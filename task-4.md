# DBX API Docs GraphRAG Ingestion And Schema Access Boundary Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade DBX Schema RAG so the main model can query database structure only through `dbx_schema_research_task`, while imported API documents are converted into validated graph knowledge plus embeddings instead of staying as plain document RAG.

**Architecture:** The main model gets one schema-query entrypoint: `dbx_schema_research_task`. Schema primitive tools remain available only inside the Schema Research subagent. API document import becomes a user-triggered ingestion flow: normalize document sections, use the configured Schema Research subagent model to extract structured facts, validate them against live schema metadata, write candidate/verified facts into Kuzu, and generate embeddings for both raw chunks and extracted fact cards.

**Tech Stack:** Vue 3, TypeScript, Tauri commands, Rust sidecar, Kuzu graph index, `/chat/completions` tool-calling model for Schema Research subagent, external embedding/rerank config from Schema RAG settings.

---

## Current Baseline

The current baseline is commit `7bf2c1cd`:

```text
feat(ai): add schema rag table maintenance and api docs import
```

Relevant current facts:

- `task-3.md` exists and covers table-level maintenance plus Markdown API doc import.
- `crates/dbx-schema-rag-sidecar/src/lib.rs` already supports `SchemaRagDocumentKind::ApiDoc`.
- Imported Markdown sections are currently embedded and used as semantic evidence, but they are not converted into first-class graph facts.
- `apps/desktop/src/lib/ai.ts` currently exposes `dbx_schema_research_task` and low-level schema tools from the same `buildAiSchemaTools` function.
- The main prompt still tells the main model it may call `dbx_search_schema`, `dbx_find_columns`, `dbx_get_column_details`, `dbx_get_related_tables`, and `dbx_load_table_schema` directly. This must change.
- `runSchemaResearchSubtask` already executes a Schema Research subagent and can call low-level schema tools internally.
- `Schema Research` model configuration already exists in AI settings and can reuse the main model or use a cheaper completions-compatible model.

## Hard Boundary

This boundary is not optional:

```text
The main model must never directly query database structure.
All table search, column search, column detail lookup, table schema loading, relationship lookup, document graph search, and schema validation must happen through the Schema Research subagent.
```

Main-model visible schema tools:

```text
dbx_schema_research_task
```

Main-model visible user interaction tools:

```text
dbx_request_table_choice
dbx_request_column_choice
dbx_request_relation
dbx_save_schema_enrichment
```

These tools may remain visible to the main model because they do not query database structure by themselves. Their candidates and confirmations must come from `dbx_schema_research_task` output or explicit user input.

Schema primitive tools must be subagent-only:

```text
dbx_search_schema
dbx_list_tables
dbx_find_columns
dbx_search_table_columns
dbx_get_column_details
dbx_load_table_schema
dbx_get_related_tables
future document graph lookup tools
```

Final SQL rule:

```text
The main model may use only fields marked verified by dbx_schema_research_task, fields present in current explicit @table context, or fields confirmed by the user and then re-verified through a follow-up dbx_schema_research_task.
```

The main model must not call `dbx_get_column_details` as a follow-up verifier. That verifier belongs inside the subagent only.

## Vocabulary

`dbx_schema_research_task`

The only schema-query tool visible to the main model. It receives a research goal and returns compact evidence: candidate tables, verified columns, relationship evidence, uncertainties, and suggested user confirmations.

`dbx_search_schema`

A subagent-only primitive. It performs vector/schema-index search and may later include graph boosts, but it is not visible to the main model.

`GraphRAG ingestion`

The import-time process that turns normalized document sections into graph facts:

```text
document section -> subagent extraction JSON -> schema validation -> Kuzu nodes/edges -> fact-card embeddings
```

`Hybrid retrieval`

The subagent query-time process that combines:

```text
vector search -> graph expansion -> live schema verification -> compact evidence
```

It is internal to `dbx_schema_research_task`, not a new main-model tool.

## Desired Runtime Flow

### User Asks A SQL Question

```text
User
  -> main model
  -> dbx_schema_research_task
     -> dbx_search_schema
     -> document graph lookup
     -> dbx_search_table_columns
     -> dbx_get_related_tables
     -> dbx_get_column_details
     -> compact JSON result
  -> main model writes SQL from verified evidence
```

If the subagent returns `partial`:

```text
main model
  -> issue a narrower dbx_schema_research_task
  -> or ask user through table/column/relation choice tools
```

If the user manually provides a table or field:

```text
main model
  -> dbx_schema_research_task with explicit user-provided candidate
  -> subagent verifies it using live schema tools
  -> main model may use only verified result
```

### User Imports Markdown API Docs

```text
User right-clicks Schema / Database -> import API docs
  -> read Markdown files
  -> normalize sections
  -> save raw normalized docs only after validation stage is ready
  -> subagent model extracts structured facts from each section
  -> validator checks candidate tables/columns against live schema metadata
  -> Kuzu stores document sections, API fields, concepts, mappings, join candidates, evidence
  -> embedding service embeds raw chunks and extracted fact cards
  -> manifest records import, extraction status, fact counts, and unresolved candidates
```

The system must not auto-ingest or auto-save graph knowledge during a normal chat answer. Ingestion happens only through explicit user-triggered document import or an explicit user confirmation/save action.

## Data Model Plan

### Rust Sidecar Types

Modify `crates/dbx-schema-rag-sidecar/src/lib.rs`.

Add extraction-related status:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApiDocExtractionStatus {
    Pending,
    Extracted,
    Partial,
    Failed,
}
```

Add fact confidence and validation status:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchemaRagFactStatus {
    Verified,
    Candidate,
    Rejected,
    Unresolved,
}
```

Add API document field facts:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaRagApiFieldFact {
    pub id: String,
    pub source_id: String,
    pub section_id: String,
    pub name: String,
    pub meaning: String,
    pub candidate_schema: Option<String>,
    pub candidate_table: Option<String>,
    pub candidate_column: Option<String>,
    pub status: SchemaRagFactStatus,
    pub confidence: f32,
    pub evidence: String,
}
```

Add business concept facts:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaRagBusinessConceptFact {
    pub id: String,
    pub source_id: String,
    pub section_id: String,
    pub term: String,
    pub description: String,
    pub candidate_schema: Option<String>,
    pub candidate_table: Option<String>,
    pub candidate_column: Option<String>,
    pub status: SchemaRagFactStatus,
    pub confidence: f32,
    pub evidence: String,
}
```

Add multi-column join candidate facts:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaRagJoinCandidateFact {
    pub id: String,
    pub source_id: String,
    pub section_id: String,
    pub left_schema: String,
    pub left_table: String,
    pub left_columns: Vec<String>,
    pub right_schema: String,
    pub right_table: String,
    pub right_columns: Vec<String>,
    pub relation: String,
    pub status: SchemaRagFactStatus,
    pub confidence: f32,
    pub evidence: String,
}
```

Add normalized extraction bundle:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SchemaRagApiDocExtraction {
    pub source_id: String,
    pub extracted_at: String,
    pub status: ApiDocExtractionStatus,
    pub api_fields: Vec<SchemaRagApiFieldFact>,
    pub business_concepts: Vec<SchemaRagBusinessConceptFact>,
    pub join_candidates: Vec<SchemaRagJoinCandidateFact>,
    pub errors: Vec<String>,
}
```

Extend `SchemaRagApiDocSource`:

```rust
pub extraction_status: ApiDocExtractionStatus,
pub extracted_at: Option<String>,
pub api_field_count: usize,
pub business_concept_count: usize,
pub join_candidate_count: usize,
pub unresolved_fact_count: usize,
```

Keep `#[serde(default)]` for all new fields to preserve existing index compatibility.

### Kuzu Graph Plan

Modify `create_kuzu_schema` in `crates/dbx-schema-rag-sidecar/src/lib.rs`.

Add nodes:

```text
ApiDocSource(id, path, original_format, content_hash, imported_at)
ApiDocSection(id, source_id, title_path, text, page)
ApiField(id, source_id, section_id, name, meaning, confidence, status, evidence)
BusinessConcept(id, source_id, section_id, term, description, confidence, status, evidence)
JoinCandidate(id, source_id, section_id, left_schema, left_table, left_columns, right_schema, right_table, right_columns, relation, confidence, status, evidence)
```

Add relations:

```text
HAS_SECTION(ApiDocSource -> ApiDocSection)
SECTION_MENTIONS_FIELD(ApiDocSection -> ApiField)
SECTION_MENTIONS_CONCEPT(ApiDocSection -> BusinessConcept)
API_FIELD_MAPS_TO_COLUMN(ApiField -> ColumnNode)
CONCEPT_MAPS_TO_TABLE(BusinessConcept -> TableNode)
CONCEPT_MAPS_TO_COLUMN(BusinessConcept -> ColumnNode)
SECTION_DESCRIBES_TABLE(ApiDocSection -> TableNode)
SECTION_DESCRIBES_COLUMN(ApiDocSection -> ColumnNode)
JOIN_LEFT_TABLE(JoinCandidate -> TableNode)
JOIN_RIGHT_TABLE(JoinCandidate -> TableNode)
```

Only create `*_MAPS_TO_*` and `SECTION_DESCRIBES_*` relations for facts whose status is `Verified`.

For `Candidate` or `Unresolved`, keep the fact node and evidence, but do not let it become verified SQL evidence.

### Embedding Documents

Extend `SchemaRagDocumentKind`:

```rust
ApiDoc,
ApiDocFact,
```

Keep current raw `ApiDoc` section embedding.

Add extracted fact-card embedding text, for example:

```text
接口字段: applyStatus
含义: 申请状态
候选映射: mc_birth_apply.apply_status
状态: verified
证据: 表格中写明 applyStatus 对应 apply_status
来源: birth-api.md / 申请列表
```

Embedding fact cards gives vector search a normalized semantic target instead of relying only on raw Markdown table text.

## LLM Extraction Contract

Use the existing Schema Research subagent model configuration. Do not add a new model class.

Add a new extraction helper in `apps/desktop/src/lib/ai.ts` or a focused module:

```text
apps/desktop/src/lib/schemaDocIngestion.ts
```

If keeping all logic in `ai.ts` becomes too large, split into:

```text
apps/desktop/src/lib/schemaResearchTools.ts
apps/desktop/src/lib/schemaResearchPrompts.ts
apps/desktop/src/lib/schemaDocIngestion.ts
```

The subagent extraction prompt must output JSON only:

```json
{
  "apiFields": [
    {
      "name": "applyStatus",
      "meaning": "申请状态",
      "candidateTable": "mc_birth_apply",
      "candidateColumn": "apply_status",
      "confidence": 0.86,
      "evidence": "表格中写明 applyStatus 对应 apply_status"
    }
  ],
  "businessConcepts": [
    {
      "term": "出生证申请",
      "description": "出生医学证明申请记录",
      "candidateTable": "mc_birth_apply",
      "candidateColumn": null,
      "confidence": 0.8,
      "evidence": "章节标题为出生证申请列表"
    }
  ],
  "joinCandidates": [
    {
      "leftTable": "mc_birth_apply",
      "leftColumns": ["id"],
      "rightTable": "mc_birth_cert",
      "rightColumns": ["apply_id"],
      "relation": "申请记录对应出生证记录",
      "confidence": 0.72,
      "evidence": "接口同时返回申请字段和证件编号"
    }
  ]
}
```

Extraction prompt rules:

- The model may propose candidates, but cannot mark anything verified.
- The model must preserve evidence text from the document section.
- If the document only says an API field meaning without database mapping, return the field with no candidate table/column.
- Multi-column relationships must use arrays with equal left/right column counts.
- Do not invent table or column names not present in document text unless the section strongly implies them from identifier-like names.

## Validation Contract

Validation happens after extraction and before graph write.

Implement in Rust sidecar if extraction is moved into sidecar. If extraction remains frontend-driven for the first implementation, validation still must be done by sidecar before Kuzu write.

Validation rules:

```text
candidate table exists in current schema -> table candidate can be verified at table level
candidate column exists in candidate table -> column mapping can be verified
candidate table exists but column missing -> unresolved column
candidate table missing -> unresolved table
join candidate tables and all columns exist -> verified join candidate
join left/right column counts mismatch -> rejected
confidence < 0.65 -> candidate, not verified
```

Suggested thresholds:

```text
verified: schema exists + table exists + columns exist + confidence >= 0.75
candidate: schema/table/column exists + 0.50 <= confidence < 0.75
unresolved: referenced identifier missing or ambiguous
rejected: malformed, impossible, or mismatched multi-column relation
```

Final SQL can use only `verified` facts.

Candidate and unresolved facts are useful for ranking and asking the user, not for direct SQL.

## Query-Time Hybrid Retrieval

There is no new main-model tool named `dbx_search_schema_context`.

The concept is implemented inside `dbx_schema_research_task`:

```text
1. Subagent calls dbx_search_schema to get vector/schema-index candidates.
2. Subagent calls document graph lookup primitive to expand from matched document sections/facts to tables, columns, concepts, and join candidates.
3. Subagent calls dbx_get_column_details or dbx_load_table_schema internally to verify fields that may enter final SQL evidence.
4. Subagent returns compact evidence to the main model.
```

Add a subagent-only primitive if needed:

```text
dbx_expand_schema_graph
```

Purpose:

```text
Given matched tables, columns, document section ids, api field ids, or business concepts, expand Kuzu graph around them and return related verified/candidate facts.
```

Parameters:

```json
{
  "seeds": [
    {
      "kind": "table | column | api_doc_section | api_field | business_concept",
      "id": "string",
      "schema": "optional",
      "table": "optional",
      "column": "optional"
    }
  ],
  "includeCandidates": true,
  "limit": 20
}
```

Return:

```json
{
  "verifiedMappings": [],
  "candidateMappings": [],
  "joinCandidates": [],
  "concepts": [],
  "sourceEvidence": []
}
```

This tool must be available only inside `runSchemaResearchSubtask`.

## Implementation Tasks

### Task 1: Enforce Main-Model Schema Tool Boundary

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `packages/app-tests/aiSchemaTools.test.ts`
- Modify: `packages/app-tests/aiWorkflowEvents.test.ts`

- [ ] Step 1: Add a failing test that main tools exclude schema primitives.

Expected main tool names:

```ts
[
  "dbx_schema_research_task",
  "dbx_request_table_choice",
  "dbx_request_column_choice",
  "dbx_request_relation",
  "dbx_save_schema_enrichment",
]
```

Expected absent names:

```ts
[
  "dbx_search_schema",
  "dbx_list_tables",
  "dbx_find_columns",
  "dbx_search_table_columns",
  "dbx_get_column_details",
  "dbx_load_table_schema",
  "dbx_get_related_tables",
]
```

Run:

```bash
pnpm exec tsx --tsconfig apps/desktop/tsconfig.json --test packages/app-tests/aiSchemaTools.test.ts
```

Expected before implementation:

```text
FAIL because current buildAiSchemaTools exposes low-level schema tools to the main model.
```

- [ ] Step 2: Split tool scopes.

Add a scope option:

```ts
export type AiSchemaToolScope = "main" | "schema_research";

export interface AiSchemaToolsOptions {
  scope?: AiSchemaToolScope;
  includeResearchTask?: boolean;
  includeUserChoiceTools?: boolean;
  includeEnrichmentTool?: boolean;
  includeLoadTableSchema?: boolean;
}
```

Implement filtering:

```ts
const MAIN_SCHEMA_TOOLS = new Set([
  "dbx_schema_research_task",
  "dbx_request_table_choice",
  "dbx_request_column_choice",
  "dbx_request_relation",
  "dbx_save_schema_enrichment",
]);

const SCHEMA_RESEARCH_TOOLS = new Set([
  "dbx_search_schema",
  "dbx_list_tables",
  "dbx_find_columns",
  "dbx_search_table_columns",
  "dbx_get_column_details",
  "dbx_load_table_schema",
  "dbx_get_related_tables",
]);
```

`buildAiSchemaTools({ scope: "main" })` returns only main tools.

`buildAiSchemaTools({ scope: "schema_research" })` returns only subagent primitives.

Default scope should be `"main"` to prevent accidental exposure.

- [ ] Step 3: Update main tool-loop construction.

Where the main AI tool loop builds tools, call:

```ts
buildAiSchemaTools({ scope: "main" })
```

Where `runSchemaResearchSubtask` builds tools, call:

```ts
buildAiSchemaTools({
  scope: "schema_research",
  includeResearchTask: false,
  includeUserChoiceTools: false,
  includeEnrichmentTool: false,
});
```

- [ ] Step 4: Rewrite main prompt.

Remove main-model instructions that say:

```text
你可以按需调用工具检索 Schema
优先调用 dbx_search_schema
字段进入最终 SQL 前调用 dbx_get_column_details
JOIN 前调用 dbx_get_related_tables
```

Replace with:

```text
查询表、字段、字段详情、表关系、文档映射时，只能调用 dbx_schema_research_task。
dbx_schema_research_task 是你唯一的 Schema 查询入口。
你不能直接调用低级 schema tools。
如果 Schema Research 返回 partial，继续发起更窄的 dbx_schema_research_task，或通过用户选择/关系确认工具让用户确认。
用户手动输入表或字段后，仍必须把该候选交给 dbx_schema_research_task 做实时验证。
最终 SQL 只能使用 Schema Research 返回的 verified 字段、当前明确 @table 上下文中的字段，或用户确认后再次由 Schema Research 验证过的字段。
```

English prompt must mirror the same boundary.

- [ ] Step 5: Update evidence gate text.

Change partial/need_user_choice follow-up instruction so it never suggests direct primitive calls.

Before:

```text
调用 dbx_search_schema、dbx_find_columns、dbx_get_column_details...
```

After:

```text
继续调用更窄的 dbx_schema_research_task，或调用用户选择/关系确认工具。
```

- [ ] Step 6: Run focused tests.

Run:

```bash
pnpm exec tsx --tsconfig apps/desktop/tsconfig.json --test packages/app-tests/aiSchemaTools.test.ts
pnpm exec tsx --tsconfig apps/desktop/tsconfig.json --test packages/app-tests/aiWorkflowEvents.test.ts
```

Expected:

```text
Both test files pass in the host environment.
```

If running in WSL hits the known esbuild platform mismatch, report that separately and verify through Windows host or IDE terminal.

### Task 2: Add Document Graph Extraction Types And Manifest Fields

**Files:**

- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`
- Modify: `crates/dbx-schema-rag-sidecar/src/main.rs`

- [ ] Step 1: Add Rust types from the Data Model Plan.

Add:

```rust
ApiDocExtractionStatus
SchemaRagFactStatus
SchemaRagApiFieldFact
SchemaRagBusinessConceptFact
SchemaRagJoinCandidateFact
SchemaRagApiDocExtraction
```

- [ ] Step 2: Extend `SchemaRagApiDocSource`.

Add defaulted fields:

```rust
#[serde(default)]
pub extraction_status: ApiDocExtractionStatus,
#[serde(default)]
pub extracted_at: Option<String>,
#[serde(default)]
pub api_field_count: usize,
#[serde(default)]
pub business_concept_count: usize,
#[serde(default)]
pub join_candidate_count: usize,
#[serde(default)]
pub unresolved_fact_count: usize,
```

Implement `Default` for `ApiDocExtractionStatus` as `Pending`.

- [ ] Step 3: Add a sidecar test for backward-compatible manifest loading.

Create a JSON fixture inside the test body that lacks the new fields and deserialize it into `SchemaRagManifest`.

Expected:

```rust
assert_eq!(manifest.api_doc_sources[0].extraction_status, ApiDocExtractionStatus::Pending);
assert_eq!(manifest.api_doc_sources[0].api_field_count, 0);
```

- [ ] Step 4: Run Rust formatting and focused sidecar tests.

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test -p dbx-schema-rag-sidecar --lib --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
Formatting passes.
Sidecar lib tests pass in host environment.
```

### Task 3: Persist API Doc Graph Nodes In Kuzu

**Files:**

- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`

- [ ] Step 1: Extend `create_kuzu_schema`.

Add Kuzu node and relation tables listed in the Kuzu Graph Plan.

Use idempotent creation like current schema creation logic. Existing indexes must keep loading.

- [ ] Step 2: Add graph insert helpers.

Add:

```rust
fn insert_api_doc_graph(connection: &Connection<'_>, graph: &SchemaRagApiDocExtraction) -> Result<(), String>
```

This function inserts:

```text
ApiField
BusinessConcept
JoinCandidate
verified mapping relations
verified join table relations
```

- [ ] Step 3: Preserve existing raw document behavior.

`insert_kuzu_documents` must continue to insert `SchemaDocument` rows for `ApiDoc` sections.

Do not create `DESCRIBES_TABLE` or `DESCRIBES_COLUMN` for raw `ApiDoc` documents unless a verified extraction fact exists.

- [ ] Step 4: Add Kuzu graph tests.

Add a test that:

```rust
1. builds fake schema with table mc_birth_apply and column apply_status
2. creates a verified SchemaRagApiFieldFact mapping applyStatus -> mc_birth_apply.apply_status
3. writes Kuzu index
4. queries API_FIELD_MAPS_TO_COLUMN count
5. asserts count == 1
```

Add a second test for unresolved mapping:

```rust
status = Unresolved
assert mapping relation count == 0
assert ApiField node exists
```

### Task 4: Validate Extracted Facts Against Live Schema Metadata

**Files:**

- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`

- [ ] Step 1: Add validation function.

```rust
pub fn validate_api_doc_extraction(
    extraction: SchemaRagApiDocExtraction,
    schema: &str,
    tables: &[SchemaRagTableMetadata],
) -> SchemaRagApiDocExtraction
```

- [ ] Step 2: Implement field mapping validation.

For each `SchemaRagApiFieldFact`:

```text
candidate table missing -> Unresolved
candidate column missing -> Unresolved
table and column exist, confidence >= 0.75 -> Verified
table and column exist, 0.50 <= confidence < 0.75 -> Candidate
confidence < 0.50 -> Rejected
```

- [ ] Step 3: Implement business concept validation.

Concepts can map to table or column:

```text
table exists and no column -> table-level Verified or Candidate by threshold
table and column exist -> column-level Verified or Candidate by threshold
missing target -> Unresolved
```

- [ ] Step 4: Implement join validation.

For each `SchemaRagJoinCandidateFact`:

```text
left_columns.len() != right_columns.len() -> Rejected
left/right table missing -> Unresolved
any referenced column missing -> Unresolved
all exist and confidence >= 0.75 -> Verified
all exist and 0.50 <= confidence < 0.75 -> Candidate
confidence < 0.50 -> Rejected
```

- [ ] Step 5: Add tests for each status.

Test cases:

```text
verified field mapping
candidate field mapping
unresolved missing table
unresolved missing column
rejected low confidence
verified multi-column join
rejected mismatched join column counts
```

### Task 5: Use Schema Research Model To Extract API Doc Facts

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Create or modify: `apps/desktop/src/lib/schemaDocIngestion.ts`
- Modify: `apps/desktop/src/lib/api.ts`
- Modify: `apps/desktop/src/lib/tauri.ts`
- Modify: `src-tauri/src/commands/schema_rag.rs`
- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`
- Modify: `crates/dbx-schema-rag-sidecar/src/main.rs`

- [ ] Step 1: Add frontend extraction contract.

Create:

```ts
export interface ApiDocExtractionRequest {
  sourceId: string;
  sourcePath: string;
  schema: string;
  sections: Array<{
    id: string;
    titlePath: string[];
    text: string;
  }>;
}

export interface ApiDocExtractionResult {
  sourceId: string;
  apiFields: Array<{
    sectionId: string;
    name: string;
    meaning: string;
    candidateTable?: string;
    candidateColumn?: string;
    confidence: number;
    evidence: string;
  }>;
  businessConcepts: Array<{
    sectionId: string;
    term: string;
    description: string;
    candidateTable?: string;
    candidateColumn?: string;
    confidence: number;
    evidence: string;
  }>;
  joinCandidates: Array<{
    sectionId: string;
    leftTable: string;
    leftColumns: string[];
    rightTable: string;
    rightColumns: string[];
    relation: string;
    confidence: number;
    evidence: string;
  }>;
  errors: string[];
}
```

- [ ] Step 2: Add extraction function using existing Schema Research config.

Function:

```ts
export async function extractApiDocGraphFactsWithSchemaResearch(
  config: AiConfig,
  request: ApiDocExtractionRequest,
): Promise<ApiDocExtractionResult>
```

It must:

```text
resolve Schema Research settings
reject disabled config with clear error
reject non-completions providers that do not support tool calling
send only document section text and schema/database identifiers
request JSON-only output
parse and normalize model output
clamp confidence into 0..1
```

- [ ] Step 3: Decide command boundary.

Recommended implementation:

```text
Frontend imports docs and calls extraction model.
Frontend sends normalized docs + extraction JSON to Tauri.
Tauri/sidecar validates extraction against live schema metadata before graph write.
```

Reason:

```text
AI config and raw chat helpers already live on frontend/core AI path.
Sidecar already handles Kuzu, embedding, and schema validation.
```

- [ ] Step 4: Add command payload.

Extend `ImportSchemaRagApiDocsRequest` with optional extraction:

```rust
pub extractions: Vec<SchemaRagApiDocExtraction>
```

If omitted:

```text
import raw docs and set extraction_status = Pending
```

If present:

```text
validate extraction, write graph, generate fact-card embeddings
```

- [ ] Step 5: Make failed extraction non-destructive.

If extraction fails for a document:

```text
raw Markdown import may continue
manifest records extraction_status = Failed or Partial
graph facts are not written for invalid extraction
embedding for raw chunks still works
```

If embedding fails:

```text
do not write manifest/Kuzu half-import for new fact cards
preserve previous index state
```

### Task 6: Add Fact-Card Embeddings

**Files:**

- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`

- [ ] Step 1: Extend document kind.

Add:

```rust
SchemaRagDocumentKind::ApiDocFact
```

Update:

```text
value_document_kind
kuzu_document_kind
document_hit_reasons
lexical_score
search_documents_vector
```

- [ ] Step 2: Build fact-card documents.

Add:

```rust
fn build_api_doc_fact_documents(
    schema: &str,
    extraction: &SchemaRagApiDocExtraction,
) -> Vec<SchemaRagDocument>
```

Only embed `Verified` and `Candidate` facts.

Do not embed `Rejected`.

Embed `Unresolved` only if it contains useful user-facing business terms and no false database mapping.

- [ ] Step 3: Add tests.

Test that:

```text
verified field mapping creates ApiDocFact document
rejected mapping creates no fact document
fact document text includes field name, meaning, candidate table/column, status, source evidence
```

### Task 7: Add Subagent-Only Graph Expansion Primitive

**Files:**

- Modify: `apps/desktop/src/lib/ai.ts`
- Modify: `apps/desktop/src/lib/schemaRag.ts`
- Modify: `apps/desktop/src/lib/tauri.ts`
- Modify: `apps/desktop/src/lib/http.ts`
- Modify: `src-tauri/src/commands/schema_rag.rs`
- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`
- Modify: `crates/dbx-schema-rag-sidecar/src/main.rs`

- [ ] Step 1: Add sidecar request and response.

Command:

```text
expand_schema_rag_graph
```

Request:

```rust
pub struct ExpandSchemaRagGraphRequest {
    pub scope: SchemaRagScope,
    pub seeds: Vec<SchemaRagGraphSeed>,
    pub include_candidates: bool,
    pub limit: usize,
}
```

Response:

```rust
pub struct ExpandSchemaRagGraphResponse {
    pub verified_mappings: Vec<SchemaRagApiFieldFact>,
    pub candidate_mappings: Vec<SchemaRagApiFieldFact>,
    pub join_candidates: Vec<SchemaRagJoinCandidateFact>,
    pub concepts: Vec<SchemaRagBusinessConceptFact>,
    pub source_evidence: Vec<String>,
}
```

- [ ] Step 2: Add Tauri wrapper.

Add:

```ts
api.expandSchemaRagGraph(request)
```

Desktop-only. HTTP mode can throw unsupported like current Schema RAG operations.

- [ ] Step 3: Add AI internal tool.

Add `dbx_expand_schema_graph` to `SCHEMA_RESEARCH_TOOLS` only.

Do not add it to `MAIN_SCHEMA_TOOLS`.

- [ ] Step 4: Add execution branch.

In `executeAiSchemaToolCall`, route:

```ts
if (name === "dbx_expand_schema_graph") {
  return executeExpandSchemaGraphTool(context, budget, args);
}
```

Add a budget counter if useful:

```ts
graphExpansions: number
```

- [ ] Step 5: Update Schema Research system prompt.

Add:

```text
当 dbx_search_schema 命中文档、事实卡片、业务概念或多个候选表时，调用 dbx_expand_schema_graph 扩展 Kuzu 图关系。
图扩展返回 candidate 时不能直接当 verified 使用；需要 dbx_get_column_details 或 verified graph fact 支撑。
```

### Task 8: UI Status And Import Feedback

**Files:**

- Modify: `apps/desktop/src/components/sidebar/TreeItem.vue`
- Modify: `apps/desktop/src/i18n/locales/zh-CN.ts`
- Modify: `apps/desktop/src/i18n/locales/en.ts`
- Modify: `apps/desktop/src/i18n/locales/es.ts`
- Modify: `apps/desktop/src/lib/schemaRag.ts`

- [ ] Step 1: Show extraction status in Schema RAG status dialog.

For each API doc source show:

```text
imported
extraction status
api field facts
business concepts
join candidates
unresolved facts
```

- [ ] Step 2: Show import result toast.

Example:

```text
已导入 2 个文档，生成 24 个文档片段、37 个图谱事实、6 个候选关系，3 个候选需要确认。
```

- [ ] Step 3: Do not auto-open user confirmation UI during import.

Import is a maintenance operation. Low-confidence facts should be visible in status and available to future user-confirmation flows, but import must not interrupt with multiple choice dialogs.

### Task 9: Tests And Verification

**Files:**

- Modify: `packages/app-tests/aiSchemaTools.test.ts`
- Modify: `packages/app-tests/schemaRag.test.ts`
- Modify: `crates/dbx-schema-rag-sidecar/src/lib.rs`

- [ ] Step 1: Main/subagent tool boundary tests.

Assertions:

```text
main tools include dbx_schema_research_task
main tools exclude all schema primitives
subagent tools exclude dbx_schema_research_task
subagent tools include schema primitives
subagent tools include dbx_expand_schema_graph after Task 7
```

- [ ] Step 2: Prompt tests.

Assert main prompt contains:

```text
只能调用 dbx_schema_research_task
```

Assert main prompt does not contain direct instructions:

```text
优先调用 dbx_search_schema
调用 dbx_get_column_details
调用 dbx_get_related_tables
```

- [ ] Step 3: Extraction validation tests.

Run Rust tests for:

```text
field mapping status
business concept mapping status
multi-column join status
manifest backward compatibility
fact-card embedding document generation
Kuzu graph insertion
```

- [ ] Step 4: Host validation.

Because this checkout is under `/mnt/d/...`, true build/test verification must run in Windows host or IDE environment.

Validation commands:

```text
pnpm exec tsx --tsconfig apps/desktop/tsconfig.json --test packages/app-tests/aiSchemaTools.test.ts
pnpm exec tsx --tsconfig apps/desktop/tsconfig.json --test packages/app-tests/schemaRag.test.ts
pnpm exec vue-tsc --noEmit --project apps/desktop/tsconfig.json
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test -p dbx-schema-rag-sidecar --lib --manifest-path src-tauri/Cargo.toml
cargo check -p dbx-schema-rag-sidecar --manifest-path src-tauri/Cargo.toml
```

Known WSL caveats:

```text
pnpm test commands may fail in WSL if esbuild platform package was installed for Windows.
cargo check may fail in WSL before compiling DBX code if cmake is not installed for kuzu build script.
```

Report these as environment blockers, not as passing or failing implementation evidence.

## Acceptance Criteria

- The main model cannot see or call `dbx_search_schema`, `dbx_find_columns`, `dbx_search_table_columns`, `dbx_get_column_details`, `dbx_get_related_tables`, or `dbx_load_table_schema`.
- `dbx_schema_research_task` is the only schema-query entrypoint exposed to the main model.
- User choice tools can still be called by the main model, but only using candidates returned by Schema Research or explicit user input.
- Schema Research subagent can still call all low-level schema primitives internally.
- Imported Markdown API docs can produce raw chunk embeddings and extracted graph facts.
- Extracted facts are validated against real schema metadata before they become verified graph relations.
- Candidate/unresolved facts can improve ranking and user confirmation, but cannot become final SQL evidence.
- Multi-column join candidates are represented with arrays and validated as a complete pair set.
- Query-time schema research can combine vector hits, graph expansion, and live field verification before returning compact evidence.
- No SQLite storage is introduced for this feature.
- No automatic document/relationship sedimentation happens during ordinary chat; ingestion and save actions remain user-triggered.

## Non-Goals

- Do not introduce LangGraph for this task.
- Do not expose `dbx_search_schema_context` as a new main-model tool.
- Do not make document facts override live schema.
- Do not send table data to Schema Research, embedding, or document extraction models.
- Do not implement OCR for image-based PDF in this task.
- Do not auto-confirm low-confidence relationships.

## Open Implementation Decision

The only decision that should be made during implementation is where to execute the extraction model call:

Recommended:

```text
Frontend/Core AI layer calls the Schema Research model and sends extraction JSON to sidecar for validation and graph write.
```

Alternative:

```text
Sidecar directly calls the Schema Research model, requiring AI config and raw chat support to be duplicated or moved into Rust sidecar.
```

Use the recommended option unless implementation evidence shows it creates an unclean dependency or blocks streaming/progress reporting.

