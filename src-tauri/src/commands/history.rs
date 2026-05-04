use tauri::{AppHandle, Manager};

pub use dbx_core::history::HistoryEntry;

fn history_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("query_history.json"))
}

#[tauri::command]
pub async fn save_history(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let path = history_file(&app)?;
    dbx_core::history::save_history_entry(&path, entry)
}

#[tauri::command]
pub async fn load_history(
    app: AppHandle,
    limit: usize,
    offset: usize,
) -> Result<Vec<HistoryEntry>, String> {
    let path = history_file(&app)?;
    dbx_core::history::load_history_entries(&path, limit, offset)
}

#[tauri::command]
pub async fn clear_history(app: AppHandle) -> Result<(), String> {
    let path = history_file(&app)?;
    dbx_core::history::clear_history_entries(&path)
}

#[tauri::command]
pub async fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let path = history_file(&app)?;
    dbx_core::history::delete_history_entry_by_id(&path, &id)
}
