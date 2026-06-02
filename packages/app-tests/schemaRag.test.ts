import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SCHEMA_RAG_CONFIG,
  normalizeSchemaRagApiKey,
  normalizeSchemaRagConfig,
} from "../../apps/desktop/src/lib/schemaRag";

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
