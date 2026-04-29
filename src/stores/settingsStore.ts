import { defineStore } from "pinia";
import { ref } from "vue";

export type AiProvider = "claude" | "openai" | "custom";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  endpoint: string;
  model: string;
}

const defaultConfigs: Record<AiProvider, Omit<AiConfig, "apiKey">> = {
  claude: { provider: "claude", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" },
  openai: { provider: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" },
  custom: { provider: "custom", endpoint: "", model: "" },
};

export const useSettingsStore = defineStore("settings", () => {
  const saved = localStorage.getItem("dbx-ai-config");
  const aiConfig = ref<AiConfig>(saved ? JSON.parse(saved) : { ...defaultConfigs.claude, apiKey: "" });

  function updateAiConfig(config: Partial<AiConfig>) {
    Object.assign(aiConfig.value, config);
    if (config.provider && config.provider !== aiConfig.value.provider) {
      const defaults = defaultConfigs[config.provider];
      aiConfig.value.endpoint = defaults.endpoint;
      aiConfig.value.model = defaults.model;
    }
    localStorage.setItem("dbx-ai-config", JSON.stringify(aiConfig.value));
  }

  function isConfigured(): boolean {
    return !!aiConfig.value.apiKey && !!aiConfig.value.endpoint;
  }

  return { aiConfig, updateAiConfig, isConfigured };
});
