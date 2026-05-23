use dbx_core::csv_export::format_csv;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultCsvExportRequest {
    pub file_path: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

#[tauri::command]
pub fn export_query_result_csv(request: QueryResultCsvExportRequest) -> Result<(), String> {
    let csv = format_csv(&request.columns, &request.rows);
    std::fs::write(&request.file_path, format!("\u{FEFF}{csv}")).map_err(|err| err.to_string())
}
