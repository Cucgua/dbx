import type { AiConfig } from "@/stores/settingsStore";
import type { SchemaRagStatus } from "@/lib/schemaRagApi";
import type { SchemaRagAiToolContext } from "@/lib/schemaRagAiTools";
import { supportsAiSchemaToolLoop, type AiContext } from "@/lib/ai";

export type AiAssistantMode = "ask" | "agent" | "rag";
export type AiRagModeUnavailableReason = "no-schema" | "not-indexed" | "unsupported-ai-config";

export interface AiRagModeAvailability {
  available: boolean;
  reason: AiRagModeUnavailableReason | null;
}

export interface SchemaResearchRuntimeConfig {
  config: AiConfig;
  maxToolRounds: number;
  maxOutputTokens: number;
}

export function hasSchemaRagAnalysis(status: SchemaRagStatus | null | undefined): boolean {
  return !!status?.indexed && !!status.manifest;
}

export function getAiRagModeAvailability(config: AiConfig, context: SchemaRagAiToolContext | null | undefined, status: SchemaRagStatus | null | undefined): AiRagModeAvailability {
  if (!context?.connectionId || !context.schema) {
    return { available: false, reason: "no-schema" };
  }
  if (!hasSchemaRagAnalysis(status)) {
    return { available: false, reason: "not-indexed" };
  }
  if (config.schemaResearch?.enabled === false) {
    return { available: false, reason: "unsupported-ai-config" };
  }
  if (
    !supportsAiSchemaToolLoop(resolveSchemaResearchAiConfig(config), {
      connectionName: "",
      databaseType: context.databaseType,
      connectionId: context.connectionId,
      database: context.database,
      schema: context.schema,
      currentSql: "",
      tables: [],
      truncated: false,
    } satisfies AiContext)
  ) {
    return { available: false, reason: "unsupported-ai-config" };
  }
  return { available: true, reason: null };
}

export function resolveSchemaResearchRuntimeConfig(config: AiConfig, fallbackMaxTokens: number): SchemaResearchRuntimeConfig {
  const toolConfig = resolveSchemaResearchAiConfig(config);
  const schemaResearch = toolConfig.schemaResearch;
  return {
    config: toolConfig,
    maxToolRounds: schemaResearch?.maxToolRounds ?? 4,
    maxOutputTokens: schemaResearch?.maxOutputTokens ?? fallbackMaxTokens,
  };
}

export function resolveSchemaResearchAiConfig(config: AiConfig): AiConfig {
  const schemaResearch = config.schemaResearch;
  if (!schemaResearch?.enabled || schemaResearch.useMainModel) return config;
  return {
    ...config,
    provider: schemaResearch.provider,
    apiKey: schemaResearch.apiKey,
    endpoint: schemaResearch.endpoint,
    model: schemaResearch.model,
    apiStyle: schemaResearch.apiStyle,
    proxyEnabled: schemaResearch.proxyEnabled,
    proxyUrl: schemaResearch.proxyUrl,
    schemaResearch,
  };
}

export function normalizeAiAssistantModeForRagAvailability(currentMode: AiAssistantMode, ragAvailable: boolean, options: { preferRag?: boolean } = {}): AiAssistantMode {
  if (ragAvailable && options.preferRag) return "rag";
  if (!ragAvailable && currentMode === "rag") return "ask";
  return currentMode;
}
