<script setup lang="ts">
import { ref, watch, shallowRef, computed } from "vue";
import type { EditorView as EditorViewType } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import { Copy, FolderOpen, RefreshCw, Settings } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useSettingsStore,
  EDITOR_THEMES,
  FONT_FAMILIES,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_APP_SETTINGS,
} from "@/stores/settingsStore";
import { loadEditorTheme, editorFontTheme } from "@/lib/editorThemes";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import * as api from "@/lib/api";
import type { McpHttpStatus } from "@/lib/api";

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

// Local edit state
const editFontFamily = ref(settingsStore.editorSettings.fontFamily);
const editFontSize = ref(settingsStore.editorSettings.fontSize);
const editTheme = ref(settingsStore.editorSettings.theme);
const editExecuteMode = ref(settingsStore.editorSettings.executeMode);
const editOracleClientLibDir = ref(settingsStore.appSettings.oracleClientLibDir);
const editOracleClientConfigDir = ref(settingsStore.appSettings.oracleClientConfigDir);
const editMcpHttpEnabled = ref(settingsStore.appSettings.mcpHttpEnabled);
const editMcpHttpHost = ref(settingsStore.appSettings.mcpHttpHost);
const editMcpHttpPort = ref(String(settingsStore.appSettings.mcpHttpPort));
const mcpHttpStatus = ref<McpHttpStatus | null>(null);
const mcpStatusLoading = ref(false);
const mcpStatusError = ref("");

const normalizedMcpHttpHost = computed(() => editMcpHttpHost.value.trim());
const normalizedMcpHttpPort = computed(() => Number(editMcpHttpPort.value));
const isMcpHttpHostValid = computed(() => normalizedMcpHttpHost.value.length > 0);
const isMcpHttpPortValid = computed(
  () =>
    Number.isInteger(normalizedMcpHttpPort.value) &&
    normalizedMcpHttpPort.value > 0 &&
    normalizedMcpHttpPort.value <= 65535,
);
const isMcpHttpSettingsValid = computed(() => isMcpHttpHostValid.value && isMcpHttpPortValid.value);
const mcpEndpointPreview = computed(
  () => `http://${normalizedMcpHttpHost.value || "127.0.0.1"}:${normalizedMcpHttpPort.value || 7424}/mcp`,
);
const mcpStatusStartedAt = computed(() => {
  if (!mcpHttpStatus.value?.started_at) return "";
  return new Date(mcpHttpStatus.value.started_at).toLocaleString();
});

// Sync from store when dialog opens
watch(
  () => props.open,
  async (open) => {
    if (open) {
      await settingsStore.initAppSettings();
      if (!props.open) return;
      editFontFamily.value = settingsStore.editorSettings.fontFamily;
      editFontSize.value = settingsStore.editorSettings.fontSize;
      editTheme.value = settingsStore.editorSettings.theme;
      editExecuteMode.value = settingsStore.editorSettings.executeMode;
      editOracleClientLibDir.value = settingsStore.appSettings.oracleClientLibDir;
      editOracleClientConfigDir.value = settingsStore.appSettings.oracleClientConfigDir;
      editMcpHttpEnabled.value = settingsStore.appSettings.mcpHttpEnabled;
      editMcpHttpHost.value = settingsStore.appSettings.mcpHttpHost;
      editMcpHttpPort.value = String(settingsStore.appSettings.mcpHttpPort);
      await refreshMcpHttpStatus();
    }
  },
);

function hasEditorChanges(): boolean {
  return (
    editFontFamily.value !== settingsStore.editorSettings.fontFamily ||
    editFontSize.value !== settingsStore.editorSettings.fontSize ||
    editTheme.value !== settingsStore.editorSettings.theme ||
    editExecuteMode.value !== settingsStore.editorSettings.executeMode
  );
}

function hasSystemChanges(): boolean {
  return (
    editOracleClientLibDir.value !== settingsStore.appSettings.oracleClientLibDir ||
    editOracleClientConfigDir.value !== settingsStore.appSettings.oracleClientConfigDir
  );
}

function hasMcpChanges(): boolean {
  return (
    editMcpHttpEnabled.value !== settingsStore.appSettings.mcpHttpEnabled ||
    normalizedMcpHttpHost.value !== settingsStore.appSettings.mcpHttpHost ||
    normalizedMcpHttpPort.value !== settingsStore.appSettings.mcpHttpPort
  );
}

function applyEditorSettings() {
  settingsStore.updateEditorSettings({
    fontFamily: editFontFamily.value,
    fontSize: editFontSize.value,
    theme: editTheme.value,
    executeMode: editExecuteMode.value,
  });
  emit("update:open", false);
}

function applySystemSettings() {
  settingsStore.updateAppSettings({
    oracleClientLibDir: editOracleClientLibDir.value.trim(),
    oracleClientConfigDir: editOracleClientConfigDir.value.trim(),
  });
  emit("update:open", false);
}

function applyMcpSettings() {
  if (!isMcpHttpSettingsValid.value) return;
  settingsStore.updateAppSettings({
    mcpHttpEnabled: editMcpHttpEnabled.value,
    mcpHttpHost: normalizedMcpHttpHost.value,
    mcpHttpPort: normalizedMcpHttpPort.value,
  });
  emit("update:open", false);
}

function resetEditorDefaults() {
  editFontFamily.value = DEFAULT_EDITOR_SETTINGS.fontFamily;
  editFontSize.value = DEFAULT_EDITOR_SETTINGS.fontSize;
  editTheme.value = DEFAULT_EDITOR_SETTINGS.theme;
  editExecuteMode.value = DEFAULT_EDITOR_SETTINGS.executeMode;
}

function resetSystemDefaults() {
  editOracleClientLibDir.value = DEFAULT_APP_SETTINGS.oracleClientLibDir;
  editOracleClientConfigDir.value = DEFAULT_APP_SETTINGS.oracleClientConfigDir;
}

function resetMcpDefaults() {
  editMcpHttpEnabled.value = DEFAULT_APP_SETTINGS.mcpHttpEnabled;
  editMcpHttpHost.value = DEFAULT_APP_SETTINGS.mcpHttpHost;
  editMcpHttpPort.value = String(DEFAULT_APP_SETTINGS.mcpHttpPort);
}

function onExecuteModeChange(v: any) {
  if (v === "all" || v === "current") editExecuteMode.value = v;
}

function onFontFamilyChange(v: any) {
  if (typeof v === "string") editFontFamily.value = v;
}

function onThemeChange(v: any) {
  if (typeof v === "string") editTheme.value = v as typeof DEFAULT_EDITOR_SETTINGS.theme;
}

const activeSettingsTab = ref("editor");
const isWeb = !isTauriRuntime();
const isDesktop = !isWeb;

async function refreshMcpHttpStatus() {
  if (!isDesktop) return;
  mcpStatusLoading.value = true;
  mcpStatusError.value = "";
  try {
    mcpHttpStatus.value = await api.loadMcpHttpStatus();
  } catch (e) {
    mcpHttpStatus.value = null;
    mcpStatusError.value = e instanceof Error ? e.message : String(e);
  } finally {
    mcpStatusLoading.value = false;
  }
}

async function copyText(text: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      activeSettingsTab.value = "editor";
      passwordMessage.value = "";
      oldPassword.value = "";
      newPassword.value = "";
      confirmNewPassword.value = "";
    }
  },
);
const oldPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");
const passwordMessage = ref("");
const passwordError = ref(false);
const changingPassword = ref(false);

async function browseOracleClientLibDir() {
  const selected = await browseDirectory();
  if (selected) editOracleClientLibDir.value = selected;
}

async function browseOracleClientConfigDir() {
  const selected = await browseDirectory();
  if (selected) editOracleClientConfigDir.value = selected;
}

async function browseDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

async function changePassword() {
  if (newPassword.value !== confirmNewPassword.value) {
    passwordMessage.value = t("auth.passwordMismatch");
    passwordError.value = true;
    return;
  }
  changingPassword.value = true;
  passwordMessage.value = "";
  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword.value, new_password: newPassword.value }),
    });
    if (res.ok) {
      passwordMessage.value = t("auth.passwordChanged");
      passwordError.value = false;
      oldPassword.value = "";
      newPassword.value = "";
      confirmNewPassword.value = "";
    } else if (res.status === 401) {
      passwordMessage.value = t("auth.oldPasswordWrong");
      passwordError.value = true;
    } else {
      passwordMessage.value = t("auth.changePasswordFailed");
      passwordError.value = true;
    }
  } catch {
    passwordMessage.value = t("auth.connectFailed");
    passwordError.value = true;
  } finally {
    changingPassword.value = false;
  }
}

// ---------- CodeMirror preview ----------
const previewRef = ref<HTMLDivElement>();
const previewView = shallowRef<EditorViewType | null>(null);

const previewSettings = computed(() => ({
  fontFamily: editFontFamily.value,
  fontSize: editFontSize.value,
  theme: editTheme.value,
}));

const previewSql = `SELECT u.id, u.name
FROM users u
ORDER BY u.id LIMIT 5;`;

let fontThemeComp: import("@codemirror/state").Compartment | null = null;
let themeComp: import("@codemirror/state").Compartment | null = null;
let editorViewModule: typeof import("@codemirror/view") | null = null;

watch(
  previewSettings,
  async (ss) => {
    if (!previewView.value || !fontThemeComp || !themeComp || !editorViewModule) return;

    const themeExt = await loadEditorTheme(ss.theme);
    previewView.value.dispatch({
      effects: [
        themeComp.reconfigure(themeExt),
        fontThemeComp.reconfigure(editorFontTheme(editorViewModule.EditorView, ss.fontSize, ss.fontFamily)),
      ],
    });
  },
  { deep: true },
);

let previewInitialized = false;

watch(activeSettingsTab, (tab) => {
  if (tab !== "editor" && previewView.value) {
    previewView.value.destroy();
    previewView.value = null;
    previewInitialized = false;
    fontThemeComp = null;
    themeComp = null;
    editorViewModule = null;
  }
});

watch(previewRef, async (el) => {
  if (!el || previewInitialized) return;
  previewInitialized = true;
  if (previewView.value) return;

  const [{ EditorView }, { EditorState, Compartment }, { sql, MySQL }, { basicSetup }] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/state"),
    import("@codemirror/lang-sql"),
    import("codemirror"),
  ]);

  editorViewModule = { EditorView } as typeof import("@codemirror/view");
  fontThemeComp = new Compartment();
  themeComp = new Compartment();

  const ss = previewSettings.value;
  const themeExt = await loadEditorTheme(ss.theme);

  const state = EditorState.create({
    doc: previewSql,
    extensions: [
      basicSetup,
      sql({ dialect: MySQL }),
      themeComp.of(themeExt),
      fontThemeComp.of(editorFontTheme(EditorView, ss.fontSize, ss.fontFamily)),
    ],
  });

  previewView.value = new EditorView({ state, parent: previewRef.value });
});

watch(
  () => props.open,
  (open) => {
    if (!open && previewView.value) {
      previewView.value.destroy();
      previewView.value = null;
      previewInitialized = false;
      fontThemeComp = null;
      themeComp = null;
      editorViewModule = null;
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[720px] max-h-[calc(100vh-80px)] overflow-y-auto overflow-x-hidden">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Settings class="h-4 w-4" />
          {{ t("settings.title") }}
        </DialogTitle>
      </DialogHeader>

      <Tabs v-model="activeSettingsTab">
        <TabsList class="w-full">
          <TabsTrigger value="editor" class="flex-1">{{ t("settings.editorTab") }}</TabsTrigger>
          <TabsTrigger v-if="isDesktop" value="system" class="flex-1">{{ t("settings.systemTab") }}</TabsTrigger>
          <TabsTrigger v-if="isDesktop" value="mcp" class="flex-1">{{ t("settings.mcpTab") }}</TabsTrigger>
          <TabsTrigger v-if="isWeb" value="security" class="flex-1">{{ t("settings.securityTab") }}</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" class="space-y-5 py-2">
          <!-- Font Family -->
          <div class="space-y-2">
            <Label>{{ t("settings.fontFamily") }}</Label>
            <Select :model-value="editFontFamily" @update:model-value="onFontFamilyChange">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.selectFont')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="font in FONT_FAMILIES"
                  :key="font.value"
                  :value="font.value"
                  :style="{ fontFamily: font.value }"
                >
                  {{ font.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground leading-relaxed font-mono" :style="{ fontFamily: editFontFamily }">
              SELECT * FROM users WHERE id = 1;
            </p>
          </div>

          <Separator />

          <!-- Font Size -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label>{{ t("settings.fontSize") }}</Label>
              <span class="text-xs text-muted-foreground tabular-nums">{{ editFontSize }}px</span>
            </div>
            <input
              type="range"
              min="10"
              max="24"
              step="1"
              :value="editFontSize"
              @input="editFontSize = Number(($event.target as HTMLInputElement).value)"
              class="w-full accent-primary"
            />
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <span>10px</span>
              <span class="flex-1 border-b border-dashed border-muted-foreground/30" />
              <span>24px</span>
            </div>
          </div>

          <Separator />

          <!-- Theme -->
          <div class="space-y-2">
            <Label>{{ t("settings.theme") }}</Label>
            <Select :model-value="editTheme" @update:model-value="onThemeChange">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.selectTheme')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="theme in EDITOR_THEMES" :key="theme.value" :value="theme.value">
                  <div class="flex items-center gap-2">
                    <span
                      class="h-3 w-3 rounded-full border"
                      :class="
                        theme.dark
                          ? 'bg-foreground border-foreground/20'
                          : 'bg-muted-foreground/30 border-muted-foreground/40'
                      "
                    />
                    {{ theme.label }}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label>{{ t("settings.executeMode") }}</Label>
            <Select :model-value="editExecuteMode" @update:model-value="onExecuteModeChange">
              <SelectTrigger>
                <SelectValue :placeholder="t('settings.executeMode')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ t("settings.executeModeAll") }}</SelectItem>
                <SelectItem value="current">{{ t("settings.executeModeCurrent") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <!-- Live Preview -->
          <div class="space-y-2">
            <Label>{{ t("settings.preview") }}</Label>
            <div
              class="rounded-md border overflow-auto max-w-full"
              :class="
                editTheme === 'vscode-light' || editTheme === 'duotone-light' || editTheme === 'xcode'
                  ? 'border-border'
                  : 'border-border/50'
              "
            >
              <div ref="previewRef" style="min-width: 100%" />
            </div>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" @click="resetEditorDefaults">
              {{ t("settings.resetDefaults") }}
            </Button>
            <div class="flex-1" />
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button :disabled="!hasEditorChanges()" @click="applyEditorSettings">
              {{ t("settings.apply") }}
            </Button>
          </DialogFooter>
        </TabsContent>

        <TabsContent v-if="isDesktop" value="system" class="space-y-5 py-2">
          <div class="space-y-3">
            <div>
              <Label class="text-base">{{ t("settings.oracleOciTitle") }}</Label>
              <p class="mt-1 text-sm text-muted-foreground">{{ t("settings.oracleOciDescription") }}</p>
            </div>

            <div class="space-y-2">
              <Label>{{ t("settings.oracleClientLibDir") }}</Label>
              <div class="flex gap-2">
                <Input v-model="editOracleClientLibDir" class="h-9" placeholder="C:\\oracle\\instantclient_19_28" />
                <Button variant="outline" size="icon" class="h-9 w-9 shrink-0" @click="browseOracleClientLibDir">
                  <FolderOpen class="h-4 w-4" />
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">{{ t("settings.oracleClientLibDirHint") }}</p>
            </div>

            <div class="space-y-2">
              <Label>{{ t("settings.oracleClientConfigDir") }}</Label>
              <div class="flex gap-2">
                <Input v-model="editOracleClientConfigDir" class="h-9" placeholder="C:\\oracle\\network\\admin" />
                <Button variant="outline" size="icon" class="h-9 w-9 shrink-0" @click="browseOracleClientConfigDir">
                  <FolderOpen class="h-4 w-4" />
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">{{ t("settings.oracleClientConfigDirHint") }}</p>
            </div>

            <p class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {{ t("settings.oracleOciRestartHint") }}
            </p>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" @click="resetSystemDefaults">
              {{ t("settings.resetDefaults") }}
            </Button>
            <div class="flex-1" />
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button :disabled="!hasSystemChanges()" @click="applySystemSettings">
              {{ t("settings.apply") }}
            </Button>
          </DialogFooter>
        </TabsContent>

        <TabsContent v-if="isDesktop" value="mcp" class="space-y-5 py-2">
          <div class="space-y-4">
            <div>
              <Label class="text-base">{{ t("settings.mcpTitle") }}</Label>
              <p class="mt-1 text-sm text-muted-foreground">{{ t("settings.mcpDescription") }}</p>
            </div>

            <div class="flex items-start justify-between gap-4 rounded-md border px-3 py-3">
              <div class="min-w-0 space-y-1">
                <Label for="mcp-http-enabled">{{ t("settings.mcpEnabled") }}</Label>
                <p class="text-xs text-muted-foreground">{{ t("settings.mcpEnabledHint") }}</p>
              </div>
              <input
                id="mcp-http-enabled"
                v-model="editMcpHttpEnabled"
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
            </div>

            <div class="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div class="space-y-2">
                <Label>{{ t("settings.mcpHost") }}</Label>
                <Input v-model="editMcpHttpHost" class="h-9" placeholder="127.0.0.1" />
                <p class="text-xs text-muted-foreground">{{ t("settings.mcpHostHint") }}</p>
              </div>
              <div class="space-y-2">
                <Label>{{ t("settings.mcpPort") }}</Label>
                <Input
                  :model-value="editMcpHttpPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="h-9"
                  :aria-invalid="!isMcpHttpPortValid"
                  @update:model-value="editMcpHttpPort = String($event)"
                />
                <p class="text-xs text-muted-foreground">{{ t("settings.mcpPortHint") }}</p>
              </div>
            </div>

            <div class="space-y-2">
              <Label>{{ t("settings.mcpEndpointPreview") }}</Label>
              <div class="flex gap-2">
                <Input :model-value="mcpEndpointPreview" readonly class="h-9 font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  class="h-9 w-9 shrink-0"
                  :title="t('settings.mcpCopyEndpoint')"
                  @click="copyText(mcpEndpointPreview)"
                >
                  <Copy class="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Separator />

            <div class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <Label class="text-sm">{{ t("settings.mcpCurrentStatus") }}</Label>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {{
                      mcpHttpStatus
                        ? mcpHttpStatus.enabled
                          ? t("settings.mcpStatusRunning")
                          : t("settings.mcpStatusDisabled")
                        : t("settings.mcpStatusUnknown")
                    }}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  class="h-8 w-8 shrink-0"
                  :title="t('settings.mcpRefreshStatus')"
                  :disabled="mcpStatusLoading"
                  @click="refreshMcpHttpStatus"
                >
                  <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': mcpStatusLoading }" />
                </Button>
              </div>

              <p v-if="mcpStatusError" class="text-xs text-destructive">{{ mcpStatusError }}</p>

              <div v-if="mcpHttpStatus" class="space-y-3">
                <div class="space-y-2">
                  <Label>{{ t("settings.mcpCurrentEndpoint") }}</Label>
                  <div class="flex gap-2">
                    <Input :model-value="mcpHttpStatus.endpoint" readonly class="h-9 font-mono text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      class="h-9 w-9 shrink-0"
                      :title="t('settings.mcpCopyEndpoint')"
                      @click="copyText(mcpHttpStatus.endpoint)"
                    >
                      <Copy class="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div class="space-y-2">
                  <Label>{{ t("settings.mcpToken") }}</Label>
                  <div class="flex gap-2">
                    <Input :model-value="mcpHttpStatus.token" readonly type="password" class="h-9 font-mono text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      class="h-9 w-9 shrink-0"
                      :title="t('settings.mcpCopyToken')"
                      @click="copyText(mcpHttpStatus.token)"
                    >
                      <Copy class="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <p v-if="mcpStatusStartedAt" class="text-xs text-muted-foreground">
                  {{ t("settings.mcpStartedAt", { time: mcpStatusStartedAt }) }}
                </p>
              </div>
            </div>

            <p class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {{ t("settings.mcpRestartHint") }}
            </p>
          </div>

          <DialogFooter class="gap-2 sm:gap-0">
            <Button variant="outline" @click="resetMcpDefaults">
              {{ t("settings.resetDefaults") }}
            </Button>
            <div class="flex-1" />
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button :disabled="!hasMcpChanges() || !isMcpHttpSettingsValid" @click="applyMcpSettings">
              {{ t("settings.apply") }}
            </Button>
          </DialogFooter>
        </TabsContent>

        <TabsContent v-if="isWeb" value="security" class="space-y-5 py-2">
          <div class="space-y-3">
            <Label class="text-base">{{ t("auth.changePassword") }}</Label>
            <p class="text-sm text-muted-foreground">{{ t("auth.changePasswordDescription") }}</p>
            <Input
              v-model="oldPassword"
              type="password"
              :placeholder="t('auth.oldPassword')"
              class="h-9"
              autocomplete="off"
            />
            <Input
              v-model="newPassword"
              type="password"
              :placeholder="t('auth.newPassword')"
              class="h-9"
              autocomplete="off"
            />
            <Input
              v-model="confirmNewPassword"
              type="password"
              :placeholder="t('auth.confirmPassword')"
              class="h-9"
              autocomplete="off"
            />
            <p v-if="passwordMessage" class="text-xs" :class="passwordError ? 'text-destructive' : 'text-green-500'">
              {{ passwordMessage }}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button
              :disabled="changingPassword || !oldPassword || !newPassword || !confirmNewPassword"
              @click="changePassword"
            >
              {{ t("auth.changePassword") }}
            </Button>
          </DialogFooter>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
