use std::sync::Arc;
use tauri::State;

use super::connection::AppState;
use dbx_core::models::app_settings::AppSettings;

#[tauri::command]
pub async fn save_app_settings(state: State<'_, Arc<AppState>>, settings: AppSettings) -> Result<(), String> {
    state.storage.save_app_settings(&settings).await
}

#[tauri::command]
pub async fn load_app_settings(state: State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    state.storage.load_app_settings().await
}
