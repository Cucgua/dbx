use std::env;
use std::path::PathBuf;

use dbx_schema_rag_sidecar::{
    analyze_schema, import_api_docs, refresh_schema_tables, save_schema_enrichment, search_schema, search_table_columns,
    AnalyzeSchemaRagRequest, AnalyzeSchemaRagResponse, ImportSchemaRagApiDocsRequest, ImportSchemaRagApiDocsResponse,
    RefreshSchemaRagTablesRequest, RefreshSchemaRagTablesResponse, SaveSchemaRagEnrichmentRequest,
    SaveSchemaRagEnrichmentResponse, SchemaRagColumnSearchResult, SchemaRagSearchResult, SearchSchemaRagRequest,
    SearchTableColumnsRagRequest,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase")]
enum SidecarRequest {
    Analyze { data_dir: PathBuf, request: AnalyzeSchemaRagRequest },
    Search { data_dir: PathBuf, request: SearchSchemaRagRequest },
    SearchTableColumns { data_dir: PathBuf, request: SearchTableColumnsRagRequest },
    SaveEnrichment { data_dir: PathBuf, request: SaveSchemaRagEnrichmentRequest },
    ImportApiDocs { data_dir: PathBuf, request: ImportSchemaRagApiDocsRequest },
    RefreshTables { data_dir: PathBuf, request: RefreshSchemaRagTablesRequest },
}

#[derive(Debug, Serialize)]
#[serde(tag = "command", content = "result", rename_all = "camelCase")]
enum SidecarResponse {
    Analyze(AnalyzeSchemaRagResponse),
    Search(SchemaRagSearchResult),
    SearchTableColumns(SchemaRagColumnSearchResult),
    SaveEnrichment(SaveSchemaRagEnrichmentResponse),
    ImportApiDocs(ImportSchemaRagApiDocsResponse),
    RefreshTables(RefreshSchemaRagTablesResponse),
}

#[tokio::main]
async fn main() {
    match run().await {
        Ok(response) => {
            println!("{}", serde_json::to_string(&response).expect("sidecar response serializes"));
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

async fn run() -> Result<SidecarResponse, String> {
    let request_path =
        env::args().nth(1).ok_or_else(|| "Missing schema RAG sidecar request path argument".to_string())?;
    let input = tokio::fs::read_to_string(request_path).await.map_err(|err| err.to_string())?;
    let request: SidecarRequest = serde_json::from_str(&input).map_err(|err| err.to_string())?;
    match request {
        SidecarRequest::Analyze { data_dir, request } => {
            analyze_schema(&data_dir, request).await.map(SidecarResponse::Analyze)
        }
        SidecarRequest::Search { data_dir, request } => {
            search_schema(&data_dir, request).await.map(SidecarResponse::Search)
        }
        SidecarRequest::SearchTableColumns { data_dir, request } => {
            search_table_columns(&data_dir, request).await.map(SidecarResponse::SearchTableColumns)
        }
        SidecarRequest::SaveEnrichment { data_dir, request } => {
            save_schema_enrichment(&data_dir, request).await.map(SidecarResponse::SaveEnrichment)
        }
        SidecarRequest::ImportApiDocs { data_dir, request } => {
            import_api_docs(&data_dir, request).await.map(SidecarResponse::ImportApiDocs)
        }
        SidecarRequest::RefreshTables { data_dir, request } => {
            refresh_schema_tables(&data_dir, request).await.map(SidecarResponse::RefreshTables)
        }
    }
}
