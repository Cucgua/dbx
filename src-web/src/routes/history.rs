use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use dbx_core::history::{self, HistoryEntry};
use serde::Deserialize;

use crate::error::AppError;
use crate::state::WebState;

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveHistoryRequest {
    pub entry: HistoryEntry,
}

pub async fn save_history(
    State(state): State<Arc<WebState>>,
    Json(body): Json<SaveHistoryRequest>,
) -> Result<Json<()>, AppError> {
    let path = state.data_dir.join("query_history.json");
    history::save_history_entry(&path, body.entry).map_err(AppError)?;
    Ok(Json(()))
}

pub async fn load_history(
    State(state): State<Arc<WebState>>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<HistoryEntry>>, AppError> {
    let path = state.data_dir.join("query_history.json");
    let limit = q.limit.unwrap_or(100);
    let offset = q.offset.unwrap_or(0);
    let entries = history::load_history_entries(&path, limit, offset).map_err(AppError)?;
    Ok(Json(entries))
}

pub async fn clear_history(State(state): State<Arc<WebState>>) -> Result<Json<()>, AppError> {
    let path = state.data_dir.join("query_history.json");
    history::clear_history_entries(&path).map_err(AppError)?;
    Ok(Json(()))
}

pub async fn delete_history_entry(
    State(state): State<Arc<WebState>>,
    Path(id): Path<String>,
) -> Result<Json<()>, AppError> {
    let path = state.data_dir.join("query_history.json");
    history::delete_history_entry_by_id(&path, &id).map_err(AppError)?;
    Ok(Json(()))
}
