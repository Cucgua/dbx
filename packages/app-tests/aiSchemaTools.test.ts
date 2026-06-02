import { strict as assert } from "node:assert";
import test from "node:test";

import type { AiConfig } from "../../apps/desktop/src/stores/settingsStore";
import type { AiContext } from "../../apps/desktop/src/lib/ai";
import { buildAiSchemaTools, buildSchemaResearchEvidenceGateInstruction, supportsAiSchemaToolLoop } from "../../apps/desktop/src/lib/ai";

function completionsConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "openai",
    apiStyle: "completions",
    endpoint: "https://example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    enableThinking: true,
    ...overrides,
  };
}

function context(overrides: Partial<AiContext> = {}): AiContext {
  return {
    connectionName: "prod",
    databaseType: "postgres",
    connectionId: "conn-1",
    database: "app",
    schema: "public",
    currentSql: "",
    tables: [],
    truncated: false,
    ...overrides,
  };
}

function toolNames(tools: unknown[]): string[] {
  return tools.map((tool: any) => tool?.function?.name).filter(Boolean);
}

test("schema tool loop stays available without checking vector index state", () => {
  assert.equal(supportsAiSchemaToolLoop(completionsConfig(), context()), true);
});

test("schema tool loop is disabled for providers without this tool-call path", () => {
  assert.equal(supportsAiSchemaToolLoop(completionsConfig({ provider: "claude" }), context()), false);
  assert.equal(supportsAiSchemaToolLoop(completionsConfig({ apiStyle: "responses" }), context()), false);
  assert.equal(supportsAiSchemaToolLoop(completionsConfig(), context({ databaseType: "mongodb" })), false);
});

test("AI schema tools include non-vector metadata tools and relation confirmation", () => {
  const tools = buildAiSchemaTools();
  assert.deepEqual(toolNames(tools), [
    "dbx_schema_research_task",
    "dbx_search_schema",
    "dbx_list_tables",
    "dbx_find_columns",
    "dbx_request_table_choice",
    "dbx_search_table_columns",
    "dbx_get_column_details",
    "dbx_load_table_schema",
    "dbx_request_column_choice",
    "dbx_save_schema_enrichment",
    "dbx_get_related_tables",
    "dbx_request_relation",
  ]);
  const researchTool = tools.find((tool: any) => tool?.function?.name === "dbx_schema_research_task") as any;
  assert.equal(researchTool?.function?.parameters?.properties?.task?.type, "string");
  assert.equal(researchTool?.function?.parameters?.properties?.requiredEvidence?.type, "array");
  assert.equal(researchTool?.function?.parameters?.properties?.constraints?.properties?.maxTables?.type, "integer");
  assert.match(researchTool?.function?.description || "", /Schema Research|子任务/);
  const tableChoiceTool = tools.find((tool: any) => tool?.function?.name === "dbx_request_table_choice") as any;
  assert.equal(tableChoiceTool?.function?.parameters?.properties?.allowManual?.type, "boolean");
  assert.match(tableChoiceTool?.function?.description || "", /manually enter|手动输入/);
  assert.equal(tableChoiceTool?.function?.parameters?.properties?.candidates?.items?.properties?.table?.type, "string");
  const columnChoiceTool = tools.find((tool: any) => tool?.function?.name === "dbx_request_column_choice") as any;
  assert.equal(columnChoiceTool?.function?.parameters?.properties?.allowManual?.type, "boolean");
  assert.equal(columnChoiceTool?.function?.parameters?.properties?.multiple?.type, "boolean");
  assert.match(columnChoiceTool?.function?.description || "", /manually enter|手动输入/);
  assert.equal(columnChoiceTool?.function?.parameters?.properties?.candidates?.items?.properties?.column?.type, "string");
  const columnSearchTool = tools.find((tool: any) => tool?.function?.name === "dbx_search_table_columns") as any;
  assert.equal(columnSearchTool?.function?.parameters?.properties?.query?.type, "string");
  assert.equal(columnSearchTool?.function?.parameters?.properties?.includePrimaryKey?.type, "boolean");
  assert.deepEqual(columnSearchTool?.function?.parameters?.required, ["table", "query"]);
  assert.match(columnSearchTool?.function?.description || "", /vector|向量/);
  const columnDetailsTool = tools.find((tool: any) => tool?.function?.name === "dbx_get_column_details") as any;
  assert.equal(columnDetailsTool?.function?.parameters?.properties?.columns?.type, "array");
  assert.deepEqual(columnDetailsTool?.function?.parameters?.required, ["table", "columns"]);
  const enrichmentTool = tools.find((tool: any) => tool?.function?.name === "dbx_save_schema_enrichment") as any;
  assert.deepEqual(enrichmentTool?.function?.parameters?.properties?.confirmationSource?.enum, [
    "explicit_user_request",
    "user_choice_confirmed",
  ]);
  assert.equal(enrichmentTool?.function?.parameters?.properties?.aliases?.type, "array");
  assert.match(enrichmentTool?.function?.description || "", /user-confirmed|用户明确/);
  const relationTool = tools.find((tool: any) => tool?.function?.name === "dbx_request_relation") as any;
  assert.equal(relationTool?.function?.parameters?.properties?.candidatePairs?.type, "array");
});

test("schema research subtask tools exclude recursion, user UI, and enrichment", () => {
  assert.deepEqual(
    toolNames(
      buildAiSchemaTools({
        includeResearchTask: false,
        includeUserChoiceTools: false,
        includeEnrichmentTool: false,
      }),
    ),
    [
      "dbx_search_schema",
      "dbx_list_tables",
      "dbx_find_columns",
      "dbx_search_table_columns",
      "dbx_get_column_details",
      "dbx_load_table_schema",
      "dbx_get_related_tables",
    ],
  );
});

test("schema research partial evidence gate requires another lookup before final SQL", () => {
  const instruction = buildSchemaResearchEvidenceGateInstruction(
    {
      status: "partial",
      summary: "Found candidate review tables but order relation is unclear.",
      uncertainties: [{ kind: "relation", message: "Need user/order join evidence." }],
    },
    true,
  );

  assert.match(instruction || "", /不能直接生成最终 SQL/);
  assert.match(instruction || "", /继续调用/);
  assert.match(instruction || "", /dbx_get_column_details/);
  assert.match(instruction || "", /relation: Need user\/order join evidence/);
});

test("schema research user-choice gate requires a user confirmation tool", () => {
  const instruction = buildSchemaResearchEvidenceGateInstruction(
    {
      status: "need_user_choice",
      summary: "Two customer tables are plausible.",
      uncertainties: [{ kind: "table", message: "Choose customer or customer_archive." }],
    },
    false,
  );

  assert.match(instruction || "", /Do not generate final SQL yet/);
  assert.match(instruction || "", /dbx_request_table_choice/);
  assert.match(instruction || "", /dbx_request_column_choice/);
  assert.match(instruction || "", /dbx_request_relation/);
});
