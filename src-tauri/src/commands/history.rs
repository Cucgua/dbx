use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub connection_name: String,
    pub database: String,
    pub sql: String,
    pub executed_at: String,
    pub execution_time_ms: u128,
    pub success: bool,
    pub error: Option<String>,
}

fn history_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("query_history.json"))
}

fn read_all(app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let path = history_file(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn write_all(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), String> {
    let path = history_file(app)?;
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

const MAX_HISTORY: usize = 1000;

#[tauri::command]
pub async fn save_history(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let mut entries = read_all(&app)?;
    entries.insert(0, entry);
    entries.truncate(MAX_HISTORY);
    write_all(&app, &entries)
}

#[tauri::command]
pub async fn load_history(
    app: AppHandle,
    limit: usize,
    offset: usize,
) -> Result<Vec<HistoryEntry>, String> {
    let entries = read_all(&app)?;
    Ok(entries.into_iter().skip(offset).take(limit).collect())
}

#[tauri::command]
pub async fn clear_history(app: AppHandle) -> Result<(), String> {
    write_all(&app, &[])
}

#[tauri::command]
pub async fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let entries: Vec<HistoryEntry> = read_all(&app)?
        .into_iter()
        .filter(|e| e.id != id)
        .collect();
    write_all(&app, &entries)
}
