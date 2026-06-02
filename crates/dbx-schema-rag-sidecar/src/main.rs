use std::env;
use std::path::PathBuf;

use dbx_schema_rag_sidecar::{
    analyze_schema, save_schema_enrichment, search_schema, search_table_columns, AnalyzeSchemaRagRequest,
    AnalyzeSchemaRagResponse, SaveSchemaRagEnrichmentRequest, SaveSchemaRagEnrichmentResponse,
    SchemaRagColumnSearchResult, SchemaRagSearchResult, SearchSchemaRagRequest, SearchTableColumnsRagRequest,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase")]
enum SidecarRequest {
    Analyze { data_dir: PathBuf, request: AnalyzeSchemaRagRequest },
    Search { data_dir: PathBuf, request: SearchSchemaRagRequest },
    SearchTableColumns { data_dir: PathBuf, request: SearchTableColumnsRagRequest },
    SaveEnrichment { data_dir: PathBuf, request: SaveSchemaRagEnrichmentRequest },
}

#[derive(Debug, Serialize)]
#[serde(tag = "command", content = "result", rename_all = "camelCase")]
enum SidecarResponse {
    Analyze(AnalyzeSchemaRagResponse),
    Search(SchemaRagSearchResult),
    SearchTableColumns(SchemaRagColumnSearchResult),
    SaveEnrichment(SaveSchemaRagEnrichmentResponse),
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
    }
}
