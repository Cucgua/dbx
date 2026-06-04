import type { ColumnInfo } from "@/types/database";

export interface SchemaRagConfig {
  embeddingProvider: string;
  embeddingEndpoint: string;
  embeddingModel: string;
  embeddingApiKey: string;
  embeddingDimension: number;
  embeddingBatchSize: number;
  embeddingConcurrency: number;
  rerankProvider: string;
  rerankEndpoint: string;
  rerankModel: string;
  rerankApiKey: string;
  proxyEnabled: boolean;
  proxyUrl: string;
}

export interface SchemaRagScopeRequest {
  connectionId: string;
  database: string;
  schema: string;
}

export interface SchemaRagProgressEvent extends SchemaRagScopeRequest {
  stage: string;
  done: number;
  total: number;
  table?: string | null;
  batch?: number | null;
  batchTotal?: number | null;
  batchSize?: number | null;
  concurrency?: number | null;
  inFlight?: number | null;
  succeededBatches?: number | null;
  failedBatches?: number | null;
  message: string;
}

export interface AnalyzeSchemaRagRequest extends SchemaRagScopeRequest {}

export interface ImportSchemaRagApiDocFile {
  path: string;
  displayName?: string | null;
}

export interface ImportSchemaRagApiDocsRequest extends SchemaRagScopeRequest {
  files: ImportSchemaRagApiDocFile[];
  extractions?: SchemaRagApiDocExtraction[];
}

export interface ImportSchemaRagApiDocsResponse {
  importedSources: number;
  chunks: number;
  embeddedChunks: number;
  graphFacts: number;
  verifiedFacts: number;
  unresolvedFacts: number;
  unsupportedFiles: string[];
}

export type ApiDocExtractionStatus = "pending" | "extracted" | "partial" | "failed";
export type SchemaRagFactStatus = "verified" | "candidate" | "rejected" | "unresolved";

export interface SchemaRagApiFieldFact {
  id: string;
  sourceId: string;
  sectionId: string;
  name: string;
  meaning: string;
  candidateSchema?: string | null;
  candidateTable?: string | null;
  candidateColumn?: string | null;
  status: SchemaRagFactStatus;
  confidence: number;
  evidence: string;
}

export interface SchemaRagBusinessConceptFact {
  id: string;
  sourceId: string;
  sectionId: string;
  term: string;
  description: string;
  candidateSchema?: string | null;
  candidateTable?: string | null;
  candidateColumn?: string | null;
  status: SchemaRagFactStatus;
  confidence: number;
  evidence: string;
}

export interface SchemaRagJoinCandidateFact {
  id: string;
  sourceId: string;
  sectionId: string;
  leftSchema: string;
  leftTable: string;
  leftColumns: string[];
  rightSchema: string;
  rightTable: string;
  rightColumns: string[];
  relation: string;
  status: SchemaRagFactStatus;
  confidence: number;
  evidence: string;
}

export interface SchemaRagApiDocExtraction {
  sourceId: string;
  extractedAt: string;
  status: ApiDocExtractionStatus;
  apiFields: SchemaRagApiFieldFact[];
  businessConcepts: SchemaRagBusinessConceptFact[];
  joinCandidates: SchemaRagJoinCandidateFact[];
  errors: string[];
}

export interface SchemaRagGraphSeed {
  kind: "table" | "column" | "api_doc_source" | "api_doc_section" | "api_field" | "business_concept" | "join_candidate";
  id?: string | null;
  schema?: string | null;
  table?: string | null;
  column?: string | null;
}

export interface ExpandSchemaRagGraphRequest extends SchemaRagScopeRequest {
  seeds: SchemaRagGraphSeed[];
  includeCandidates?: boolean;
  limit?: number;
}

export interface ExpandSchemaRagGraphResponse {
  verifiedMappings: SchemaRagApiFieldFact[];
  candidateMappings: SchemaRagApiFieldFact[];
  joinCandidates: SchemaRagJoinCandidateFact[];
  concepts: SchemaRagBusinessConceptFact[];
  sourceEvidence: string[];
}

export interface RefreshSchemaRagTableRequest extends SchemaRagScopeRequest {
  table: string;
}

export interface SchemaRagTableChangeSummary {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  total: number;
}

export interface RefreshSchemaRagTableResponse {
  manifest: SchemaRagManifest;
  changes: SchemaRagTableChangeSummary;
  rebuiltDocuments: number;
  indexPath: string;
}

export interface SearchSchemaRagRequest extends SchemaRagScopeRequest {
  query: string;
  limit?: number;
}

export interface SearchTableColumnsRagRequest extends SchemaRagScopeRequest {
  table: string;
  query: string;
  limit?: number;
  includePrimaryKey?: boolean;
}

export interface SchemaRagBusinessAliasInput {
  term: string;
  targetKind?: "table" | "column";
  table: string;
  column?: string | null;
  source?: string;
  confidence?: number;
  note?: string | null;
}

export interface SaveSchemaRagEnrichmentRequest extends SchemaRagScopeRequest {
  aliases: SchemaRagBusinessAliasInput[];
}

export interface SaveSchemaRagEnrichmentResponse {
  savedAliases: number;
}

export interface SchemaRagManifest {
  connectionId: string;
  database: string;
  schema: string;
  dbType: string;
  embeddingProvider: string;
  embeddingEndpoint: string;
  embeddingModel: string;
  embeddingDimension: number;
  rerankProvider: string;
  analyzedAt: string;
  tableCount: number;
  columnCount: number;
  indexCount: number;
  foreignKeyCount: number;
  schemaFingerprint: string;
  tableUnits?: SchemaRagTableIndexUnit[];
  apiDocSources?: SchemaRagApiDocSource[];
  apiDocChunkCount?: number;
}

export interface SchemaRagTableIndexUnit {
  schema: string;
  table: string;
  fingerprint: string;
  documentIds: string[];
  columnCount: number;
  indexCount: number;
  foreignKeyCount: number;
  updatedAt: string;
}

export interface SchemaRagApiDocSource {
  sourceId: string;
  sourcePath: string;
  originalFormat: string;
  converter: string;
  contentHash: string;
  sectionCount: number;
  importedAt: string;
  extractionStatus?: ApiDocExtractionStatus;
  extractedAt?: string | null;
  apiFieldCount?: number;
  businessConceptCount?: number;
  joinCandidateCount?: number;
  unresolvedFactCount?: number;
}

export interface AnalyzeSchemaRagResponse {
  manifest: SchemaRagManifest;
  indexPath: string;
}

export interface SchemaRagStatus {
  indexed: boolean;
  manifest?: SchemaRagManifest | null;
  indexPath: string;
}

export interface SchemaRagMatchedColumn {
  name: string;
  comment?: string | null;
  primaryKey?: boolean;
  dataType?: string;
  score: number;
  reason: string;
}

export interface SchemaRagColumnSearchResult {
  indexedAt: string;
  schema: string;
  table: string;
  query: string;
  totalColumns: number;
  returnedColumns: number;
  columns: SchemaRagMatchedColumn[];
  truncated: boolean;
}

export interface SchemaRagRelatedTable {
  schema: string;
  name: string;
  relation: string;
  reason: string;
}

export interface SchemaRagSearchTable {
  schema: string;
  name: string;
  tableType: string;
  score: number;
  reason: string;
  matchedColumns: SchemaRagMatchedColumn[];
  relatedTables: SchemaRagRelatedTable[];
}

export interface SchemaRagSearchResult {
  indexedAt: string;
  query: string;
  tables: SchemaRagSearchTable[];
  truncated: boolean;
}

export const DEFAULT_SCHEMA_RAG_CONFIG: SchemaRagConfig = {
  embeddingProvider: "openai-compatible",
  embeddingEndpoint: "",
  embeddingModel: "",
  embeddingApiKey: "",
  embeddingDimension: 1536,
  embeddingBatchSize: 64,
  embeddingConcurrency: 4,
  rerankProvider: "none",
  rerankEndpoint: "",
  rerankModel: "",
  rerankApiKey: "",
  proxyEnabled: false,
  proxyUrl: "",
};

export function findSchemaRagTableUnit(
  manifest: SchemaRagManifest | null | undefined,
  target: { schema?: string | null; table?: string | null },
): SchemaRagTableIndexUnit | null {
  const schema = target.schema?.trim();
  const table = target.table?.trim();
  if (!schema || !table) return null;
  return (
    manifest?.tableUnits?.find(
      (unit) =>
        unit.schema.trim().toLowerCase() === schema.toLowerCase() &&
        unit.table.trim().toLowerCase() === table.toLowerCase(),
    ) || null
  );
}

type RawSchemaRagConfig = Partial<SchemaRagConfig> & {
  embedding_provider?: unknown;
  embedding_endpoint?: unknown;
  embedding_model?: unknown;
  embedding_api_key?: unknown;
  embedding_dimension?: unknown;
  embedding_batch_size?: unknown;
  embedding_concurrency?: unknown;
  rerank_provider?: unknown;
  rerank_endpoint?: unknown;
  rerank_model?: unknown;
  rerank_api_key?: unknown;
  proxy_enabled?: unknown;
  proxy_url?: unknown;
};

export function normalizeSchemaRagConfig(
  config: RawSchemaRagConfig | null | undefined,
  previousConfig?: Pick<SchemaRagConfig, "embeddingApiKey" | "rerankApiKey"> | null,
): SchemaRagConfig {
  const value = config || {};
  return {
    ...DEFAULT_SCHEMA_RAG_CONFIG,
    embeddingProvider: nonEmptyStringValue(
      value.embeddingProvider,
      value.embedding_provider,
      DEFAULT_SCHEMA_RAG_CONFIG.embeddingProvider,
    ),
    embeddingEndpoint: stringValue(
      value.embeddingEndpoint,
      value.embedding_endpoint,
      DEFAULT_SCHEMA_RAG_CONFIG.embeddingEndpoint,
    ),
    embeddingModel: stringValue(value.embeddingModel, value.embedding_model, DEFAULT_SCHEMA_RAG_CONFIG.embeddingModel),
    embeddingApiKey: normalizeSchemaRagApiKey(
      stringValue(value.embeddingApiKey, value.embedding_api_key, DEFAULT_SCHEMA_RAG_CONFIG.embeddingApiKey),
      stringValue(value.embeddingEndpoint, value.embedding_endpoint, DEFAULT_SCHEMA_RAG_CONFIG.embeddingEndpoint),
      previousConfig?.embeddingApiKey || "",
    ),
    embeddingDimension: positiveInt(
      firstDefined(value.embeddingDimension, value.embedding_dimension),
      DEFAULT_SCHEMA_RAG_CONFIG.embeddingDimension,
    ),
    embeddingBatchSize: positiveInt(
      firstDefined(value.embeddingBatchSize, value.embedding_batch_size),
      DEFAULT_SCHEMA_RAG_CONFIG.embeddingBatchSize,
    ),
    embeddingConcurrency: clampInt(
      finiteInt(
        firstDefined(value.embeddingConcurrency, value.embedding_concurrency),
        DEFAULT_SCHEMA_RAG_CONFIG.embeddingConcurrency,
      ),
      1,
      16,
    ),
    rerankProvider: nonEmptyStringValue(
      value.rerankProvider,
      value.rerank_provider,
      DEFAULT_SCHEMA_RAG_CONFIG.rerankProvider,
    ),
    rerankEndpoint: stringValue(value.rerankEndpoint, value.rerank_endpoint, DEFAULT_SCHEMA_RAG_CONFIG.rerankEndpoint),
    rerankModel: stringValue(value.rerankModel, value.rerank_model, DEFAULT_SCHEMA_RAG_CONFIG.rerankModel),
    rerankApiKey: normalizeSchemaRagApiKey(
      stringValue(value.rerankApiKey, value.rerank_api_key, DEFAULT_SCHEMA_RAG_CONFIG.rerankApiKey),
      stringValue(value.rerankEndpoint, value.rerank_endpoint, DEFAULT_SCHEMA_RAG_CONFIG.rerankEndpoint),
      previousConfig?.rerankApiKey || "",
    ),
    proxyEnabled: !!firstDefined(value.proxyEnabled, value.proxy_enabled),
    proxyUrl: stringValue(value.proxyUrl, value.proxy_url, DEFAULT_SCHEMA_RAG_CONFIG.proxyUrl),
  };
}

export function normalizeSchemaRagApiKey(value: string, endpoint: string, previousValue = ""): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (looksLikeUrl(trimmed)) {
    const previous = previousValue.trim();
    return previous && !looksLikeUrl(previous) ? previous : "";
  }
  if (endpoint.trim() && trimmed === endpoint.trim()) {
    const previous = previousValue.trim();
    return previous && !looksLikeUrl(previous) ? previous : "";
  }
  return value;
}

export function filterRagColumnsAgainstRealtime(
  matchedColumns: SchemaRagMatchedColumn[],
  realtimeColumns: ColumnInfo[],
): SchemaRagMatchedColumn[] {
  const realtime = new Set(realtimeColumns.map((column) => column.name.toLowerCase()));
  return matchedColumns.filter((column) => realtime.has(column.name.toLowerCase()));
}

export function formatSchemaRagContext(result: SchemaRagSearchResult | undefined): string {
  if (!result?.tables.length) return "";
  const lines = ["Smart schema retrieval hits:"];
  for (const table of result.tables) {
    const tableName = table.schema ? `${table.schema}.${table.name}` : table.name;
    lines.push(`- ${tableName}: score ${table.score.toFixed(2)}; ${table.reason}`);
    if (table.matchedColumns.length) {
      lines.push(
        `  matched columns: ${table.matchedColumns.map((column) => `${column.name} (${column.reason})`).join(", ")}`,
      );
    }
    if (table.relatedTables.length) {
      lines.push(
        `  related tables: ${table.relatedTables
          .map((related) => `${related.schema ? `${related.schema}.` : ""}${related.name} via ${related.relation}`)
          .join(", ")}`,
      );
    }
  }
  if (result.truncated) lines.push("- Retrieval result was truncated.");
  return lines.join("\n");
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function finiteInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstDefined<T>(value: T | undefined, fallback: T | undefined): T | undefined {
  return value !== undefined ? value : fallback;
}

function stringValue(value: unknown, fallbackValue: unknown, defaultValue: string): string {
  const selected = firstDefined(value, fallbackValue);
  return typeof selected === "string" ? selected : defaultValue;
}

function nonEmptyStringValue(value: unknown, fallbackValue: unknown, defaultValue: string): string {
  const selected = stringValue(value, fallbackValue, defaultValue).trim();
  return selected || defaultValue;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}
