use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::error::AppError;
use crate::state::WebState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLayoutRequest {
    pub layout: serde_json::Value,
}

pub async fn save_sidebar_layout(
    State(state): State<Arc<WebState>>,
    Json(body): Json<SaveLayoutRequest>,
) -> Result<Json<()>, AppError> {
    let path = state.data_dir.join("sidebar_layout.json");
    let json = serde_json::to_string_pretty(&body.layout).map_err(|e| AppError(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| AppError(e.to_string()))?;
    Ok(Json(()))
}

pub async fn load_sidebar_layout(
    State(state): State<Arc<WebState>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let path = state.data_dir.join("sidebar_layout.json");
    if !path.exists() {
        return Ok(Json(serde_json::json!(null)));
    }
    let json = std::fs::read_to_string(&path).map_err(|e| AppError(e.to_string()))?;
    let layout: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| AppError(e.to_string()))?;
    Ok(Json(layout))
}
