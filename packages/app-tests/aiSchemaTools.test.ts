import { strict as assert } from "node:assert";
import test from "node:test";

import type { AiConfig } from "../../apps/desktop/src/stores/settingsStore";
import type { AiContext } from "../../apps/desktop/src/lib/ai";
import {
  buildApiDocExtractionBatchesForTest,
  buildApiDocExtractionUserPromptForTest,
  buildAiSchemaTools,
  buildSchemaResearchEvidenceGateInstruction,
  buildToolSystemPrompt,
  parseApiDocExtractionJsonForTest,
  schemaRagScopeForContextForTest,
  schemaResearchSubtaskAllowedToolNamesForTest,
  schemaDocRawChatOptionsForTest,
  supportsAiSchemaToolLoop,
} from "../../apps/desktop/src/lib/ai";
import type { ApiDocExtractionRequest } from "../../apps/desktop/src/lib/schemaDocIngestion";

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

test("schema RAG scope uses schema as database for Oracle-like schema-targeted connections", () => {
  assert.deepEqual(
    schemaRagScopeForContextForTest(
      context({
        connectionId: "oracle-1",
        databaseType: "oracle",
        database: "ORCL",
        schema: "MCHS",
      }),
    ),
    {
      connectionId: "oracle-1",
      database: "MCHS",
      schema: "MCHS",
    },
  );
});

test("schema RAG scope keeps catalog database for regular schema-aware databases", () => {
  assert.deepEqual(
    schemaRagScopeForContextForTest(
      context({
        connectionId: "pg-1",
        databaseType: "postgres",
        database: "app",
        schema: "public",
      }),
    ),
    {
      connectionId: "pg-1",
      database: "app",
      schema: "public",
    },
  );
});

test("main AI schema tools expose only schema research and user confirmation tools", () => {
  const tools = buildAiSchemaTools();
  assert.deepEqual(toolNames(tools), [
    "dbx_schema_research_task",
    "dbx_request_table_choice",
    "dbx_request_column_choice",
    "dbx_save_schema_enrichment",
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
  assert.equal(
    columnChoiceTool?.function?.parameters?.properties?.candidates?.items?.properties?.column?.type,
    "string",
  );
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
  const tools = buildAiSchemaTools({
    scope: "schema_research",
    includeResearchTask: false,
    includeUserChoiceTools: false,
    includeEnrichmentTool: false,
  });
  assert.deepEqual(toolNames(tools), [
    "dbx_search_schema",
    "dbx_list_tables",
    "dbx_find_columns",
    "dbx_search_table_columns",
    "dbx_get_column_details",
    "dbx_load_table_schema",
    "dbx_get_related_tables",
    "dbx_expand_schema_graph",
  ]);
  const columnSearchTool = tools.find((tool: any) => tool?.function?.name === "dbx_search_table_columns") as any;
  assert.equal(columnSearchTool?.function?.parameters?.properties?.query?.type, "string");
  assert.equal(columnSearchTool?.function?.parameters?.properties?.includePrimaryKey?.type, "boolean");
  assert.deepEqual(columnSearchTool?.function?.parameters?.required, ["table", "query"]);
  assert.match(columnSearchTool?.function?.description || "", /vector|向量/);
  const columnDetailsTool = tools.find((tool: any) => tool?.function?.name === "dbx_get_column_details") as any;
  assert.equal(columnDetailsTool?.function?.parameters?.properties?.columns?.type, "array");
  assert.deepEqual(columnDetailsTool?.function?.parameters?.required, ["table", "columns"]);
  const graphTool = tools.find((tool: any) => tool?.function?.name === "dbx_expand_schema_graph") as any;
  assert.equal(graphTool?.function?.parameters?.properties?.seeds?.type, "array");
  assert.equal(graphTool?.function?.parameters?.properties?.includeCandidates?.type, "boolean");
  assert.match(graphTool?.function?.description || "", /Schema Graph|Kuzu|图/);
});

test("schema research subtask can execute every advertised schema research tool", () => {
  const advertisedToolNames = toolNames(
    buildAiSchemaTools({
      scope: "schema_research",
      includeResearchTask: false,
      includeUserChoiceTools: false,
      includeEnrichmentTool: false,
    }),
  );
  const allowedToolNames = new Set(schemaResearchSubtaskAllowedToolNamesForTest());
  for (const name of advertisedToolNames) {
    assert.equal(allowedToolNames.has(name), true, `${name} is advertised but not executable`);
  }
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
  assert.doesNotMatch(instruction || "", /dbx_get_column_details/);
  assert.doesNotMatch(instruction || "", /dbx_search_schema/);
  assert.match(instruction || "", /dbx_schema_research_task/);
  assert.match(instruction || "", /relation: Need user\/order join evidence/);
});

test("main schema prompt allows schema queries only through schema research task", () => {
  const prompt = buildToolSystemPrompt("generate", context(), "agent");

  assert.match(prompt, /dbx_schema_research_task/);
  assert.match(prompt, /唯一的 Schema 查询入口|only schema-query entrypoint/);
  assert.doesNotMatch(prompt, /优先调用 dbx_search_schema/);
  assert.doesNotMatch(prompt, /调用 dbx_get_column_details/);
  assert.doesNotMatch(prompt, /调用 dbx_get_related_tables/);
  assert.doesNotMatch(prompt, /prefer dbx_search_schema/i);
  assert.doesNotMatch(prompt, /call dbx_get_column_details/i);
  assert.doesNotMatch(prompt, /call dbx_get_related_tables/i);
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

test("api doc extraction parser accepts fenced JSON responses", () => {
  const parsed = parseApiDocExtractionJsonForTest(`
Here is the extraction:
\`\`\`json
{
  "apiFields": [
    { "name": "patientId", "meaning": "患者编号", "sectionId": "doc#section-1" }
  ],
  "businessConcepts": [],
  "joinCandidates": [],
  "errors": []
}
\`\`\`
`);

  assert.equal(parsed.apiFields[0].name, "patientId");
});

test("api doc extraction parser reports malformed JSON", () => {
  assert.throws(
    () =>
      parseApiDocExtractionJsonForTest(`{
  "apiFields": [
    { "name": "patientId" }
    { "name": "visitId" }
  ],
  "businessConcepts": [],
  "joinCandidates": [],
  "errors": []
}`),
    /Expected ',' or ']'/,
  );
});

test("schema doc raw chat options enable DeepSeek JSON mode without affecting other providers", () => {
  const deepseekOptions = schemaDocRawChatOptionsForTest(completionsConfig({ provider: "deepseek" }));
  assert.equal(deepseekOptions.debugLabel, "schema-doc-extraction");
  assert.deepEqual(deepseekOptions.responseFormat, { type: "json_object" });

  const openaiOptions = schemaDocRawChatOptionsForTest(completionsConfig({ provider: "openai" }));
  assert.equal(openaiOptions.debugLabel, "schema-doc-extraction");
  assert.equal(openaiOptions.responseFormat, undefined);
});

test("schema doc extraction prompt includes a strict JSON output contract", () => {
  const request: ApiDocExtractionRequest = {
    sourceId: "api-doc:test",
    sourcePath: "/docs/schema.md",
    schema: "public",
    sections: [
      {
        id: "api-doc:test#section-1",
        titlePath: ["数据字典", "出生证申请表"],
        text: "| 字段英文名 | 字段中文名 | 表英文名 |\n| APPLY_STATUS | 申请状态 | MC_BIRTH_APPLY |",
      },
    ],
  };

  const prompt = JSON.parse(buildApiDocExtractionUserPromptForTest(request));

  assert.deepEqual(prompt.outputContract.topLevelKeys, ["apiFields", "businessConcepts", "joinCandidates", "errors"]);
  assert.deepEqual(prompt.outputContract.apiFields.required, ["name", "meaning", "sectionId"]);
  assert.deepEqual(prompt.outputContract.joinCandidates.required, [
    "leftTable",
    "leftColumns",
    "rightTable",
    "rightColumns",
    "sectionId",
  ]);
  assert.match(prompt.outputContract.rules.join("\n"), /Top-level arrays must always be present/);
  assert.match(prompt.outputExamples.apiFields[0].candidateColumn, /APPLY_STATUS/);
});

test("schema doc extraction batches sections and carries previous table context", () => {
  const request: ApiDocExtractionRequest = {
    sourceId: "api-doc:test",
    sourcePath: "/docs/schema.md",
    schema: "public",
    sections: Array.from({ length: 7 }, (_, index) => ({
      id: `api-doc:test#section-${index + 1}`,
      titlePath: ["数据字典", `片段${index + 1}`],
      text: `第 ${index + 1} 段字段说明`,
    })),
  };

  const batches = buildApiDocExtractionBatchesForTest(request);

  assert.deepEqual(
    batches.map((batch) => batch.request.sections.map((section) => section.id)),
    [
      ["api-doc:test#section-1", "api-doc:test#section-2", "api-doc:test#section-3"],
      ["api-doc:test#section-4", "api-doc:test#section-5", "api-doc:test#section-6"],
      ["api-doc:test#section-7"],
    ],
  );
  assert.deepEqual(
    batches.map((batch) => [batch.metadata.omittedBefore, batch.metadata.omittedAfter]),
    [
      [false, true],
      [true, true],
      [true, false],
    ],
  );

  const prompt = JSON.parse(
    buildApiDocExtractionUserPromptForTest(batches[1].request, {
      ...batches[1].metadata,
      previousContext: {
        recentTables: ["public.mc_birth_apply"],
        recentColumns: ["public.mc_birth_apply.apply_status"],
      },
    }),
  );

  assert.equal(prompt.batch.batchIndex, 2);
  assert.equal(prompt.batch.batchCount, 3);
  assert.equal(prompt.batch.totalSections, 7);
  assert.equal(prompt.batch.omittedBefore, true);
  assert.equal(prompt.batch.omittedAfter, true);
  assert.deepEqual(prompt.previousContext.recentTables, ["public.mc_birth_apply"]);
  assert.match(prompt.instructions.continuation, /previousContext/);
  assert.match(prompt.instructions.outputCompaction, /Omit/i);
});
