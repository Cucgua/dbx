import { strict as assert } from "node:assert";
import test from "node:test";

import {
  getAiRagModeAvailability,
  normalizeAiAssistantModeForRagAvailability,
  resolveSchemaResearchRuntimeConfig,
} from "../../apps/desktop/src/lib/aiRagMode.ts";
import type { AiConfig } from "../../apps/desktop/src/stores/settingsStore.ts";
import type { SchemaRagStatus } from "../../apps/desktop/src/lib/schemaRagApi.ts";

function completionsConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "openai",
    apiStyle: "completions",
    endpoint: "https://example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    proxyEnabled: false,
    proxyUrl: "",
    enableThinking: true,
    ...overrides,
  };
}

const context = {
  connectionId: "conn-1",
  databaseType: "postgres" as const,
  database: "app",
  schema: "public",
};

const indexedStatus: SchemaRagStatus = {
  indexed: true,
  indexPath: "C:/dbx/schema-rag/index",
  manifest: {
    connectionId: "conn-1",
    database: "app",
    schema: "public",
    dbType: "postgres",
    embeddingProvider: "openai-compatible",
    embeddingEndpoint: "https://example.test/v1",
    embeddingModel: "text-embedding",
    embeddingDimension: 1536,
    rerankProvider: "none",
    analyzedAt: new Date("2026-06-05T00:00:00.000Z").toISOString(),
    tableCount: 1,
    columnCount: 2,
    indexCount: 0,
    foreignKeyCount: 0,
    schemaFingerprint: "fp",
  },
};

test("RAG mode is available only for an indexed schema with supported tool-call config", () => {
  assert.deepEqual(getAiRagModeAvailability(completionsConfig(), context, indexedStatus), {
    available: true,
    reason: null,
  });

  assert.equal(getAiRagModeAvailability(completionsConfig(), context, null).available, false);
  assert.deepEqual(getAiRagModeAvailability(completionsConfig(), { ...context, schema: undefined }, indexedStatus), {
    available: false,
    reason: "no-schema",
  });
  assert.equal(
    getAiRagModeAvailability(completionsConfig({ provider: "claude" }), context, indexedStatus).reason,
    "unsupported-ai-config",
  );
});

test("RAG mode can use an independent schema research model config", () => {
  const config = completionsConfig({
    provider: "claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4",
    schemaResearch: {
      enabled: true,
      useMainModel: false,
      provider: "openai-compatible",
      apiKey: "cheap-key",
      endpoint: "https://cheap.example.test/v1",
      model: "cheap-schema-model",
      apiStyle: "completions",
      proxyEnabled: false,
      proxyUrl: "",
      maxToolRounds: 3,
      maxOutputTokens: 1200,
    },
  });

  assert.deepEqual(getAiRagModeAvailability(config, context, indexedStatus), {
    available: true,
    reason: null,
  });

  const runtime = resolveSchemaResearchRuntimeConfig(config, 8192);
  assert.equal(runtime.config.provider, "openai-compatible");
  assert.equal(runtime.config.endpoint, "https://cheap.example.test/v1");
  assert.equal(runtime.config.model, "cheap-schema-model");
  assert.equal(runtime.maxToolRounds, 3);
  assert.equal(runtime.maxOutputTokens, 1200);
});

test("RAG mode is unavailable when the SQL assistant subagent is disabled", () => {
  const config = completionsConfig({
    schemaResearch: {
      enabled: false,
      useMainModel: true,
      provider: "openai",
      apiKey: "test-key",
      endpoint: "https://example.test/v1",
      model: "test-model",
      apiStyle: "completions",
      proxyEnabled: false,
      proxyUrl: "",
      maxToolRounds: 4,
      maxOutputTokens: 1800,
    },
  });

  assert.deepEqual(getAiRagModeAvailability(config, context, indexedStatus), {
    available: false,
    reason: "unsupported-ai-config",
  });
});

test("RAG mode defaults on when available and falls back when it becomes unavailable", () => {
  assert.equal(normalizeAiAssistantModeForRagAvailability("ask", true, { preferRag: true }), "rag");
  assert.equal(normalizeAiAssistantModeForRagAvailability("agent", true, { preferRag: false }), "agent");
  assert.equal(normalizeAiAssistantModeForRagAvailability("rag", false), "ask");
  assert.equal(normalizeAiAssistantModeForRagAvailability("agent", false), "agent");
});
