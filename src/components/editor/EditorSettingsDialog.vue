<script setup lang="ts">
import { ref, watch, shallowRef, computed } from "vue";
import type { EditorView as EditorViewType } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import { Settings } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore, EDITOR_THEMES, FONT_FAMILIES, DEFAULT_EDITOR_SETTINGS } from "@/stores/settingsStore";
import { loadEditorTheme, editorFontTheme } from "@/lib/editorThemes";
import { isTauriRuntime } from "@/lib/tauriRuntime";

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
const editWordWrap = ref(settingsStore.editorSettings.wordWrap);
const editAppLayout = ref(settingsStore.editorSettings.appLayout);

// Sync from store when dialog opens
watch(
  () => props.open,
  (open) => {
    if (open) {
      editFontFamily.value = settingsStore.editorSettings.fontFamily;
      editFontSize.value = settingsStore.editorSettings.fontSize;
      editTheme.value = settingsStore.editorSettings.theme;
      editExecuteMode.value = settingsStore.editorSettings.executeMode;
      editWordWrap.value = settingsStore.editorSettings.wordWrap;
      editAppLayout.value = settingsStore.editorSettings.appLayout;
    }
  },
);

function hasChanges(): boolean {
  return (
    editFontFamily.value !== settingsStore.editorSettings.fontFamily ||
    editFontSize.value !== settingsStore.editorSettings.fontSize ||
    editTheme.value !== settingsStore.editorSettings.theme ||
    editExecuteMode.value !== settingsStore.editorSettings.executeMode ||
    editWordWrap.value !== settingsStore.editorSettings.wordWrap ||
    editAppLayout.value !== settingsStore.editorSettings.appLayout
  );
}

function applySettings() {
  settingsStore.updateEditorSettings({
    fontFamily: editFontFamily.value,
    fontSize: editFontSize.value,
    theme: editTheme.value,
    executeMode: editExecuteMode.value,
    wordWrap: editWordWrap.value,
    appLayout: editAppLayout.value,
  });
  emit("update:open", false);
}

function resetDefaults() {
  editFontFamily.value = DEFAULT_EDITOR_SETTINGS.fontFamily;
  editFontSize.value = DEFAULT_EDITOR_SETTINGS.fontSize;
  editTheme.value = DEFAULT_EDITOR_SETTINGS.theme;
  editExecuteMode.value = DEFAULT_EDITOR_SETTINGS.executeMode;
  editWordWrap.value = DEFAULT_EDITOR_SETTINGS.wordWrap;
  editAppLayout.value = DEFAULT_EDITOR_SETTINGS.appLayout;
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

function setAppLayout(value: "separated" | "classic") {
  editAppLayout.value = value;
}

const activeSettingsTab = ref("editor");
const isWeb = !isTauriRuntime();

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
          <TabsTrigger value="appearance" class="flex-1">{{ t("settings.appearanceTab") }}</TabsTrigger>
          <TabsTrigger v-if="isWeb" value="security" class="flex-1">{{ t("settings.securityTab") }}</TabsTrigger>
          <TabsTrigger value="about" class="flex-1">{{ t("settings.aboutTab") }}</TabsTrigger>
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

          <Separator />

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

          <div class="flex items-center justify-between gap-4">
            <div class="space-y-1">
              <Label>{{ t("settings.wordWrap") }}</Label>
              <p class="text-xs text-muted-foreground">{{ t("settings.wordWrapDescription") }}</p>
            </div>
            <input v-model="editWordWrap" type="checkbox" class="h-4 w-4 shrink-0 accent-primary" />
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

          <DialogFooter class="border-t-0 bg-transparent gap-2 sm:gap-0">
            <Button variant="outline" @click="resetDefaults">
              {{ t("settings.resetDefaults") }}
            </Button>
            <div class="flex-1" />
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button :disabled="!hasChanges()" @click="applySettings">
              {{ t("settings.apply") }}
            </Button>
          </DialogFooter>
        </TabsContent>

        <TabsContent value="appearance" class="space-y-5 py-2">
          <div class="space-y-2">
            <Label>{{ t("settings.appLayout") }}</Label>
            <div class="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                class="h-auto justify-start p-3"
                :class="editAppLayout === 'separated' ? 'border-primary bg-primary/10' : ''"
                @click="setAppLayout('separated')"
              >
                <div class="text-left">
                  <div class="text-sm font-medium">{{ t("settings.appLayoutSeparated") }}</div>
                  <div class="text-xs text-muted-foreground">{{ t("settings.appLayoutSeparatedDescription") }}</div>
                </div>
              </Button>
              <Button
                type="button"
                variant="outline"
                class="h-auto justify-start p-3"
                :class="editAppLayout === 'classic' ? 'border-primary bg-primary/10' : ''"
                @click="setAppLayout('classic')"
              >
                <div class="text-left">
                  <div class="text-sm font-medium">{{ t("settings.appLayoutClassic") }}</div>
                  <div class="text-xs text-muted-foreground">{{ t("settings.appLayoutClassicDescription") }}</div>
                </div>
              </Button>
            </div>
          </div>

          <DialogFooter class="border-t-0 bg-transparent gap-2 sm:gap-0">
            <Button variant="outline" @click="resetDefaults">
              {{ t("settings.resetDefaults") }}
            </Button>
            <div class="flex-1" />
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
            <Button :disabled="!hasChanges()" @click="applySettings">
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
          <DialogFooter class="border-t-0 bg-transparent">
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

        <TabsContent value="about" class="space-y-5 py-2">
          <div class="rounded-lg border bg-muted/20 p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-1">
                <div class="text-lg font-semibold">DBX</div>
                <p class="text-sm text-muted-foreground">{{ t("settings.aboutDescription") }}</p>
              </div>
              <div class="rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">v0.5.0</div>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border p-4">
              <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {{ t("settings.community") }}
              </div>
              <div class="mt-2 text-sm font-medium">{{ t("settings.qqGroup") }}</div>
              <div class="mt-1 font-mono text-base">1087880322</div>
            </div>
            <div class="rounded-lg border p-4">
              <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {{ t("settings.project") }}
              </div>
              <div class="mt-2 text-sm font-medium">{{ t("settings.openSource") }}</div>
              <div class="mt-1 text-sm text-muted-foreground">github.com/t8y2/dbx</div>
            </div>
          </div>

          <DialogFooter class="border-t-0 bg-transparent">
            <Button variant="outline" @click="emit('update:open', false)">
              {{ t("common.close") }}
            </Button>
          </DialogFooter>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
</template>
