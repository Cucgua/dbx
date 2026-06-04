import { DEFAULT_SCHEMA_RAG_CONFIG, normalizeSchemaRagConfig, type SchemaRagConfig } from "@/lib/schemaRagApi";

export type SchemaRagEmbeddingConfig = SchemaRagConfig;

export function createDefaultSchemaRagEmbeddingConfig(): SchemaRagEmbeddingConfig {
  return { ...DEFAULT_SCHEMA_RAG_CONFIG };
}

export function normalizeSchemaRagEmbeddingConfig(
  config: Partial<SchemaRagEmbeddingConfig> | null | undefined,
  previousConfig?: Pick<SchemaRagEmbeddingConfig, "embeddingApiKey" | "rerankApiKey"> | null,
): SchemaRagEmbeddingConfig {
  return normalizeSchemaRagConfig(config, previousConfig);
}

export function redactedSchemaRagConfig(config: SchemaRagEmbeddingConfig): SchemaRagEmbeddingConfig {
  return {
    ...config,
    embeddingApiKey: config.embeddingApiKey ? "********" : "",
    rerankApiKey: config.rerankApiKey ? "********" : "",
  };
}
