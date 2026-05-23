use std::sync::Arc;

use dbx_core::storage::DesktopSettings;
use tauri::{AppHandle, State};

use super::connection::AppState;
use crate::apply_desktop_tray_preference;

#[tauri::command]
pub async fn load_desktop_settings(state: State<'_, Arc<AppState>>) -> Result<DesktopSettings, String> {
    state.storage.load_desktop_settings().await
}

#[tauri::command]
pub async fn save_desktop_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    settings: DesktopSettings,
) -> Result<(), String> {
    state.storage.save_desktop_settings(&settings).await?;
    if let Err(err) = apply_desktop_tray_preference(&app, settings.show_tray_icon) {
        eprintln!("Failed to apply desktop tray preference: {err}");
    }
    Ok(())
}

#[tauri::command]
pub async fn load_pinned_tree_node_ids(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    state.storage.load_pinned_tree_node_ids().await
}

#[tauri::command]
pub async fn save_pinned_tree_node_ids(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> Result<(), String> {
    state.storage.save_pinned_tree_node_ids(&ids).await
}
