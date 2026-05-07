use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

use super::connection::AppState;
use dbx_core::models::app_settings::AppSettings;
use dbx_mcp::McpHttpStatus;

#[tauri::command]
pub async fn save_app_settings(state: State<'_, Arc<AppState>>, settings: AppSettings) -> Result<(), String> {
    state.storage.save_app_settings(&settings).await
}

#[tauri::command]
pub async fn load_app_settings(state: State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    state.storage.load_app_settings().await
}

#[tauri::command]
pub async fn load_mcp_http_status(app: AppHandle) -> Result<Option<McpHttpStatus>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    dbx_mcp::read_status(&data_dir)
}
