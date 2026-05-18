use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::error::AppError;
use crate::state::WebState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub connection_id: String,
    pub database: String,
    pub sql: String,
    pub schema: Option<String>,
    pub execution_id: Option<String>,
    pub max_rows: Option<usize>,
    pub fetch_size: Option<usize>,
    pub page_size: Option<usize>,
    pub result_session_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub execution_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSessionRequest {
    pub connection_id: String,
    pub database: String,
    pub session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteBatchRequest {
    pub connection_id: String,
    pub database: String,
    pub statements: Vec<String>,
    pub schema: Option<String>,
}

pub async fn execute_query(
    State(state): State<Arc<WebState>>,
    Json(req): Json<ExecuteQueryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let execution_id = req.execution_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let registered = state.app.running_queries.register(execution_id);
    let cancel_token = registered.token();

    let result = dbx_core::query::execute_sql_statement_with_options(
        &state.app,
        &req.connection_id,
        &req.database,
        &req.sql,
        req.schema.as_deref(),
        Some(cancel_token),
        dbx_core::query::QueryExecutionOptions {
            max_rows: req.max_rows,
            fetch_size: req.fetch_size,
            page_size: req.page_size,
            result_session_id: req.result_session_id,
        },
    )
    .await
    .map_err(AppError)?;

    drop(registered);
    Ok(Json(serde_json::to_value(result).map_err(|e| AppError(e.to_string()))?))
}

pub async fn execute_multi(
    State(state): State<Arc<WebState>>,
    Json(req): Json<ExecuteQueryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let execution_id = req.execution_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let registered = state.app.running_queries.register(execution_id);
    let cancel_token = registered.token();

    let result = dbx_core::query::execute_multi_core_with_options(
        &state.app,
        &req.connection_id,
        &req.database,
        &req.sql,
        req.schema.as_deref(),
        Some(cancel_token),
        dbx_core::query::QueryExecutionOptions {
            max_rows: req.max_rows,
            fetch_size: req.fetch_size,
            page_size: req.page_size,
            result_session_id: req.result_session_id,
        },
    )
    .await
    .map_err(AppError)?;

    drop(registered);
    Ok(Json(serde_json::to_value(result).map_err(|e| AppError(e.to_string()))?))
}

pub async fn execute_batch(
    State(state): State<Arc<WebState>>,
    Json(req): Json<ExecuteBatchRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = dbx_core::query::execute_statements(
        &state.app,
        &req.connection_id,
        &req.database,
        &req.statements,
        req.schema.as_deref(),
    )
    .await
    .map_err(AppError)?;

    Ok(Json(serde_json::to_value(result).map_err(|e| AppError(e.to_string()))?))
}

pub async fn cancel_query(
    State(state): State<Arc<WebState>>,
    Json(req): Json<CancelRequest>,
) -> Json<serde_json::Value> {
    let cancelled = state.app.running_queries.cancel(&req.execution_id);
    Json(serde_json::json!({ "cancelled": cancelled }))
}

pub async fn close_query_session(
    State(state): State<Arc<WebState>>,
    Json(req): Json<CloseSessionRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let closed = dbx_core::query::close_query_session(&state.app, &req.connection_id, &req.database, &req.session_id)
        .await
        .map_err(AppError)?;

    Ok(Json(serde_json::json!(closed)))
}

pub async fn execute_script(
    State(state): State<Arc<WebState>>,
    Json(req): Json<ExecuteQueryRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let statements = dbx_core::sql::split_sql_statements(&req.sql);
    let result = dbx_core::query::execute_statements(
        &state.app,
        &req.connection_id,
        &req.database,
        &statements,
        req.schema.as_deref(),
    )
    .await
    .map_err(AppError)?;

    Ok(Json(serde_json::to_value(result).map_err(|e| AppError(e.to_string()))?))
}

pub async fn execute_in_transaction(
    State(state): State<Arc<WebState>>,
    Json(req): Json<ExecuteBatchRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = dbx_core::query::execute_statements_in_transaction(
        &state.app,
        &req.connection_id,
        &req.database,
        &req.statements,
        req.schema.as_deref(),
    )
    .await
    .map_err(AppError)?;

    Ok(Json(serde_json::to_value(result).map_err(|e| AppError(e.to_string()))?))
}
