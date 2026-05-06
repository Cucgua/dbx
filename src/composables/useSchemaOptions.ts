import { ref } from "vue";
import { useConnectionStore } from "@/stores/connectionStore";
import * as api from "@/lib/api";

export function useSchemaOptions() {
  const connectionStore = useConnectionStore();

  const schemaOptions = ref<Record<string, string[]>>({});
  const loadingSchemaOptions = ref<Record<string, boolean>>({});

  function cacheKey(connectionId: string, database: string) {
    return `${connectionId}:${database}`;
  }

  function isSchemaAware(connectionId: string): boolean {
    const dbType = connectionStore.getConfig(connectionId)?.db_type;
    return dbType === "postgres" || dbType === "sqlserver" || dbType === "oracle";
  }

  async function loadSchemaOptions(connectionId: string, database: string) {
    if (!isSchemaAware(connectionId) || !database) return;
    const key = cacheKey(connectionId, database);
    if (loadingSchemaOptions.value[key]) return;

    loadingSchemaOptions.value[key] = true;
    try {
      await connectionStore.ensureConnected(connectionId);
      schemaOptions.value[key] = await api.listSchemas(connectionId, database);
    } finally {
      loadingSchemaOptions.value[key] = false;
    }
  }

  function getSchemaOptionsForDb(connectionId: string, database: string): string[] {
    return schemaOptions.value[cacheKey(connectionId, database)] ?? [];
  }

  function isLoadingSchemas(connectionId: string, database: string): boolean {
    return !!loadingSchemaOptions.value[cacheKey(connectionId, database)];
  }

  return {
    schemaOptions,
    loadingSchemaOptions,
    loadSchemaOptions,
    getSchemaOptionsForDb,
    isLoadingSchemas,
    isSchemaAware,
  };
}
