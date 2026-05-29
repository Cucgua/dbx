use std::sync::Arc;

use tauri::{Emitter, State};

use dbx_core::agent_manager::{AgentDriverInfo, DriverStoreUsage, JavaRuntimeConfig, JavaRuntimeMode, DEFAULT_JRE_KEY};
use dbx_core::agent_service::{
    build_agent_list, fetch_registry, import_agent_jar, import_agents_from_zip as import_agents_from_zip_core,
    install_agent_driver, invalidate_registry_cache, reinstall_agent_jre, uninstall_agent_driver, uninstall_agent_jre,
    upgrade_all_agent_drivers, AgentProgressEvent,
};
use dbx_core::connection::AppState;

#[tauri::command]
pub async fn list_installed_agents_local(state: State<'_, Arc<AppState>>) -> Result<Vec<AgentDriverInfo>, String> {
    Ok(build_agent_list(&state.agent_manager, None))
}

#[tauri::command]
pub async fn list_installed_agents(state: State<'_, Arc<AppState>>) -> Result<Vec<AgentDriverInfo>, String> {
    let registry = fetch_registry().await.ok();
    Ok(build_agent_list(&state.agent_manager, registry.as_ref()))
}

#[tauri::command]
pub async fn get_driver_store_usage(state: State<'_, Arc<AppState>>) -> Result<DriverStoreUsage, String> {
    Ok(state.agent_manager.collect_driver_store_usage(state.plugins.root_dir()))
}

#[tauri::command]
pub async fn install_agent(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    db_type: String,
) -> Result<(), String> {
    let app_handle = app.clone();
    install_agent_driver(&state.agent_manager, &db_type, move |event| emit_agent_progress(&app_handle, event)).await
}

#[tauri::command]
pub async fn upgrade_all_agents(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> Result<u32, String> {
    let app_handle = app.clone();
    upgrade_all_agent_drivers(&state.agent_manager, move |event| emit_agent_progress(&app_handle, event)).await
}

#[tauri::command]
pub async fn uninstall_agent(state: State<'_, Arc<AppState>>, db_type: String) -> Result<(), String> {
    uninstall_agent_driver(&state.agent_manager, &db_type).await
}

#[tauri::command]
pub async fn check_jre_installed(state: State<'_, Arc<AppState>>, jre_key: Option<String>) -> Result<bool, String> {
    let key = jre_key.as_deref().unwrap_or(DEFAULT_JRE_KEY);
    Ok(state.agent_manager.is_jre_installed(key))
}

#[tauri::command]
pub async fn get_agent_java_runtime_config(state: State<'_, Arc<AppState>>) -> Result<JavaRuntimeConfig, String> {
    Ok(state.agent_manager.load_state().java_runtime)
}

#[tauri::command]
pub async fn set_agent_java_runtime_config(
    state: State<'_, Arc<AppState>>,
    mut config: JavaRuntimeConfig,
) -> Result<JavaRuntimeConfig, String> {
    let am = &state.agent_manager;
    if config.mode == JavaRuntimeMode::Custom || config.mode == JavaRuntimeMode::System {
        let candidate_state = dbx_core::agent_manager::AgentState { java_runtime: config.clone(), ..am.load_state() };
        let resolved = am.resolve_java_runtime(&candidate_state, DEFAULT_JRE_KEY)?;
        if config.mode == JavaRuntimeMode::Custom {
            config.custom_java_path = Some(resolved.to_string_lossy().to_string());
        }
    }
    if config.mode != JavaRuntimeMode::Custom {
        config.custom_java_path = None;
    }

    let mut local_state = am.load_state();
    local_state.java_runtime = config.clone();
    am.save_state(&local_state)?;
    am.stop_daemons().await;
    Ok(config)
}

#[tauri::command]
pub async fn uninstall_jre(state: State<'_, Arc<AppState>>, jre_key: String) -> Result<(), String> {
    uninstall_agent_jre(&state.agent_manager, &jre_key).await
}

#[tauri::command]
pub async fn invalidate_agent_registry_cache() -> Result<(), String> {
    invalidate_registry_cache().await;
    Ok(())
}

#[tauri::command]
pub async fn import_agents_from_zip(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<u32, String> {
    let am = &state.agent_manager;
    let zip_path = std::path::PathBuf::from(&path);
    let app_handle = app.clone();
    let result = import_agents_from_zip_core(am, &zip_path, |event| emit_agent_progress(&app_handle, event))?;
    let count = result.drivers_installed.len() as u32;
    emit_agent_progress(&app, AgentProgressEvent::step("done"));
    Ok(count)
}

#[tauri::command]
pub async fn import_agent_jar_cmd(
    state: State<'_, Arc<AppState>>,
    db_type: String,
    path: String,
) -> Result<(), String> {
    import_agent_jar(&state.agent_manager, &db_type, std::path::Path::new(&path))
}

#[tauri::command]
pub async fn reinstall_jre(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    jre_key: Option<String>,
) -> Result<(), String> {
    let key = jre_key.as_deref().unwrap_or(DEFAULT_JRE_KEY);
    let app_handle = app.clone();
    reinstall_agent_jre(&state.agent_manager, key, move |event| emit_agent_progress(&app_handle, event)).await
}

fn emit_agent_progress(app: &tauri::AppHandle, event: AgentProgressEvent) {
    let _ = app.emit("agent-install-progress", event);
}
