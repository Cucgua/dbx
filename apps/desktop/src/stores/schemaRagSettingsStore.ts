import { defineStore } from "pinia";
import { ref } from "vue";
import * as api from "@/lib/api";
import { createDefaultSchemaRagEmbeddingConfig, normalizeSchemaRagEmbeddingConfig, type SchemaRagEmbeddingConfig } from "@/lib/schemaRagSettings";

export const useSchemaRagSettingsStore = defineStore("schemaRagSettings", () => {
  const config = ref<SchemaRagEmbeddingConfig>(createDefaultSchemaRagEmbeddingConfig());
  const loaded = ref(false);
  const loading = ref(false);
  const saving = ref(false);

  async function load() {
    if (loading.value) return;
    loading.value = true;
    try {
      const saved = await api.loadSchemaRagConfig();
      config.value = normalizeSchemaRagEmbeddingConfig(saved, config.value);
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function save(next: SchemaRagEmbeddingConfig) {
    saving.value = true;
    try {
      const normalized = normalizeSchemaRagEmbeddingConfig(next, config.value);
      await api.saveSchemaRagConfig(normalized);
      config.value = normalized;
      loaded.value = true;
    } finally {
      saving.value = false;
    }
  }

  return { config, loaded, loading, saving, load, save };
});
