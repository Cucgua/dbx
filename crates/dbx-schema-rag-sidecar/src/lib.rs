use chrono::{DateTime, Utc};
use futures::stream::{FuturesUnordered, StreamExt};
use kuzu::{Connection, Database, LogicalType, PreparedStatement, SystemConfig, Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::AsyncWriteExt;

const API_DOC_SECTION_TARGET_CHARS: usize = 1600;
const API_DOC_SECTION_MAX_CHARS: usize = 2200;
const API_DOC_SECTION_OVERLAP_CHARS: usize = 180;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagConfig {
    #[serde(alias = "embedding_provider")]
    pub embedding_provider: String,
    #[serde(alias = "embedding_endpoint")]
    pub embedding_endpoint: String,
    #[serde(alias = "embedding_model")]
    pub embedding_model: String,
    #[serde(alias = "embedding_api_key")]
    pub embedding_api_key: String,
    #[serde(alias = "embedding_dimension")]
    pub embedding_dimension: usize,
    #[serde(alias = "embedding_batch_size")]
    pub embedding_batch_size: usize,
    #[serde(default = "default_embedding_concurrency")]
    #[serde(alias = "embedding_concurrency")]
    pub embedding_concurrency: usize,
    #[serde(alias = "rerank_provider")]
    pub rerank_provider: String,
    #[serde(alias = "rerank_endpoint")]
    pub rerank_endpoint: String,
    #[serde(alias = "rerank_model")]
    pub rerank_model: String,
    #[serde(alias = "rerank_api_key")]
    pub rerank_api_key: String,
    #[serde(alias = "proxy_enabled")]
    pub proxy_enabled: bool,
    #[serde(alias = "proxy_url")]
    pub proxy_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagScope {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub db_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub column_default: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagIndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagForeignKeyMetadata {
    pub name: String,
    pub column: String,
    pub ref_schema: Option<String>,
    pub ref_table: String,
    pub ref_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagTableMetadata {
    pub schema: String,
    pub name: String,
    pub table_type: String,
    pub comment: Option<String>,
    pub ddl: Option<String>,
    pub columns: Vec<SchemaRagColumnMetadata>,
    pub indexes: Vec<SchemaRagIndexMetadata>,
    pub foreign_keys: Vec<SchemaRagForeignKeyMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSchemaRagRequest {
    pub scope: SchemaRagScope,
    pub tables: Vec<SchemaRagTableMetadata>,
    pub config: SchemaRagConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagManifest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub db_type: String,
    pub embedding_provider: String,
    pub embedding_endpoint: String,
    pub embedding_model: String,
    pub embedding_dimension: usize,
    pub rerank_provider: String,
    pub analyzed_at: DateTime<Utc>,
    pub table_count: usize,
    pub column_count: usize,
    pub index_count: usize,
    pub foreign_key_count: usize,
    pub schema_fingerprint: String,
    #[serde(default)]
    pub table_units: Vec<SchemaRagTableIndexUnit>,
    #[serde(default)]
    pub api_doc_sources: Vec<SchemaRagApiDocSource>,
    #[serde(default)]
    pub api_doc_chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagTableIndexUnit {
    pub schema: String,
    pub table: String,
    pub fingerprint: String,
    pub document_ids: Vec<String>,
    pub column_count: usize,
    pub index_count: usize,
    pub foreign_key_count: usize,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaRagTableChangeKind {
    Added,
    Changed,
    Removed,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagTableChange {
    pub schema: String,
    pub table: String,
    pub kind: SchemaRagTableChangeKind,
    pub old_fingerprint: Option<String>,
    pub new_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagTableChangeSummary {
    pub added: usize,
    pub changed: usize,
    pub removed: usize,
    pub unchanged: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefreshSchemaRagMode {
    ChangedOnly,
    SelectedTables,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSchemaRagTablesRequest {
    pub scope: SchemaRagScope,
    pub tables: Vec<SchemaRagTableMetadata>,
    pub config: SchemaRagConfig,
    pub mode: RefreshSchemaRagMode,
    #[serde(default)]
    pub selected_tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSchemaRagTablesResponse {
    pub manifest: SchemaRagManifest,
    pub changes: SchemaRagTableChangeSummary,
    pub rebuilt_documents: usize,
    pub index_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeSourceKind {
    Schema,
    ApiDoc,
    Enrichment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedApiDocSection {
    pub id: String,
    pub title_path: Vec<String>,
    pub text: String,
    pub page: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedApiDoc {
    pub source_id: String,
    pub source_path: String,
    pub source_kind: KnowledgeSourceKind,
    pub original_format: String,
    pub converter: String,
    pub content_hash: String,
    pub markdown: String,
    pub sections: Vec<NormalizedApiDocSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApiDocExtractionStatus {
    Pending,
    Extracted,
    Partial,
    Failed,
}

impl Default for ApiDocExtractionStatus {
    fn default() -> Self {
        Self::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaRagFactStatus {
    Verified,
    Candidate,
    Rejected,
    Unresolved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagApiDocExtraction {
    pub source_id: String,
    pub extracted_at: String,
    pub status: ApiDocExtractionStatus,
    #[serde(default)]
    pub api_fields: Vec<SchemaRagApiFieldFact>,
    #[serde(default)]
    pub business_concepts: Vec<SchemaRagBusinessConceptFact>,
    #[serde(default)]
    pub join_candidates: Vec<SchemaRagJoinCandidateFact>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagApiDocSource {
    pub source_id: String,
    pub source_path: String,
    pub original_format: String,
    pub converter: String,
    pub content_hash: String,
    pub section_count: usize,
    pub imported_at: DateTime<Utc>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSchemaRagResponse {
    pub manifest: SchemaRagManifest,
    pub index_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSchemaRagApiDocsRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub config: SchemaRagConfig,
    pub files: Vec<ApiDocImportFile>,
    #[serde(default)]
    pub extractions: Vec<SchemaRagApiDocExtraction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiDocImportFile {
    pub path: String,
    pub display_name: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSchemaRagApiDocsResponse {
    pub imported_sources: usize,
    pub chunks: usize,
    pub embedded_chunks: usize,
    pub graph_facts: usize,
    pub verified_facts: usize,
    pub unresolved_facts: usize,
    pub unsupported_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagGraphSeed {
    pub kind: String,
    pub id: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub column: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpandSchemaRagGraphRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    #[serde(default)]
    pub seeds: Vec<SchemaRagGraphSeed>,
    #[serde(default)]
    pub include_candidates: bool,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpandSchemaRagGraphResponse {
    pub verified_mappings: Vec<SchemaRagApiFieldFact>,
    pub candidate_mappings: Vec<SchemaRagApiFieldFact>,
    pub join_candidates: Vec<SchemaRagJoinCandidateFact>,
    pub concepts: Vec<SchemaRagBusinessConceptFact>,
    pub source_evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagStatusRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagStatus {
    pub indexed: bool,
    pub manifest: Option<SchemaRagManifest>,
    pub index_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSchemaRagRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub query: String,
    pub config: SchemaRagConfig,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagMatchedColumn {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_key: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_type: Option<String>,
    pub score: f32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchTableColumnsRagRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
    pub query: String,
    pub config: SchemaRagConfig,
    pub limit: Option<usize>,
    pub include_primary_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagBusinessAliasInput {
    pub term: String,
    pub target_kind: Option<String>,
    pub table: String,
    pub column: Option<String>,
    pub source: Option<String>,
    pub confidence: Option<f32>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveSchemaRagEnrichmentRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub aliases: Vec<SchemaRagBusinessAliasInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveSchemaRagEnrichmentResponse {
    pub saved_aliases: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagColumnSearchResult {
    pub indexed_at: String,
    pub schema: String,
    pub table: String,
    pub query: String,
    pub total_columns: usize,
    pub returned_columns: usize,
    pub columns: Vec<SchemaRagMatchedColumn>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagRelatedTable {
    pub schema: String,
    pub name: String,
    pub relation: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagSearchTable {
    pub schema: String,
    pub name: String,
    pub table_type: String,
    pub score: f32,
    pub reason: String,
    pub matched_columns: Vec<SchemaRagMatchedColumn>,
    pub related_tables: Vec<SchemaRagRelatedTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagSearchResult {
    pub indexed_at: String,
    pub query: String,
    pub tables: Vec<SchemaRagSearchTable>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagAnalyzeProgress {
    pub stage: String,
    pub done: usize,
    pub total: usize,
    pub table: Option<String>,
    pub batch: Option<usize>,
    pub batch_total: Option<usize>,
    pub batch_size: Option<usize>,
    pub concurrency: Option<usize>,
    pub in_flight: Option<usize>,
    pub succeeded_batches: Option<usize>,
    pub failed_batches: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagDocument {
    pub id: String,
    pub kind: SchemaRagDocumentKind,
    pub schema: String,
    pub table: String,
    pub column: Option<String>,
    pub data_type: Option<String>,
    pub text_for_embedding: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaRagDocumentKind {
    Table,
    Column,
    ApiDoc,
    ApiDocFact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSchemaRagIndex {
    manifest: SchemaRagManifest,
    tables: Vec<SchemaRagTableMetadata>,
    documents: Vec<SchemaRagDocument>,
    #[serde(default)]
    api_doc_extractions: Vec<SchemaRagApiDocExtraction>,
}

#[derive(Debug, Clone, Default)]
struct SchemaRagEnrichment {
    aliases: Vec<SchemaRagBusinessAlias>,
}

#[derive(Debug, Clone, PartialEq)]
struct SchemaRagBusinessAlias {
    term: String,
    target_kind: String,
    schema: String,
    table: String,
    column: Option<String>,
    source: String,
    confidence: f32,
    note: Option<String>,
}

#[derive(Debug, Clone)]
struct SchemaRagSearchIndex {
    stored: StoredSchemaRagIndex,
    enrichment: SchemaRagEnrichment,
    source: String,
}

const DEFAULT_EMBEDDING_CONCURRENCY: usize = 4;
const MAX_EMBEDDING_CONCURRENCY: usize = 16;
const MAX_EMBEDDING_BATCH_SIZE: usize = 256;

fn default_embedding_concurrency() -> usize {
    DEFAULT_EMBEDDING_CONCURRENCY
}

pub fn normalized_embedding_concurrency(config: &SchemaRagConfig) -> usize {
    config.embedding_concurrency.clamp(1, MAX_EMBEDDING_CONCURRENCY)
}

fn normalized_embedding_batch_size(config: &SchemaRagConfig, single_input_only: bool) -> usize {
    if single_input_only {
        1
    } else {
        config.embedding_batch_size.clamp(1, MAX_EMBEDDING_BATCH_SIZE)
    }
}

pub fn validate_schema_rag_config(config: &SchemaRagConfig) -> Result<(), String> {
    if config.embedding_provider.trim().is_empty() {
        return Err("Embedding provider is required".to_string());
    }
    if config.embedding_endpoint.trim().is_empty() {
        return Err("Embedding endpoint is required".to_string());
    }
    if config.embedding_model.trim().is_empty() {
        return Err("Embedding model is required".to_string());
    }
    if config.embedding_dimension == 0 {
        return Err("Embedding dimension must be greater than zero".to_string());
    }
    Ok(())
}

pub async fn analyze_schema(
    data_dir: &Path,
    request: AnalyzeSchemaRagRequest,
) -> Result<AnalyzeSchemaRagResponse, String> {
    analyze_schema_with_progress(data_dir, request, |_| {}).await
}

pub async fn analyze_schema_with_progress<F>(
    data_dir: &Path,
    request: AnalyzeSchemaRagRequest,
    mut progress: F,
) -> Result<AnalyzeSchemaRagResponse, String>
where
    F: FnMut(SchemaRagAnalyzeProgress),
{
    validate_schema_rag_config(&request.config)?;
    let index_dir =
        schema_index_dir(data_dir, &request.scope.connection_id, &request.scope.database, &request.scope.schema);
    tokio::fs::create_dir_all(&index_dir).await.map_err(|err| err.to_string())?;
    tokio::fs::write(index_dir.join("sidecar.log"), b"").await.map_err(|err| err.to_string())?;
    append_sidecar_log(
        &index_dir,
        &format!(
            "analyze start connection={} database={} schema={} tables={}",
            request.scope.connection_id,
            request.scope.database,
            request.scope.schema,
            request.tables.len()
        ),
    )
    .await?;
    progress(progress_event(
        "build_documents",
        0,
        request.tables.len(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "Building schema documents",
    ));

    let api_documents = load_api_doc_documents(&index_dir, &request.scope.schema).await?;
    let mut documents = build_schema_documents(&request.tables);
    documents.extend(api_documents);
    let texts: Vec<String> = documents.iter().map(|doc| doc.text_for_embedding.clone()).collect();
    append_sidecar_log(
        &index_dir,
        &format!(
            "documents built total={} tables={} columns={}",
            texts.len(),
            request.tables.len(),
            request.tables.iter().map(|table| table.columns.len()).sum::<usize>()
        ),
    )
    .await?;
    let embeddings = embed_texts(&request.config, &texts, &index_dir, &mut progress).await?;
    if embeddings.len() != documents.len() {
        return Err("Embedding service returned an unexpected number of vectors".to_string());
    }
    for (doc, embedding) in documents.iter_mut().zip(embeddings) {
        doc.embedding = embedding;
    }

    let analyzed_at = Utc::now();
    let mut manifest = build_manifest(&request, analyzed_at)?;
    if let Some(existing_manifest) = load_manifest_if_exists(&index_dir).await? {
        manifest.api_doc_sources = existing_manifest.api_doc_sources;
        manifest.api_doc_chunk_count = existing_manifest.api_doc_chunk_count;
    }
    let document_count = documents.len();
    progress(progress_event(
        "write_index",
        document_count,
        document_count,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "Writing schema index files",
    ));
    append_sidecar_log(&index_dir, "writing manifest and documents").await?;
    write_json_pretty(&index_dir.join("manifest.json"), &manifest).await?;
    let stored = StoredSchemaRagIndex {
        manifest: manifest.clone(),
        tables: request.tables,
        documents,
        api_doc_extractions: Vec::new(),
    };
    write_json_pretty(&index_dir.join("documents.json"), &stored).await?;
    write_kuzu_index(&index_dir.join("graph.kuzu"), &stored).await?;
    append_sidecar_log(&index_dir, "analyze finished").await?;
    progress(progress_event(
        "finished",
        document_count,
        document_count,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "Schema index finished",
    ));

    Ok(AnalyzeSchemaRagResponse { manifest, index_path: index_dir.to_string_lossy().to_string() })
}

pub async fn refresh_schema_tables(
    data_dir: &Path,
    request: RefreshSchemaRagTablesRequest,
) -> Result<RefreshSchemaRagTablesResponse, String> {
    validate_schema_rag_config(&request.config)?;
    let index_dir =
        schema_index_dir(data_dir, &request.scope.connection_id, &request.scope.database, &request.scope.schema);
    let mut search_index =
        load_search_index(data_dir, &request.scope.connection_id, &request.scope.database, &request.scope.schema).await?;
    let requested_tables: HashSet<String> = match request.mode {
        RefreshSchemaRagMode::ChangedOnly => request.tables.iter().map(|table| table.name.clone()).collect(),
        RefreshSchemaRagMode::SelectedTables => request.selected_tables.iter().cloned().collect(),
    };
    if requested_tables.is_empty() {
        return Err("At least one table is required for table refresh".to_string());
    }

    let changes = diff_table_index_units(&search_index.stored.manifest.table_units, &request.tables)?;
    let selected_tables: Vec<SchemaRagTableMetadata> = request
        .tables
        .iter()
        .filter(|table| requested_tables.iter().any(|selected| selected.eq_ignore_ascii_case(&table.name)))
        .cloned()
        .collect();
    if selected_tables.is_empty() {
        return Err("Selected tables were not found in current schema metadata".to_string());
    }

    let mut refreshed_documents = build_schema_documents(&selected_tables);
    let texts: Vec<String> = refreshed_documents.iter().map(|doc| doc.text_for_embedding.clone()).collect();
    let mut progress = |_| {};
    let embeddings = embed_texts(&request.config, &texts, &index_dir, &mut progress).await?;
    if embeddings.len() != refreshed_documents.len() {
        return Err("Embedding service returned an unexpected number of vectors".to_string());
    }
    for (doc, embedding) in refreshed_documents.iter_mut().zip(embeddings) {
        doc.embedding = embedding;
    }

    let selected_names: Vec<String> = selected_tables.iter().map(|table| table.name.clone()).collect();
    search_index.stored.documents =
        merge_refreshed_table_documents(&search_index.stored.documents, refreshed_documents, &selected_names);
    for refreshed_table in selected_tables {
        if let Some(existing) = search_index
            .stored
            .tables
            .iter_mut()
            .find(|table| table.schema == refreshed_table.schema && table.name.eq_ignore_ascii_case(&refreshed_table.name))
        {
            *existing = refreshed_table;
        } else {
            search_index.stored.tables.push(refreshed_table);
        }
    }
    search_index.stored.tables.sort_by(|a, b| a.schema.cmp(&b.schema).then_with(|| a.name.cmp(&b.name)));

    let analyzed_at = Utc::now();
    let mut manifest = build_manifest(
        &AnalyzeSchemaRagRequest { scope: request.scope, tables: search_index.stored.tables.clone(), config: request.config },
        analyzed_at,
    )?;
    manifest.api_doc_sources = search_index.stored.manifest.api_doc_sources;
    manifest.api_doc_chunk_count = search_index.stored.manifest.api_doc_chunk_count;
    search_index.stored.manifest = manifest.clone();

    write_json_pretty(&index_dir.join("manifest.json"), &manifest).await?;
    write_json_pretty(&index_dir.join("documents.json"), &search_index.stored).await?;
    let graph_path = index_dir.join("graph.kuzu");
    write_kuzu_index(&graph_path, &search_index.stored).await?;
    if !search_index.enrichment.aliases.is_empty() {
        save_kuzu_business_aliases(&graph_path, &search_index.enrichment.aliases).await?;
    }
    append_sidecar_log(&index_dir, &format!("table refresh done rebuilt_documents={}", texts.len())).await?;

    Ok(RefreshSchemaRagTablesResponse {
        manifest,
        changes: summarize_table_changes(&changes_for_requested_tables(&changes, &requested_tables)),
        rebuilt_documents: texts.len(),
        index_path: index_dir.to_string_lossy().to_string(),
    })
}

pub async fn search_schema(data_dir: &Path, request: SearchSchemaRagRequest) -> Result<SchemaRagSearchResult, String> {
    validate_schema_rag_config(&request.config)?;
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, &request.schema);
    let search_index = load_search_index(data_dir, &request.connection_id, &request.database, &request.schema).await?;
    let started_at = Instant::now();
    append_sidecar_log(
        &index_dir,
        &format!(
            "search start source={} connection={} database={} schema={} limit={} query={}",
            search_index.source,
            request.connection_id,
            request.database,
            request.schema,
            request.limit.unwrap_or(8),
            sanitize_log_value(&request.query)
        ),
    )
    .await?;
    let query_embedding = embed_query_text(&request.config, &request.query, &index_dir).await?;
    let result = search_documents_vector(
        &request.schema,
        &request.query,
        &query_embedding,
        &search_index.stored.documents,
        &search_index.stored.tables,
        &search_index.enrichment,
        request.limit.unwrap_or(8),
        &search_index.stored.manifest.analyzed_at.to_rfc3339(),
    );
    append_sidecar_log(
        &index_dir,
        &format!(
            "search done tables={} truncated={} elapsed_ms={}",
            result.tables.len(),
            result.truncated,
            started_at.elapsed().as_millis()
        ),
    )
    .await?;
    Ok(result)
}

pub async fn search_table_columns(
    data_dir: &Path,
    request: SearchTableColumnsRagRequest,
) -> Result<SchemaRagColumnSearchResult, String> {
    validate_schema_rag_config(&request.config)?;
    let schema = request.schema.trim();
    let table = request.table.trim();
    let query = request.query.trim();
    if schema.is_empty() {
        return Err("schema is required".to_string());
    }
    if table.is_empty() {
        return Err("table is required".to_string());
    }
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, schema);
    let search_index = load_search_index(data_dir, &request.connection_id, &request.database, schema).await?;
    let started_at = Instant::now();
    append_sidecar_log(
        &index_dir,
        &format!(
            "column search start source={} connection={} database={} schema={} table={} limit={} query={}",
            search_index.source,
            request.connection_id,
            request.database,
            schema,
            table,
            request.limit.unwrap_or(12),
            sanitize_log_value(query)
        ),
    )
    .await?;
    let query_embedding = embed_query_text(&request.config, query, &index_dir).await?;
    let result = search_table_columns_vector(
        schema,
        table,
        query,
        &query_embedding,
        &search_index.stored.documents,
        &search_index.stored.tables,
        &search_index.enrichment,
        request.limit.unwrap_or(12),
        request.include_primary_key.unwrap_or(true),
        &search_index.stored.manifest.analyzed_at.to_rfc3339(),
    );
    append_sidecar_log(
        &index_dir,
        &format!(
            "column search done columns={} truncated={} elapsed_ms={}",
            result.columns.len(),
            result.truncated,
            started_at.elapsed().as_millis()
        ),
    )
    .await?;
    Ok(result)
}

pub async fn save_schema_enrichment(
    data_dir: &Path,
    request: SaveSchemaRagEnrichmentRequest,
) -> Result<SaveSchemaRagEnrichmentResponse, String> {
    let schema = request.schema.trim();
    if schema.is_empty() {
        return Err("schema is required".to_string());
    }
    if request.aliases.is_empty() {
        return Ok(SaveSchemaRagEnrichmentResponse { saved_aliases: 0 });
    }
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, schema);
    let graph_path = index_dir.join("graph.kuzu");
    if !graph_path.exists() {
        return Err("Schema RAG graph is not available. Analyze schema before saving enrichment.".to_string());
    }
    let aliases = request
        .aliases
        .into_iter()
        .map(|alias| normalize_business_alias(schema, alias))
        .collect::<Result<Vec<_>, _>>()?;
    let saved_aliases = save_kuzu_business_aliases(&graph_path, &aliases).await?;
    append_sidecar_log(&index_dir, &format!("enrichment saved aliases={saved_aliases}")).await?;
    Ok(SaveSchemaRagEnrichmentResponse { saved_aliases })
}

pub async fn import_api_docs(
    data_dir: &Path,
    request: ImportSchemaRagApiDocsRequest,
) -> Result<ImportSchemaRagApiDocsResponse, String> {
    let schema = request.schema.trim();
    if schema.is_empty() {
        return Err("schema is required".to_string());
    }
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, schema);
    tokio::fs::create_dir_all(&index_dir).await.map_err(|err| err.to_string())?;
    let docs_dir = index_dir.join("api-docs");
    tokio::fs::create_dir_all(&docs_dir).await.map_err(|err| err.to_string())?;

    let mut manifest = load_manifest_if_exists(&index_dir)
        .await?
        .ok_or_else(|| "Analyze schema before importing API docs.".to_string())?;
    validate_schema_rag_config(&request.config)?;
    let mut imported_sources = 0usize;
    let mut chunks = 0usize;
    let mut embedded_chunks = 0usize;
    let mut graph_facts = 0usize;
    let mut verified_facts = 0usize;
    let mut unresolved_facts = 0usize;
    let mut unsupported_files = Vec::new();
    let mut imported_source_ids = HashSet::new();
    let mut normalized_docs = Vec::new();
    let mut all_api_documents = Vec::new();
    let request_extractions: HashMap<String, SchemaRagApiDocExtraction> =
        request.extractions.into_iter().map(|extraction| (extraction.source_id.clone(), extraction)).collect();
    let imported_at = Utc::now();

    for file in request.files {
        let path = file.path.trim();
        let display_name = file.display_name.as_deref().unwrap_or(path);
        if !is_markdown_path(path) {
            unsupported_files.push(display_name.to_string());
            continue;
        }
        let source_id = format!("api-doc:{}", sha256_hex(path.as_bytes()));
        let normalized = normalize_markdown_api_doc(&source_id, path, &file.content)?;
        chunks += normalized.sections.len();
        imported_sources += 1;
        imported_source_ids.insert(normalized.source_id.clone());
        all_api_documents.extend(build_api_doc_documents(schema, &normalized));
        normalized_docs.push(normalized);
    }

    let mut validated_extractions = Vec::new();
    let mut updated_search_index = None;
    if !all_api_documents.is_empty() {
        let mut search_index =
            load_search_index(data_dir, &request.connection_id, &request.database, schema).await?;
        let source_id_set = imported_source_ids.clone();
        let old_fact_document_ids: HashSet<String> = search_index
            .stored
            .api_doc_extractions
            .iter()
            .filter(|extraction| source_id_set.contains(&extraction.source_id))
            .flat_map(api_doc_extraction_fact_document_ids)
            .collect();
        for normalized in &normalized_docs {
            if let Some(extraction) = request_extractions.get(&normalized.source_id).cloned() {
                let validated = validate_api_doc_extraction(extraction, schema, &search_index.stored.tables);
                graph_facts += extraction_fact_count(&validated);
                verified_facts += extraction_verified_fact_count(&validated);
                unresolved_facts += extraction_unresolved_fact_count(&validated);
                all_api_documents.extend(build_api_doc_fact_documents(schema, &validated));
                validated_extractions.push(validated);
            }
        }
        let texts: Vec<String> = all_api_documents.iter().map(|doc| doc.text_for_embedding.clone()).collect();
        let mut progress = |_| {};
        let embeddings = embed_texts(&request.config, &texts, &index_dir, &mut progress).await?;
        if embeddings.len() != all_api_documents.len() {
            return Err("Embedding service returned an unexpected number of vectors".to_string());
        }
        for (doc, embedding) in all_api_documents.iter_mut().zip(embeddings) {
            doc.embedding = embedding;
        }
        search_index
            .stored
            .documents
            .retain(|doc| !is_imported_api_doc_document(doc, &source_id_set, &old_fact_document_ids));
        search_index.stored.documents.extend(all_api_documents);
        search_index
            .stored
            .api_doc_extractions
            .retain(|extraction| !source_id_set.contains(&extraction.source_id));
        search_index.stored.api_doc_extractions.extend(validated_extractions.clone());
        search_index.stored.api_doc_extractions.sort_by(|a, b| a.source_id.cmp(&b.source_id));
        search_index
            .stored
            .documents
            .sort_by(|a, b| a.schema.cmp(&b.schema).then_with(|| a.table.cmp(&b.table)).then_with(|| a.id.cmp(&b.id)));
        embedded_chunks = texts.len();
        updated_search_index = Some(search_index);
    }

    for normalized in &normalized_docs {
        write_json_pretty(
            &docs_dir.join(format!("{}.json", sanitize_path_segment(&normalized.source_id))),
            normalized,
        )
        .await?;
        upsert_api_doc_source(&mut manifest, normalized, imported_at);
    }
    for extraction in &validated_extractions {
        apply_api_doc_extraction_summary(&mut manifest, extraction);
    }
    if !normalized_docs.is_empty() {
        manifest.api_doc_chunk_count = load_api_doc_chunk_count(&docs_dir).await.unwrap_or(chunks);
        write_json_pretty(&index_dir.join("manifest.json"), &manifest).await?;
    }
    if let Some(mut search_index) = updated_search_index {
        search_index.stored.manifest = manifest;
        write_json_pretty(&index_dir.join("documents.json"), &search_index.stored).await?;
        let graph_path = index_dir.join("graph.kuzu");
        write_kuzu_index(&graph_path, &search_index.stored).await?;
        if !search_index.enrichment.aliases.is_empty() {
            save_kuzu_business_aliases(&graph_path, &search_index.enrichment.aliases).await?;
        }
    }
    append_sidecar_log(
        &index_dir,
        &format!(
            "api docs imported sources={} chunks={} embedded_chunks={} unsupported={}",
            imported_sources,
            chunks,
            embedded_chunks,
            unsupported_files.len()
        ),
    )
    .await?;

    Ok(ImportSchemaRagApiDocsResponse {
        imported_sources,
        chunks,
        embedded_chunks,
        graph_facts,
        verified_facts,
        unresolved_facts,
        unsupported_files,
    })
}

pub async fn index_status(data_dir: &Path, request: SchemaRagStatusRequest) -> Result<SchemaRagStatus, String> {
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, &request.schema);
    let manifest_path = index_dir.join("manifest.json");
    let manifest = match tokio::fs::read(&manifest_path).await {
        Ok(bytes) => Some(serde_json::from_slice::<SchemaRagManifest>(&bytes).map_err(|err| err.to_string())?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.to_string()),
    };
    Ok(SchemaRagStatus { indexed: manifest.is_some(), manifest, index_path: index_dir.to_string_lossy().to_string() })
}

pub async fn expand_schema_graph(
    data_dir: &Path,
    request: ExpandSchemaRagGraphRequest,
) -> Result<ExpandSchemaRagGraphResponse, String> {
    let schema = request.schema.trim();
    if schema.is_empty() {
        return Err("schema is required".to_string());
    }
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, schema);
    let graph_path = index_dir.join("graph.kuzu");
    if !graph_path.exists() {
        return Err("Schema RAG graph.kuzu is not available. Analyze schema before expanding graph.".to_string());
    }
    let limit = request.limit.unwrap_or(20).clamp(1, 100);
    let graph_path_for_task = graph_path.clone();
    let seeds = request.seeds.clone();
    let seed_count = seeds.len();
    let include_candidates = request.include_candidates;
    let response = tokio::task::spawn_blocking(move || {
        expand_schema_graph_blocking(&graph_path_for_task, &seeds, include_candidates, limit)
    })
    .await
    .map_err(|err| format!("Kuzu graph expansion task failed: {err}"))??;
    append_sidecar_log(
        &index_dir,
        &format!(
            "graph expanded seeds={} verified={} candidates={} joins={} concepts={}",
            seed_count,
            response.verified_mappings.len(),
            response.candidate_mappings.len(),
            response.join_candidates.len(),
            response.concepts.len()
        ),
    )
    .await?;
    Ok(response)
}

pub async fn delete_index(data_dir: &Path, request: SchemaRagStatusRequest) -> Result<bool, String> {
    let index_dir = schema_index_dir(data_dir, &request.connection_id, &request.database, &request.schema);
    match tokio::fs::remove_dir_all(index_dir).await {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

pub fn schema_index_dir(data_dir: &Path, connection_id: &str, database: &str, schema: &str) -> PathBuf {
    data_dir
        .join("schema-rag")
        .join("indexes")
        .join(sanitize_path_segment(connection_id))
        .join(sanitize_path_segment(database))
        .join(sanitize_path_segment(schema))
}

pub fn build_schema_documents(tables: &[SchemaRagTableMetadata]) -> Vec<SchemaRagDocument> {
    let mut docs = Vec::new();
    for table in tables {
        docs.push(SchemaRagDocument {
            id: format!("table:{}:{}", table.schema, table.name),
            kind: SchemaRagDocumentKind::Table,
            schema: table.schema.clone(),
            table: table.name.clone(),
            column: None,
            data_type: None,
            text_for_embedding: table_text_for_embedding(table),
            embedding: Vec::new(),
        });
        for column in &table.columns {
            docs.push(SchemaRagDocument {
                id: format!("column:{}:{}.{}", table.schema, table.name, column.name),
                kind: SchemaRagDocumentKind::Column,
                schema: table.schema.clone(),
                table: table.name.clone(),
                column: Some(column.name.clone()),
                data_type: Some(column.data_type.clone()),
                text_for_embedding: column_text_for_embedding(table, column),
                embedding: Vec::new(),
            });
        }
    }
    docs
}

fn build_api_doc_documents(schema: &str, doc: &NormalizedApiDoc) -> Vec<SchemaRagDocument> {
    doc.sections
        .iter()
        .map(|section| SchemaRagDocument {
            id: format!("api-doc:{}:{}", doc.source_id, section.id),
            kind: SchemaRagDocumentKind::ApiDoc,
            schema: schema.to_string(),
            table: doc.source_id.clone(),
            column: Some(section.id.clone()),
            data_type: Some(doc.original_format.clone()),
            text_for_embedding: api_doc_section_text_for_embedding(doc, section),
            embedding: Vec::new(),
        })
        .collect()
}

fn build_api_doc_fact_documents(schema: &str, extraction: &SchemaRagApiDocExtraction) -> Vec<SchemaRagDocument> {
    let mut documents = Vec::new();

    for fact in &extraction.api_fields {
        if !should_embed_fact(&fact.status) {
            continue;
        }
        let target_schema = fact_schema(fact.candidate_schema.as_deref(), schema);
        let table = fact.candidate_table.as_deref().unwrap_or("").trim();
        let column = fact.candidate_column.as_deref().unwrap_or("").trim();
        let target = if !table.is_empty() && !column.is_empty() {
            format!("{target_schema}.{table}.{column}")
        } else if !table.is_empty() {
            format!("{target_schema}.{table}")
        } else {
            "未映射数据库字段".to_string()
        };
        documents.push(SchemaRagDocument {
            id: format!("api-doc-fact:{}", fact.id),
            kind: SchemaRagDocumentKind::ApiDocFact,
            schema: target_schema,
            table: if table.is_empty() { fact.source_id.clone() } else { table.to_string() },
            column: (!column.is_empty()).then(|| column.to_string()),
            data_type: Some("api_doc_field_fact".to_string()),
            text_for_embedding: [
                format!("接口字段: {}", fact.name),
                format!("含义: {}", fact.meaning),
                format!("候选映射: {target}"),
                format!("状态: {}", fact_status_label(&fact.status)),
                format!("置信度: {:.2}", fact.confidence),
                format!("证据: {}", fact.evidence),
                format!("来源: {} / {}", fact.source_id, fact.section_id),
            ]
            .join("\n"),
            embedding: Vec::new(),
        });
    }

    for fact in &extraction.business_concepts {
        if !should_embed_fact(&fact.status) {
            continue;
        }
        let target_schema = fact_schema(fact.candidate_schema.as_deref(), schema);
        let table = fact.candidate_table.as_deref().unwrap_or("").trim();
        let column = fact.candidate_column.as_deref().unwrap_or("").trim();
        let target = if !table.is_empty() && !column.is_empty() {
            format!("{target_schema}.{table}.{column}")
        } else if !table.is_empty() {
            format!("{target_schema}.{table}")
        } else {
            "未映射数据库对象".to_string()
        };
        documents.push(SchemaRagDocument {
            id: format!("api-doc-fact:{}", fact.id),
            kind: SchemaRagDocumentKind::ApiDocFact,
            schema: target_schema,
            table: if table.is_empty() { fact.source_id.clone() } else { table.to_string() },
            column: (!column.is_empty()).then(|| column.to_string()),
            data_type: Some("api_doc_concept_fact".to_string()),
            text_for_embedding: [
                format!("业务概念: {}", fact.term),
                format!("说明: {}", fact.description),
                format!("候选映射: {target}"),
                format!("状态: {}", fact_status_label(&fact.status)),
                format!("置信度: {:.2}", fact.confidence),
                format!("证据: {}", fact.evidence),
                format!("来源: {} / {}", fact.source_id, fact.section_id),
            ]
            .join("\n"),
            embedding: Vec::new(),
        });
    }

    for fact in &extraction.join_candidates {
        if !should_embed_fact(&fact.status) {
            continue;
        }
        documents.push(SchemaRagDocument {
            id: format!("api-doc-fact:{}", fact.id),
            kind: SchemaRagDocumentKind::ApiDocFact,
            schema: fact.left_schema.clone(),
            table: fact.left_table.clone(),
            column: None,
            data_type: Some("api_doc_join_fact".to_string()),
            text_for_embedding: [
                format!("关联关系: {}", fact.relation),
                format!("左表: {}.{}({})", fact.left_schema, fact.left_table, fact.left_columns.join(", ")),
                format!("右表: {}.{}({})", fact.right_schema, fact.right_table, fact.right_columns.join(", ")),
                format!("状态: {}", fact_status_label(&fact.status)),
                format!("置信度: {:.2}", fact.confidence),
                format!("证据: {}", fact.evidence),
                format!("来源: {} / {}", fact.source_id, fact.section_id),
            ]
            .join("\n"),
            embedding: Vec::new(),
        });
    }

    documents
}

fn should_embed_fact(status: &SchemaRagFactStatus) -> bool {
    matches!(status, SchemaRagFactStatus::Verified | SchemaRagFactStatus::Candidate | SchemaRagFactStatus::Unresolved)
}

fn fact_status_label(status: &SchemaRagFactStatus) -> &'static str {
    match status {
        SchemaRagFactStatus::Verified => "verified",
        SchemaRagFactStatus::Candidate => "candidate",
        SchemaRagFactStatus::Rejected => "rejected",
        SchemaRagFactStatus::Unresolved => "unresolved",
    }
}

fn merge_refreshed_table_documents(
    old_documents: &[SchemaRagDocument],
    refreshed_documents: Vec<SchemaRagDocument>,
    selected_tables: &[String],
) -> Vec<SchemaRagDocument> {
    let mut merged: Vec<SchemaRagDocument> = old_documents
        .iter()
        .filter(|doc| !selected_tables.iter().any(|table| table.eq_ignore_ascii_case(&doc.table)))
        .cloned()
        .collect();
    merged.extend(refreshed_documents);
    merged.sort_by(|a, b| a.schema.cmp(&b.schema).then_with(|| a.table.cmp(&b.table)).then_with(|| a.id.cmp(&b.id)));
    merged
}

fn changes_for_requested_tables(
    changes: &[SchemaRagTableChange],
    requested_tables: &HashSet<String>,
) -> Vec<SchemaRagTableChange> {
    changes
        .iter()
        .filter(|change| requested_tables.iter().any(|table| table.eq_ignore_ascii_case(&change.table)))
        .cloned()
        .collect()
}

pub fn search_documents_lexical(
    schema: &str,
    query: &str,
    documents: &[SchemaRagDocument],
    tables: &[SchemaRagTableMetadata],
    limit: usize,
    indexed_at: &str,
) -> SchemaRagSearchResult {
    let query_tokens = tokenize(query);
    let query_text = query.to_lowercase();
    let mut by_table: HashMap<(String, String), (f32, Vec<SchemaRagMatchedColumn>, Vec<String>)> = HashMap::new();
    for doc in documents.iter().filter(|doc| doc.schema == schema) {
        if matches!(doc.kind, SchemaRagDocumentKind::ApiDoc | SchemaRagDocumentKind::ApiDocFact) {
            continue;
        }
        let score = lexical_score(&query_tokens, &query_text, doc);
        if score <= 0.0 {
            continue;
        }
        let key = (doc.schema.clone(), doc.table.clone());
        let entry = by_table.entry(key).or_insert_with(|| (0.0, Vec::new(), Vec::new()));
        entry.0 += match doc.kind {
            SchemaRagDocumentKind::Table => score,
            SchemaRagDocumentKind::Column => score + 0.4,
            SchemaRagDocumentKind::ApiDoc | SchemaRagDocumentKind::ApiDocFact => continue,
        };
        entry.2.push(match doc.kind {
            SchemaRagDocumentKind::Table => "表级元数据命中".to_string(),
            SchemaRagDocumentKind::Column => format!("字段 {} 命中", doc.column.as_deref().unwrap_or("")),
            SchemaRagDocumentKind::ApiDoc | SchemaRagDocumentKind::ApiDocFact => continue,
        });
        if doc.kind == SchemaRagDocumentKind::Column {
            if let Some(column) = &doc.column {
                entry.1.push(SchemaRagMatchedColumn {
                    name: column.clone(),
                    comment: None,
                    primary_key: None,
                    data_type: doc.data_type.clone(),
                    score,
                    reason: "字段名、字段注释或所属表上下文与问题匹配".to_string(),
                });
            }
        }
    }

    let table_map: HashMap<(String, String), &SchemaRagTableMetadata> =
        tables.iter().map(|table| ((table.schema.clone(), table.name.clone()), table)).collect();
    let mut scored: Vec<SchemaRagSearchTable> = by_table
        .into_iter()
        .filter_map(|((schema, name), (score, mut matched_columns, reasons))| {
            let table = table_map.get(&(schema.clone(), name.clone()))?;
            matched_columns.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
            matched_columns.dedup_by(|a, b| a.name == b.name);
            Some(SchemaRagSearchTable {
                schema,
                name,
                table_type: table.table_type.clone(),
                score,
                reason: summarize_reasons(&reasons),
                matched_columns: matched_columns.into_iter().take(8).collect(),
                related_tables: related_tables_for(table, tables),
            })
        })
        .collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let truncated = scored.len() > limit;
    scored.truncate(limit);

    SchemaRagSearchResult { indexed_at: indexed_at.to_string(), query: query.to_string(), tables: scored, truncated }
}

fn search_documents_vector(
    schema: &str,
    query: &str,
    query_embedding: &[f32],
    documents: &[SchemaRagDocument],
    tables: &[SchemaRagTableMetadata],
    enrichment: &SchemaRagEnrichment,
    limit: usize,
    indexed_at: &str,
) -> SchemaRagSearchResult {
    let query_tokens = tokenize(query);
    let query_text = query.to_lowercase();
    let mut by_table: HashMap<(String, String), TableSearchAccumulator> = HashMap::new();
    for doc in documents.iter().filter(|doc| doc.schema == schema) {
        if doc.kind == SchemaRagDocumentKind::ApiDoc {
            apply_api_doc_search_hit(query_embedding, &query_tokens, &query_text, doc, tables, &mut by_table);
            continue;
        }
        if doc.kind == SchemaRagDocumentKind::ApiDocFact {
            apply_api_doc_fact_search_hit(query_embedding, &query_tokens, &query_text, doc, tables, &mut by_table);
            continue;
        }
        let vector_score = cosine_similarity(query_embedding, &doc.embedding).unwrap_or(0.0).max(0.0);
        let lexical_raw = lexical_score(&query_tokens, &query_text, doc);
        let alias_hits = business_alias_hits_for_doc(&query_tokens, &query_text, doc, enrichment);
        if vector_score < 0.05 && lexical_raw <= 0.0 && alias_hits.is_empty() {
            continue;
        }
        let lexical_component = normalize_lexical_score(lexical_raw);
        let alias_component = alias_score_component(&alias_hits, 0.35);
        let mut score = vector_score * 0.65 + lexical_component * 0.20 + alias_component;
        if doc.kind == SchemaRagDocumentKind::Column {
            score += 0.05;
        }
        if score <= 0.0 {
            continue;
        }

        let key = (doc.schema.clone(), doc.table.clone());
        let entry = by_table.entry(key).or_default();
        entry.score = entry.score.max(score);
        let mut reasons = if vector_score >= 0.35 || lexical_raw > 0.0 || alias_hits.is_empty() {
            document_hit_reasons(doc, vector_score, lexical_raw)
        } else {
            Vec::new()
        };
        reasons.extend(alias_hit_reasons(&alias_hits));
        entry.reasons.extend(reasons.clone());
        if doc.kind == SchemaRagDocumentKind::Column {
            if let Some(column) = &doc.column {
                entry.matched_columns.push(SchemaRagMatchedColumn {
                    name: column.clone(),
                    comment: None,
                    primary_key: None,
                    data_type: doc.data_type.clone(),
                    score,
                    reason: summarize_reasons(&reasons),
                });
            }
        }
    }

    let table_map: HashMap<(String, String), &SchemaRagTableMetadata> =
        tables.iter().map(|table| ((table.schema.clone(), table.name.clone()), table)).collect();
    let mut scored: Vec<SchemaRagSearchTable> = by_table
        .into_iter()
        .filter_map(|((schema, name), mut entry)| {
            let table = table_map.get(&(schema.clone(), name.clone()))?;
            entry.matched_columns.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
            entry.matched_columns.dedup_by(|a, b| a.name == b.name);
            let mut reasons: Vec<String> = entry.matched_columns.iter().map(|column| column.reason.clone()).collect();
            reasons.extend(entry.reasons);
            let matched_columns = if entry.matched_columns.is_empty() {
                key_columns_for_table(table)
            } else {
                entry.matched_columns.into_iter().take(8).collect()
            };
            Some(SchemaRagSearchTable {
                schema,
                name,
                table_type: table.table_type.clone(),
                score: entry.score,
                reason: summarize_reasons(&reasons),
                matched_columns,
                related_tables: related_tables_for(table, tables),
            })
        })
        .collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let truncated = scored.len() > limit;
    scored.truncate(limit);

    SchemaRagSearchResult { indexed_at: indexed_at.to_string(), query: query.to_string(), tables: scored, truncated }
}

fn search_table_columns_vector(
    schema: &str,
    table: &str,
    query: &str,
    query_embedding: &[f32],
    documents: &[SchemaRagDocument],
    tables: &[SchemaRagTableMetadata],
    enrichment: &SchemaRagEnrichment,
    limit: usize,
    include_primary_key: bool,
    indexed_at: &str,
) -> SchemaRagColumnSearchResult {
    let query_tokens = tokenize(query);
    let query_text = query.to_lowercase();
    let mut scored: Vec<SchemaRagMatchedColumn> = Vec::new();
    let mut total_columns = 0usize;
    let comments_by_column: HashMap<String, Option<String>> = tables
        .iter()
        .find(|candidate| candidate.schema == schema && candidate.name.eq_ignore_ascii_case(table))
        .map(|table| {
            table
                .columns
                .iter()
                .map(|column| (normalize_identifier_key(&column.name), column.comment.clone()))
                .collect()
        })
        .unwrap_or_default();
    let primary_key_by_column: HashMap<String, bool> = tables
        .iter()
        .find(|candidate| candidate.schema == schema && candidate.name.eq_ignore_ascii_case(table))
        .map(|table| {
            table.columns.iter().map(|column| (normalize_identifier_key(&column.name), column.is_primary_key)).collect()
        })
        .unwrap_or_default();

    for doc in documents.iter().filter(|doc| {
        doc.schema == schema
            && doc.table.eq_ignore_ascii_case(table)
            && doc.kind == SchemaRagDocumentKind::Column
            && doc.column.is_some()
    }) {
        total_columns += 1;
        let vector_score = cosine_similarity(query_embedding, &doc.embedding).unwrap_or(0.0).max(0.0);
        let lexical_raw = lexical_score(&query_tokens, &query_text, doc);
        let alias_hits = business_alias_hits_for_doc(&query_tokens, &query_text, doc, enrichment);
        if vector_score < 0.05 && lexical_raw <= 0.0 && alias_hits.is_empty() {
            continue;
        }
        let lexical_component = normalize_lexical_score(lexical_raw);
        let score = vector_score * 0.75 + lexical_component * 0.20 + alias_score_component(&alias_hits, 0.45);
        if score <= 0.0 {
            continue;
        }
        let mut reasons = if vector_score >= 0.35 || lexical_raw > 0.0 || alias_hits.is_empty() {
            document_hit_reasons(doc, vector_score, lexical_raw)
        } else {
            Vec::new()
        };
        reasons.extend(alias_hit_reasons(&alias_hits));
        let column_name = doc.column.clone().unwrap_or_default();
        scored.push(SchemaRagMatchedColumn {
            comment: comments_by_column.get(&normalize_identifier_key(&column_name)).cloned().flatten(),
            primary_key: include_primary_key
                .then(|| primary_key_by_column.get(&normalize_identifier_key(&column_name)).copied().unwrap_or(false)),
            name: column_name,
            data_type: None,
            score,
            reason: summarize_reasons(&reasons),
        });
    }

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.dedup_by(|a, b| a.name == b.name);
    let truncated = scored.len() > limit;
    scored.truncate(limit);

    SchemaRagColumnSearchResult {
        indexed_at: indexed_at.to_string(),
        schema: schema.to_string(),
        table: table.to_string(),
        query: query.to_string(),
        total_columns,
        returned_columns: scored.len(),
        columns: scored,
        truncated,
    }
}

#[derive(Debug, Default)]
struct TableSearchAccumulator {
    score: f32,
    matched_columns: Vec<SchemaRagMatchedColumn>,
    reasons: Vec<String>,
}

fn build_manifest(request: &AnalyzeSchemaRagRequest, analyzed_at: DateTime<Utc>) -> Result<SchemaRagManifest, String> {
    let table_count = request.tables.len();
    let column_count = request.tables.iter().map(|table| table.columns.len()).sum();
    let index_count = request.tables.iter().map(|table| table.indexes.len()).sum();
    let foreign_key_count = request.tables.iter().map(|table| table.foreign_keys.len()).sum();
    Ok(SchemaRagManifest {
        connection_id: request.scope.connection_id.clone(),
        database: request.scope.database.clone(),
        schema: request.scope.schema.clone(),
        db_type: request.scope.db_type.clone(),
        embedding_provider: request.config.embedding_provider.clone(),
        embedding_endpoint: request.config.embedding_endpoint.clone(),
        embedding_model: request.config.embedding_model.clone(),
        embedding_dimension: request.config.embedding_dimension,
        rerank_provider: request.config.rerank_provider.clone(),
        analyzed_at,
        table_count,
        column_count,
        index_count,
        foreign_key_count,
        schema_fingerprint: schema_fingerprint(&request.tables)?,
        table_units: build_table_index_units(&request.tables, analyzed_at)?,
        api_doc_sources: Vec::new(),
        api_doc_chunk_count: 0,
    })
}

fn apply_api_doc_search_hit(
    query_embedding: &[f32],
    query_tokens: &HashSet<String>,
    query_text: &str,
    doc: &SchemaRagDocument,
    tables: &[SchemaRagTableMetadata],
    by_table: &mut HashMap<(String, String), TableSearchAccumulator>,
) {
    let vector_score = cosine_similarity(query_embedding, &doc.embedding).unwrap_or(0.0).max(0.0);
    let lexical_raw = lexical_score(query_tokens, query_text, doc);
    if vector_score < 0.20 && lexical_raw <= 0.0 {
        return;
    }
    let lexical_component = normalize_lexical_score(lexical_raw);
    let base_score = vector_score * 0.55 + lexical_component * 0.30;
    if base_score <= 0.0 {
        return;
    }
    let text = doc.text_for_embedding.to_lowercase();
    for table in tables.iter().filter(|table| table.schema == doc.schema) {
        let table_name = table.name.to_lowercase();
        let table_comment = table.comment.as_deref().unwrap_or("").to_lowercase();
        let table_matches = text.contains(&table_name) || (!table_comment.is_empty() && text.contains(&table_comment));
        let matched_columns = api_doc_matched_columns(table, &text, base_score);
        if !table_matches && matched_columns.is_empty() {
            continue;
        }

        let key = (table.schema.clone(), table.name.clone());
        let entry = by_table.entry(key).or_default();
        entry.score = entry.score.max(base_score + if table_matches { 0.10 } else { 0.0 });
        let mut reasons = vec![format!("接口文档命中 {}", api_doc_section_label(doc))];
        if table_matches {
            reasons.push("接口文档提到当前表".to_string());
        }
        entry.reasons.extend(reasons.clone());
        entry.matched_columns.extend(matched_columns.into_iter().map(|mut column| {
            let original_reason = column.reason.clone();
            column.reason = summarize_reasons(&[original_reason, summarize_reasons(&reasons)]);
            column
        }));
    }
}

fn apply_api_doc_fact_search_hit(
    query_embedding: &[f32],
    query_tokens: &HashSet<String>,
    query_text: &str,
    doc: &SchemaRagDocument,
    tables: &[SchemaRagTableMetadata],
    by_table: &mut HashMap<(String, String), TableSearchAccumulator>,
) {
    let vector_score = cosine_similarity(query_embedding, &doc.embedding).unwrap_or(0.0).max(0.0);
    let lexical_raw = lexical_score(query_tokens, query_text, doc);
    if vector_score < 0.15 && lexical_raw <= 0.0 {
        return;
    }
    let lexical_component = normalize_lexical_score(lexical_raw);
    let score = vector_score * 0.68 + lexical_component * 0.24 + 0.08;
    if score <= 0.0 {
        return;
    }
    let Some(table) = tables
        .iter()
        .find(|table| table.schema == doc.schema && table.name.eq_ignore_ascii_case(&doc.table))
    else {
        return;
    };
    let key = (table.schema.clone(), table.name.clone());
    let entry = by_table.entry(key).or_default();
    entry.score = entry.score.max(score);
    entry.reasons.extend(document_hit_reasons(doc, vector_score, lexical_raw));
    if let Some(column_name) = doc.column.as_deref() {
        if let Some(column) = table.columns.iter().find(|column| column.name.eq_ignore_ascii_case(column_name)) {
            entry.matched_columns.push(SchemaRagMatchedColumn {
                name: column.name.clone(),
                comment: column.comment.clone(),
                primary_key: Some(column.is_primary_key),
                data_type: Some(column.data_type.clone()),
                score,
                reason: summarize_reasons(&document_hit_reasons(doc, vector_score, lexical_raw)),
            });
        }
    }
}

fn api_doc_matched_columns(table: &SchemaRagTableMetadata, text: &str, score: f32) -> Vec<SchemaRagMatchedColumn> {
    table
        .columns
        .iter()
        .filter(|column| {
            let column_name = column.name.to_lowercase();
            let column_comment = column.comment.as_deref().unwrap_or("").to_lowercase();
            (column_name.chars().count() >= 3 && text.contains(&column_name))
                || (!column_comment.is_empty() && text.contains(&column_comment))
        })
        .take(8)
        .map(|column| SchemaRagMatchedColumn {
            name: column.name.clone(),
            comment: column.comment.clone(),
            primary_key: Some(column.is_primary_key),
            data_type: Some(column.data_type.clone()),
            score,
            reason: format!("接口文档命中字段 {}", column.name),
        })
        .collect()
}

async fn write_kuzu_index(graph_path: &Path, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let graph_path = graph_path.to_path_buf();
    let stored = stored.clone();
    tokio::task::spawn_blocking(move || write_kuzu_index_blocking(&graph_path, &stored))
        .await
        .map_err(|err| format!("Kuzu index task failed: {err}"))?
}

fn write_kuzu_index_blocking(graph_path: &Path, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    if graph_path.exists() {
        if graph_path.is_dir() {
            std::fs::remove_dir_all(graph_path).map_err(|err| err.to_string())?;
        } else {
            std::fs::remove_file(graph_path).map_err(|err| err.to_string())?;
        }
    }
    let database = Database::new(graph_path, SystemConfig::default()).map_err(|err| err.to_string())?;
    let connection = Connection::new(&database).map_err(|err| err.to_string())?;
    create_kuzu_schema(&connection)?;
    insert_kuzu_manifest(&connection, stored)?;
    insert_kuzu_tables(&connection, stored)?;
    insert_kuzu_indexes(&connection, stored)?;
    insert_kuzu_documents(&connection, stored)?;
    insert_kuzu_api_doc_graph(&connection, stored)?;
    insert_kuzu_foreign_keys(&connection, stored)?;
    Ok(())
}

fn create_kuzu_schema(connection: &Connection<'_>) -> Result<(), String> {
    for statement in [
        "CREATE NODE TABLE SchemaScope(id STRING, connection_id STRING, database_name STRING, schema_name STRING, db_type STRING, analyzed_at STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE TableNode(id STRING, schema_name STRING, name STRING, table_type STRING, comment STRING, ddl STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE ColumnNode(id STRING, schema_name STRING, table_name STRING, name STRING, data_type STRING, is_nullable BOOL, is_primary_key BOOL, comment STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE IndexNode(id STRING, schema_name STRING, table_name STRING, name STRING, columns STRING[], is_unique BOOL, is_primary BOOL, index_type STRING, comment STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE ForeignKeyNode(id STRING, schema_name STRING, table_name STRING, name STRING, column_name STRING, ref_schema STRING, ref_table STRING, ref_column STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE SchemaDocument(id STRING, kind STRING, schema_name STRING, table_name STRING, column_name STRING, data_type STRING, text_for_embedding STRING, embedding FLOAT[], embedding_model STRING, embedding_dimension INT64, PRIMARY KEY(id));",
        "CREATE NODE TABLE BusinessAlias(id STRING, term STRING, target_kind STRING, schema_name STRING, table_name STRING, column_name STRING, source STRING, confidence FLOAT, note STRING, created_at STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE QueryPattern(id STRING, text STRING, created_at STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE ApiDocSource(id STRING, path STRING, original_format STRING, content_hash STRING, imported_at STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE ApiDocSection(id STRING, source_id STRING, title_path STRING[], text STRING, page INT64, PRIMARY KEY(id));",
        "CREATE NODE TABLE ApiField(id STRING, source_id STRING, section_id STRING, name STRING, meaning STRING, candidate_schema STRING, candidate_table STRING, candidate_column STRING, confidence FLOAT, status STRING, evidence STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE BusinessConcept(id STRING, source_id STRING, section_id STRING, term STRING, description STRING, candidate_schema STRING, candidate_table STRING, candidate_column STRING, confidence FLOAT, status STRING, evidence STRING, PRIMARY KEY(id));",
        "CREATE NODE TABLE JoinCandidate(id STRING, source_id STRING, section_id STRING, left_schema STRING, left_table STRING, left_columns STRING[], right_schema STRING, right_table STRING, right_columns STRING[], relation STRING, confidence FLOAT, status STRING, evidence STRING, PRIMARY KEY(id));",
        "CREATE REL TABLE HAS_TABLE(FROM SchemaScope TO TableNode);",
        "CREATE REL TABLE HAS_COLUMN(FROM TableNode TO ColumnNode);",
        "CREATE REL TABLE HAS_INDEX(FROM TableNode TO IndexNode);",
        "CREATE REL TABLE HAS_FOREIGN_KEY(FROM TableNode TO ForeignKeyNode);",
        "CREATE REL TABLE FK_TO(FROM ColumnNode TO ColumnNode);",
        "CREATE REL TABLE RELATED_TO(FROM TableNode TO TableNode, source STRING, reason STRING);",
        "CREATE REL TABLE DESCRIBES_TABLE(FROM SchemaDocument TO TableNode);",
        "CREATE REL TABLE DESCRIBES_COLUMN(FROM SchemaDocument TO ColumnNode);",
        "CREATE REL TABLE ALIAS_OF_TABLE(FROM BusinessAlias TO TableNode);",
        "CREATE REL TABLE ALIAS_OF_COLUMN(FROM BusinessAlias TO ColumnNode);",
        "CREATE REL TABLE HAS_SECTION(FROM ApiDocSource TO ApiDocSection);",
        "CREATE REL TABLE SECTION_MENTIONS_FIELD(FROM ApiDocSection TO ApiField);",
        "CREATE REL TABLE SECTION_MENTIONS_CONCEPT(FROM ApiDocSection TO BusinessConcept);",
        "CREATE REL TABLE SECTION_MENTIONS_JOIN(FROM ApiDocSection TO JoinCandidate);",
        "CREATE REL TABLE API_FIELD_MAPS_TO_COLUMN(FROM ApiField TO ColumnNode);",
        "CREATE REL TABLE CONCEPT_MAPS_TO_TABLE(FROM BusinessConcept TO TableNode);",
        "CREATE REL TABLE CONCEPT_MAPS_TO_COLUMN(FROM BusinessConcept TO ColumnNode);",
        "CREATE REL TABLE SECTION_DESCRIBES_TABLE(FROM ApiDocSection TO TableNode);",
        "CREATE REL TABLE SECTION_DESCRIBES_COLUMN(FROM ApiDocSection TO ColumnNode);",
        "CREATE REL TABLE JOIN_LEFT_TABLE(FROM JoinCandidate TO TableNode);",
        "CREATE REL TABLE JOIN_RIGHT_TABLE(FROM JoinCandidate TO TableNode);",
    ] {
        connection.query(statement).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn create_kuzu_enrichment_schema_if_missing(connection: &Connection<'_>) -> Result<(), String> {
    for statement in [
        "CREATE NODE TABLE BusinessAlias(id STRING, term STRING, target_kind STRING, schema_name STRING, table_name STRING, column_name STRING, source STRING, confidence FLOAT, note STRING, created_at STRING, PRIMARY KEY(id));",
        "CREATE REL TABLE ALIAS_OF_TABLE(FROM BusinessAlias TO TableNode);",
        "CREATE REL TABLE ALIAS_OF_COLUMN(FROM BusinessAlias TO ColumnNode);",
    ] {
        if let Err(err) = connection.query(statement) {
            let message = err.to_string();
            if !message.to_lowercase().contains("already") && !message.to_lowercase().contains("exist") {
                return Err(message);
            }
        }
    }
    Ok(())
}

fn insert_kuzu_manifest(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let manifest = &stored.manifest;
    let mut statement = connection
        .prepare(
            "CREATE (:SchemaScope {id: $id, connection_id: $connection_id, database_name: $database_name, schema_name: $schema_name, db_type: $db_type, analyzed_at: $analyzed_at});",
        )
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            &mut statement,
            vec![
                ("id", Value::String(kuzu_scope_id(manifest))),
                ("connection_id", Value::String(manifest.connection_id.clone())),
                ("database_name", Value::String(manifest.database.clone())),
                ("schema_name", Value::String(manifest.schema.clone())),
                ("db_type", Value::String(manifest.db_type.clone())),
                ("analyzed_at", Value::String(manifest.analyzed_at.to_rfc3339())),
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_kuzu_tables(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let mut table_statement = connection
        .prepare(
            "CREATE (:TableNode {id: $id, schema_name: $schema_name, name: $name, table_type: $table_type, comment: $comment, ddl: $ddl});",
        )
        .map_err(|err| err.to_string())?;
    let mut has_table_statement = connection
        .prepare("MATCH (s:SchemaScope {id: $scopeId}), (t:TableNode {id: $tableId}) CREATE (s)-[:HAS_TABLE]->(t);")
        .map_err(|err| err.to_string())?;
    let mut column_statement = connection
        .prepare(
            "CREATE (:ColumnNode {id: $id, schema_name: $schema_name, table_name: $table_name, name: $name, data_type: $data_type, is_nullable: $is_nullable, is_primary_key: $is_primary_key, comment: $comment});",
        )
        .map_err(|err| err.to_string())?;
    let mut has_column_statement = connection
        .prepare("MATCH (t:TableNode {id: $tableId}), (c:ColumnNode {id: $columnId}) CREATE (t)-[:HAS_COLUMN]->(c);")
        .map_err(|err| err.to_string())?;

    let scope_id = kuzu_scope_id(&stored.manifest);
    for table in &stored.tables {
        let table_id = kuzu_table_id(&table.schema, &table.name);
        connection
            .execute(
                &mut table_statement,
                vec![
                    ("id", Value::String(table_id.clone())),
                    ("schema_name", Value::String(table.schema.clone())),
                    ("name", Value::String(table.name.clone())),
                    ("table_type", Value::String(table.table_type.clone())),
                    ("comment", Value::String(table.comment.clone().unwrap_or_default())),
                    ("ddl", Value::String(table.ddl.clone().unwrap_or_default())),
                ],
            )
            .map_err(|err| err.to_string())?;
        connection
            .execute(
                &mut has_table_statement,
                vec![("scopeId", Value::String(scope_id.clone())), ("tableId", Value::String(table_id.clone()))],
            )
            .map_err(|err| err.to_string())?;
        for column in &table.columns {
            let column_id = kuzu_column_id(&table.schema, &table.name, &column.name);
            connection
                .execute(
                    &mut column_statement,
                    vec![
                        ("id", Value::String(column_id.clone())),
                        ("schema_name", Value::String(table.schema.clone())),
                        ("table_name", Value::String(table.name.clone())),
                        ("name", Value::String(column.name.clone())),
                        ("data_type", Value::String(column.data_type.clone())),
                        ("is_nullable", Value::Bool(column.is_nullable)),
                        ("is_primary_key", Value::Bool(column.is_primary_key)),
                        ("comment", Value::String(column.comment.clone().unwrap_or_default())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut has_column_statement,
                    vec![("tableId", Value::String(table_id.clone())), ("columnId", Value::String(column_id))],
                )
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn insert_kuzu_indexes(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let mut index_statement = connection
        .prepare(
            "CREATE (:IndexNode {id: $id, schema_name: $schema_name, table_name: $table_name, name: $name, columns: $columns, is_unique: $is_unique, is_primary: $is_primary, index_type: $index_type, comment: $comment});",
        )
        .map_err(|err| err.to_string())?;
    let mut has_index_statement = connection
        .prepare("MATCH (t:TableNode {id: $tableId}), (i:IndexNode {id: $indexId}) CREATE (t)-[:HAS_INDEX]->(i);")
        .map_err(|err| err.to_string())?;
    for table in &stored.tables {
        let table_id = kuzu_table_id(&table.schema, &table.name);
        for index in &table.indexes {
            let index_id = kuzu_index_id(&table.schema, &table.name, &index.name);
            connection
                .execute(
                    &mut index_statement,
                    vec![
                        ("id", Value::String(index_id.clone())),
                        ("schema_name", Value::String(table.schema.clone())),
                        ("table_name", Value::String(table.name.clone())),
                        ("name", Value::String(index.name.clone())),
                        ("columns", string_list_value(&index.columns)),
                        ("is_unique", Value::Bool(index.is_unique)),
                        ("is_primary", Value::Bool(index.is_primary)),
                        ("index_type", Value::String(index.index_type.clone().unwrap_or_default())),
                        ("comment", Value::String(index.comment.clone().unwrap_or_default())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut has_index_statement,
                    vec![("tableId", Value::String(table_id.clone())), ("indexId", Value::String(index_id))],
                )
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn insert_kuzu_documents(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let mut document_statement = connection
        .prepare(
            "CREATE (:SchemaDocument {id: $id, kind: $kind, schema_name: $schema_name, table_name: $table_name, column_name: $column_name, data_type: $data_type, text_for_embedding: $text_for_embedding, embedding: $embedding, embedding_model: $embedding_model, embedding_dimension: $embedding_dimension});",
        )
        .map_err(|err| err.to_string())?;
    let mut describes_table_statement = connection
        .prepare(
            "MATCH (d:SchemaDocument {id: $documentId}), (t:TableNode {id: $tableId}) CREATE (d)-[:DESCRIBES_TABLE]->(t);",
        )
        .map_err(|err| err.to_string())?;
    let mut describes_column_statement = connection
        .prepare(
            "MATCH (d:SchemaDocument {id: $documentId}), (c:ColumnNode {id: $columnId}) CREATE (d)-[:DESCRIBES_COLUMN]->(c);",
        )
        .map_err(|err| err.to_string())?;
    for document in &stored.documents {
        connection
            .execute(
                &mut document_statement,
                vec![
                    ("id", Value::String(document.id.clone())),
                    ("kind", Value::String(kuzu_document_kind(&document.kind).to_string())),
                    ("schema_name", Value::String(document.schema.clone())),
                    ("table_name", Value::String(document.table.clone())),
                    ("column_name", Value::String(document.column.clone().unwrap_or_default())),
                    ("data_type", Value::String(document.data_type.clone().unwrap_or_default())),
                    ("text_for_embedding", Value::String(document.text_for_embedding.clone())),
                    ("embedding", float_list_value(&document.embedding)),
                    ("embedding_model", Value::String(stored.manifest.embedding_model.clone())),
                    ("embedding_dimension", Value::Int64(stored.manifest.embedding_dimension as i64)),
                ],
            )
            .map_err(|err| err.to_string())?;
        if matches!(document.kind, SchemaRagDocumentKind::ApiDoc | SchemaRagDocumentKind::ApiDocFact) {
            continue;
        }
        let table_id = kuzu_table_id(&document.schema, &document.table);
        connection
            .execute(
                &mut describes_table_statement,
                vec![("documentId", Value::String(document.id.clone())), ("tableId", Value::String(table_id))],
            )
            .map_err(|err| err.to_string())?;
        if let Some(column) = &document.column {
            let column_id = kuzu_column_id(&document.schema, &document.table, column);
            connection
                .execute(
                    &mut describes_column_statement,
                    vec![("documentId", Value::String(document.id.clone())), ("columnId", Value::String(column_id))],
                )
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn insert_kuzu_api_doc_graph(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let mut source_statement = connection
        .prepare(
            "CREATE (:ApiDocSource {id: $id, path: $path, original_format: $original_format, content_hash: $content_hash, imported_at: $imported_at});",
        )
        .map_err(|err| err.to_string())?;
    let mut section_statement = connection
        .prepare(
            "CREATE (:ApiDocSection {id: $id, source_id: $source_id, title_path: $title_path, text: $text, page: $page});",
        )
        .map_err(|err| err.to_string())?;
    let mut has_section_statement = connection
        .prepare("MATCH (s:ApiDocSource {id: $sourceId}), (section:ApiDocSection {id: $sectionId}) CREATE (s)-[:HAS_SECTION]->(section);")
        .map_err(|err| err.to_string())?;

    let mut inserted_sources = HashSet::new();
    for source in &stored.manifest.api_doc_sources {
        insert_kuzu_api_doc_source(connection, &mut source_statement, source)?;
        inserted_sources.insert(source.source_id.clone());
    }
    for extraction in &stored.api_doc_extractions {
        if inserted_sources.insert(extraction.source_id.clone()) {
            insert_kuzu_api_doc_source_fallback(connection, &mut source_statement, &extraction.source_id)?;
        }
    }

    let source_ids: HashSet<String> = stored.manifest.api_doc_sources.iter().map(|source| source.source_id.clone()).collect();
    let mut inserted_sections = HashSet::new();
    for document in stored.documents.iter().filter(|doc| doc.kind == SchemaRagDocumentKind::ApiDoc) {
        let source_id = document.table.clone();
        if !source_ids.contains(&source_id) && inserted_sources.insert(source_id.clone()) {
            insert_kuzu_api_doc_source_fallback(connection, &mut source_statement, &source_id)?;
        }
        let section_id = document.column.clone().unwrap_or_else(|| document.id.clone());
        if inserted_sections.insert(section_id.clone()) {
            insert_kuzu_api_doc_section(
                connection,
                &mut section_statement,
                &mut has_section_statement,
                &source_id,
                &section_id,
                section_title_path_for_api_doc_document(document),
                document.text_for_embedding.clone(),
                -1,
            )?;
        }
    }
    for extraction in &stored.api_doc_extractions {
        for section_id in api_doc_extraction_section_ids(extraction) {
            if inserted_sections.insert(section_id.clone()) {
                insert_kuzu_api_doc_section(
                    connection,
                    &mut section_statement,
                    &mut has_section_statement,
                    &extraction.source_id,
                    &section_id,
                    Vec::new(),
                    String::new(),
                    -1,
                )?;
            }
        }
    }

    insert_kuzu_api_doc_extractions(connection, &stored.api_doc_extractions)?;
    Ok(())
}

fn insert_kuzu_api_doc_source(
    connection: &Connection<'_>,
    statement: &mut PreparedStatement,
    source: &SchemaRagApiDocSource,
) -> Result<(), String> {
    connection
        .execute(
            statement,
            vec![
                ("id", Value::String(source.source_id.clone())),
                ("path", Value::String(source.source_path.clone())),
                ("original_format", Value::String(source.original_format.clone())),
                ("content_hash", Value::String(source.content_hash.clone())),
                ("imported_at", Value::String(source.imported_at.to_rfc3339())),
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_kuzu_api_doc_source_fallback(
    connection: &Connection<'_>,
    statement: &mut PreparedStatement,
    source_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            statement,
            vec![
                ("id", Value::String(source_id.to_string())),
                ("path", Value::String(String::new())),
                ("original_format", Value::String(String::new())),
                ("content_hash", Value::String(String::new())),
                ("imported_at", Value::String(String::new())),
            ],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_kuzu_api_doc_section(
    connection: &Connection<'_>,
    section_statement: &mut PreparedStatement,
    has_section_statement: &mut PreparedStatement,
    source_id: &str,
    section_id: &str,
    title_path: Vec<String>,
    text: String,
    page: i64,
) -> Result<(), String> {
    connection
        .execute(
            section_statement,
            vec![
                ("id", Value::String(section_id.to_string())),
                ("source_id", Value::String(source_id.to_string())),
                ("title_path", string_list_value(&title_path)),
                ("text", Value::String(text)),
                ("page", Value::Int64(page)),
            ],
        )
        .map_err(|err| err.to_string())?;
    connection
        .execute(
            has_section_statement,
            vec![("sourceId", Value::String(source_id.to_string())), ("sectionId", Value::String(section_id.to_string()))],
        )
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn insert_kuzu_api_doc_extractions(
    connection: &Connection<'_>,
    extractions: &[SchemaRagApiDocExtraction],
) -> Result<(), String> {
    let mut field_statement = connection
        .prepare(
            "CREATE (:ApiField {id: $id, source_id: $source_id, section_id: $section_id, name: $name, meaning: $meaning, candidate_schema: $candidate_schema, candidate_table: $candidate_table, candidate_column: $candidate_column, confidence: $confidence, status: $status, evidence: $evidence});",
        )
        .map_err(|err| err.to_string())?;
    let mut concept_statement = connection
        .prepare(
            "CREATE (:BusinessConcept {id: $id, source_id: $source_id, section_id: $section_id, term: $term, description: $description, candidate_schema: $candidate_schema, candidate_table: $candidate_table, candidate_column: $candidate_column, confidence: $confidence, status: $status, evidence: $evidence});",
        )
        .map_err(|err| err.to_string())?;
    let mut join_statement = connection
        .prepare(
            "CREATE (:JoinCandidate {id: $id, source_id: $source_id, section_id: $section_id, left_schema: $left_schema, left_table: $left_table, left_columns: $left_columns, right_schema: $right_schema, right_table: $right_table, right_columns: $right_columns, relation: $relation, confidence: $confidence, status: $status, evidence: $evidence});",
        )
        .map_err(|err| err.to_string())?;
    let mut section_field_statement = connection
        .prepare("MATCH (section:ApiDocSection {id: $sectionId}), (field:ApiField {id: $fieldId}) CREATE (section)-[:SECTION_MENTIONS_FIELD]->(field);")
        .map_err(|err| err.to_string())?;
    let mut section_concept_statement = connection
        .prepare("MATCH (section:ApiDocSection {id: $sectionId}), (concept:BusinessConcept {id: $conceptId}) CREATE (section)-[:SECTION_MENTIONS_CONCEPT]->(concept);")
        .map_err(|err| err.to_string())?;
    let mut section_join_statement = connection
        .prepare("MATCH (section:ApiDocSection {id: $sectionId}), (join:JoinCandidate {id: $joinId}) CREATE (section)-[:SECTION_MENTIONS_JOIN]->(join);")
        .map_err(|err| err.to_string())?;
    let mut field_column_statement = connection
        .prepare("MATCH (field:ApiField {id: $fieldId}), (column:ColumnNode {id: $columnId}) CREATE (field)-[:API_FIELD_MAPS_TO_COLUMN]->(column);")
        .map_err(|err| err.to_string())?;
    let mut concept_table_statement = connection
        .prepare("MATCH (concept:BusinessConcept {id: $conceptId}), (table:TableNode {id: $tableId}) CREATE (concept)-[:CONCEPT_MAPS_TO_TABLE]->(table);")
        .map_err(|err| err.to_string())?;
    let mut concept_column_statement = connection
        .prepare("MATCH (concept:BusinessConcept {id: $conceptId}), (column:ColumnNode {id: $columnId}) CREATE (concept)-[:CONCEPT_MAPS_TO_COLUMN]->(column);")
        .map_err(|err| err.to_string())?;
    let mut section_table_statement = connection
        .prepare("MATCH (section:ApiDocSection {id: $sectionId}), (table:TableNode {id: $tableId}) CREATE (section)-[:SECTION_DESCRIBES_TABLE]->(table);")
        .map_err(|err| err.to_string())?;
    let mut section_column_statement = connection
        .prepare("MATCH (section:ApiDocSection {id: $sectionId}), (column:ColumnNode {id: $columnId}) CREATE (section)-[:SECTION_DESCRIBES_COLUMN]->(column);")
        .map_err(|err| err.to_string())?;
    let mut join_left_statement = connection
        .prepare("MATCH (join:JoinCandidate {id: $joinId}), (table:TableNode {id: $tableId}) CREATE (join)-[:JOIN_LEFT_TABLE]->(table);")
        .map_err(|err| err.to_string())?;
    let mut join_right_statement = connection
        .prepare("MATCH (join:JoinCandidate {id: $joinId}), (table:TableNode {id: $tableId}) CREATE (join)-[:JOIN_RIGHT_TABLE]->(table);")
        .map_err(|err| err.to_string())?;

    for extraction in extractions {
        for field in &extraction.api_fields {
            connection
                .execute(
                    &mut field_statement,
                    vec![
                        ("id", Value::String(field.id.clone())),
                        ("source_id", Value::String(field.source_id.clone())),
                        ("section_id", Value::String(field.section_id.clone())),
                        ("name", Value::String(field.name.clone())),
                        ("meaning", Value::String(field.meaning.clone())),
                        ("candidate_schema", optional_string_value(field.candidate_schema.as_deref())),
                        ("candidate_table", optional_string_value(field.candidate_table.as_deref())),
                        ("candidate_column", optional_string_value(field.candidate_column.as_deref())),
                        ("confidence", Value::Float(field.confidence)),
                        ("status", Value::String(fact_status_label(&field.status).to_string())),
                        ("evidence", Value::String(field.evidence.clone())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut section_field_statement,
                    vec![("sectionId", Value::String(field.section_id.clone())), ("fieldId", Value::String(field.id.clone()))],
                )
                .map_err(|err| err.to_string())?;
            if field.status == SchemaRagFactStatus::Verified {
                if let (Some(schema), Some(table), Some(column)) = (
                    field.candidate_schema.as_deref(),
                    field.candidate_table.as_deref(),
                    field.candidate_column.as_deref(),
                ) {
                    let table_id = kuzu_table_id(schema, table);
                    let column_id = kuzu_column_id(schema, table, column);
                    connection
                        .execute(&mut field_column_statement, vec![("fieldId", Value::String(field.id.clone())), ("columnId", Value::String(column_id.clone()))])
                        .map_err(|err| err.to_string())?;
                    connection
                        .execute(&mut section_table_statement, vec![("sectionId", Value::String(field.section_id.clone())), ("tableId", Value::String(table_id))])
                        .map_err(|err| err.to_string())?;
                    connection
                        .execute(&mut section_column_statement, vec![("sectionId", Value::String(field.section_id.clone())), ("columnId", Value::String(column_id))])
                        .map_err(|err| err.to_string())?;
                }
            }
        }

        for concept in &extraction.business_concepts {
            connection
                .execute(
                    &mut concept_statement,
                    vec![
                        ("id", Value::String(concept.id.clone())),
                        ("source_id", Value::String(concept.source_id.clone())),
                        ("section_id", Value::String(concept.section_id.clone())),
                        ("term", Value::String(concept.term.clone())),
                        ("description", Value::String(concept.description.clone())),
                        ("candidate_schema", optional_string_value(concept.candidate_schema.as_deref())),
                        ("candidate_table", optional_string_value(concept.candidate_table.as_deref())),
                        ("candidate_column", optional_string_value(concept.candidate_column.as_deref())),
                        ("confidence", Value::Float(concept.confidence)),
                        ("status", Value::String(fact_status_label(&concept.status).to_string())),
                        ("evidence", Value::String(concept.evidence.clone())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut section_concept_statement,
                    vec![("sectionId", Value::String(concept.section_id.clone())), ("conceptId", Value::String(concept.id.clone()))],
                )
                .map_err(|err| err.to_string())?;
            if concept.status == SchemaRagFactStatus::Verified {
                if let (Some(schema), Some(table)) = (concept.candidate_schema.as_deref(), concept.candidate_table.as_deref()) {
                    let table_id = kuzu_table_id(schema, table);
                    connection
                        .execute(&mut concept_table_statement, vec![("conceptId", Value::String(concept.id.clone())), ("tableId", Value::String(table_id.clone()))])
                        .map_err(|err| err.to_string())?;
                    connection
                        .execute(&mut section_table_statement, vec![("sectionId", Value::String(concept.section_id.clone())), ("tableId", Value::String(table_id))])
                        .map_err(|err| err.to_string())?;
                    if let Some(column) = concept.candidate_column.as_deref().filter(|column| !column.trim().is_empty()) {
                        let column_id = kuzu_column_id(schema, table, column);
                        connection
                            .execute(&mut concept_column_statement, vec![("conceptId", Value::String(concept.id.clone())), ("columnId", Value::String(column_id.clone()))])
                            .map_err(|err| err.to_string())?;
                        connection
                            .execute(&mut section_column_statement, vec![("sectionId", Value::String(concept.section_id.clone())), ("columnId", Value::String(column_id))])
                            .map_err(|err| err.to_string())?;
                    }
                }
            }
        }

        for join in &extraction.join_candidates {
            connection
                .execute(
                    &mut join_statement,
                    vec![
                        ("id", Value::String(join.id.clone())),
                        ("source_id", Value::String(join.source_id.clone())),
                        ("section_id", Value::String(join.section_id.clone())),
                        ("left_schema", Value::String(join.left_schema.clone())),
                        ("left_table", Value::String(join.left_table.clone())),
                        ("left_columns", string_list_value(&join.left_columns)),
                        ("right_schema", Value::String(join.right_schema.clone())),
                        ("right_table", Value::String(join.right_table.clone())),
                        ("right_columns", string_list_value(&join.right_columns)),
                        ("relation", Value::String(join.relation.clone())),
                        ("confidence", Value::Float(join.confidence)),
                        ("status", Value::String(fact_status_label(&join.status).to_string())),
                        ("evidence", Value::String(join.evidence.clone())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut section_join_statement,
                    vec![("sectionId", Value::String(join.section_id.clone())), ("joinId", Value::String(join.id.clone()))],
                )
                .map_err(|err| err.to_string())?;
            if join.status == SchemaRagFactStatus::Verified {
                let left_table_id = kuzu_table_id(&join.left_schema, &join.left_table);
                let right_table_id = kuzu_table_id(&join.right_schema, &join.right_table);
                connection
                    .execute(&mut join_left_statement, vec![("joinId", Value::String(join.id.clone())), ("tableId", Value::String(left_table_id))])
                    .map_err(|err| err.to_string())?;
                connection
                    .execute(&mut join_right_statement, vec![("joinId", Value::String(join.id.clone())), ("tableId", Value::String(right_table_id))])
                    .map_err(|err| err.to_string())?;
            }
        }
    }

    Ok(())
}

fn section_title_path_for_api_doc_document(document: &SchemaRagDocument) -> Vec<String> {
    let marker = "章节: ";
    document
        .text_for_embedding
        .lines()
        .find_map(|line| line.strip_prefix(marker))
        .map(|path| {
            path.split(" / ")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn api_doc_extraction_section_ids(extraction: &SchemaRagApiDocExtraction) -> HashSet<String> {
    extraction
        .api_fields
        .iter()
        .map(|fact| fact.section_id.clone())
        .chain(extraction.business_concepts.iter().map(|fact| fact.section_id.clone()))
        .chain(extraction.join_candidates.iter().map(|fact| fact.section_id.clone()))
        .collect()
}

fn optional_string_value(value: Option<&str>) -> Value {
    Value::String(value.unwrap_or("").to_string())
}

fn insert_kuzu_foreign_keys(connection: &Connection<'_>, stored: &StoredSchemaRagIndex) -> Result<(), String> {
    let mut fk_statement = connection
        .prepare(
            "CREATE (:ForeignKeyNode {id: $id, schema_name: $schema_name, table_name: $table_name, name: $name, column_name: $column_name, ref_schema: $ref_schema, ref_table: $ref_table, ref_column: $ref_column});",
        )
        .map_err(|err| err.to_string())?;
    let mut has_fk_statement = connection
        .prepare(
            "MATCH (t:TableNode {id: $tableId}), (f:ForeignKeyNode {id: $fkId}) CREATE (t)-[:HAS_FOREIGN_KEY]->(f);",
        )
        .map_err(|err| err.to_string())?;
    let mut fk_to_statement = connection
        .prepare(
            "MATCH (from:ColumnNode {id: $fromColumnId}), (to:ColumnNode {id: $toColumnId}) CREATE (from)-[:FK_TO]->(to);",
        )
        .map_err(|err| err.to_string())?;
    let mut related_statement = connection
        .prepare(
            "MATCH (from:TableNode {id: $fromTableId}), (to:TableNode {id: $toTableId}) CREATE (from)-[:RELATED_TO {source: $source, reason: $reason}]->(to);",
        )
        .map_err(|err| err.to_string())?;

    let table_ids: HashSet<String> =
        stored.tables.iter().map(|table| kuzu_table_id(&table.schema, &table.name)).collect();
    let column_ids: HashSet<String> = stored
        .tables
        .iter()
        .flat_map(|table| table.columns.iter().map(|column| kuzu_column_id(&table.schema, &table.name, &column.name)))
        .collect();

    for table in &stored.tables {
        let table_id = kuzu_table_id(&table.schema, &table.name);
        for fk in &table.foreign_keys {
            let fk_id = kuzu_foreign_key_id(&table.schema, &table.name, &fk.name, &fk.column);
            let ref_schema = fk.ref_schema.clone().unwrap_or_else(|| table.schema.clone());
            let ref_table_id = kuzu_table_id(&ref_schema, &fk.ref_table);
            let from_column_id = kuzu_column_id(&table.schema, &table.name, &fk.column);
            let to_column_id = kuzu_column_id(&ref_schema, &fk.ref_table, &fk.ref_column);
            connection
                .execute(
                    &mut fk_statement,
                    vec![
                        ("id", Value::String(fk_id.clone())),
                        ("schema_name", Value::String(table.schema.clone())),
                        ("table_name", Value::String(table.name.clone())),
                        ("name", Value::String(fk.name.clone())),
                        ("column_name", Value::String(fk.column.clone())),
                        ("ref_schema", Value::String(ref_schema.clone())),
                        ("ref_table", Value::String(fk.ref_table.clone())),
                        ("ref_column", Value::String(fk.ref_column.clone())),
                    ],
                )
                .map_err(|err| err.to_string())?;
            connection
                .execute(
                    &mut has_fk_statement,
                    vec![("tableId", Value::String(table_id.clone())), ("fkId", Value::String(fk_id))],
                )
                .map_err(|err| err.to_string())?;
            if column_ids.contains(&from_column_id) && column_ids.contains(&to_column_id) {
                connection
                    .execute(
                        &mut fk_to_statement,
                        vec![
                            ("fromColumnId", Value::String(from_column_id)),
                            ("toColumnId", Value::String(to_column_id)),
                        ],
                    )
                    .map_err(|err| err.to_string())?;
            }
            if table_ids.contains(&ref_table_id) {
                connection
                    .execute(
                        &mut related_statement,
                        vec![
                            ("fromTableId", Value::String(table_id.clone())),
                            ("toTableId", Value::String(ref_table_id)),
                            ("source", Value::String("foreign_key".to_string())),
                            (
                                "reason",
                                Value::String(format!(
                                    "{}.{} -> {}.{}",
                                    table.name, fk.column, fk.ref_table, fk.ref_column
                                )),
                            ),
                        ],
                    )
                    .map_err(|err| err.to_string())?;
            }
        }
    }
    Ok(())
}

fn kuzu_scope_id(manifest: &SchemaRagManifest) -> String {
    format!("scope:{}:{}:{}", manifest.connection_id, manifest.database, manifest.schema)
}

fn kuzu_table_id(schema: &str, table: &str) -> String {
    format!("table:{schema}:{table}")
}

fn kuzu_column_id(schema: &str, table: &str, column: &str) -> String {
    format!("column:{schema}:{table}:{column}")
}

fn kuzu_index_id(schema: &str, table: &str, index: &str) -> String {
    format!("index:{schema}:{table}:{index}")
}

fn kuzu_foreign_key_id(schema: &str, table: &str, name: &str, column: &str) -> String {
    format!("foreign_key:{schema}:{table}:{name}:{column}")
}

fn kuzu_document_kind(kind: &SchemaRagDocumentKind) -> &'static str {
    match kind {
        SchemaRagDocumentKind::Table => "table",
        SchemaRagDocumentKind::Column => "column",
        SchemaRagDocumentKind::ApiDoc => "api_doc",
        SchemaRagDocumentKind::ApiDocFact => "api_doc_fact",
    }
}

fn string_list_value(values: &[String]) -> Value {
    Value::List(LogicalType::String, values.iter().cloned().map(Value::String).collect())
}

fn float_list_value(values: &[f32]) -> Value {
    Value::List(LogicalType::Float, values.iter().copied().map(Value::Float).collect())
}

async fn embed_texts<F>(
    config: &SchemaRagConfig,
    texts: &[String],
    index_dir: &Path,
    progress: &mut F,
) -> Result<Vec<Vec<f32>>, String>
where
    F: FnMut(SchemaRagAnalyzeProgress),
{
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    if !config.embedding_provider.eq_ignore_ascii_case("openai-compatible") {
        return Err("Only openai-compatible embedding provider is supported in Schema RAG V1".to_string());
    }

    let client = build_http_client(config)?;
    let endpoint = resolve_embedding_endpoint(&config.embedding_endpoint);
    let client = Arc::new(client);
    let single_input_only = embedding_endpoint_requires_single_input(&endpoint);
    let batch_size = normalized_embedding_batch_size(config, single_input_only);
    let concurrency = normalized_embedding_concurrency(config);
    let jobs = build_embedding_batch_jobs(texts, batch_size);
    let batch_total = jobs.len();
    progress(progress_event(
        "embedding_queued",
        0,
        texts.len(),
        None,
        None,
        Some(batch_total),
        None,
        Some(concurrency),
        Some(0),
        Some(0),
        Some(0),
        "Schema documents queued for embedding",
    ));
    append_sidecar_log(
        index_dir,
        &format!(
            "embedding queued endpoint={} model={} documents={} batch_size={} batches={} concurrency={}",
            endpoint,
            config.embedding_model,
            texts.len(),
            batch_size,
            batch_total,
            concurrency
        ),
    )
    .await?;

    let mut results: Vec<Option<EmbeddingBatchResult>> = vec![None; batch_total];
    let mut futures = FuturesUnordered::new();
    let mut next_job = 0;
    let mut completed_items = 0;
    let mut succeeded_batches = 0;
    let mut failed_batches = 0;

    while next_job < jobs.len() && futures.len() < concurrency {
        let job = jobs[next_job].clone();
        next_job += 1;
        emit_embedding_request_started(
            progress,
            index_dir,
            &job,
            texts.len(),
            batch_total,
            concurrency,
            futures.len() + 1,
            completed_items,
            succeeded_batches,
            failed_batches,
        )
        .await?;
        futures.push(send_embedding_batch(
            Arc::clone(&client),
            endpoint.clone(),
            config.clone(),
            job,
            single_input_only,
        ));
    }

    while let Some(result) = futures.next().await {
        let in_flight_after_complete = futures.len();
        match result {
            Ok(result) => {
                let batch_index = result.batch_index;
                completed_items += result.embeddings.len();
                succeeded_batches += 1;
                let batch_number = batch_index + 1;
                let batch_len = result.embeddings.len();
                append_sidecar_log(
                    index_dir,
                    &format!(
                        "embedding request done batch={}/{} done={} total={} elapsed_ms={}",
                        batch_number,
                        batch_total,
                        completed_items,
                        texts.len(),
                        result.elapsed_ms
                    ),
                )
                .await?;
                progress(progress_event(
                    "embedding_done",
                    completed_items,
                    texts.len(),
                    None,
                    Some(batch_number),
                    Some(batch_total),
                    Some(batch_len),
                    Some(concurrency),
                    Some(in_flight_after_complete),
                    Some(succeeded_batches),
                    Some(failed_batches),
                    "Embedding response received",
                ));
                results[batch_index] = Some(result);
            }
            Err(error) => {
                failed_batches += 1;
                append_sidecar_log(
                    index_dir,
                    &format!(
                        "embedding request failed batch={}/{} done={} total={} error={}",
                        error.batch_index + 1,
                        batch_total,
                        completed_items,
                        texts.len(),
                        error.message
                    ),
                )
                .await?;
                progress(progress_event(
                    "embedding_failed",
                    completed_items,
                    texts.len(),
                    None,
                    Some(error.batch_index + 1),
                    Some(batch_total),
                    None,
                    Some(concurrency),
                    Some(in_flight_after_complete),
                    Some(succeeded_batches),
                    Some(failed_batches),
                    "Embedding request failed",
                ));
                return Err(error.message);
            }
        }

        while next_job < jobs.len() && futures.len() < concurrency {
            let job = jobs[next_job].clone();
            next_job += 1;
            emit_embedding_request_started(
                progress,
                index_dir,
                &job,
                texts.len(),
                batch_total,
                concurrency,
                futures.len() + 1,
                completed_items,
                succeeded_batches,
                failed_batches,
            )
            .await?;
            futures.push(send_embedding_batch(
                Arc::clone(&client),
                endpoint.clone(),
                config.clone(),
                job,
                single_input_only,
            ));
        }
    }

    flatten_embedding_batch_results(results)
}

async fn embed_query_text(config: &SchemaRagConfig, query: &str, index_dir: &Path) -> Result<Vec<f32>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Schema RAG search query is required".to_string());
    }
    if !config.embedding_provider.eq_ignore_ascii_case("openai-compatible") {
        return Err("Only openai-compatible embedding provider is supported in Schema RAG V1".to_string());
    }

    let endpoint = resolve_embedding_endpoint(&config.embedding_endpoint);
    let client = Arc::new(build_http_client(config)?);
    let single_input_only = embedding_endpoint_requires_single_input(&endpoint);
    append_sidecar_log(
        index_dir,
        &format!(
            "search query embedding request endpoint={} model={} query_chars={}",
            endpoint,
            config.embedding_model,
            query.chars().count()
        ),
    )
    .await?;
    let job = EmbeddingBatchJob { batch_index: 0, start: 0, texts: vec![query.to_string()] };
    let started_at = Instant::now();
    match send_embedding_batch(client, endpoint, config.clone(), job, single_input_only).await {
        Ok(result) => {
            let embedding = result
                .embeddings
                .into_iter()
                .next()
                .ok_or_else(|| "Embedding service returned no vector for search query".to_string())?;
            append_sidecar_log(
                index_dir,
                &format!(
                    "search query embedding done dimensions={} elapsed_ms={}",
                    embedding.len(),
                    started_at.elapsed().as_millis()
                ),
            )
            .await?;
            Ok(embedding)
        }
        Err(error) => {
            append_sidecar_log(index_dir, &format!("search query embedding failed error={}", error.message)).await?;
            Err(error.message)
        }
    }
}

async fn emit_embedding_request_started<F>(
    progress: &mut F,
    index_dir: &Path,
    job: &EmbeddingBatchJob,
    total: usize,
    batch_total: usize,
    concurrency: usize,
    in_flight: usize,
    completed_items: usize,
    succeeded_batches: usize,
    failed_batches: usize,
) -> Result<(), String>
where
    F: FnMut(SchemaRagAnalyzeProgress),
{
    let batch_number = job.batch_index + 1;
    progress(progress_event(
        "embedding_request",
        completed_items,
        total,
        None,
        Some(batch_number),
        Some(batch_total),
        Some(job.texts.len()),
        Some(concurrency),
        Some(in_flight),
        Some(succeeded_batches),
        Some(failed_batches),
        "Sending embedding request",
    ));
    append_sidecar_log(
        index_dir,
        &format!(
            "embedding request start batch={}/{} start={} size={} done={} total={} concurrency={} in_flight={}",
            batch_number,
            batch_total,
            job.start,
            job.texts.len(),
            completed_items,
            total,
            concurrency,
            in_flight
        ),
    )
    .await
}

#[derive(Debug, Clone)]
struct EmbeddingBatchJob {
    batch_index: usize,
    start: usize,
    texts: Vec<String>,
}

#[derive(Debug, Clone)]
struct EmbeddingBatchResult {
    batch_index: usize,
    embeddings: Vec<Vec<f32>>,
    elapsed_ms: u128,
}

#[derive(Debug, Clone)]
struct EmbeddingBatchError {
    batch_index: usize,
    message: String,
}

fn build_embedding_batch_jobs(texts: &[String], batch_size: usize) -> Vec<EmbeddingBatchJob> {
    let batch_size = batch_size.max(1);
    texts
        .chunks(batch_size)
        .enumerate()
        .map(|(batch_index, batch)| EmbeddingBatchJob {
            batch_index,
            start: batch_index * batch_size,
            texts: batch.to_vec(),
        })
        .collect()
}

fn flatten_embedding_batch_results(results: Vec<Option<EmbeddingBatchResult>>) -> Result<Vec<Vec<f32>>, String> {
    let total: usize = results.iter().filter_map(|result| result.as_ref()).map(|result| result.embeddings.len()).sum();
    let mut out = Vec::with_capacity(total);
    for result in results {
        let result = result.ok_or_else(|| "Embedding service did not return every batch".to_string())?;
        out.extend(result.embeddings);
    }
    Ok(out)
}

async fn send_embedding_batch(
    client: Arc<reqwest::Client>,
    endpoint: String,
    config: SchemaRagConfig,
    job: EmbeddingBatchJob,
    single_input_only: bool,
) -> Result<EmbeddingBatchResult, EmbeddingBatchError> {
    let started_at = Instant::now();
    let request_body = embedding_request_body(&config, &job.texts, single_input_only);
    let mut request = client.post(&endpoint).json(&request_body);
    if !config.embedding_api_key.trim().is_empty() {
        request = request.bearer_auth(config.embedding_api_key.trim());
    }
    let response = request.send().await.map_err(|err| EmbeddingBatchError {
        batch_index: job.batch_index,
        message: format!("Embedding request failed at batch {}: {err}", job.batch_index + 1),
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(EmbeddingBatchError {
            batch_index: job.batch_index,
            message: format!("Embedding request failed at batch {} with HTTP {status}: {body}", job.batch_index + 1),
        });
    }
    let payload: serde_json::Value = response.json().await.map_err(|err| EmbeddingBatchError {
        batch_index: job.batch_index,
        message: format!("Embedding response parse failed at batch {}: {err}", job.batch_index + 1),
    })?;
    let data = payload["data"].as_array().ok_or_else(|| EmbeddingBatchError {
        batch_index: job.batch_index,
        message: format!("Embedding response missing data array at batch {}", job.batch_index + 1),
    })?;
    let mut embeddings = Vec::with_capacity(data.len());
    for item in data {
        let embedding = item["embedding"]
            .as_array()
            .ok_or_else(|| EmbeddingBatchError {
                batch_index: job.batch_index,
                message: format!("Embedding response item missing embedding array at batch {}", job.batch_index + 1),
            })?
            .iter()
            .map(|value| {
                value.as_f64().map(|num| num as f32).ok_or_else(|| EmbeddingBatchError {
                    batch_index: job.batch_index,
                    message: format!("Embedding value is not numeric at batch {}", job.batch_index + 1),
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        embeddings.push(embedding);
    }
    if embeddings.len() != job.texts.len() {
        return Err(EmbeddingBatchError {
            batch_index: job.batch_index,
            message: format!(
                "Embedding service returned {} vectors for {} inputs at batch {}",
                embeddings.len(),
                job.texts.len(),
                job.batch_index + 1
            ),
        });
    }
    Ok(EmbeddingBatchResult { batch_index: job.batch_index, embeddings, elapsed_ms: started_at.elapsed().as_millis() })
}

fn build_http_client(config: &SchemaRagConfig) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120));
    if config.proxy_enabled && !config.proxy_url.trim().is_empty() {
        builder = builder.proxy(reqwest::Proxy::all(config.proxy_url.trim()).map_err(|err| err.to_string())?);
    }
    builder.build().map_err(|err| err.to_string())
}

fn embedding_request_body(config: &SchemaRagConfig, batch: &[String], single_input_only: bool) -> serde_json::Value {
    let input = if single_input_only || batch.len() == 1 {
        serde_json::Value::String(batch[0].clone())
    } else {
        serde_json::Value::Array(batch.iter().cloned().map(serde_json::Value::String).collect())
    };
    serde_json::json!({
        "model": config.embedding_model,
        "input": input,
        "encoding_format": "float",
        "dimensions": config.embedding_dimension,
        "user": "",
    })
}

fn embedding_endpoint_requires_single_input(endpoint: &str) -> bool {
    endpoint.contains("ai.gitee.com/")
}

fn resolve_embedding_endpoint(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if endpoint.ends_with("/embeddings") {
        endpoint.to_string()
    } else {
        format!("{endpoint}/embeddings")
    }
}

async fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    tokio::fs::write(path, bytes).await.map_err(|err| err.to_string())
}

async fn append_sidecar_log(index_dir: &Path, message: &str) -> Result<(), String> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(index_dir.join("sidecar.log"))
        .await
        .map_err(|err| err.to_string())?;
    file.write_all(format!("{} {}\n", Utc::now().to_rfc3339(), message).as_bytes()).await.map_err(|err| err.to_string())
}

fn progress_event(
    stage: &str,
    done: usize,
    total: usize,
    table: Option<String>,
    batch: Option<usize>,
    batch_total: Option<usize>,
    batch_size: Option<usize>,
    concurrency: Option<usize>,
    in_flight: Option<usize>,
    succeeded_batches: Option<usize>,
    failed_batches: Option<usize>,
    message: &str,
) -> SchemaRagAnalyzeProgress {
    SchemaRagAnalyzeProgress {
        stage: stage.to_string(),
        done,
        total,
        table,
        batch,
        batch_total,
        batch_size,
        concurrency,
        in_flight,
        succeeded_batches,
        failed_batches,
        message: message.to_string(),
    }
}

async fn load_search_index(
    data_dir: &Path,
    connection_id: &str,
    database: &str,
    schema: &str,
) -> Result<SchemaRagSearchIndex, String> {
    let index_dir = schema_index_dir(data_dir, connection_id, database, schema);
    let graph_path = index_dir.join("graph.kuzu");
    if !graph_path.exists() {
        return Err("Schema RAG graph.kuzu is not available. Analyze schema before searching.".to_string());
    }
    let manifest = load_manifest(&index_dir).await?;
    let graph_path_for_task = graph_path.clone();
    let (stored, enrichment) =
        tokio::task::spawn_blocking(move || load_kuzu_search_index_blocking(&graph_path_for_task, manifest))
            .await
            .map_err(|err| format!("Kuzu search index task failed: {err}"))??;
    Ok(SchemaRagSearchIndex { stored, enrichment, source: "graph.kuzu".to_string() })
}

async fn load_manifest(index_dir: &Path) -> Result<SchemaRagManifest, String> {
    let path = index_dir.join("manifest.json");
    let bytes = tokio::fs::read(&path).await.map_err(|err| format!("Schema RAG manifest is not available: {err}"))?;
    serde_json::from_slice(&bytes).map_err(|err| err.to_string())
}

fn load_kuzu_search_index_blocking(
    graph_path: &Path,
    manifest: SchemaRagManifest,
) -> Result<(StoredSchemaRagIndex, SchemaRagEnrichment), String> {
    let database = Database::new(graph_path, SystemConfig::default()).map_err(|err| err.to_string())?;
    let connection = Connection::new(&database).map_err(|err| err.to_string())?;
    let tables = load_kuzu_tables(&connection)?;
    let documents = load_kuzu_documents(&connection)?;
    if documents.is_empty() {
        return Err("graph.kuzu does not contain schema documents".to_string());
    }
    let enrichment = load_kuzu_enrichment(&connection)?;
    let api_doc_extractions = load_kuzu_api_doc_extractions(&connection)?;
    Ok((StoredSchemaRagIndex { manifest, tables, documents, api_doc_extractions }, enrichment))
}

fn expand_schema_graph_blocking(
    graph_path: &Path,
    seeds: &[SchemaRagGraphSeed],
    include_candidates: bool,
    limit: usize,
) -> Result<ExpandSchemaRagGraphResponse, String> {
    let database = Database::new(graph_path, SystemConfig::default()).map_err(|err| err.to_string())?;
    let connection = Connection::new(&database).map_err(|err| err.to_string())?;
    let extractions = load_kuzu_api_doc_extractions(&connection)?;
    Ok(expand_schema_graph_from_extractions(&extractions, seeds, include_candidates, limit))
}

fn expand_schema_graph_from_extractions(
    extractions: &[SchemaRagApiDocExtraction],
    seeds: &[SchemaRagGraphSeed],
    include_candidates: bool,
    limit: usize,
) -> ExpandSchemaRagGraphResponse {
    let mut verified_mappings = Vec::new();
    let mut candidate_mappings = Vec::new();
    let mut join_candidates = Vec::new();
    let mut concepts = Vec::new();
    let mut source_evidence = Vec::new();
    let mut seen_evidence = HashSet::new();

    for extraction in extractions {
        for field in &extraction.api_fields {
            if !seeds.is_empty() && !seeds.iter().any(|seed| api_field_matches_seed(field, seed)) {
                continue;
            }
            match field.status {
                SchemaRagFactStatus::Verified => {
                    if verified_mappings.len() < limit {
                        verified_mappings.push(field.clone());
                    }
                }
                SchemaRagFactStatus::Candidate if include_candidates => {
                    if candidate_mappings.len() < limit {
                        candidate_mappings.push(field.clone());
                    }
                }
                _ => {}
            }
            push_fact_evidence(&mut source_evidence, &mut seen_evidence, &field.source_id, &field.section_id, &field.evidence);
        }

        for concept in &extraction.business_concepts {
            if !seeds.is_empty() && !seeds.iter().any(|seed| business_concept_matches_seed(concept, seed)) {
                continue;
            }
            if concept.status == SchemaRagFactStatus::Verified
                || (include_candidates && concept.status == SchemaRagFactStatus::Candidate)
            {
                if concepts.len() < limit {
                    concepts.push(concept.clone());
                }
                push_fact_evidence(
                    &mut source_evidence,
                    &mut seen_evidence,
                    &concept.source_id,
                    &concept.section_id,
                    &concept.evidence,
                );
            }
        }

        for join in &extraction.join_candidates {
            if !seeds.is_empty() && !seeds.iter().any(|seed| join_candidate_matches_seed(join, seed)) {
                continue;
            }
            if join.status == SchemaRagFactStatus::Verified
                || (include_candidates && join.status == SchemaRagFactStatus::Candidate)
            {
                if join_candidates.len() < limit {
                    join_candidates.push(join.clone());
                }
                push_fact_evidence(&mut source_evidence, &mut seen_evidence, &join.source_id, &join.section_id, &join.evidence);
            }
        }
    }

    source_evidence.truncate(limit);
    ExpandSchemaRagGraphResponse { verified_mappings, candidate_mappings, join_candidates, concepts, source_evidence }
}

fn api_field_matches_seed(field: &SchemaRagApiFieldFact, seed: &SchemaRagGraphSeed) -> bool {
    if seed_matches_source_or_section(&field.source_id, &field.section_id, &field.id, seed) {
        return true;
    }
    let schema = field.candidate_schema.as_deref();
    let table = field.candidate_table.as_deref();
    let column = field.candidate_column.as_deref();
    seed_matches_database_target(schema, table, column, seed)
}

fn business_concept_matches_seed(concept: &SchemaRagBusinessConceptFact, seed: &SchemaRagGraphSeed) -> bool {
    if seed_matches_source_or_section(&concept.source_id, &concept.section_id, &concept.id, seed) {
        return true;
    }
    if seed.kind.eq_ignore_ascii_case("business_concept")
        && seed.id.as_deref().is_some_and(|id| {
            id.eq_ignore_ascii_case(&concept.id) || id.eq_ignore_ascii_case(&concept.term)
        })
    {
        return true;
    }
    seed_matches_database_target(
        concept.candidate_schema.as_deref(),
        concept.candidate_table.as_deref(),
        concept.candidate_column.as_deref(),
        seed,
    )
}

fn join_candidate_matches_seed(join: &SchemaRagJoinCandidateFact, seed: &SchemaRagGraphSeed) -> bool {
    if seed_matches_source_or_section(&join.source_id, &join.section_id, &join.id, seed) {
        return true;
    }
    let seed_schema = seed.schema.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let Some(seed_table) = seed.table.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let seed_column = seed.column.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let left_table_matches = schema_matches(seed_schema, &join.left_schema)
        && join.left_table.eq_ignore_ascii_case(seed_table)
        && seed_column_matches_any(seed_column, &join.left_columns);
    let right_table_matches = schema_matches(seed_schema, &join.right_schema)
        && join.right_table.eq_ignore_ascii_case(seed_table)
        && seed_column_matches_any(seed_column, &join.right_columns);
    left_table_matches || right_table_matches
}

fn seed_matches_source_or_section(source_id: &str, section_id: &str, fact_id: &str, seed: &SchemaRagGraphSeed) -> bool {
    let kind = seed.kind.trim().to_ascii_lowercase();
    let id = seed.id.as_deref().map(str::trim).filter(|value| !value.is_empty());
    match kind.as_str() {
        "api_doc_source" => id.is_some_and(|id| id.eq_ignore_ascii_case(source_id)),
        "api_doc_section" => id.is_some_and(|id| id.eq_ignore_ascii_case(section_id)),
        "api_field" | "business_concept" | "join_candidate" => id.is_some_and(|id| id.eq_ignore_ascii_case(fact_id)),
        _ => false,
    }
}

fn seed_matches_database_target(
    schema: Option<&str>,
    table: Option<&str>,
    column: Option<&str>,
    seed: &SchemaRagGraphSeed,
) -> bool {
    let Some(seed_table) = seed.table.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let Some(target_table) = table.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    if !target_table.eq_ignore_ascii_case(seed_table) {
        return false;
    }
    let seed_schema = seed.schema.as_deref().map(str::trim).filter(|value| !value.is_empty());
    if let Some(target_schema) = schema.map(str::trim).filter(|value| !value.is_empty()) {
        if !schema_matches(seed_schema, target_schema) {
            return false;
        }
    }
    let seed_column = seed.column.as_deref().map(str::trim).filter(|value| !value.is_empty());
    match seed.kind.trim().to_ascii_lowercase().as_str() {
        "column" => {
            let Some(seed_column) = seed_column else {
                return false;
            };
            column.is_some_and(|target_column| target_column.eq_ignore_ascii_case(seed_column))
        }
        "table" => true,
        _ => match seed_column {
            Some(seed_column) => column.is_some_and(|target_column| target_column.eq_ignore_ascii_case(seed_column)),
            None => true,
        },
    }
}

fn schema_matches(seed_schema: Option<&str>, target_schema: &str) -> bool {
    seed_schema.map_or(true, |schema| schema.eq_ignore_ascii_case(target_schema))
}

fn seed_column_matches_any(seed_column: Option<&str>, candidates: &[String]) -> bool {
    seed_column.map_or(true, |column| candidates.iter().any(|candidate| candidate.eq_ignore_ascii_case(column)))
}

fn push_fact_evidence(
    source_evidence: &mut Vec<String>,
    seen: &mut HashSet<String>,
    source_id: &str,
    section_id: &str,
    evidence: &str,
) {
    let evidence = evidence.trim();
    if evidence.is_empty() {
        return;
    }
    let line = format!("{source_id} / {section_id}: {evidence}");
    if seen.insert(line.clone()) {
        source_evidence.push(line);
    }
}

fn load_kuzu_tables(connection: &Connection<'_>) -> Result<Vec<SchemaRagTableMetadata>, String> {
    let mut table_map: HashMap<(String, String), SchemaRagTableMetadata> = HashMap::new();
    let mut table_result = connection
        .query("MATCH (t:TableNode) RETURN t.schema_name, t.name, t.table_type, t.comment, t.ddl")
        .map_err(|err| err.to_string())?;
    while let Some(row) = table_result.next() {
        let schema = value_string(&row[0])?;
        let name = value_string(&row[1])?;
        table_map.insert(
            (schema.clone(), name.clone()),
            SchemaRagTableMetadata {
                schema,
                name,
                table_type: value_string(&row[2])?,
                comment: value_optional_string(&row[3])?,
                ddl: value_optional_string(&row[4])?,
                columns: Vec::new(),
                indexes: Vec::new(),
                foreign_keys: Vec::new(),
            },
        );
    }

    let mut column_result = connection
        .query(
            "MATCH (c:ColumnNode) RETURN c.schema_name, c.table_name, c.name, c.data_type, c.is_nullable, c.is_primary_key, c.comment",
        )
        .map_err(|err| err.to_string())?;
    while let Some(row) = column_result.next() {
        let schema = value_string(&row[0])?;
        let table_name = value_string(&row[1])?;
        let table = table_map
            .entry((schema.clone(), table_name.clone()))
            .or_insert_with(|| empty_table_metadata(&schema, &table_name));
        table.columns.push(SchemaRagColumnMetadata {
            name: value_string(&row[2])?,
            data_type: value_string(&row[3])?,
            is_nullable: value_bool(&row[4])?,
            is_primary_key: value_bool(&row[5])?,
            column_default: None,
            comment: value_optional_string(&row[6])?,
        });
    }

    let mut index_result = connection
        .query(
            "MATCH (i:IndexNode) RETURN i.schema_name, i.table_name, i.name, i.columns, i.is_unique, i.is_primary, i.index_type, i.comment",
        )
        .map_err(|err| err.to_string())?;
    while let Some(row) = index_result.next() {
        let schema = value_string(&row[0])?;
        let table_name = value_string(&row[1])?;
        let table = table_map
            .entry((schema.clone(), table_name.clone()))
            .or_insert_with(|| empty_table_metadata(&schema, &table_name));
        table.indexes.push(SchemaRagIndexMetadata {
            name: value_string(&row[2])?,
            columns: value_string_list(&row[3])?,
            is_unique: value_bool(&row[4])?,
            is_primary: value_bool(&row[5])?,
            index_type: value_optional_string(&row[6])?,
            comment: value_optional_string(&row[7])?,
        });
    }

    let mut fk_result = connection
        .query(
            "MATCH (f:ForeignKeyNode) RETURN f.schema_name, f.table_name, f.name, f.column_name, f.ref_schema, f.ref_table, f.ref_column",
        )
        .map_err(|err| err.to_string())?;
    while let Some(row) = fk_result.next() {
        let schema = value_string(&row[0])?;
        let table_name = value_string(&row[1])?;
        let table = table_map
            .entry((schema.clone(), table_name.clone()))
            .or_insert_with(|| empty_table_metadata(&schema, &table_name));
        table.foreign_keys.push(SchemaRagForeignKeyMetadata {
            name: value_string(&row[2])?,
            column: value_string(&row[3])?,
            ref_schema: value_optional_string(&row[4])?,
            ref_table: value_string(&row[5])?,
            ref_column: value_string(&row[6])?,
        });
    }

    let mut tables: Vec<SchemaRagTableMetadata> = table_map.into_values().collect();
    tables.sort_by(|a, b| (a.schema.as_str(), a.name.as_str()).cmp(&(b.schema.as_str(), b.name.as_str())));
    for table in &mut tables {
        table.columns.sort_by(|a, b| a.name.cmp(&b.name));
        table.indexes.sort_by(|a, b| a.name.cmp(&b.name));
        table.foreign_keys.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.column.cmp(&b.column)));
    }
    Ok(tables)
}

fn load_kuzu_documents(connection: &Connection<'_>) -> Result<Vec<SchemaRagDocument>, String> {
    let mut result = connection
        .query(
            "MATCH (d:SchemaDocument) RETURN d.id, d.kind, d.schema_name, d.table_name, d.column_name, d.data_type, d.text_for_embedding, d.embedding",
        )
        .map_err(|err| err.to_string())?;
    let mut documents = Vec::new();
    while let Some(row) = result.next() {
        documents.push(SchemaRagDocument {
            id: value_string(&row[0])?,
            kind: value_document_kind(&row[1])?,
            schema: value_string(&row[2])?,
            table: value_string(&row[3])?,
            column: value_optional_string(&row[4])?,
            data_type: value_optional_string(&row[5])?,
            text_for_embedding: value_string(&row[6])?,
            embedding: value_float_list(&row[7])?,
        });
    }
    documents.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(documents)
}

fn load_kuzu_enrichment(connection: &Connection<'_>) -> Result<SchemaRagEnrichment, String> {
    let mut result = match connection.query(
        "MATCH (a:BusinessAlias) RETURN a.term, a.target_kind, a.schema_name, a.table_name, a.column_name, a.source, a.confidence, a.note",
    ) {
        Ok(result) => result,
        Err(err) => {
            let message = err.to_string().to_lowercase();
            if message.contains("businessalias") && (message.contains("exist") || message.contains("not found")) {
                return Ok(SchemaRagEnrichment::default());
            }
            return Err(err.to_string());
        }
    };
    let mut aliases = Vec::new();
    let mut seen = HashSet::new();
    while let Some(row) = result.next() {
        let alias = SchemaRagBusinessAlias {
            term: value_string(&row[0])?,
            target_kind: value_string(&row[1])?,
            schema: value_string(&row[2])?,
            table: value_string(&row[3])?,
            column: value_optional_string(&row[4])?,
            source: value_string(&row[5])?,
            confidence: value_f32(&row[6])?,
            note: value_optional_string(&row[7])?,
        };
        let key = format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
            alias.term.to_lowercase(),
            alias.target_kind,
            alias.schema,
            alias.table.to_lowercase(),
            alias.column.clone().unwrap_or_default().to_lowercase()
        );
        if seen.insert(key) {
            aliases.push(alias);
        }
    }
    Ok(SchemaRagEnrichment { aliases })
}

fn load_kuzu_api_doc_extractions(connection: &Connection<'_>) -> Result<Vec<SchemaRagApiDocExtraction>, String> {
    let mut by_source: HashMap<String, SchemaRagApiDocExtraction> = HashMap::new();

    let mut field_result = match connection.query(
        "MATCH (f:ApiField) RETURN f.id, f.source_id, f.section_id, f.name, f.meaning, f.candidate_schema, f.candidate_table, f.candidate_column, f.status, f.confidence, f.evidence",
    ) {
        Ok(result) => result,
        Err(err) => {
            if is_missing_kuzu_table_error(&err.to_string(), "apifield") {
                return Ok(Vec::new());
            }
            return Err(err.to_string());
        }
    };
    while let Some(row) = field_result.next() {
        let source_id = value_string(&row[1])?;
        by_source
            .entry(source_id.clone())
            .or_insert_with(|| empty_kuzu_api_doc_extraction(&source_id))
            .api_fields
            .push(SchemaRagApiFieldFact {
                id: value_string(&row[0])?,
                source_id,
                section_id: value_string(&row[2])?,
                name: value_string(&row[3])?,
                meaning: value_string(&row[4])?,
                candidate_schema: value_optional_string(&row[5])?,
                candidate_table: value_optional_string(&row[6])?,
                candidate_column: value_optional_string(&row[7])?,
                status: value_fact_status(&row[8])?,
                confidence: value_f32(&row[9])?,
                evidence: value_string(&row[10])?,
            });
    }

    let mut concept_result = match connection.query(
        "MATCH (c:BusinessConcept) RETURN c.id, c.source_id, c.section_id, c.term, c.description, c.candidate_schema, c.candidate_table, c.candidate_column, c.status, c.confidence, c.evidence",
    ) {
        Ok(result) => result,
        Err(err) => {
            if is_missing_kuzu_table_error(&err.to_string(), "businessconcept") {
                return finish_kuzu_api_doc_extractions(by_source);
            }
            return Err(err.to_string());
        }
    };
    while let Some(row) = concept_result.next() {
        let source_id = value_string(&row[1])?;
        by_source
            .entry(source_id.clone())
            .or_insert_with(|| empty_kuzu_api_doc_extraction(&source_id))
            .business_concepts
            .push(SchemaRagBusinessConceptFact {
                id: value_string(&row[0])?,
                source_id,
                section_id: value_string(&row[2])?,
                term: value_string(&row[3])?,
                description: value_string(&row[4])?,
                candidate_schema: value_optional_string(&row[5])?,
                candidate_table: value_optional_string(&row[6])?,
                candidate_column: value_optional_string(&row[7])?,
                status: value_fact_status(&row[8])?,
                confidence: value_f32(&row[9])?,
                evidence: value_string(&row[10])?,
            });
    }

    let mut join_result = match connection.query(
        "MATCH (j:JoinCandidate) RETURN j.id, j.source_id, j.section_id, j.left_schema, j.left_table, j.left_columns, j.right_schema, j.right_table, j.right_columns, j.relation, j.status, j.confidence, j.evidence",
    ) {
        Ok(result) => result,
        Err(err) => {
            if is_missing_kuzu_table_error(&err.to_string(), "joincandidate") {
                return finish_kuzu_api_doc_extractions(by_source);
            }
            return Err(err.to_string());
        }
    };
    while let Some(row) = join_result.next() {
        let source_id = value_string(&row[1])?;
        by_source
            .entry(source_id.clone())
            .or_insert_with(|| empty_kuzu_api_doc_extraction(&source_id))
            .join_candidates
            .push(SchemaRagJoinCandidateFact {
                id: value_string(&row[0])?,
                source_id,
                section_id: value_string(&row[2])?,
                left_schema: value_string(&row[3])?,
                left_table: value_string(&row[4])?,
                left_columns: value_string_list(&row[5])?,
                right_schema: value_string(&row[6])?,
                right_table: value_string(&row[7])?,
                right_columns: value_string_list(&row[8])?,
                relation: value_string(&row[9])?,
                status: value_fact_status(&row[10])?,
                confidence: value_f32(&row[11])?,
                evidence: value_string(&row[12])?,
            });
    }

    finish_kuzu_api_doc_extractions(by_source)
}

fn empty_kuzu_api_doc_extraction(source_id: &str) -> SchemaRagApiDocExtraction {
    SchemaRagApiDocExtraction {
        source_id: source_id.to_string(),
        extracted_at: String::new(),
        status: ApiDocExtractionStatus::Pending,
        api_fields: Vec::new(),
        business_concepts: Vec::new(),
        join_candidates: Vec::new(),
        errors: Vec::new(),
    }
}

fn finish_kuzu_api_doc_extractions(
    by_source: HashMap<String, SchemaRagApiDocExtraction>,
) -> Result<Vec<SchemaRagApiDocExtraction>, String> {
    let mut extractions: Vec<SchemaRagApiDocExtraction> = by_source
        .into_values()
        .map(|mut extraction| {
            extraction.status = summarize_api_doc_extraction_status(&extraction);
            extraction
        })
        .collect();
    extractions.sort_by(|a, b| a.source_id.cmp(&b.source_id));
    Ok(extractions)
}

fn summarize_api_doc_extraction_status(extraction: &SchemaRagApiDocExtraction) -> ApiDocExtractionStatus {
    let facts = extraction_fact_count(extraction);
    if facts == 0 {
        if !extraction.errors.is_empty() {
            return ApiDocExtractionStatus::Failed;
        }
        return ApiDocExtractionStatus::Pending;
    }
    if !extraction.errors.is_empty() {
        return ApiDocExtractionStatus::Partial;
    }
    let has_unresolved = extraction
        .api_fields
        .iter()
        .any(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected))
        || extraction
            .business_concepts
            .iter()
            .any(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected))
        || extraction
            .join_candidates
            .iter()
            .any(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected));
    if has_unresolved {
        ApiDocExtractionStatus::Partial
    } else {
        ApiDocExtractionStatus::Extracted
    }
}

fn is_missing_kuzu_table_error(message: &str, table_name: &str) -> bool {
    let message = message.to_lowercase();
    message.contains(table_name) && (message.contains("exist") || message.contains("not found"))
}

fn empty_table_metadata(schema: &str, table_name: &str) -> SchemaRagTableMetadata {
    SchemaRagTableMetadata {
        schema: schema.to_string(),
        name: table_name.to_string(),
        table_type: "TABLE".to_string(),
        comment: None,
        ddl: None,
        columns: Vec::new(),
        indexes: Vec::new(),
        foreign_keys: Vec::new(),
    }
}

async fn save_kuzu_business_aliases(graph_path: &Path, aliases: &[SchemaRagBusinessAlias]) -> Result<usize, String> {
    let graph_path = graph_path.to_path_buf();
    let aliases = aliases.to_vec();
    tokio::task::spawn_blocking(move || save_kuzu_business_aliases_blocking(&graph_path, &aliases))
        .await
        .map_err(|err| format!("Kuzu enrichment task failed: {err}"))?
}

fn save_kuzu_business_aliases_blocking(graph_path: &Path, aliases: &[SchemaRagBusinessAlias]) -> Result<usize, String> {
    let database = Database::new(graph_path, SystemConfig::default()).map_err(|err| err.to_string())?;
    let connection = Connection::new(&database).map_err(|err| err.to_string())?;
    create_kuzu_enrichment_schema_if_missing(&connection)?;

    let mut alias_statement = connection
        .prepare(
            "CREATE (:BusinessAlias {id: $id, term: $term, target_kind: $target_kind, schema_name: $schema_name, table_name: $table_name, column_name: $column_name, source: $source, confidence: $confidence, note: $note, created_at: $created_at});",
        )
        .map_err(|err| err.to_string())?;
    let mut table_rel_statement = connection
        .prepare(
            "MATCH (a:BusinessAlias {id: $aliasId}), (t:TableNode {id: $tableId}) CREATE (a)-[:ALIAS_OF_TABLE]->(t);",
        )
        .map_err(|err| err.to_string())?;
    let mut column_rel_statement = connection
        .prepare("MATCH (a:BusinessAlias {id: $aliasId}), (c:ColumnNode {id: $columnId}) CREATE (a)-[:ALIAS_OF_COLUMN]->(c);")
        .map_err(|err| err.to_string())?;

    let created_at = Utc::now().to_rfc3339();
    let mut saved = 0usize;
    for (index, alias) in aliases.iter().enumerate() {
        let alias_id = kuzu_business_alias_id(alias, index);
        connection
            .execute(
                &mut alias_statement,
                vec![
                    ("id", Value::String(alias_id.clone())),
                    ("term", Value::String(alias.term.clone())),
                    ("target_kind", Value::String(alias.target_kind.clone())),
                    ("schema_name", Value::String(alias.schema.clone())),
                    ("table_name", Value::String(alias.table.clone())),
                    ("column_name", Value::String(alias.column.clone().unwrap_or_default())),
                    ("source", Value::String(alias.source.clone())),
                    ("confidence", Value::Float(alias.confidence)),
                    ("note", Value::String(alias.note.clone().unwrap_or_default())),
                    ("created_at", Value::String(created_at.clone())),
                ],
            )
            .map_err(|err| err.to_string())?;
        let table_id = kuzu_table_id(&alias.schema, &alias.table);
        connection
            .execute(
                &mut table_rel_statement,
                vec![("aliasId", Value::String(alias_id.clone())), ("tableId", Value::String(table_id))],
            )
            .map_err(|err| err.to_string())?;
        if let Some(column) = &alias.column {
            let column_id = kuzu_column_id(&alias.schema, &alias.table, column);
            connection
                .execute(
                    &mut column_rel_statement,
                    vec![("aliasId", Value::String(alias_id)), ("columnId", Value::String(column_id))],
                )
                .map_err(|err| err.to_string())?;
        }
        saved += 1;
    }
    Ok(saved)
}

fn normalize_business_alias(
    schema: &str,
    input: SchemaRagBusinessAliasInput,
) -> Result<SchemaRagBusinessAlias, String> {
    let term = input.term.trim().to_string();
    if term.is_empty() {
        return Err("alias term is required".to_string());
    }
    let table = input.table.trim().to_string();
    if table.is_empty() {
        return Err("alias table is required".to_string());
    }
    let column = input.column.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    let target_kind = input
        .target_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(if column.is_some() { "column" } else { "table" })
        .to_lowercase();
    if !matches!(target_kind.as_str(), "table" | "column") {
        return Err("alias targetKind must be table or column".to_string());
    }
    if target_kind == "column" && column.is_none() {
        return Err("alias column is required when targetKind is column".to_string());
    }
    if target_kind == "table" && column.is_some() {
        return Err("alias column must be empty when targetKind is table".to_string());
    }
    let source = input
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user_confirmed")
        .to_string();
    let note = input.note.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    });
    Ok(SchemaRagBusinessAlias {
        term,
        target_kind,
        schema: schema.to_string(),
        table,
        column,
        source,
        confidence: input.confidence.unwrap_or(1.0).clamp(0.0, 1.0),
        note,
    })
}

fn kuzu_business_alias_id(alias: &SchemaRagBusinessAlias, index: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(alias.term.as_bytes());
    hasher.update(alias.target_kind.as_bytes());
    hasher.update(alias.schema.as_bytes());
    hasher.update(alias.table.as_bytes());
    if let Some(column) = &alias.column {
        hasher.update(column.as_bytes());
    }
    hasher.update(alias.source.as_bytes());
    hasher.update(Utc::now().timestamp_nanos_opt().unwrap_or_default().to_string().as_bytes());
    hasher.update(index.to_string().as_bytes());
    format!("alias:{:x}", hasher.finalize())
}

fn value_string(value: &Value) -> Result<String, String> {
    match value {
        Value::String(value) => Ok(value.clone()),
        Value::Null(_) => Ok(String::new()),
        other => Err(format!("expected Kuzu string, got {other:?}")),
    }
}

fn value_optional_string(value: &Value) -> Result<Option<String>, String> {
    let value = value_string(value)?;
    Ok((!value.trim().is_empty()).then_some(value))
}

fn value_bool(value: &Value) -> Result<bool, String> {
    match value {
        Value::Bool(value) => Ok(*value),
        Value::Null(_) => Ok(false),
        other => Err(format!("expected Kuzu bool, got {other:?}")),
    }
}

fn value_f32(value: &Value) -> Result<f32, String> {
    match value {
        Value::Float(value) => Ok(*value),
        Value::Double(value) => Ok(*value as f32),
        Value::Int64(value) => Ok(*value as f32),
        Value::Null(_) => Ok(0.0),
        other => Err(format!("expected Kuzu number, got {other:?}")),
    }
}

fn value_string_list(value: &Value) -> Result<Vec<String>, String> {
    match value {
        Value::List(_, values) | Value::Array(_, values) => values.iter().map(value_string).collect(),
        Value::Null(_) => Ok(Vec::new()),
        other => Err(format!("expected Kuzu string list, got {other:?}")),
    }
}

fn value_float_list(value: &Value) -> Result<Vec<f32>, String> {
    match value {
        Value::List(_, values) | Value::Array(_, values) => values.iter().map(value_f32).collect(),
        Value::Null(_) => Ok(Vec::new()),
        other => Err(format!("expected Kuzu float list, got {other:?}")),
    }
}

fn value_document_kind(value: &Value) -> Result<SchemaRagDocumentKind, String> {
    match value_string(value)?.as_str() {
        "table" => Ok(SchemaRagDocumentKind::Table),
        "column" => Ok(SchemaRagDocumentKind::Column),
        "api_doc" => Ok(SchemaRagDocumentKind::ApiDoc),
        "api_doc_fact" => Ok(SchemaRagDocumentKind::ApiDocFact),
        other => Err(format!("unknown schema document kind: {other}")),
    }
}

fn value_fact_status(value: &Value) -> Result<SchemaRagFactStatus, String> {
    match value_string(value)?.as_str() {
        "verified" => Ok(SchemaRagFactStatus::Verified),
        "candidate" => Ok(SchemaRagFactStatus::Candidate),
        "rejected" => Ok(SchemaRagFactStatus::Rejected),
        "unresolved" => Ok(SchemaRagFactStatus::Unresolved),
        other => Err(format!("unknown schema rag fact status: {other}")),
    }
}

fn table_text_for_embedding(table: &SchemaRagTableMetadata) -> String {
    let mut lines = vec![
        format!("表: {}", table.name),
        format!("类型: {}", table.table_type),
        format!("注释: {}", table.comment.as_deref().unwrap_or("")),
        format!("字段: {}", table.columns.iter().map(|column| column.name.as_str()).collect::<Vec<_>>().join(", ")),
    ];
    for index in &table.indexes {
        lines.push(format!("索引: {}({})", index.name, index.columns.join(", ")));
    }
    for fk in &table.foreign_keys {
        let ref_table = fk
            .ref_schema
            .as_ref()
            .filter(|schema| *schema != &table.schema)
            .map(|schema| format!("{schema}.{}", fk.ref_table))
            .unwrap_or_else(|| fk.ref_table.clone());
        lines.push(format!("外键: {} -> {}.{}", fk.column, ref_table, fk.ref_column));
    }
    if let Some(ddl) = table.ddl.as_deref().filter(|ddl| !ddl.trim().is_empty()) {
        lines.push(format!("DDL: {}", ddl.trim()));
    }
    lines.join("\n")
}

fn column_text_for_embedding(table: &SchemaRagTableMetadata, column: &SchemaRagColumnMetadata) -> String {
    [
        format!("字段: {}.{}", table.name, column.name),
        format!("所属表: {}", table.name),
        format!("表注释: {}", table.comment.as_deref().unwrap_or("")),
        format!("字段注释: {}", column.comment.as_deref().unwrap_or("")),
        format!("类型: {}", column.data_type),
        format!("主键: {}", column.is_primary_key),
        format!("可空: {}", column.is_nullable),
    ]
    .join("\n")
}

fn api_doc_section_text_for_embedding(doc: &NormalizedApiDoc, section: &NormalizedApiDocSection) -> String {
    [
        format!("接口文档: {}", doc.source_path),
        format!("章节: {}", section.title_path.join(" / ")),
        format!("内容: {}", section.text),
    ]
    .join("\n")
}

fn lexical_score(query_tokens: &HashSet<String>, query_text: &str, doc: &SchemaRagDocument) -> f32 {
    let haystack = doc.text_for_embedding.to_lowercase();
    let mut score = 0.0;
    for token in query_tokens {
        if token.len() >= 2 && haystack.contains(token) {
            score += token.chars().count() as f32;
        } else if is_cjk_token(token) && haystack.contains(token) {
            score += 0.5;
        }
    }
    if query_text.contains(&doc.table.to_lowercase()) {
        score += 12.0;
    }
    if matches!(doc.kind, SchemaRagDocumentKind::ApiDoc | SchemaRagDocumentKind::ApiDocFact) {
        let haystack = doc.text_for_embedding.to_lowercase();
        if query_text.len() >= 2 && haystack.contains(query_text) {
            score += 10.0;
        }
    }
    if let Some(column) = &doc.column {
        if query_text.contains(&column.to_lowercase()) {
            score += 14.0;
        }
    }
    score
}

fn normalize_lexical_score(score: f32) -> f32 {
    if score <= 0.0 {
        0.0
    } else {
        (score / 24.0).min(1.0)
    }
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return None;
    }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }
    if left_norm <= f32::EPSILON || right_norm <= f32::EPSILON {
        return None;
    }
    Some(dot / (left_norm.sqrt() * right_norm.sqrt()))
}

fn document_hit_reasons(doc: &SchemaRagDocument, vector_score: f32, lexical_score: f32) -> Vec<String> {
    let mut reasons = Vec::new();
    if vector_score >= 0.35 {
        match doc.kind {
            SchemaRagDocumentKind::Table => reasons.push("向量命中表级文档".to_string()),
            SchemaRagDocumentKind::Column => {
                reasons.push(format!("向量命中字段 {}", doc.column.as_deref().unwrap_or("")))
            }
            SchemaRagDocumentKind::ApiDoc => reasons.push(format!("向量命中接口文档 {}", api_doc_section_label(doc))),
            SchemaRagDocumentKind::ApiDocFact => {
                reasons.push(format!("向量命中接口文档事实 {}", api_doc_section_label(doc)))
            }
        }
    }
    if lexical_score > 0.0 {
        match doc.kind {
            SchemaRagDocumentKind::Table => reasons.push("关键词命中表级元数据".to_string()),
            SchemaRagDocumentKind::Column => {
                reasons.push(format!("关键词命中字段 {}", doc.column.as_deref().unwrap_or("")))
            }
            SchemaRagDocumentKind::ApiDoc => reasons.push(format!("关键词命中接口文档 {}", api_doc_section_label(doc))),
            SchemaRagDocumentKind::ApiDocFact => {
                reasons.push(format!("关键词命中接口文档事实 {}", api_doc_section_label(doc)))
            }
        }
    }
    if reasons.is_empty() {
        match doc.kind {
            SchemaRagDocumentKind::Table => reasons.push("低分向量命中表级文档".to_string()),
            SchemaRagDocumentKind::Column => {
                reasons.push(format!("低分向量命中字段 {}", doc.column.as_deref().unwrap_or("")))
            }
            SchemaRagDocumentKind::ApiDoc => reasons.push(format!("低分向量命中接口文档 {}", api_doc_section_label(doc))),
            SchemaRagDocumentKind::ApiDocFact => {
                reasons.push(format!("低分向量命中接口文档事实 {}", api_doc_section_label(doc)))
            }
        }
    }
    reasons
}

fn api_doc_section_label(doc: &SchemaRagDocument) -> String {
    doc.column.as_deref().unwrap_or(&doc.table).to_string()
}

fn business_alias_hits_for_doc<'a>(
    query_tokens: &HashSet<String>,
    query_text: &str,
    doc: &SchemaRagDocument,
    enrichment: &'a SchemaRagEnrichment,
) -> Vec<&'a SchemaRagBusinessAlias> {
    enrichment
        .aliases
        .iter()
        .filter(|alias| business_alias_matches_query(query_tokens, query_text, &alias.term))
        .filter(|alias| business_alias_targets_document(alias, doc))
        .collect()
}

fn business_alias_matches_query(query_tokens: &HashSet<String>, query_text: &str, term: &str) -> bool {
    let normalized = term.trim().to_lowercase();
    if normalized.len() < 2 {
        return false;
    }
    if query_text.contains(&normalized) {
        return true;
    }
    tokenize(&normalized).iter().any(|token| token.len() >= 2 && query_tokens.contains(token))
}

fn business_alias_targets_document(alias: &SchemaRagBusinessAlias, doc: &SchemaRagDocument) -> bool {
    if alias.schema != doc.schema || !alias.table.eq_ignore_ascii_case(&doc.table) {
        return false;
    }
    match alias.target_kind.as_str() {
        "table" => doc.kind == SchemaRagDocumentKind::Table && alias.column.is_none(),
        "column" => {
            doc.kind == SchemaRagDocumentKind::Column
                && alias.column.as_deref().is_some_and(|column| {
                    doc.column.as_deref().is_some_and(|doc_column| column.eq_ignore_ascii_case(doc_column))
                })
        }
        _ => false,
    }
}

fn alias_score_component(alias_hits: &[&SchemaRagBusinessAlias], max_bonus: f32) -> f32 {
    alias_hits.iter().map(|alias| alias.confidence.clamp(0.0, 1.0) * max_bonus).fold(0.0_f32, f32::max)
}

fn alias_hit_reasons(alias_hits: &[&SchemaRagBusinessAlias]) -> Vec<String> {
    alias_hits.iter().map(|alias| format!("用户确认业务别名命中 {}", alias.term)).collect()
}

fn key_columns_for_table(table: &SchemaRagTableMetadata) -> Vec<SchemaRagMatchedColumn> {
    table
        .columns
        .iter()
        .filter(|column| {
            column.is_primary_key || column.comment.as_deref().is_some_and(|comment| !comment.trim().is_empty())
        })
        .take(8)
        .map(|column| SchemaRagMatchedColumn {
            name: column.name.clone(),
            comment: column.comment.clone(),
            primary_key: Some(column.is_primary_key),
            data_type: Some(column.data_type.clone()),
            score: 0.0,
            reason: "表级文档命中后展开关键字段".to_string(),
        })
        .collect()
}

fn is_cjk_token(token: &str) -> bool {
    let mut chars = token.chars();
    matches!(chars.next(), Some(ch) if ('\u{4e00}'..='\u{9fff}').contains(&ch)) && chars.next().is_none()
}

fn normalize_identifier_key(value: &str) -> String {
    value.trim().to_lowercase()
}

fn tokenize(value: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let lower = value.to_lowercase();
    for token in
        lower.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ('\u{4e00}'..='\u{9fff}').contains(&ch)))
    {
        let token = token.trim();
        if token.len() >= 2 {
            tokens.insert(token.to_string());
        }
    }
    for ch in lower.chars().filter(|ch| ('\u{4e00}'..='\u{9fff}').contains(ch)) {
        tokens.insert(ch.to_string());
    }
    tokens
}

fn summarize_reasons(reasons: &[String]) -> String {
    let mut seen = HashSet::new();
    reasons.iter().filter(|reason| seen.insert((*reason).clone())).take(3).cloned().collect::<Vec<_>>().join("; ")
}

fn sanitize_log_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn related_tables_for(table: &SchemaRagTableMetadata, tables: &[SchemaRagTableMetadata]) -> Vec<SchemaRagRelatedTable> {
    let table_names: HashMap<&str, &SchemaRagTableMetadata> =
        tables.iter().map(|table| (table.name.as_str(), table)).collect();
    let mut related = Vec::new();
    for fk in &table.foreign_keys {
        if let Some(target) = table_names.get(fk.ref_table.as_str()) {
            related.push(SchemaRagRelatedTable {
                schema: target.schema.clone(),
                name: target.name.clone(),
                relation: "foreign_key".to_string(),
                reason: format!("{}.{} -> {}.{}", table.name, fk.column, fk.ref_table, fk.ref_column),
            });
        } else {
            related.push(SchemaRagRelatedTable {
                schema: fk.ref_schema.clone().unwrap_or_else(|| table.schema.clone()),
                name: fk.ref_table.clone(),
                relation: "foreign_key".to_string(),
                reason: format!("{}.{} -> {}.{}", table.name, fk.column, fk.ref_table, fk.ref_column),
            });
        }
    }
    related.truncate(8);
    related
}

pub fn build_table_index_units(
    tables: &[SchemaRagTableMetadata],
    updated_at: DateTime<Utc>,
) -> Result<Vec<SchemaRagTableIndexUnit>, String> {
    tables
        .iter()
        .map(|table| {
            Ok(SchemaRagTableIndexUnit {
                schema: table.schema.clone(),
                table: table.name.clone(),
                fingerprint: table_fingerprint(table)?,
                document_ids: table_document_ids(table),
                column_count: table.columns.len(),
                index_count: table.indexes.len(),
                foreign_key_count: table.foreign_keys.len(),
                updated_at,
            })
        })
        .collect()
}

pub fn diff_table_index_units(
    old_units: &[SchemaRagTableIndexUnit],
    new_tables: &[SchemaRagTableMetadata],
) -> Result<Vec<SchemaRagTableChange>, String> {
    let old_by_key: HashMap<(String, String), &SchemaRagTableIndexUnit> =
        old_units.iter().map(|unit| ((unit.schema.clone(), unit.table.clone()), unit)).collect();
    let mut seen_new_keys = HashSet::new();
    let mut changes = Vec::new();

    for table in new_tables {
        let key = (table.schema.clone(), table.name.clone());
        seen_new_keys.insert(key.clone());
        let new_fingerprint = table_fingerprint(table)?;
        match old_by_key.get(&key) {
            Some(old) if old.fingerprint == new_fingerprint => changes.push(SchemaRagTableChange {
                schema: table.schema.clone(),
                table: table.name.clone(),
                kind: SchemaRagTableChangeKind::Unchanged,
                old_fingerprint: Some(old.fingerprint.clone()),
                new_fingerprint: Some(new_fingerprint),
            }),
            Some(old) => changes.push(SchemaRagTableChange {
                schema: table.schema.clone(),
                table: table.name.clone(),
                kind: SchemaRagTableChangeKind::Changed,
                old_fingerprint: Some(old.fingerprint.clone()),
                new_fingerprint: Some(new_fingerprint),
            }),
            None => changes.push(SchemaRagTableChange {
                schema: table.schema.clone(),
                table: table.name.clone(),
                kind: SchemaRagTableChangeKind::Added,
                old_fingerprint: None,
                new_fingerprint: Some(new_fingerprint),
            }),
        }
    }

    for old in old_units {
        let key = (old.schema.clone(), old.table.clone());
        if !seen_new_keys.contains(&key) {
            changes.push(SchemaRagTableChange {
                schema: old.schema.clone(),
                table: old.table.clone(),
                kind: SchemaRagTableChangeKind::Removed,
                old_fingerprint: Some(old.fingerprint.clone()),
                new_fingerprint: None,
            });
        }
    }

    changes.sort_by(|a, b| a.schema.cmp(&b.schema).then_with(|| a.table.cmp(&b.table)));
    Ok(changes)
}

pub fn summarize_table_changes(changes: &[SchemaRagTableChange]) -> SchemaRagTableChangeSummary {
    let mut summary = SchemaRagTableChangeSummary { added: 0, changed: 0, removed: 0, unchanged: 0, total: changes.len() };
    for change in changes {
        match change.kind {
            SchemaRagTableChangeKind::Added => summary.added += 1,
            SchemaRagTableChangeKind::Changed => summary.changed += 1,
            SchemaRagTableChangeKind::Removed => summary.removed += 1,
            SchemaRagTableChangeKind::Unchanged => summary.unchanged += 1,
        }
    }
    summary
}

pub fn table_fingerprint(table: &SchemaRagTableMetadata) -> Result<String, String> {
    let bytes = serde_json::to_vec(table).map_err(|err| err.to_string())?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

fn table_document_ids(table: &SchemaRagTableMetadata) -> Vec<String> {
    let mut ids = Vec::with_capacity(table.columns.len() + 1);
    ids.push(format!("table:{}:{}", table.schema, table.name));
    ids.extend(table.columns.iter().map(|column| format!("column:{}:{}.{}", table.schema, table.name, column.name)));
    ids
}

async fn load_manifest_if_exists(index_dir: &Path) -> Result<Option<SchemaRagManifest>, String> {
    match tokio::fs::read(index_dir.join("manifest.json")).await {
        Ok(bytes) => serde_json::from_slice::<SchemaRagManifest>(&bytes).map(Some).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn upsert_api_doc_source(manifest: &mut SchemaRagManifest, doc: &NormalizedApiDoc, imported_at: DateTime<Utc>) {
    let existing = manifest.api_doc_sources.iter().find(|source| source.source_id == doc.source_id);
    let source = SchemaRagApiDocSource {
        source_id: doc.source_id.clone(),
        source_path: doc.source_path.clone(),
        original_format: doc.original_format.clone(),
        converter: doc.converter.clone(),
        content_hash: doc.content_hash.clone(),
        section_count: doc.sections.len(),
        imported_at,
        extraction_status: existing
            .map(|source| source.extraction_status.clone())
            .unwrap_or(ApiDocExtractionStatus::Pending),
        extracted_at: existing.and_then(|source| source.extracted_at.clone()),
        api_field_count: existing.map(|source| source.api_field_count).unwrap_or(0),
        business_concept_count: existing.map(|source| source.business_concept_count).unwrap_or(0),
        join_candidate_count: existing.map(|source| source.join_candidate_count).unwrap_or(0),
        unresolved_fact_count: existing.map(|source| source.unresolved_fact_count).unwrap_or(0),
    };
    if let Some(existing) = manifest.api_doc_sources.iter_mut().find(|source| source.source_id == doc.source_id) {
        *existing = source;
    } else {
        manifest.api_doc_sources.push(source);
    }
    manifest.api_doc_sources.sort_by(|a, b| a.source_path.cmp(&b.source_path));
}

fn apply_api_doc_extraction_summary(manifest: &mut SchemaRagManifest, extraction: &SchemaRagApiDocExtraction) {
    if let Some(source) = manifest.api_doc_sources.iter_mut().find(|source| source.source_id == extraction.source_id) {
        source.extraction_status = extraction.status.clone();
        source.extracted_at = Some(extraction.extracted_at.clone());
        source.api_field_count = extraction.api_fields.len();
        source.business_concept_count = extraction.business_concepts.len();
        source.join_candidate_count = extraction.join_candidates.len();
        source.unresolved_fact_count = extraction_unresolved_fact_count(extraction);
    }
}

fn extraction_fact_count(extraction: &SchemaRagApiDocExtraction) -> usize {
    extraction.api_fields.len() + extraction.business_concepts.len() + extraction.join_candidates.len()
}

fn extraction_verified_fact_count(extraction: &SchemaRagApiDocExtraction) -> usize {
    extraction
        .api_fields
        .iter()
        .filter(|fact| fact.status == SchemaRagFactStatus::Verified)
        .count()
        + extraction
            .business_concepts
            .iter()
            .filter(|fact| fact.status == SchemaRagFactStatus::Verified)
            .count()
        + extraction
            .join_candidates
            .iter()
            .filter(|fact| fact.status == SchemaRagFactStatus::Verified)
            .count()
}

fn extraction_unresolved_fact_count(extraction: &SchemaRagApiDocExtraction) -> usize {
    extraction
        .api_fields
        .iter()
        .filter(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected))
        .count()
        + extraction
            .business_concepts
            .iter()
            .filter(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected))
            .count()
        + extraction
            .join_candidates
            .iter()
            .filter(|fact| matches!(fact.status, SchemaRagFactStatus::Unresolved | SchemaRagFactStatus::Rejected))
            .count()
}

fn api_doc_extraction_fact_document_ids(extraction: &SchemaRagApiDocExtraction) -> Vec<String> {
    extraction
        .api_fields
        .iter()
        .map(|fact| fact.id.as_str())
        .chain(extraction.business_concepts.iter().map(|fact| fact.id.as_str()))
        .chain(extraction.join_candidates.iter().map(|fact| fact.id.as_str()))
        .map(|id| format!("api-doc-fact:{id}"))
        .collect()
}

fn is_imported_api_doc_document(
    doc: &SchemaRagDocument,
    imported_source_ids: &HashSet<String>,
    old_fact_document_ids: &HashSet<String>,
) -> bool {
    match doc.kind {
        SchemaRagDocumentKind::ApiDoc => imported_source_ids.contains(&doc.table),
        SchemaRagDocumentKind::ApiDocFact => {
            imported_source_ids.contains(&doc.table) || old_fact_document_ids.contains(&doc.id)
        }
        SchemaRagDocumentKind::Table | SchemaRagDocumentKind::Column => false,
    }
}

async fn load_api_doc_chunk_count(docs_dir: &Path) -> Result<usize, String> {
    let mut entries = match tokio::fs::read_dir(docs_dir).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err.to_string()),
    };
    let mut chunks = 0usize;
    while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let bytes = tokio::fs::read(entry.path()).await.map_err(|err| err.to_string())?;
        let doc: NormalizedApiDoc = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
        chunks += doc.sections.len();
    }
    Ok(chunks)
}

async fn load_api_doc_documents(index_dir: &Path, schema: &str) -> Result<Vec<SchemaRagDocument>, String> {
    let docs_dir = index_dir.join("api-docs");
    let mut entries = match tokio::fs::read_dir(&docs_dir).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.to_string()),
    };
    let mut documents = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let bytes = tokio::fs::read(entry.path()).await.map_err(|err| err.to_string())?;
        let doc: NormalizedApiDoc = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
        documents.extend(build_api_doc_documents(schema, &doc));
    }
    documents.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(documents)
}

fn is_markdown_path(path: &str) -> bool {
    let extension = Path::new(path).extension().and_then(|ext| ext.to_str()).unwrap_or_default();
    extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
}

fn schema_fingerprint(tables: &[SchemaRagTableMetadata]) -> Result<String, String> {
    let bytes = serde_json::to_vec(tables).map_err(|err| err.to_string())?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

pub fn normalize_markdown_api_doc(
    source_id: &str,
    source_path: &str,
    markdown: &str,
) -> Result<NormalizedApiDoc, String> {
    let markdown = markdown.trim();
    if markdown.is_empty() {
        return Err("API document content is empty".to_string());
    }
    let content_hash = sha256_hex(markdown.as_bytes());
    Ok(NormalizedApiDoc {
        source_id: source_id.to_string(),
        source_path: source_path.to_string(),
        source_kind: KnowledgeSourceKind::ApiDoc,
        original_format: "markdown".to_string(),
        converter: "builtin-markdown".to_string(),
        content_hash,
        markdown: markdown.to_string(),
        sections: split_markdown_sections(markdown, source_id),
    })
}

pub fn validate_api_doc_extraction(
    mut extraction: SchemaRagApiDocExtraction,
    schema: &str,
    tables: &[SchemaRagTableMetadata],
) -> SchemaRagApiDocExtraction {
    for field in &mut extraction.api_fields {
        let target_schema = fact_schema(field.candidate_schema.as_deref(), schema);
        field.candidate_schema = Some(target_schema.clone());
        field.status = validate_column_target_status(
            &target_schema,
            field.candidate_table.as_deref(),
            field.candidate_column.as_deref(),
            field.confidence,
            tables,
        );
    }

    for concept in &mut extraction.business_concepts {
        let target_schema = fact_schema(concept.candidate_schema.as_deref(), schema);
        concept.candidate_schema = Some(target_schema.clone());
        concept.status = if concept.candidate_column.as_deref().filter(|column| !column.trim().is_empty()).is_some() {
            validate_column_target_status(
                &target_schema,
                concept.candidate_table.as_deref(),
                concept.candidate_column.as_deref(),
                concept.confidence,
                tables,
            )
        } else {
            validate_table_target_status(&target_schema, concept.candidate_table.as_deref(), concept.confidence, tables)
        };
    }

    for join in &mut extraction.join_candidates {
        join.left_schema = fact_schema(Some(&join.left_schema), schema);
        join.right_schema = fact_schema(Some(&join.right_schema), schema);
        join.status = validate_join_candidate_status(join, tables);
    }

    extraction.status = summarize_api_doc_extraction_status(&extraction);
    extraction
}

fn fact_schema(candidate_schema: Option<&str>, default_schema: &str) -> String {
    candidate_schema
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_schema)
        .to_string()
}

fn validate_table_target_status(
    schema: &str,
    table: Option<&str>,
    confidence: f32,
    tables: &[SchemaRagTableMetadata],
) -> SchemaRagFactStatus {
    let Some(table) = table.map(str::trim).filter(|value| !value.is_empty()) else {
        return SchemaRagFactStatus::Unresolved;
    };
    if find_schema_table(tables, schema, table).is_none() {
        return SchemaRagFactStatus::Unresolved;
    }
    fact_status_for_existing_target(confidence)
}

fn validate_column_target_status(
    schema: &str,
    table: Option<&str>,
    column: Option<&str>,
    confidence: f32,
    tables: &[SchemaRagTableMetadata],
) -> SchemaRagFactStatus {
    let Some(table) = table.map(str::trim).filter(|value| !value.is_empty()) else {
        return SchemaRagFactStatus::Unresolved;
    };
    let Some(column) = column.map(str::trim).filter(|value| !value.is_empty()) else {
        return SchemaRagFactStatus::Unresolved;
    };
    let Some(table) = find_schema_table(tables, schema, table) else {
        return SchemaRagFactStatus::Unresolved;
    };
    if !table.columns.iter().any(|candidate| candidate.name.eq_ignore_ascii_case(column)) {
        return SchemaRagFactStatus::Unresolved;
    }
    fact_status_for_existing_target(confidence)
}

fn validate_join_candidate_status(join: &SchemaRagJoinCandidateFact, tables: &[SchemaRagTableMetadata]) -> SchemaRagFactStatus {
    if join.left_columns.len() != join.right_columns.len() {
        return SchemaRagFactStatus::Rejected;
    }
    if join.left_columns.is_empty() {
        return SchemaRagFactStatus::Unresolved;
    }
    let Some(left) = find_schema_table(tables, &join.left_schema, &join.left_table) else {
        return SchemaRagFactStatus::Unresolved;
    };
    let Some(right) = find_schema_table(tables, &join.right_schema, &join.right_table) else {
        return SchemaRagFactStatus::Unresolved;
    };
    if !join.left_columns.iter().all(|column| table_has_column(left, column))
        || !join.right_columns.iter().all(|column| table_has_column(right, column))
    {
        return SchemaRagFactStatus::Unresolved;
    }
    fact_status_for_existing_target(join.confidence)
}

fn fact_status_for_existing_target(confidence: f32) -> SchemaRagFactStatus {
    if confidence < 0.5 {
        SchemaRagFactStatus::Rejected
    } else if confidence < 0.75 {
        SchemaRagFactStatus::Candidate
    } else {
        SchemaRagFactStatus::Verified
    }
}

fn find_schema_table<'a>(
    tables: &'a [SchemaRagTableMetadata],
    schema: &str,
    table: &str,
) -> Option<&'a SchemaRagTableMetadata> {
    tables.iter().find(|candidate| candidate.schema == schema && candidate.name.eq_ignore_ascii_case(table))
}

fn table_has_column(table: &SchemaRagTableMetadata, column: &str) -> bool {
    let column = column.trim();
    !column.is_empty() && table.columns.iter().any(|candidate| candidate.name.eq_ignore_ascii_case(column))
}

fn split_markdown_sections(markdown: &str, source_id: &str) -> Vec<NormalizedApiDocSection> {
    let mut title_stack: Vec<String> = Vec::new();
    let mut current_title_path: Vec<String> = Vec::new();
    let mut current_lines: Vec<String> = Vec::new();
    let mut sections = Vec::new();

    for line in markdown.lines() {
        if let Some((level, title)) = markdown_heading(line) {
            push_markdown_section(source_id, &mut sections, &current_title_path, &mut current_lines);
            title_stack.truncate(level.saturating_sub(1));
            title_stack.push(title.to_string());
            current_title_path = title_stack.clone();
            continue;
        }
        current_lines.push(line.to_string());
    }
    push_markdown_section(source_id, &mut sections, &current_title_path, &mut current_lines);
    sections
}

fn push_markdown_section(
    source_id: &str,
    sections: &mut Vec<NormalizedApiDocSection>,
    title_path: &[String],
    lines: &mut Vec<String>,
) {
    let text = lines.join("\n").trim().to_string();
    lines.clear();
    if text.is_empty() {
        return;
    }
    for chunk in split_api_doc_section_text(&text) {
        let section_index = sections.len() + 1;
        sections.push(NormalizedApiDocSection {
            id: format!("{source_id}#section-{section_index}"),
            title_path: title_path.to_vec(),
            text: chunk,
            page: None,
        });
    }
}

fn split_api_doc_section_text(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.chars().count() <= API_DOC_SECTION_MAX_CHARS {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for line in text.lines() {
        let line = line.trim_end();
        if line.chars().count() > API_DOC_SECTION_MAX_CHARS {
            push_api_doc_chunk(&mut chunks, &mut current);
            chunks.extend(split_long_api_doc_line(line));
            continue;
        }

        let additional = line.chars().count() + usize::from(!current.is_empty());
        if !current.is_empty() && current.chars().count() + additional > API_DOC_SECTION_TARGET_CHARS {
            push_api_doc_chunk(&mut chunks, &mut current);
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }

    push_api_doc_chunk(&mut chunks, &mut current);
    chunks
}

fn push_api_doc_chunk(chunks: &mut Vec<String>, current: &mut String) {
    let chunk = current.trim();
    if chunk.is_empty() {
        current.clear();
        return;
    }
    chunks.push(chunk.to_string());
    let overlap = trailing_chars(chunk, API_DOC_SECTION_OVERLAP_CHARS);
    current.clear();
    if !overlap.trim().is_empty() {
        current.push_str(overlap.trim_start());
    }
}

fn split_long_api_doc_line(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + API_DOC_SECTION_MAX_CHARS).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        if !chunk.trim().is_empty() {
            chunks.push(chunk);
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(API_DOC_SECTION_OVERLAP_CHARS);
    }
    chunks
}

fn trailing_chars(text: &str, max_chars: usize) -> &str {
    let mut indices: Vec<usize> = text.char_indices().map(|(index, _)| index).collect();
    indices.push(text.len());
    let char_count = indices.len().saturating_sub(1);
    let start_char = char_count.saturating_sub(max_chars);
    &text[indices[start_char]..]
}

fn markdown_heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = trimmed.get(hashes..)?.trim();
    if rest.is_empty() {
        return None;
    }
    Some((hashes, rest))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn sanitize_path_segment(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "_".to_string();
    }
    let sanitized: String = trimmed
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') { ch } else { '_' })
        .collect();
    if sanitized.is_empty() {
        "_".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread::JoinHandle;
    use std::time::Duration;

    fn fake_table() -> SchemaRagTableMetadata {
        SchemaRagTableMetadata {
            schema: "public".to_string(),
            name: "mc_birth_apply".to_string(),
            table_type: "TABLE".to_string(),
            comment: Some("出生医学证明申请".to_string()),
            ddl: None,
            columns: vec![
                SchemaRagColumnMetadata {
                    name: "id".to_string(),
                    data_type: "bigint".to_string(),
                    is_nullable: false,
                    is_primary_key: true,
                    column_default: None,
                    comment: None,
                },
                SchemaRagColumnMetadata {
                    name: "mother_name".to_string(),
                    data_type: "varchar".to_string(),
                    is_nullable: true,
                    is_primary_key: false,
                    column_default: None,
                    comment: Some("母亲姓名".to_string()),
                },
                SchemaRagColumnMetadata {
                    name: "apply_status".to_string(),
                    data_type: "varchar".to_string(),
                    is_nullable: true,
                    is_primary_key: false,
                    column_default: None,
                    comment: Some("申请状态".to_string()),
                },
            ],
            indexes: vec![SchemaRagIndexMetadata {
                name: "idx_apply_status".to_string(),
                columns: vec!["apply_status".to_string()],
                is_unique: false,
                is_primary: false,
                index_type: None,
                comment: None,
            }],
            foreign_keys: vec![SchemaRagForeignKeyMetadata {
                name: "fk_hospital".to_string(),
                column: "hospital_id".to_string(),
                ref_schema: Some("public".to_string()),
                ref_table: "bd_hospital".to_string(),
                ref_column: "id".to_string(),
            }],
        }
    }

    fn fake_config() -> SchemaRagConfig {
        SchemaRagConfig {
            embedding_provider: "openai-compatible".to_string(),
            embedding_endpoint: "https://ai.gitee.com/v1".to_string(),
            embedding_model: "Qwen3-Embedding-0.6B".to_string(),
            embedding_api_key: String::new(),
            embedding_dimension: 1024,
            embedding_batch_size: 1,
            embedding_concurrency: 4,
            rerank_provider: "none".to_string(),
            rerank_endpoint: String::new(),
            rerank_model: String::new(),
            rerank_api_key: String::new(),
            proxy_enabled: false,
            proxy_url: String::new(),
        }
    }

    fn fake_manifest(table_count: usize, column_count: usize) -> SchemaRagManifest {
        SchemaRagManifest {
            connection_id: "conn".to_string(),
            database: "main".to_string(),
            schema: "public".to_string(),
            db_type: "sqlite".to_string(),
            embedding_provider: "openai-compatible".to_string(),
            embedding_endpoint: "http://127.0.0.1".to_string(),
            embedding_model: "fake-embedding".to_string(),
            embedding_dimension: 3,
            rerank_provider: "none".to_string(),
            analyzed_at: DateTime::parse_from_rfc3339("2026-05-31T00:00:00Z").unwrap().with_timezone(&Utc),
            table_count,
            column_count,
            index_count: 0,
            foreign_key_count: 0,
            schema_fingerprint: "fake".to_string(),
            table_units: Vec::new(),
            api_doc_sources: Vec::new(),
            api_doc_chunk_count: 0,
        }
    }

    fn kuzu_count(graph_path: &Path, query: &str) -> i64 {
        let database = kuzu::Database::new(graph_path.to_str().unwrap(), kuzu::SystemConfig::default()).unwrap();
        let connection = kuzu::Connection::new(&database).unwrap();
        let mut result = connection.query(query).unwrap();
        let row = result.next().unwrap();
        match row.first().unwrap() {
            kuzu::Value::Int64(value) => *value,
            other => panic!("unexpected count value: {other:?}"),
        }
    }

    fn spawn_embedding_server(embedding: Vec<f32>) -> (String, std::sync::Arc<AtomicUsize>, JoinHandle<()>) {
        spawn_embedding_server_with_limit(embedding, 1)
    }

    fn spawn_embedding_server_with_limit(
        embedding: Vec<f32>,
        request_limit: usize,
    ) -> (String, std::sync::Arc<AtomicUsize>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let requests = std::sync::Arc::new(AtomicUsize::new(0));
        let requests_for_thread = std::sync::Arc::clone(&requests);
        let handle = std::thread::spawn(move || {
            for _ in 0..request_limit {
                let (mut stream, _) = listener.accept().unwrap();
                requests_for_thread.fetch_add(1, Ordering::SeqCst);
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut buffer = Vec::new();
                let mut chunk = [0; 1024];
                let mut content_length = None;
                loop {
                    let read = stream.read(&mut chunk).unwrap();
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    let request_text = String::from_utf8_lossy(&buffer);
                    if content_length.is_none() {
                        if let Some(header_end) = request_text.find("\r\n\r\n") {
                            content_length = request_text[..header_end]
                                .lines()
                                .find_map(|line| {
                                    line.strip_prefix("content-length: ")
                                        .or_else(|| line.strip_prefix("Content-Length: "))
                                })
                                .and_then(|value| value.trim().parse::<usize>().ok());
                        }
                    }
                    if let (Some(header_end), Some(length)) = (request_text.find("\r\n\r\n"), content_length) {
                        let body_start = header_end + 4;
                        if buffer.len() >= body_start + length {
                            break;
                        }
                    }
                }
                let body = serde_json::json!({
                    "data": [
                        { "embedding": embedding }
                    ]
                })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (format!("http://{address}"), requests, handle)
    }

    #[test]
    fn table_document_includes_comments_columns_indexes_and_foreign_keys() {
        let table = fake_table();

        let docs = build_schema_documents(&[table]);

        let table_doc = docs.iter().find(|doc| doc.kind == SchemaRagDocumentKind::Table).unwrap();
        assert!(table_doc.text_for_embedding.contains("表: mc_birth_apply"));
        assert!(table_doc.text_for_embedding.contains("注释: 出生医学证明申请"));
        assert!(table_doc.text_for_embedding.contains("字段: id, mother_name, apply_status"));
        assert!(table_doc.text_for_embedding.contains("索引: idx_apply_status(apply_status)"));
        assert!(table_doc.text_for_embedding.contains("外键: hospital_id -> bd_hospital.id"));
    }

    #[test]
    fn column_document_keeps_table_context_when_comment_is_missing() {
        let table = fake_table();

        let docs = build_schema_documents(&[table]);

        let id_doc = docs
            .iter()
            .find(|doc| doc.kind == SchemaRagDocumentKind::Column && doc.column.as_deref() == Some("id"))
            .unwrap();
        assert!(id_doc.text_for_embedding.contains("字段: mc_birth_apply.id"));
        assert!(id_doc.text_for_embedding.contains("所属表: mc_birth_apply"));
        assert!(id_doc.text_for_embedding.contains("表注释: 出生医学证明申请"));
        assert!(id_doc.text_for_embedding.contains("类型: bigint"));
        assert!(id_doc.text_for_embedding.contains("主键: true"));
    }

    #[test]
    fn api_doc_documents_use_markdown_sections_as_embedding_units() {
        let doc = normalize_markdown_api_doc(
            "api-doc:birth",
            "/docs/birth.md",
            r#"# 出生证接口

## 申请列表

返回 apply_status 和 mother_name 字段。
"#,
        )
        .unwrap();

        let docs = build_api_doc_documents("public", &doc);

        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].kind, SchemaRagDocumentKind::ApiDoc);
        assert_eq!(docs[0].schema, "public");
        assert_eq!(docs[0].table, "api-doc:birth");
        assert!(docs[0].text_for_embedding.contains("接口文档: /docs/birth.md"));
        assert!(docs[0].text_for_embedding.contains("申请列表"));
        assert!(docs[0].text_for_embedding.contains("apply_status"));
    }

    #[test]
    fn api_doc_vector_hit_boosts_tables_mentioned_by_imported_docs() {
        let table = fake_table();
        let doc = SchemaRagDocument {
            id: "api-doc:birth:section-1".to_string(),
            kind: SchemaRagDocumentKind::ApiDoc,
            schema: "public".to_string(),
            table: "api-doc:birth".to_string(),
            column: Some("出生证接口 / 申请列表".to_string()),
            data_type: Some("markdown".to_string()),
            text_for_embedding: "接口文档: 出生证申请列表 返回字段 apply_status mother_name".to_string(),
            embedding: vec![1.0, 0.0, 0.0],
        };

        let result = search_documents_vector(
            "public",
            "出生证申请列表",
            &[1.0, 0.0, 0.0],
            &[doc],
            &[table],
            &SchemaRagEnrichment::default(),
            5,
            "2026-06-03T00:00:00Z",
        );

        assert_eq!(result.tables.len(), 1);
        assert_eq!(result.tables[0].name, "mc_birth_apply");
        assert!(result.tables[0].reason.contains("接口文档命中"));
        assert!(result.tables[0].matched_columns.iter().any(|column| column.name == "apply_status"));
    }

    #[test]
    fn table_index_units_include_table_and_column_document_ids() {
        let table = fake_table();
        let units = build_table_index_units(std::slice::from_ref(&table), Utc::now()).unwrap();

        assert_eq!(units.len(), 1);
        assert_eq!(units[0].schema, "public");
        assert_eq!(units[0].table, "mc_birth_apply");
        assert_eq!(units[0].column_count, 3);
        assert_eq!(units[0].index_count, 1);
        assert_eq!(units[0].foreign_key_count, 1);
        assert_eq!(
            units[0].document_ids,
            vec![
                "table:public:mc_birth_apply".to_string(),
                "column:public:mc_birth_apply.id".to_string(),
                "column:public:mc_birth_apply.mother_name".to_string(),
                "column:public:mc_birth_apply.apply_status".to_string(),
            ]
        );
        assert_eq!(units[0].fingerprint, table_fingerprint(&table).unwrap());
    }

    #[test]
    fn table_diff_detects_added_changed_removed_and_unchanged_tables() {
        let unchanged = fake_table();
        let mut changed_old = fake_table();
        changed_old.name = "changed_table".to_string();
        changed_old.comment = Some("old comment".to_string());
        let mut changed_new = changed_old.clone();
        changed_new.comment = Some("new comment".to_string());
        let mut removed = fake_table();
        removed.name = "removed_table".to_string();
        let mut added = fake_table();
        added.name = "added_table".to_string();

        let old_units = build_table_index_units(&[unchanged.clone(), changed_old, removed], Utc::now()).unwrap();
        let changes = diff_table_index_units(&old_units, &[unchanged, changed_new, added]).unwrap();

        let by_table: HashMap<String, SchemaRagTableChangeKind> =
            changes.into_iter().map(|change| (change.table, change.kind)).collect();
        assert_eq!(by_table.get("mc_birth_apply"), Some(&SchemaRagTableChangeKind::Unchanged));
        assert_eq!(by_table.get("changed_table"), Some(&SchemaRagTableChangeKind::Changed));
        assert_eq!(by_table.get("removed_table"), Some(&SchemaRagTableChangeKind::Removed));
        assert_eq!(by_table.get("added_table"), Some(&SchemaRagTableChangeKind::Added));
    }

    #[test]
    fn table_change_summary_counts_each_kind() {
        let changes = vec![
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "added_table".to_string(),
                kind: SchemaRagTableChangeKind::Added,
                old_fingerprint: None,
                new_fingerprint: Some("new".to_string()),
            },
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "changed_table".to_string(),
                kind: SchemaRagTableChangeKind::Changed,
                old_fingerprint: Some("old".to_string()),
                new_fingerprint: Some("new".to_string()),
            },
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "removed_table".to_string(),
                kind: SchemaRagTableChangeKind::Removed,
                old_fingerprint: Some("old".to_string()),
                new_fingerprint: None,
            },
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "same_table".to_string(),
                kind: SchemaRagTableChangeKind::Unchanged,
                old_fingerprint: Some("same".to_string()),
                new_fingerprint: Some("same".to_string()),
            },
        ];

        let summary = summarize_table_changes(&changes);

        assert_eq!(summary.added, 1);
        assert_eq!(summary.changed, 1);
        assert_eq!(summary.removed, 1);
        assert_eq!(summary.unchanged, 1);
        assert_eq!(summary.total, 4);
    }

    #[test]
    fn normalize_markdown_api_doc_splits_sections_by_heading_path() {
        let doc = normalize_markdown_api_doc(
            "doc:order-api",
            "/docs/order-api.md",
            r#"# 订单模块

## 退款列表接口

GET /api/refund/list

### 响应字段

| 字段 | 说明 |
| --- | --- |
| refundNo | 退款单号 |
"#,
        )
        .unwrap();

        assert_eq!(doc.source_id, "doc:order-api");
        assert_eq!(doc.original_format, "markdown");
        assert_eq!(doc.converter, "builtin-markdown");
        assert_eq!(doc.sections.len(), 2);
        assert_eq!(doc.sections[0].title_path, vec!["订单模块", "退款列表接口"]);
        assert!(doc.sections[0].text.contains("GET /api/refund/list"));
        assert_eq!(doc.sections[1].title_path, vec!["订单模块", "退款列表接口", "响应字段"]);
        assert!(doc.sections[1].text.contains("refundNo"));
        assert_eq!(
            doc.content_hash,
            normalize_markdown_api_doc("doc:order-api-copy", "/copy.md", doc.markdown.as_str()).unwrap().content_hash
        );
    }

    #[test]
    fn normalize_markdown_api_doc_rejects_empty_content() {
        let error = normalize_markdown_api_doc("doc:empty", "/docs/empty.md", " \n\t ").unwrap_err();

        assert_eq!(error, "API document content is empty");
    }

    #[test]
    fn normalize_markdown_api_doc_splits_oversized_sections_by_chunk_budget() {
        let rows = (0..120)
            .map(|index| format!("| field_{index} | 字段说明 {index} | table_{index}.column_{index} |"))
            .collect::<Vec<_>>()
            .join("\n");
        let markdown = format!(
            r#"# 接口文档

## 超长响应字段

| 字段 | 说明 | 数据库字段 |
| --- | --- | --- |
{rows}
"#
        );

        let doc = normalize_markdown_api_doc("doc:large-table", "/docs/large-table.md", &markdown).unwrap();

        assert!(doc.sections.len() > 1);
        assert!(doc.sections.iter().all(|section| section.text.chars().count() <= API_DOC_SECTION_MAX_CHARS));
        assert!(doc.sections.iter().all(|section| section.title_path == vec!["接口文档", "超长响应字段"]));
        assert!(doc.sections[0].text.contains("field_0"));
    }

    #[test]
    fn api_doc_source_defaults_extraction_fields_for_old_manifest_json() {
        let manifest: SchemaRagManifest = serde_json::from_value(serde_json::json!({
            "connectionId": "conn",
            "database": "main",
            "schema": "public",
            "dbType": "sqlite",
            "embeddingProvider": "openai-compatible",
            "embeddingEndpoint": "http://127.0.0.1",
            "embeddingModel": "fake-embedding",
            "embeddingDimension": 3,
            "rerankProvider": "none",
            "analyzedAt": "2026-05-31T00:00:00Z",
            "tableCount": 1,
            "columnCount": 1,
            "indexCount": 0,
            "foreignKeyCount": 0,
            "schemaFingerprint": "fake",
            "apiDocSources": [{
                "sourceId": "api-doc:birth",
                "sourcePath": "/docs/birth.md",
                "originalFormat": "markdown",
                "converter": "builtin-markdown",
                "contentHash": "hash",
                "sectionCount": 2,
                "importedAt": "2026-06-03T00:00:00Z"
            }]
        }))
        .unwrap();

        let source = &manifest.api_doc_sources[0];
        assert_eq!(source.extraction_status, ApiDocExtractionStatus::Pending);
        assert_eq!(source.extracted_at, None);
        assert_eq!(source.api_field_count, 0);
        assert_eq!(source.business_concept_count, 0);
        assert_eq!(source.join_candidate_count, 0);
        assert_eq!(source.unresolved_fact_count, 0);
    }

    #[test]
    fn validate_api_doc_extraction_marks_field_mappings_by_schema_evidence() {
        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Extracted,
            api_fields: vec![
                SchemaRagApiFieldFact {
                    id: "field:verified".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "applyStatus".to_string(),
                    meaning: "申请状态".to_string(),
                    candidate_schema: None,
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("apply_status".to_string()),
                    status: SchemaRagFactStatus::Candidate,
                    confidence: 0.86,
                    evidence: "表格写明 applyStatus 对应 apply_status".to_string(),
                },
                SchemaRagApiFieldFact {
                    id: "field:candidate".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "motherName".to_string(),
                    meaning: "母亲姓名".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("mother_name".to_string()),
                    status: SchemaRagFactStatus::Unresolved,
                    confidence: 0.62,
                    evidence: "字段名相似".to_string(),
                },
                SchemaRagApiFieldFact {
                    id: "field:missing-column".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "certNo".to_string(),
                    meaning: "证件编号".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("cert_no".to_string()),
                    status: SchemaRagFactStatus::Candidate,
                    confidence: 0.9,
                    evidence: "文档写了 certNo".to_string(),
                },
                SchemaRagApiFieldFact {
                    id: "field:low-confidence".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "unknown".to_string(),
                    meaning: "未知字段".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("apply_status".to_string()),
                    status: SchemaRagFactStatus::Verified,
                    confidence: 0.4,
                    evidence: "低置信度猜测".to_string(),
                },
            ],
            business_concepts: vec![],
            join_candidates: vec![],
            errors: vec![],
        };

        let validated = validate_api_doc_extraction(extraction, "public", &[fake_table()]);

        assert_eq!(validated.api_fields[0].status, SchemaRagFactStatus::Verified);
        assert_eq!(validated.api_fields[0].candidate_schema.as_deref(), Some("public"));
        assert_eq!(validated.api_fields[1].status, SchemaRagFactStatus::Candidate);
        assert_eq!(validated.api_fields[2].status, SchemaRagFactStatus::Unresolved);
        assert_eq!(validated.api_fields[3].status, SchemaRagFactStatus::Rejected);
    }

    #[test]
    fn validate_api_doc_extraction_validates_multi_column_join_candidates() {
        let mut left = fake_table();
        left.name = "left_table".to_string();
        left.columns.push(SchemaRagColumnMetadata {
            name: "tenant_id".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            column_default: None,
            comment: Some("租户".to_string()),
        });
        let mut right = fake_table();
        right.name = "right_table".to_string();
        right.columns.push(SchemaRagColumnMetadata {
            name: "tenant_id".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            column_default: None,
            comment: Some("租户".to_string()),
        });
        right.columns.push(SchemaRagColumnMetadata {
            name: "apply_id".to_string(),
            data_type: "bigint".to_string(),
            is_nullable: false,
            is_primary_key: false,
            column_default: None,
            comment: Some("申请ID".to_string()),
        });

        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Extracted,
            api_fields: vec![],
            business_concepts: vec![],
            join_candidates: vec![
                SchemaRagJoinCandidateFact {
                    id: "join:verified".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    left_schema: "public".to_string(),
                    left_table: "left_table".to_string(),
                    left_columns: vec!["tenant_id".to_string(), "id".to_string()],
                    right_schema: "public".to_string(),
                    right_table: "right_table".to_string(),
                    right_columns: vec!["tenant_id".to_string(), "apply_id".to_string()],
                    relation: "租户内申请对应详情".to_string(),
                    status: SchemaRagFactStatus::Candidate,
                    confidence: 0.88,
                    evidence: "文档展示联合字段".to_string(),
                },
                SchemaRagJoinCandidateFact {
                    id: "join:mismatch".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    left_schema: "public".to_string(),
                    left_table: "left_table".to_string(),
                    left_columns: vec!["id".to_string()],
                    right_schema: "public".to_string(),
                    right_table: "right_table".to_string(),
                    right_columns: vec!["tenant_id".to_string(), "apply_id".to_string()],
                    relation: "字段数量不匹配".to_string(),
                    status: SchemaRagFactStatus::Verified,
                    confidence: 0.9,
                    evidence: "错误抽取".to_string(),
                },
            ],
            errors: vec![],
        };

        let validated = validate_api_doc_extraction(extraction, "public", &[left, right]);

        assert_eq!(validated.join_candidates[0].status, SchemaRagFactStatus::Verified);
        assert_eq!(validated.join_candidates[1].status, SchemaRagFactStatus::Rejected);
    }

    #[test]
    fn api_doc_fact_documents_embed_verified_and_candidate_facts() {
        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Extracted,
            api_fields: vec![
                SchemaRagApiFieldFact {
                    id: "field:verified".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "applyStatus".to_string(),
                    meaning: "申请状态".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("apply_status".to_string()),
                    status: SchemaRagFactStatus::Verified,
                    confidence: 0.86,
                    evidence: "表格写明 applyStatus 对应 apply_status".to_string(),
                },
                SchemaRagApiFieldFact {
                    id: "field:rejected".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "unknown".to_string(),
                    meaning: "未知".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("missing".to_string()),
                    status: SchemaRagFactStatus::Rejected,
                    confidence: 0.4,
                    evidence: "低置信度猜测".to_string(),
                },
            ],
            business_concepts: vec![],
            join_candidates: vec![],
            errors: vec![],
        };

        let docs = build_api_doc_fact_documents("public", &extraction);

        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].kind, SchemaRagDocumentKind::ApiDocFact);
        assert_eq!(docs[0].table, "mc_birth_apply");
        assert_eq!(docs[0].column.as_deref(), Some("apply_status"));
        assert!(docs[0].text_for_embedding.contains("接口字段: applyStatus"));
        assert!(docs[0].text_for_embedding.contains("候选映射: public.mc_birth_apply.apply_status"));
        assert!(docs[0].text_for_embedding.contains("状态: verified"));
        assert!(docs[0].text_for_embedding.contains("表格写明"));
    }

    #[test]
    fn graph_expansion_returns_facts_matching_table_and_column_seeds() {
        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Extracted,
            api_fields: vec![
                SchemaRagApiFieldFact {
                    id: "field:verified".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "applyStatus".to_string(),
                    meaning: "申请状态".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("apply_status".to_string()),
                    status: SchemaRagFactStatus::Verified,
                    confidence: 0.86,
                    evidence: "表格写明 applyStatus 对应 apply_status".to_string(),
                },
                SchemaRagApiFieldFact {
                    id: "field:candidate".to_string(),
                    source_id: "api-doc:birth".to_string(),
                    section_id: "api-doc:birth#section-1".to_string(),
                    name: "motherName".to_string(),
                    meaning: "母亲姓名".to_string(),
                    candidate_schema: Some("public".to_string()),
                    candidate_table: Some("mc_birth_apply".to_string()),
                    candidate_column: Some("mother_name".to_string()),
                    status: SchemaRagFactStatus::Candidate,
                    confidence: 0.66,
                    evidence: "字段名相似".to_string(),
                },
            ],
            business_concepts: vec![],
            join_candidates: vec![SchemaRagJoinCandidateFact {
                id: "join:verified".to_string(),
                source_id: "api-doc:birth".to_string(),
                section_id: "api-doc:birth#section-1".to_string(),
                left_schema: "public".to_string(),
                left_table: "mc_birth_apply".to_string(),
                left_columns: vec!["id".to_string()],
                right_schema: "public".to_string(),
                right_table: "mc_birth_detail".to_string(),
                right_columns: vec!["apply_id".to_string()],
                relation: "申请对应详情".to_string(),
                status: SchemaRagFactStatus::Verified,
                confidence: 0.8,
                evidence: "详情接口关联申请ID".to_string(),
            }],
            errors: vec![],
        };

        let result = expand_schema_graph_from_extractions(
            &[extraction],
            &[SchemaRagGraphSeed {
                kind: "column".to_string(),
                id: None,
                schema: Some("public".to_string()),
                table: Some("mc_birth_apply".to_string()),
                column: Some("apply_status".to_string()),
            }],
            true,
            10,
        );

        assert_eq!(result.verified_mappings.len(), 1);
        assert_eq!(result.verified_mappings[0].name, "applyStatus");
        assert!(result.candidate_mappings.is_empty());
        assert!(result.join_candidates.is_empty());
        assert!(result.source_evidence.iter().any(|line| line.contains("applyStatus")));
    }

    #[test]
    fn kuzu_graph_writes_verified_api_field_mapping_edges() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Extracted,
            api_fields: vec![SchemaRagApiFieldFact {
                id: "field:verified".to_string(),
                source_id: "api-doc:birth".to_string(),
                section_id: "api-doc:birth#section-1".to_string(),
                name: "applyStatus".to_string(),
                meaning: "申请状态".to_string(),
                candidate_schema: Some("public".to_string()),
                candidate_table: Some("mc_birth_apply".to_string()),
                candidate_column: Some("apply_status".to_string()),
                status: SchemaRagFactStatus::Verified,
                confidence: 0.86,
                evidence: "接口文档字段表写明 applyStatus 对应 apply_status".to_string(),
            }],
            business_concepts: Vec::new(),
            join_candidates: Vec::new(),
            errors: Vec::new(),
        };
        let graph_path = temp_dir.path().join("graph.kuzu");
        let stored = StoredSchemaRagIndex {
            manifest: fake_manifest(1, table.columns.len()),
            tables: vec![table],
            documents: Vec::new(),
            api_doc_extractions: vec![extraction],
        };

        write_kuzu_index_blocking(&graph_path, &stored).unwrap();

        assert_eq!(kuzu_count(&graph_path, "MATCH (f:ApiField) RETURN count(f) AS count"), 1);
        assert_eq!(
            kuzu_count(
                &graph_path,
                "MATCH (f:ApiField)-[r:API_FIELD_MAPS_TO_COLUMN]->(c:ColumnNode) RETURN count(r) AS count",
            ),
            1,
        );
        assert_eq!(
            kuzu_count(
                &graph_path,
                "MATCH (section:ApiDocSection)-[r:SECTION_DESCRIBES_COLUMN]->(c:ColumnNode) RETURN count(r) AS count",
            ),
            1,
        );
    }

    #[test]
    fn kuzu_graph_keeps_unresolved_api_field_without_mapping_edges() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let extraction = SchemaRagApiDocExtraction {
            source_id: "api-doc:birth".to_string(),
            extracted_at: "2026-06-03T00:00:00Z".to_string(),
            status: ApiDocExtractionStatus::Partial,
            api_fields: vec![SchemaRagApiFieldFact {
                id: "field:unresolved".to_string(),
                source_id: "api-doc:birth".to_string(),
                section_id: "api-doc:birth#section-1".to_string(),
                name: "unknownCode".to_string(),
                meaning: "接口文档中的未知编码".to_string(),
                candidate_schema: None,
                candidate_table: None,
                candidate_column: None,
                status: SchemaRagFactStatus::Unresolved,
                confidence: 0.2,
                evidence: "文档有字段，但当前 schema 中没有可靠匹配".to_string(),
            }],
            business_concepts: Vec::new(),
            join_candidates: Vec::new(),
            errors: Vec::new(),
        };
        let graph_path = temp_dir.path().join("graph.kuzu");
        let stored = StoredSchemaRagIndex {
            manifest: fake_manifest(1, table.columns.len()),
            tables: vec![table],
            documents: Vec::new(),
            api_doc_extractions: vec![extraction],
        };

        write_kuzu_index_blocking(&graph_path, &stored).unwrap();

        assert_eq!(kuzu_count(&graph_path, "MATCH (f:ApiField) RETURN count(f) AS count"), 1);
        assert_eq!(
            kuzu_count(
                &graph_path,
                "MATCH (f:ApiField)-[r:API_FIELD_MAPS_TO_COLUMN]->(c:ColumnNode) RETURN count(r) AS count",
            ),
            0,
        );
        assert_eq!(
            kuzu_count(
                &graph_path,
                "MATCH (section:ApiDocSection)-[r:SECTION_MENTIONS_FIELD]->(f:ApiField) RETURN count(r) AS count",
            ),
            1,
        );
    }

    #[test]
    fn field_search_promotes_owning_table_without_cross_scope_confusion() {
        let mut table = fake_table();
        table.schema = "public".to_string();
        let other_table = SchemaRagTableMetadata {
            schema: "archive".to_string(),
            name: "old_birth_apply".to_string(),
            table_type: "TABLE".to_string(),
            comment: None,
            ddl: None,
            columns: vec![SchemaRagColumnMetadata {
                name: "archive_apply_status".to_string(),
                data_type: "varchar".to_string(),
                is_nullable: true,
                is_primary_key: false,
                column_default: None,
                comment: Some("归档状态".to_string()),
            }],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let docs = build_schema_documents(&[table, other_table]);

        let result = search_documents_lexical(
            "public",
            "出生证申请状态和母亲姓名",
            &docs,
            &[fake_table()],
            5,
            "2026-05-31T00:00:00Z",
        );

        assert_eq!(result.tables[0].schema, "public");
        assert_eq!(result.tables[0].name, "mc_birth_apply");
        let columns: Vec<&str> = result.tables[0].matched_columns.iter().map(|column| column.name.as_str()).collect();
        assert!(columns.contains(&"apply_status"));
        assert!(columns.contains(&"mother_name"));
    }

    #[test]
    fn vector_search_promotes_field_document_to_owning_table() {
        let table = fake_table();
        let mut docs = build_schema_documents(&[table.clone()]);
        for doc in &mut docs {
            doc.embedding = match doc.column.as_deref() {
                Some("apply_status") => vec![1.0, 0.0, 0.0],
                Some("mother_name") => vec![0.0, 1.0, 0.0],
                _ => vec![0.0, 0.0, 1.0],
            };
        }

        let result = search_documents_vector(
            "public",
            "申请状态怎么查",
            &[1.0, 0.0, 0.0],
            &docs,
            &[table],
            &SchemaRagEnrichment::default(),
            5,
            "2026-05-31T00:00:00Z",
        );

        assert_eq!(result.tables.len(), 1);
        assert_eq!(result.tables[0].name, "mc_birth_apply");
        assert!(result.tables[0].reason.contains("向量命中字段 apply_status"));
        assert_eq!(result.tables[0].matched_columns[0].name, "apply_status");
        assert!(result.tables[0].matched_columns[0].reason.contains("向量命中字段 apply_status"));
    }

    #[test]
    fn vector_column_search_returns_lightweight_columns_for_one_table() {
        let table = fake_table();
        let other_table = SchemaRagTableMetadata {
            schema: "public".to_string(),
            name: "other_apply".to_string(),
            table_type: "TABLE".to_string(),
            comment: None,
            ddl: None,
            columns: vec![SchemaRagColumnMetadata {
                name: "apply_status".to_string(),
                data_type: "varchar".to_string(),
                is_nullable: true,
                is_primary_key: false,
                column_default: None,
                comment: Some("其他状态".to_string()),
            }],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let tables = vec![table, other_table];
        let mut docs = build_schema_documents(&tables);
        for doc in &mut docs {
            doc.embedding = match (doc.table.as_str(), doc.column.as_deref()) {
                ("mc_birth_apply", Some("apply_status")) => vec![1.0, 0.0, 0.0],
                ("mc_birth_apply", Some("mother_name")) => vec![0.8, 0.1, 0.0],
                ("other_apply", Some("archive_apply_status")) => vec![1.0, 0.0, 0.0],
                _ => vec![0.0, 0.0, 1.0],
            };
        }

        let result = search_table_columns_vector(
            "public",
            "mc_birth_apply",
            "申请状态",
            &[1.0, 0.0, 0.0],
            &docs,
            &tables,
            &SchemaRagEnrichment::default(),
            2,
            true,
            "2026-05-31T00:00:00Z",
        );

        assert_eq!(result.schema, "public");
        assert_eq!(result.table, "mc_birth_apply");
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.columns[0].name, "apply_status");
        assert!(result.columns[0].data_type.is_none());
        assert_eq!(result.columns[0].primary_key, Some(false));
        assert!(result.columns[0].reason.contains("向量命中字段 apply_status"));
        assert!(result.columns.iter().all(|column| column.name != "archive_apply_status"));
        assert!(result.truncated);
    }

    #[test]
    fn table_alias_does_not_boost_every_column_in_column_search() {
        let table = fake_table();
        let mut docs = build_schema_documents(std::slice::from_ref(&table));
        for doc in &mut docs {
            doc.embedding = vec![0.0, 0.0, 1.0];
        }
        let enrichment = SchemaRagEnrichment {
            aliases: vec![SchemaRagBusinessAlias {
                term: "birth-cert-business-alias".to_string(),
                target_kind: "table".to_string(),
                schema: "public".to_string(),
                table: "mc_birth_apply".to_string(),
                column: None,
                source: "user_confirmed".to_string(),
                confidence: 1.0,
                note: None,
            }],
        };

        let result = search_table_columns_vector(
            "public",
            "mc_birth_apply",
            "birth-cert-business-alias",
            &[1.0, 0.0, 0.0],
            &docs,
            &[table],
            &enrichment,
            5,
            true,
            "2026-05-31T00:00:00Z",
        );

        assert!(result.columns.is_empty());
    }

    #[test]
    fn merge_refreshed_table_documents_replaces_only_selected_table_documents() {
        let mut current_table = fake_table();
        current_table.columns.push(SchemaRagColumnMetadata {
            name: "apply_no".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            column_default: None,
            comment: Some("申请编号".to_string()),
        });
        let other_table = SchemaRagTableMetadata {
            schema: "public".to_string(),
            name: "other_apply".to_string(),
            table_type: "TABLE".to_string(),
            comment: Some("其他申请".to_string()),
            ddl: None,
            columns: vec![SchemaRagColumnMetadata {
                name: "id".to_string(),
                data_type: "varchar".to_string(),
                is_nullable: false,
                is_primary_key: true,
                column_default: None,
                comment: None,
            }],
            indexes: vec![],
            foreign_keys: vec![],
        };
        let old_tables = vec![fake_table(), other_table.clone()];
        let mut old_documents = build_schema_documents(&old_tables);
        for doc in &mut old_documents {
            doc.embedding = if doc.table == "other_apply" { vec![9.0, 9.0, 9.0] } else { vec![1.0, 1.0, 1.0] };
        }
        let mut refreshed_documents = build_schema_documents(std::slice::from_ref(&current_table));
        for doc in &mut refreshed_documents {
            doc.embedding = vec![2.0, 2.0, 2.0];
        }

        let merged = merge_refreshed_table_documents(&old_documents, refreshed_documents, &["mc_birth_apply".to_string()]);

        assert!(merged.iter().any(|doc| doc.table == "mc_birth_apply" && doc.column.as_deref() == Some("apply_no")));
        assert!(merged.iter().any(|doc| doc.table == "other_apply" && doc.embedding == vec![9.0, 9.0, 9.0]));
        assert!(merged
            .iter()
            .filter(|doc| doc.table == "mc_birth_apply")
            .all(|doc| doc.embedding == vec![2.0, 2.0, 2.0]));
    }

    #[test]
    fn changes_for_requested_tables_does_not_count_unselected_removed_tables() {
        let changes = vec![
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "mc_birth_apply".to_string(),
                kind: SchemaRagTableChangeKind::Changed,
                old_fingerprint: Some("old".to_string()),
                new_fingerprint: Some("new".to_string()),
            },
            SchemaRagTableChange {
                schema: "public".to_string(),
                table: "other_apply".to_string(),
                kind: SchemaRagTableChangeKind::Removed,
                old_fingerprint: Some("other".to_string()),
                new_fingerprint: None,
            },
        ];
        let requested_tables = HashSet::from(["mc_birth_apply".to_string()]);

        let summary = summarize_table_changes(&changes_for_requested_tables(&changes, &requested_tables));

        assert_eq!(summary.total, 1);
        assert_eq!(summary.changed, 1);
        assert_eq!(summary.removed, 0);
    }

    #[tokio::test]
    async fn search_schema_embeds_query_before_vector_search() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let mut docs = build_schema_documents(&[table.clone()]);
        for doc in &mut docs {
            doc.embedding = match doc.column.as_deref() {
                Some("apply_status") => vec![1.0, 0.0, 0.0],
                _ => vec![0.0, 0.0, 1.0],
            };
        }
        let index_dir = schema_index_dir(temp_dir.path(), "conn", "main", "public");
        tokio::fs::create_dir_all(&index_dir).await.unwrap();
        write_json_pretty(
            &index_dir.join("documents.json"),
            &StoredSchemaRagIndex {
                manifest: fake_manifest(1, table.columns.len()),
                tables: vec![table],
                documents: docs,
                api_doc_extractions: Vec::new(),
            },
        )
        .await
        .unwrap();
        let (endpoint, requests, handle) = spawn_embedding_server(vec![1.0, 0.0, 0.0]);
        let mut config = fake_config();
        config.embedding_endpoint = endpoint;
        config.embedding_model = "fake-embedding".to_string();
        config.embedding_dimension = 3;

        let result = search_schema(
            temp_dir.path(),
            SearchSchemaRagRequest {
                connection_id: "conn".to_string(),
                database: "main".to_string(),
                schema: "public".to_string(),
                query: "申请状态怎么查".to_string(),
                config,
                limit: Some(5),
            },
        )
        .await
        .unwrap();

        handle.join().unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        assert_eq!(result.tables[0].name, "mc_birth_apply");
        assert_eq!(result.tables[0].matched_columns[0].name, "apply_status");
    }

    #[tokio::test]
    async fn analyze_schema_writes_queryable_kuzu_graph_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let texts = build_schema_documents(std::slice::from_ref(&table)).len();
        let (endpoint, _requests, handle) = spawn_embedding_server_with_limit(vec![0.1, 0.2, 0.3], texts);
        let mut config = fake_config();
        config.embedding_endpoint = endpoint;
        config.embedding_model = "fake-embedding".to_string();
        config.embedding_dimension = 3;

        let response = analyze_schema(
            temp_dir.path(),
            AnalyzeSchemaRagRequest {
                scope: SchemaRagScope {
                    connection_id: "conn".to_string(),
                    database: "main".to_string(),
                    schema: "public".to_string(),
                    db_type: "sqlite".to_string(),
                },
                tables: vec![table],
                config,
            },
        )
        .await
        .unwrap();

        handle.join().unwrap();
        let graph_path = Path::new(&response.index_path).join("graph.kuzu");
        assert!(graph_path.is_file());
        let database = kuzu::Database::new(graph_path.to_str().unwrap(), kuzu::SystemConfig::default()).unwrap();
        let connection = kuzu::Connection::new(&database).unwrap();
        let mut result = connection.query("MATCH (d:SchemaDocument) RETURN count(d) AS count").unwrap();
        let row = result.next().unwrap();
        let count = match row.first().unwrap() {
            kuzu::Value::Int64(value) => *value,
            other => panic!("unexpected count value: {other:?}"),
        };
        assert_eq!(count, texts as i64);
    }

    #[tokio::test]
    async fn search_schema_reads_graph_when_documents_json_is_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let texts = build_schema_documents(std::slice::from_ref(&table)).len();
        let (endpoint, _requests, handle) = spawn_embedding_server_with_limit(vec![1.0, 0.0, 0.0], texts + 1);
        let mut config = fake_config();
        config.embedding_endpoint = endpoint;
        config.embedding_model = "fake-embedding".to_string();
        config.embedding_dimension = 3;

        let response = analyze_schema(
            temp_dir.path(),
            AnalyzeSchemaRagRequest {
                scope: SchemaRagScope {
                    connection_id: "conn".to_string(),
                    database: "main".to_string(),
                    schema: "public".to_string(),
                    db_type: "sqlite".to_string(),
                },
                tables: vec![table],
                config: config.clone(),
            },
        )
        .await
        .unwrap();
        tokio::fs::remove_file(Path::new(&response.index_path).join("documents.json")).await.unwrap();

        let result = search_schema(
            temp_dir.path(),
            SearchSchemaRagRequest {
                connection_id: "conn".to_string(),
                database: "main".to_string(),
                schema: "public".to_string(),
                query: "申请状态".to_string(),
                config,
                limit: Some(5),
            },
        )
        .await
        .unwrap();

        handle.join().unwrap();
        assert_eq!(result.tables[0].name, "mc_birth_apply");
        assert!(result.tables[0].matched_columns.iter().any(|column| column.name == "apply_status"));
    }

    #[tokio::test]
    async fn search_schema_errors_when_graph_is_missing_even_if_documents_json_exists() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let docs = build_schema_documents(std::slice::from_ref(&table));
        let index_dir = schema_index_dir(temp_dir.path(), "conn", "main", "public");
        tokio::fs::create_dir_all(&index_dir).await.unwrap();
        write_json_pretty(&index_dir.join("manifest.json"), &fake_manifest(1, table.columns.len())).await.unwrap();
        write_json_pretty(
            &index_dir.join("documents.json"),
            &StoredSchemaRagIndex {
                manifest: fake_manifest(1, table.columns.len()),
                tables: vec![table],
                documents: docs,
                api_doc_extractions: Vec::new(),
            },
        )
        .await
        .unwrap();
        let config = fake_config();

        let error = search_schema(
            temp_dir.path(),
            SearchSchemaRagRequest {
                connection_id: "conn".to_string(),
                database: "main".to_string(),
                schema: "public".to_string(),
                query: "申请状态".to_string(),
                config,
                limit: Some(5),
            },
        )
        .await
        .unwrap_err();

        assert!(error.contains("graph.kuzu is not available"));
    }

    #[tokio::test]
    async fn user_confirmed_business_alias_saved_in_graph_boosts_column_search() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table = fake_table();
        let texts = build_schema_documents(std::slice::from_ref(&table)).len();
        let (endpoint, _requests, handle) = spawn_embedding_server_with_limit(vec![0.0, 0.0, 1.0], texts + 1);
        let mut config = fake_config();
        config.embedding_endpoint = endpoint;
        config.embedding_model = "fake-embedding".to_string();
        config.embedding_dimension = 3;

        analyze_schema(
            temp_dir.path(),
            AnalyzeSchemaRagRequest {
                scope: SchemaRagScope {
                    connection_id: "conn".to_string(),
                    database: "main".to_string(),
                    schema: "public".to_string(),
                    db_type: "sqlite".to_string(),
                },
                tables: vec![table],
                config: config.clone(),
            },
        )
        .await
        .unwrap();
        let response = save_schema_enrichment(
            temp_dir.path(),
            SaveSchemaRagEnrichmentRequest {
                connection_id: "conn".to_string(),
                database: "main".to_string(),
                schema: "public".to_string(),
                aliases: vec![SchemaRagBusinessAliasInput {
                    term: "guardian-mom-alias".to_string(),
                    target_kind: Some("column".to_string()),
                    table: "mc_birth_apply".to_string(),
                    column: Some("mother_name".to_string()),
                    source: Some("user_confirmed".to_string()),
                    confidence: Some(1.0),
                    note: None,
                }],
            },
        )
        .await
        .unwrap();

        let result = search_table_columns(
            temp_dir.path(),
            SearchTableColumnsRagRequest {
                connection_id: "conn".to_string(),
                database: "main".to_string(),
                schema: "public".to_string(),
                table: "mc_birth_apply".to_string(),
                query: "guardian-mom-alias".to_string(),
                config,
                limit: Some(3),
                include_primary_key: Some(true),
            },
        )
        .await
        .unwrap();

        handle.join().unwrap();
        assert_eq!(response.saved_aliases, 1);
        assert_eq!(result.columns[0].name, "mother_name");
        assert!(result.columns[0].reason.contains("用户确认业务别名命中 guardian-mom-alias"));
    }

    #[test]
    fn embedding_request_uses_string_input_for_single_item_batches() {
        let config = fake_config();

        let body = embedding_request_body(&config, &["hello".to_string()], true);

        assert_eq!(body["model"], "Qwen3-Embedding-0.6B");
        assert_eq!(body["input"], "hello");
        assert_eq!(body["encoding_format"], "float");
        assert_eq!(body["dimensions"], 1024);
        assert_eq!(body["user"], "");
    }

    #[test]
    fn embedding_request_keeps_array_input_for_multi_item_batches() {
        let mut config = fake_config();
        config.embedding_batch_size = 2;

        let body = embedding_request_body(&config, &["hello".to_string(), "world".to_string()], false);

        assert_eq!(body["input"], serde_json::json!(["hello", "world"]));
    }

    #[test]
    fn gitee_endpoint_forces_single_input_batches() {
        assert!(embedding_endpoint_requires_single_input("https://ai.gitee.com/v1/embeddings"));
        assert!(embedding_endpoint_requires_single_input("https://ai.gitee.com/v1"));
        assert!(!embedding_endpoint_requires_single_input("https://api.openai.com/v1/embeddings"));
    }

    #[test]
    fn embedding_concurrency_is_clamped_to_supported_range() {
        let mut config = fake_config();

        config.embedding_concurrency = 0;
        assert_eq!(normalized_embedding_concurrency(&config), 1);

        config.embedding_concurrency = 8;
        assert_eq!(normalized_embedding_concurrency(&config), 8);

        config.embedding_concurrency = 99;
        assert_eq!(normalized_embedding_concurrency(&config), 16);
    }

    #[test]
    fn single_input_endpoint_keeps_batch_size_one_but_preserves_concurrency() {
        let mut config = fake_config();
        config.embedding_batch_size = 64;
        config.embedding_concurrency = 6;

        assert_eq!(normalized_embedding_batch_size(&config, true), 1);
        assert_eq!(normalized_embedding_concurrency(&config), 6);
    }

    #[test]
    fn embedding_batch_jobs_preserve_text_order_boundaries() {
        let texts = vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string(), "e".to_string()];

        let jobs = build_embedding_batch_jobs(&texts, 2);

        assert_eq!(jobs.len(), 3);
        assert_eq!(jobs[0].batch_index, 0);
        assert_eq!(jobs[0].start, 0);
        assert_eq!(jobs[0].texts, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(jobs[1].batch_index, 1);
        assert_eq!(jobs[1].start, 2);
        assert_eq!(jobs[1].texts, vec!["c".to_string(), "d".to_string()]);
        assert_eq!(jobs[2].batch_index, 2);
        assert_eq!(jobs[2].start, 4);
        assert_eq!(jobs[2].texts, vec!["e".to_string()]);
    }

    #[test]
    fn embedding_batch_results_flatten_in_batch_order() {
        let results = vec![
            Some(EmbeddingBatchResult { batch_index: 0, embeddings: vec![vec![1.0], vec![2.0]], elapsed_ms: 30 }),
            Some(EmbeddingBatchResult { batch_index: 1, embeddings: vec![vec![3.0]], elapsed_ms: 10 }),
            Some(EmbeddingBatchResult { batch_index: 2, embeddings: vec![vec![4.0], vec![5.0]], elapsed_ms: 20 }),
        ];

        let flattened = flatten_embedding_batch_results(results).unwrap();

        assert_eq!(flattened, vec![vec![1.0], vec![2.0], vec![3.0], vec![4.0], vec![5.0]]);
    }
}
