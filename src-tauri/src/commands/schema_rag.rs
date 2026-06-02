use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use dbx_core::db;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;

use crate::commands::connection::AppState;

const SCHEMA_RAG_SIDECAR: &str = "dbx-schema-rag-sidecar";

#[derive(Debug, Clone)]
pub struct SchemaRagRuntimeState {
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagScopeRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSchemaRagCommandRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSchemaRagCommandRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTableColumnsRagCommandRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
    pub query: String,
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
pub struct SaveSchemaRagEnrichmentCommandRequest {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub aliases: Vec<SchemaRagBusinessAliasInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRagProgressEvent {
    pub connection_id: String,
    pub database: String,
    pub schema: String,
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
    pub analyzed_at: chrono::DateTime<chrono::Utc>,
    pub table_count: usize,
    pub column_count: usize,
    pub index_count: usize,
    pub foreign_key_count: usize,
    pub schema_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSchemaRagResponse {
    pub manifest: SchemaRagManifest,
    pub index_path: String,
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

#[derive(Debug, Serialize)]
#[serde(tag = "command", rename_all = "camelCase")]
enum SidecarRequest {
    Analyze { data_dir: PathBuf, request: AnalyzeSchemaRagRequest },
    Search { data_dir: PathBuf, request: SearchSchemaRagRequest },
    SearchTableColumns { data_dir: PathBuf, request: SearchTableColumnsRagRequest },
    SaveEnrichment { data_dir: PathBuf, request: SaveSchemaRagEnrichmentRequest },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", content = "result", rename_all = "camelCase")]
enum SidecarResponse {
    Analyze(AnalyzeSchemaRagResponse),
    Search(SchemaRagSearchResult),
    SearchTableColumns(SchemaRagColumnSearchResult),
    SaveEnrichment(SaveSchemaRagEnrichmentResponse),
}

const DEFAULT_EMBEDDING_CONCURRENCY: usize = 4;

fn default_embedding_concurrency() -> usize {
    DEFAULT_EMBEDDING_CONCURRENCY
}

#[tauri::command]
pub async fn save_schema_rag_config(
    runtime: State<'_, SchemaRagRuntimeState>,
    config: SchemaRagConfig,
) -> Result<(), String> {
    let path = schema_rag_config_path(&runtime.data_dir);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| err.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&config).map_err(|err| err.to_string())?;
    tokio::fs::write(path, bytes).await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn load_schema_rag_config(
    runtime: State<'_, SchemaRagRuntimeState>,
) -> Result<Option<SchemaRagConfig>, String> {
    let path = schema_rag_config_path(&runtime.data_dir);
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub async fn analyze_schema_rag(
    app: AppHandle,
    runtime: State<'_, SchemaRagRuntimeState>,
    state: State<'_, Arc<AppState>>,
    request: AnalyzeSchemaRagCommandRequest,
) -> Result<AnalyzeSchemaRagResponse, String> {
    let started_at = Instant::now();
    log::info!(
        "[schema-rag][analyze:start] connection_id={} database={} schema={}",
        request.connection_id,
        request.database,
        request.schema
    );
    let config = require_schema_rag_config(&runtime.data_dir).await?;
    let db_type = connection_db_type(&state, &request.connection_id).await?;
    let tables = collect_schema_metadata(&app, &state, &request, &db_type).await?;
    let table_count = tables.len();
    let column_count: usize = tables.iter().map(|table| table.columns.len()).sum();
    log::info!(
        "[schema-rag][analyze:metadata_done] connection_id={} database={} schema={} table_count={} column_count={} elapsed_ms={}",
        request.connection_id,
        request.database,
        request.schema,
        table_count,
        column_count,
        started_at.elapsed().as_millis()
    );
    let sidecar_request = AnalyzeSchemaRagRequest {
        scope: SchemaRagScope {
            connection_id: request.connection_id,
            database: request.database,
            schema: request.schema,
            db_type,
        },
        tables,
        config,
    };
    let connection_id = sidecar_request.scope.connection_id.clone();
    let database = sidecar_request.scope.database.clone();
    let schema = sidecar_request.scope.schema.clone();
    emit_schema_rag_progress(&app, &connection_id, &database, &schema, "sidecar", 0, 1, "Running schema index sidecar");
    let result = invoke_schema_rag_sidecar(
        &app,
        &runtime.data_dir,
        SidecarRequest::Analyze { data_dir: runtime.data_dir.clone(), request: sidecar_request },
    )
    .await
    .and_then(|response| match response {
        SidecarResponse::Analyze(result) => Ok(result),
        SidecarResponse::Search(_) => Err("Schema RAG sidecar returned an unexpected search response".to_string()),
        SidecarResponse::SearchTableColumns(_) => {
            Err("Schema RAG sidecar returned an unexpected column search response".to_string())
        }
        SidecarResponse::SaveEnrichment(_) => {
            Err("Schema RAG sidecar returned an unexpected enrichment response".to_string())
        }
    });
    match &result {
        Ok(response) => log::info!(
            "[schema-rag][analyze:done] table_count={} column_count={} index_path={} elapsed_ms={}",
            response.manifest.table_count,
            response.manifest.column_count,
            response.index_path,
            started_at.elapsed().as_millis()
        ),
        Err(error) => {
            log::info!("[schema-rag][analyze:error] error={} elapsed_ms={}", error, started_at.elapsed().as_millis())
        }
    }
    result
}

#[tauri::command]
pub async fn search_schema_rag(
    app: AppHandle,
    runtime: State<'_, SchemaRagRuntimeState>,
    request: SearchSchemaRagCommandRequest,
) -> Result<SchemaRagSearchResult, String> {
    let started_at = Instant::now();
    log::info!(
        "[schema-rag][search:start] connection_id={} database={} schema={} limit={:?} query={}",
        request.connection_id,
        request.database,
        request.schema,
        request.limit,
        request.query
    );
    let config = require_schema_rag_config(&runtime.data_dir).await?;
    let result = invoke_schema_rag_sidecar(
        &app,
        &runtime.data_dir,
        SidecarRequest::Search {
            data_dir: runtime.data_dir.clone(),
            request: SearchSchemaRagRequest {
                connection_id: request.connection_id,
                database: request.database,
                schema: request.schema,
                query: request.query,
                config,
                limit: request.limit,
            },
        },
    )
    .await
    .and_then(|response| match response {
        SidecarResponse::Search(result) => Ok(result),
        SidecarResponse::Analyze(_) => Err("Schema RAG sidecar returned an unexpected analyze response".to_string()),
        SidecarResponse::SearchTableColumns(_) => {
            Err("Schema RAG sidecar returned an unexpected column search response".to_string())
        }
        SidecarResponse::SaveEnrichment(_) => {
            Err("Schema RAG sidecar returned an unexpected enrichment response".to_string())
        }
    });
    match &result {
        Ok(response) => log::info!(
            "[schema-rag][search:done] table_count={} truncated={} elapsed_ms={}",
            response.tables.len(),
            response.truncated,
            started_at.elapsed().as_millis()
        ),
        Err(error) => {
            log::info!("[schema-rag][search:error] error={} elapsed_ms={}", error, started_at.elapsed().as_millis())
        }
    }
    result
}

#[tauri::command]
pub async fn search_table_columns_rag(
    app: AppHandle,
    runtime: State<'_, SchemaRagRuntimeState>,
    request: SearchTableColumnsRagCommandRequest,
) -> Result<SchemaRagColumnSearchResult, String> {
    let started_at = Instant::now();
    log::info!(
        "[schema-rag][column-search:start] connection_id={} database={} schema={} table={} limit={:?} query={}",
        request.connection_id,
        request.database,
        request.schema,
        request.table,
        request.limit,
        request.query
    );
    let config = require_schema_rag_config(&runtime.data_dir).await?;
    let result = invoke_schema_rag_sidecar(
        &app,
        &runtime.data_dir,
        SidecarRequest::SearchTableColumns {
            data_dir: runtime.data_dir.clone(),
            request: SearchTableColumnsRagRequest {
                connection_id: request.connection_id,
                database: request.database,
                schema: request.schema,
                table: request.table,
                query: request.query,
                config,
                limit: request.limit,
                include_primary_key: request.include_primary_key,
            },
        },
    )
    .await
    .and_then(|response| match response {
        SidecarResponse::SearchTableColumns(result) => Ok(result),
        SidecarResponse::Analyze(_) => Err("Schema RAG sidecar returned an unexpected analyze response".to_string()),
        SidecarResponse::Search(_) => Err("Schema RAG sidecar returned an unexpected search response".to_string()),
        SidecarResponse::SaveEnrichment(_) => {
            Err("Schema RAG sidecar returned an unexpected enrichment response".to_string())
        }
    });
    match &result {
        Ok(response) => log::info!(
            "[schema-rag][column-search:done] column_count={} truncated={} elapsed_ms={}",
            response.columns.len(),
            response.truncated,
            started_at.elapsed().as_millis()
        ),
        Err(error) => log::info!(
            "[schema-rag][column-search:error] error={} elapsed_ms={}",
            error,
            started_at.elapsed().as_millis()
        ),
    }
    result
}

#[tauri::command]
pub async fn save_schema_rag_enrichment(
    app: AppHandle,
    runtime: State<'_, SchemaRagRuntimeState>,
    request: SaveSchemaRagEnrichmentCommandRequest,
) -> Result<SaveSchemaRagEnrichmentResponse, String> {
    let started_at = Instant::now();
    log::info!(
        "[schema-rag][enrichment:start] connection_id={} database={} schema={} aliases={}",
        request.connection_id,
        request.database,
        request.schema,
        request.aliases.len()
    );
    let result = invoke_schema_rag_sidecar(
        &app,
        &runtime.data_dir,
        SidecarRequest::SaveEnrichment {
            data_dir: runtime.data_dir.clone(),
            request: SaveSchemaRagEnrichmentRequest {
                connection_id: request.connection_id,
                database: request.database,
                schema: request.schema,
                aliases: request.aliases,
            },
        },
    )
    .await
    .and_then(|response| match response {
        SidecarResponse::SaveEnrichment(result) => Ok(result),
        SidecarResponse::Analyze(_) => Err("Schema RAG sidecar returned an unexpected analyze response".to_string()),
        SidecarResponse::Search(_) => Err("Schema RAG sidecar returned an unexpected search response".to_string()),
        SidecarResponse::SearchTableColumns(_) => {
            Err("Schema RAG sidecar returned an unexpected column search response".to_string())
        }
    });
    match &result {
        Ok(response) => log::info!(
            "[schema-rag][enrichment:done] saved_aliases={} elapsed_ms={}",
            response.saved_aliases,
            started_at.elapsed().as_millis()
        ),
        Err(error) => {
            log::info!("[schema-rag][enrichment:error] error={} elapsed_ms={}", error, started_at.elapsed().as_millis())
        }
    }
    result
}

#[tauri::command]
pub async fn load_schema_rag_status(
    runtime: State<'_, SchemaRagRuntimeState>,
    request: SchemaRagScopeRequest,
) -> Result<SchemaRagStatus, String> {
    let index_dir = schema_index_dir(&runtime.data_dir, &request.connection_id, &request.database, &request.schema);
    let manifest_path = index_dir.join("manifest.json");
    let manifest = match tokio::fs::read(&manifest_path).await {
        Ok(bytes) => Some(serde_json::from_slice::<SchemaRagManifest>(&bytes).map_err(|err| err.to_string())?),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.to_string()),
    };
    Ok(SchemaRagStatus { indexed: manifest.is_some(), manifest, index_path: index_dir.to_string_lossy().to_string() })
}

#[tauri::command]
pub async fn delete_schema_rag_index(
    runtime: State<'_, SchemaRagRuntimeState>,
    request: SchemaRagScopeRequest,
) -> Result<bool, String> {
    let index_dir = schema_index_dir(&runtime.data_dir, &request.connection_id, &request.database, &request.schema);
    match tokio::fs::remove_dir_all(index_dir).await {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

async fn require_schema_rag_config(data_dir: &Path) -> Result<SchemaRagConfig, String> {
    let path = schema_rag_config_path(data_dir);
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|_| "Schema RAG embedding is not configured. Configure it in Settings > AI first.".to_string())?;
    let config: SchemaRagConfig = serde_json::from_slice(&bytes).map_err(|err| err.to_string())?;
    validate_schema_rag_config(&config)?;
    Ok(config)
}

async fn invoke_schema_rag_sidecar(
    app: &AppHandle,
    data_dir: &Path,
    request: SidecarRequest,
) -> Result<SidecarResponse, String> {
    let requests_dir = data_dir.join("schema-rag").join("sidecar-requests");
    tokio::fs::create_dir_all(&requests_dir).await.map_err(|err| err.to_string())?;
    let request_path = requests_dir.join(format!("{}.json", uuid::Uuid::new_v4()));
    let payload = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
    tokio::fs::write(&request_path, payload).await.map_err(|err| err.to_string())?;

    let command_result = app
        .shell()
        .sidecar(SCHEMA_RAG_SIDECAR)
        .map(|command| command.arg(request_path.as_os_str()))
        .map_err(|err| format!("Failed to resolve schema RAG sidecar: {err}"));
    let output_result = match command_result {
        Ok(command) => command.output().await.map_err(|err| format!("Failed to run schema RAG sidecar: {err}")),
        Err(error) => Err(error),
    };
    let _ = tokio::fs::remove_file(&request_path).await;
    let output = output_result?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("Schema RAG sidecar exited with status {:?}", output.status.code())
        } else {
            stderr
        });
    }
    if stdout.is_empty() {
        return Err(if stderr.is_empty() {
            "Schema RAG sidecar returned empty output".to_string()
        } else {
            format!("Schema RAG sidecar returned empty output; stderr: {stderr}")
        });
    }
    serde_json::from_str(&stdout).map_err(|err| {
        if stderr.is_empty() {
            format!("Schema RAG sidecar returned invalid JSON: {err}")
        } else {
            format!("Schema RAG sidecar returned invalid JSON: {err}; stderr: {stderr}")
        }
    })
}

fn validate_schema_rag_config(config: &SchemaRagConfig) -> Result<(), String> {
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

async fn connection_db_type(state: &Arc<AppState>, connection_id: &str) -> Result<String, String> {
    let configs = state.configs.read().await;
    let config = configs.get(connection_id).ok_or_else(|| "Connection config not found".to_string())?;
    Ok(serde_json::to_value(config.db_type)
        .ok()
        .and_then(|value| value.as_str().map(ToString::to_string))
        .unwrap_or_else(|| format!("{:?}", config.db_type).to_lowercase()))
}

async fn collect_schema_metadata(
    app: &AppHandle,
    state: &Arc<AppState>,
    request: &AnalyzeSchemaRagCommandRequest,
    _db_type: &str,
) -> Result<Vec<SchemaRagTableMetadata>, String> {
    let tables = dbx_core::schema::list_tables_core(
        state,
        &request.connection_id,
        &request.database,
        &request.schema,
        None,
        None,
    )
    .await?;
    let total = tables.len();
    let mut result = Vec::with_capacity(tables.len());
    for (index, table) in tables.into_iter().enumerate() {
        let table_name = table.name.clone();
        let columns = dbx_core::schema::get_columns_core(
            state,
            &request.connection_id,
            &request.database,
            &request.schema,
            &table.name,
        )
        .await
        .unwrap_or_default();
        let indexes = dbx_core::schema::list_indexes_core(
            state,
            &request.connection_id,
            &request.database,
            &request.schema,
            &table.name,
        )
        .await
        .unwrap_or_default();
        let foreign_keys = dbx_core::schema::list_foreign_keys_core(
            state,
            &request.connection_id,
            &request.database,
            &request.schema,
            &table.name,
        )
        .await
        .unwrap_or_default();

        result.push(table_metadata(&request.schema, table, columns, indexes, foreign_keys));
        let _ = app.emit(
            "schema-rag-progress",
            SchemaRagProgressEvent {
                connection_id: request.connection_id.clone(),
                database: request.database.clone(),
                schema: request.schema.clone(),
                stage: "scan_table".to_string(),
                done: index + 1,
                total,
                table: Some(table_name),
                batch: None,
                batch_total: None,
                batch_size: None,
                concurrency: None,
                in_flight: None,
                succeeded_batches: None,
                failed_batches: None,
                message: "Scanning table metadata".to_string(),
            },
        );
    }
    Ok(result)
}

fn emit_schema_rag_progress(
    app: &AppHandle,
    connection_id: &str,
    database: &str,
    schema: &str,
    stage: &str,
    done: usize,
    total: usize,
    message: &str,
) {
    let _ = app.emit(
        "schema-rag-progress",
        SchemaRagProgressEvent {
            connection_id: connection_id.to_string(),
            database: database.to_string(),
            schema: schema.to_string(),
            stage: stage.to_string(),
            done,
            total,
            table: None,
            batch: None,
            batch_total: None,
            batch_size: None,
            concurrency: None,
            in_flight: None,
            succeeded_batches: None,
            failed_batches: None,
            message: message.to_string(),
        },
    );
}

fn table_metadata(
    schema: &str,
    table: db::TableInfo,
    columns: Vec<db::ColumnInfo>,
    indexes: Vec<db::IndexInfo>,
    foreign_keys: Vec<db::ForeignKeyInfo>,
) -> SchemaRagTableMetadata {
    SchemaRagTableMetadata {
        schema: schema.to_string(),
        name: table.name,
        table_type: table.table_type,
        comment: table.comment,
        ddl: None,
        columns: columns.into_iter().map(column_metadata).collect(),
        indexes: indexes.into_iter().map(index_metadata).collect(),
        foreign_keys: foreign_keys.into_iter().map(foreign_key_metadata).collect(),
    }
}

fn column_metadata(column: db::ColumnInfo) -> SchemaRagColumnMetadata {
    SchemaRagColumnMetadata {
        name: column.name,
        data_type: column.data_type,
        is_nullable: column.is_nullable,
        is_primary_key: column.is_primary_key,
        column_default: column.column_default,
        comment: column.comment,
    }
}

fn index_metadata(index: db::IndexInfo) -> SchemaRagIndexMetadata {
    SchemaRagIndexMetadata {
        name: index.name,
        columns: index.columns,
        is_unique: index.is_unique,
        is_primary: index.is_primary,
        index_type: index.index_type,
        comment: index.comment,
    }
}

fn foreign_key_metadata(fk: db::ForeignKeyInfo) -> SchemaRagForeignKeyMetadata {
    SchemaRagForeignKeyMetadata {
        name: fk.name,
        column: fk.column,
        ref_schema: None,
        ref_table: fk.ref_table,
        ref_column: fk.ref_column,
    }
}

fn schema_rag_config_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("schema-rag").join("config.json")
}

fn schema_index_dir(data_dir: &std::path::Path, connection_id: &str, database: &str, schema: &str) -> PathBuf {
    data_dir
        .join("schema-rag")
        .join("indexes")
        .join(sanitize_path_segment(connection_id))
        .join(sanitize_path_segment(database))
        .join(sanitize_path_segment(schema))
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
