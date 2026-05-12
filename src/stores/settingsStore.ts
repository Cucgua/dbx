import { defineStore } from "pinia";
import { ref } from "vue";
import * as api from "@/lib/api";

export type AiProvider = "claude" | "openai" | "custom";
export type AiApiStyle = "completions" | "responses";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  apiStyle: AiApiStyle;
  proxyEnabled?: boolean;
  proxyUrl?: string;
}

const defaultConfigs: Record<AiProvider, Omit<AiConfig, "apiKey">> = {
  claude: {
    provider: "claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-20250514",
    apiStyle: "completions",
  },
  openai: {
    provider: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
    apiStyle: "completions",
  },
  custom: { provider: "custom", endpoint: "", model: "", apiStyle: "completions" },
};

export type EditorTheme =
  | "one-dark"
  | "vscode-dark"
  | "vscode-light"
  | "nord"
  | "okaidia"
  | "material"
  | "duotone-light"
  | "duotone-dark"
  | "xcode";

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  theme: EditorTheme;
  executeMode: "all" | "current";
  wordWrap: boolean;
  appLayout: "separated" | "classic";
}

export interface AppSettings {
  oracleClientLibDir: string;
  oracleClientConfigDir: string;
  mcpHttpEnabled: boolean;
  mcpHttpHost: string;
  mcpHttpPort: number;
}

export const EDITOR_THEMES: { value: EditorTheme; label: string; dark: boolean }[] = [
  { value: "one-dark", label: "One Dark", dark: true },
  { value: "vscode-dark", label: "VS Dark+", dark: true },
  { value: "vscode-light", label: "VS Light+", dark: false },
  { value: "nord", label: "Nord", dark: true },
  { value: "okaidia", label: "Okaidia", dark: true },
  { value: "material", label: "Material", dark: true },
  { value: "duotone-light", label: "Duotone Light", dark: false },
  { value: "duotone-dark", label: "Duotone Dark", dark: true },
  { value: "xcode", label: "Xcode", dark: false },
];

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: "'JetBrains Mono', 'Fira Code', monospace", label: "JetBrains Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code" },
  { value: "'Source Code Pro', monospace", label: "Source Code Pro" },
  { value: "'SF Mono', 'Menlo', monospace", label: "SF Mono / Menlo" },
  { value: "'Consolas', 'Courier New', monospace", label: "Consolas" },
  { value: "monospace", label: "System Monospace" },
];

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 13,
  theme: "one-dark",
  executeMode: "all",
  wordWrap: false,
  appLayout: "classic",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  oracleClientLibDir: "",
  oracleClientConfigDir: "",
  mcpHttpEnabled: true,
  mcpHttpHost: "127.0.0.1",
  mcpHttpPort: 7424,
};

export const STORAGE_KEY = "dbx-editor-settings";
const OLD_FONT_SIZE_KEY = "dbx-query-editor-font-size";

function loadEditorSettings(): EditorSettings {
  // Try new format first
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EditorSettings>;
      return {
        fontFamily: parsed.fontFamily ?? DEFAULT_EDITOR_SETTINGS.fontFamily,
        fontSize: parsed.fontSize ?? DEFAULT_EDITOR_SETTINGS.fontSize,
        theme: parsed.theme ?? DEFAULT_EDITOR_SETTINGS.theme,
        executeMode: parsed.executeMode ?? DEFAULT_EDITOR_SETTINGS.executeMode,
        wordWrap: parsed.wordWrap ?? DEFAULT_EDITOR_SETTINGS.wordWrap,
        appLayout: parsed.appLayout ?? DEFAULT_EDITOR_SETTINGS.appLayout,
      };
    }
  } catch {
    /* ignore */
  }

  // Migrate old font-size key if new settings don't exist
  try {
    const oldSize = localStorage.getItem(OLD_FONT_SIZE_KEY);
    if (oldSize) {
      const parsed = parseInt(oldSize, 10);
      if (!isNaN(parsed)) {
        const migrated: EditorSettings = {
          ...DEFAULT_EDITOR_SETTINGS,
          fontSize: parsed,
        };
        saveEditorSettings(migrated);
        localStorage.removeItem(OLD_FONT_SIZE_KEY);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }

  return { ...DEFAULT_EDITOR_SETTINGS };
}

function saveEditorSettings(settings: EditorSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useSettingsStore = defineStore("settings", () => {
  const aiConfig = ref<AiConfig>({ ...defaultConfigs.claude, apiKey: "", apiStyle: "completions" });
  const isAiConfigLoaded = ref(false);
  const isAppSettingsLoaded = ref(false);

  const editorSettings = ref<EditorSettings>(loadEditorSettings());
  const appSettings = ref<AppSettings>({ ...DEFAULT_APP_SETTINGS });

  async function initAiConfig() {
    if (isAiConfigLoaded.value) return;
    const legacy = localStorage.getItem("dbx-ai-config");
    const saved = await api.loadAiConfig().catch(() => null);
    if (saved) {
      aiConfig.value = saved;
    } else if (legacy) {
      aiConfig.value = JSON.parse(legacy);
      await api.saveAiConfig(aiConfig.value).catch(() => {});
      localStorage.removeItem("dbx-ai-config");
    }
    isAiConfigLoaded.value = true;
  }

  function updateAiConfig(config: Partial<AiConfig>) {
    const previousProvider = aiConfig.value.provider;
    if (config.provider && config.provider !== previousProvider) {
      Object.assign(aiConfig.value, defaultConfigs[config.provider]);
    }
    Object.assign(aiConfig.value, config);
    api.saveAiConfig(aiConfig.value).catch(() => {});
  }

  async function initAppSettings() {
    if (isAppSettingsLoaded.value) return;
    const saved = await api.loadAppSettings().catch(() => null);
    appSettings.value = {
      oracleClientLibDir: saved?.oracleClientLibDir || DEFAULT_APP_SETTINGS.oracleClientLibDir,
      oracleClientConfigDir: saved?.oracleClientConfigDir || DEFAULT_APP_SETTINGS.oracleClientConfigDir,
      mcpHttpEnabled: saved?.mcpHttpEnabled ?? DEFAULT_APP_SETTINGS.mcpHttpEnabled,
      mcpHttpHost: saved?.mcpHttpHost || DEFAULT_APP_SETTINGS.mcpHttpHost,
      mcpHttpPort: saved?.mcpHttpPort || DEFAULT_APP_SETTINGS.mcpHttpPort,
    };
    isAppSettingsLoaded.value = true;
  }

  function updateAppSettings(config: Partial<AppSettings>) {
    Object.assign(appSettings.value, config);
    api.saveAppSettings(appSettings.value).catch(() => {});
  }

  function isConfigured(): boolean {
    return !!aiConfig.value.apiKey && !!aiConfig.value.endpoint;
  }

  function updateEditorSettings(partial: Partial<EditorSettings>) {
    Object.assign(editorSettings.value, partial);
    saveEditorSettings(editorSettings.value);
  }

  return {
    aiConfig,
    isAiConfigLoaded,
    isAppSettingsLoaded,
    initAiConfig,
    initAppSettings,
    updateAiConfig,
    updateAppSettings,
    isConfigured,
    editorSettings,
    appSettings,
    updateEditorSettings,
  };
});
