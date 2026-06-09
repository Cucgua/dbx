import assert from "node:assert/strict";
import { test } from "vitest";

import type { AiConfig } from "../../apps/desktop/src/stores/settingsStore";
import { prioritizeAiCandidateSchemasForTest } from "../../apps/desktop/src/lib/ai.ts";
import {
  buildSchemaRagAiTools,
  getSchemaRagSubtaskAllowedToolNames,
  isSchemaRagAiToolName,
  schemaRagScopeForContext,
  supportsSchemaRagAiToolLoop,
} from "../../apps/desktop/src/lib/schemaRagAiTools";

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

function toolNames(tools: unknown[]): string[] {
  return tools.map((tool: any) => tool?.function?.name).filter(Boolean);
}

test("schema rag advertised tools are executable by schema research subtasks", () => {
  const allowed = new Set(getSchemaRagSubtaskAllowedToolNames());
  for (const tool of toolNames(buildSchemaRagAiTools())) {
    assert.equal(allowed.has(tool), true, `${tool} is advertised but not executable`);
    assert.equal(isSchemaRagAiToolName(tool), true, `${tool} is not recognized as a Schema RAG tool`);
  }
});

test("schema rag AI tool loop requires desktop-compatible OpenAI chat completions context", () => {
  const context = {
    connectionId: "conn-1",
    databaseType: "postgres" as const,
    database: "app",
    schema: "public",
  };

  assert.equal(supportsSchemaRagAiToolLoop(completionsConfig(), context), true);
  assert.equal(supportsSchemaRagAiToolLoop(completionsConfig({ provider: "claude" }), context), false);
  assert.equal(supportsSchemaRagAiToolLoop(completionsConfig({ apiStyle: "responses" }), context), false);
  assert.equal(supportsSchemaRagAiToolLoop(completionsConfig(), { ...context, databaseType: "mongodb" }), false);
  assert.equal(supportsSchemaRagAiToolLoop(completionsConfig(), { ...context, schema: undefined }), false);
});

test("schema rag scope uses active schema as database for Oracle-style schema tree nodes", () => {
  assert.deepEqual(
    schemaRagScopeForContext({
      connectionId: "oracle-1",
      databaseType: "oracle",
      database: "ORCL",
      schema: "MCHS",
    }),
    {
      connectionId: "oracle-1",
      database: "MCHS",
      schema: "MCHS",
    },
  );
});

test("schema rag scope keeps catalog database for regular schema-aware databases", () => {
  assert.deepEqual(
    schemaRagScopeForContext({
      connectionId: "pg-1",
      databaseType: "postgres",
      database: "app",
      schema: "public",
    }),
    {
      connectionId: "pg-1",
      database: "app",
      schema: "public",
    },
  );
});

test("schema rag scope uses schema override as database for Oracle column searches", () => {
  assert.deepEqual(
    schemaRagScopeForContext(
      {
        connectionId: "oracle-1",
        databaseType: "oracle",
        database: "ORCL",
        schema: "MCHS",
      },
      "MCHS_DICT",
    ),
    {
      connectionId: "oracle-1",
      database: "MCHS_DICT",
      schema: "MCHS_DICT",
    },
  );
});

test("AI candidate schema priority keeps the active tab schema before alphabetical fallback", () => {
  assert.deepEqual(prioritizeAiCandidateSchemasForTest(["AAA", "MCHS", "ZZZ"], "MCHS"), ["MCHS", "AAA", "ZZZ"]);
});
