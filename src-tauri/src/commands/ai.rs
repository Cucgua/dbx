use tauri::{AppHandle, Emitter, Manager};

pub use dbx_core::ai::*;

fn ai_config_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai_config.json"))
}

fn conversations_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai_conversations.json"))
}

#[tauri::command]
pub async fn ai_test_connection(config: AiConfig) -> Result<String, String> {
    dbx_core::ai::test_connection_core(&config).await
}

#[tauri::command]
pub async fn save_ai_config(app: AppHandle, config: AiConfig) -> Result<(), String> {
    dbx_core::ai::save_config(&ai_config_file(&app)?, &config)
}

#[tauri::command]
pub async fn load_ai_config(app: AppHandle) -> Result<Option<AiConfig>, String> {
    dbx_core::ai::load_config(&ai_config_file(&app)?)
}

#[tauri::command]
pub async fn ai_complete(request: AiCompletionRequest) -> Result<String, String> {
    dbx_core::ai::complete(&request).await
}

#[tauri::command]
pub async fn ai_stream(
    app: AppHandle,
    session_id: String,
    request: AiCompletionRequest,
) -> Result<(), String> {
    let cancelled = dbx_core::ai::register_stream(&session_id).await;

    let result = dbx_core::ai::stream(&session_id, &request, &cancelled, |chunk| {
        let _ = app.emit("ai-stream-chunk", &chunk);
    })
    .await;

    dbx_core::ai::unregister_stream(&session_id).await;
    result
}

#[tauri::command]
pub async fn ai_cancel_stream(session_id: String) -> Result<bool, String> {
    Ok(dbx_core::ai::cancel_stream(&session_id).await)
}

#[tauri::command]
pub async fn save_ai_conversation(
    app: AppHandle,
    conversation: AiConversation,
) -> Result<(), String> {
    dbx_core::ai::save_conversation(&conversations_file(&app)?, conversation)
}

#[tauri::command]
pub async fn load_ai_conversations(app: AppHandle) -> Result<Vec<AiConversation>, String> {
    dbx_core::ai::load_conversations(&conversations_file(&app)?)
}

#[tauri::command]
pub async fn delete_ai_conversation(app: AppHandle, id: String) -> Result<(), String> {
    dbx_core::ai::delete_conversation(&conversations_file(&app)?, &id)
}
