import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SCHEMA_RAG_CONFIG,
  findSchemaRagTableUnit,
  normalizeSchemaRagApiKey,
  normalizeSchemaRagConfig,
} from "../../apps/desktop/src/lib/schemaRag";
import {
  API_DOC_SECTION_MAX_CHARS_FOR_TEST,
  apiDocSourceId,
  splitMarkdownSections,
} from "../../apps/desktop/src/lib/schemaDocIngestion";
import {
  appendSchemaDocImportLog,
  createSchemaDocImportProgress,
  schemaDocImportProgressPercent,
} from "../../apps/desktop/src/lib/schemaDocImportProgress";

test("normalizeSchemaRagConfig defaults missing embedding concurrency", () => {
  const config = normalizeSchemaRagConfig({
    embeddingEndpoint: "https://ai.gitee.com/v1",
    embeddingModel: "Qwen3-Embedding-0.6B",
  });

  assert.equal(config.embeddingConcurrency, DEFAULT_SCHEMA_RAG_CONFIG.embeddingConcurrency);
});

test("normalizeSchemaRagConfig clamps embedding concurrency", () => {
  assert.equal(normalizeSchemaRagConfig({ embeddingConcurrency: 0 }).embeddingConcurrency, 1);
  assert.equal(normalizeSchemaRagConfig({ embeddingConcurrency: 1 }).embeddingConcurrency, 1);
  assert.equal(normalizeSchemaRagConfig({ embeddingConcurrency: 99 }).embeddingConcurrency, 16);
});

test("normalizeSchemaRagConfig preserves snake case persisted model fields", () => {
  const config = normalizeSchemaRagConfig({
    embedding_provider: "openai-compatible",
    embedding_endpoint: "https://ai.gitee.com/v1",
    embedding_model: "Qwen3-Embedding-0.6B",
    embedding_api_key: "embedding-key",
    embedding_dimension: 1024,
    embedding_batch_size: 32,
    embedding_concurrency: 8,
    rerank_provider: "openai-compatible",
    rerank_endpoint: "https://ai.gitee.com/v1",
    rerank_model: "Qwen3-Reranker-0.6B",
    rerank_api_key: "rerank-key",
    proxy_enabled: true,
    proxy_url: "socks5://127.0.0.1:7890",
  } as any);

  assert.equal(config.embeddingModel, "Qwen3-Embedding-0.6B");
  assert.equal(config.embeddingApiKey, "embedding-key");
  assert.equal(config.rerankModel, "Qwen3-Reranker-0.6B");
  assert.equal(config.rerankApiKey, "rerank-key");
  assert.equal(config.embeddingConcurrency, 8);
  assert.equal(config.proxyEnabled, true);
});

test("normalizeSchemaRagConfig drops URL-shaped API key values", () => {
  const config = normalizeSchemaRagConfig({
    embeddingEndpoint: "https://ai.gitee.com/v1",
    embeddingModel: "Qwen3-Embedding-0.6B",
    embeddingApiKey: "https://ai.gitee.com/v1",
    rerankProvider: "openai-compatible",
    rerankEndpoint: "https://rerank.example.com/v1",
    rerankModel: "Qwen3-Reranker-0.6B",
    rerankApiKey: "https://rerank.example.com/v1",
  });

  assert.equal(config.embeddingEndpoint, "https://ai.gitee.com/v1");
  assert.equal(config.embeddingApiKey, "");
  assert.equal(config.rerankEndpoint, "https://rerank.example.com/v1");
  assert.equal(config.rerankApiKey, "");
});

test("normalizeSchemaRagApiKey preserves a previous real key when form value is an endpoint URL", () => {
  assert.equal(normalizeSchemaRagApiKey("https://ai.gitee.com/v1", "https://ai.gitee.com/v1", "real-key"), "real-key");
  assert.equal(normalizeSchemaRagApiKey("new-real-key", "https://ai.gitee.com/v1", "old-key"), "new-real-key");
  assert.equal(normalizeSchemaRagApiKey("", "https://ai.gitee.com/v1", "old-key"), "");
});

test("normalizeSchemaRagConfig preserves previous real keys when form fields echo endpoint URLs", () => {
  const config = normalizeSchemaRagConfig(
    {
      embeddingEndpoint: "https://ai.gitee.com/v1",
      embeddingApiKey: "https://ai.gitee.com/v1",
      rerankEndpoint: "https://rerank.example.com/v1",
      rerankApiKey: "https://rerank.example.com/v1",
    },
    {
      embeddingApiKey: "old-embedding-key",
      rerankApiKey: "old-rerank-key",
    },
  );

  assert.equal(config.embeddingApiKey, "old-embedding-key");
  assert.equal(config.rerankApiKey, "old-rerank-key");
});

test("findSchemaRagTableUnit resolves the indexed unit for a selected table", () => {
  const unit = findSchemaRagTableUnit(
    {
      connectionId: "conn",
      database: "db",
      schema: "PUBLIC",
      dbType: "postgres",
      embeddingProvider: "openai-compatible",
      embeddingEndpoint: "https://embedding.example.com/v1",
      embeddingModel: "embedding-model",
      embeddingDimension: 1024,
      rerankProvider: "none",
      analyzedAt: "2026-06-02T00:00:00Z",
      tableCount: 2,
      columnCount: 3,
      indexCount: 1,
      foreignKeyCount: 0,
      schemaFingerprint: "schema-fingerprint",
      tableUnits: [
        {
          schema: "PUBLIC",
          table: "orders",
          fingerprint: "orders-fingerprint",
          documentIds: ["table:PUBLIC.orders", "column:PUBLIC.orders.id"],
          columnCount: 2,
          indexCount: 1,
          foreignKeyCount: 0,
          updatedAt: "2026-06-02T00:00:00Z",
        },
        {
          schema: "PUBLIC",
          table: "users",
          fingerprint: "users-fingerprint",
          documentIds: ["table:PUBLIC.users"],
          columnCount: 1,
          indexCount: 0,
          foreignKeyCount: 0,
          updatedAt: "2026-06-02T00:00:00Z",
        },
      ],
    },
    { schema: "public", table: "ORDERS" },
  );

  assert.equal(unit?.fingerprint, "orders-fingerprint");
});

test("schema doc ingestion builds stable source and section ids", async () => {
  const sourceId = await apiDocSourceId("/docs/birth.md");
  const sections = splitMarkdownSections(
    [
      "# 出生证接口",
      "",
      "总览",
      "",
      "## 申请列表",
      "",
      "返回 apply_status 和 mother_name 字段。",
    ].join("\n"),
    sourceId,
  );

  assert.match(sourceId, /^api-doc:[a-f0-9]{64}$/);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, `${sourceId}#section-1`);
  assert.deepEqual(sections[1].titlePath, ["出生证接口", "申请列表"]);
  assert.match(sections[1].text, /apply_status/);
});

test("schema doc ingestion uses smaller chunks for token-heavy JSON extraction", () => {
  const sections = splitMarkdownSections("长字段说明\n".repeat(260), "api-doc:long");

  assert.ok(sections.length > 1);
  assert.ok(sections.every((section) => section.text.length <= API_DOC_SECTION_MAX_CHARS_FOR_TEST));
});

test("schema doc import progress clamps percent and keeps recent logs", () => {
  const progress = {
    ...createSchemaDocImportProgress(),
    totalFiles: 4,
    processedFiles: 5,
  };

  assert.equal(schemaDocImportProgressPercent(progress), 100);
  assert.equal(schemaDocImportProgressPercent({ ...progress, stage: "finished", processedFiles: 0 }), 100);
  assert.equal(schemaDocImportProgressPercent({ ...progress, totalFiles: 0, processedFiles: 0 }), 0);

  let withLogs = createSchemaDocImportProgress();
  withLogs = appendSchemaDocImportLog(withLogs, "第一条", 2);
  withLogs = appendSchemaDocImportLog(withLogs, "第二条", 2);
  withLogs = appendSchemaDocImportLog(withLogs, "第三条", 2);
  withLogs = appendSchemaDocImportLog(withLogs, "   ", 2);

  assert.deepEqual(withLogs.logs, ["第二条", "第三条"]);
});
