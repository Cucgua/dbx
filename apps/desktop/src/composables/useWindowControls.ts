import { ref, onMounted, onUnmounted } from "vue";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { isMacOS } from "@/lib/platform";

export function useWindowControls() {
  const isMaximized = ref(false);
  const isMac = isMacOS();
  const isDesktop = isTauriRuntime();
  const showControls = isDesktop && !isMac;

  let unlisten: (() => void) | null = null;

  async function updateMaximizedState() {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    isMaximized.value = await getCurrentWindow().isMaximized();
  }

  async function minimize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  }

  async function toggleMaximize() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
    setTimeout(updateMaximizedState, 50);
  }

  async function close() {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }

  onMounted(async () => {
    if (!isDesktop) return;
    await updateMaximizedState();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const unlistenFn = await getCurrentWindow().onResized(() => {
      updateMaximizedState();
    });
    unlisten = unlistenFn;
  });

  onUnmounted(() => {
    unlisten?.();
  });

  return {
    isMac,
    isDesktop,
    showControls,
    isMaximized,
    minimize,
    toggleMaximize,
    close,
  };
}
