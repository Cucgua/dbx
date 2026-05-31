<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { translateBackendError } from "@/i18n/backend-errors";
import { Upload, Download, RefreshCw } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import LightDropdown from "@/components/ui/LightDropdown.vue";
import ConnectionTree from "@/components/sidebar/ConnectionTree.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToast } from "@/composables/useToast";

defineProps<{
  sidebarWidth: number;
  classicLayout?: boolean;
}>();

const emit = defineEmits<{
  import: [source: "dbx" | "navicat" | "dbeaver"];
  export: [];
  startResize: [event: MouseEvent];
}>();

const { t } = useI18n();
const connectionStore = useConnectionStore();
const { toast } = useToast();
const connectionTreeRef = ref<InstanceType<typeof ConnectionTree>>();
const importSourceItems = computed(() => [
  { value: "dbx", label: t("sidebar.importDbx") },
  { value: "navicat", label: t("sidebar.importNavicat") },
  { value: "dbeaver", label: t("sidebar.importDbeaver") },
]);

async function refreshTree() {
  try {
    await connectionStore.refreshAllTree();
  } catch (e: any) {
    toast(t("connection.connectFailed", { message: translateBackendError(t, e?.message || String(e)) }), 5000);
  }
}

function focusSearch(): boolean {
  return connectionTreeRef.value?.focusSearch() ?? false;
}

defineExpose({ focusSearch });
</script>

<template>
  <div
    class="h-full shrink-0 relative select-none"
    :class="classicLayout ? '' : 'rounded-md border border-border/80 bg-background'"
    :style="{ width: sidebarWidth + 'px' }"
  >
    <div class="h-full flex flex-col overflow-hidden">
      <div
        class="flex items-center px-3 text-xs font-medium text-muted-foreground border-b bg-muted/20"
        :class="classicLayout ? 'h-9' : 'h-10'"
      >
        <span class="flex self-stretch items-center truncate" data-tauri-drag-region>{{
          t("sidebar.connections")
        }}</span>
        <span class="flex-1 self-stretch" data-tauri-drag-region />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-5 w-5" @click="refreshTree">
              <RefreshCw class="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("contextMenu.refreshChildren") }}</TooltipContent>
        </Tooltip>
        <LightDropdown
          model-value=""
          :items="importSourceItems"
          :aria-label="t('sidebar.import')"
          :trigger-title="t('sidebar.import')"
          :trigger-icon="Upload"
          trigger-class="inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
          trigger-icon-class="h-3 w-3"
          content-class="w-44"
          :show-trigger-label="false"
          :show-chevron="false"
          :highlight-selected="false"
          check-position="none"
          align="end"
          @update:model-value="(source) => emit('import', source as 'dbx' | 'navicat' | 'dbeaver')"
        />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-5 w-5" @click="emit('export')">
              <Download class="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t("sidebar.export") }}</TooltipContent>
        </Tooltip>
      </div>
      <div class="flex-1 min-h-0">
        <ConnectionTree ref="connectionTreeRef" />
      </div>
    </div>
    <div class="panel-resize-handle panel-resize-handle--right" @mousedown="emit('startResize', $event)" />
  </div>
</template>
