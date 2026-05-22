use std::sync::Arc;
use tauri::State;

use crate::commands::connection::AppState;
use dbx_core::db;
use dbx_core::sql::split_sql_statements;

// Re-export core functions for use by other modules (e.g., sql_file.rs)
pub use dbx_core::query::execute_sql_statement;

#[tauri::command]
pub async fn execute_query(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    sql: String,
    schema: Option<String>,
    execution_id: Option<String>,
    max_rows: Option<usize>,
    fetch_size: Option<usize>,
    page_size: Option<usize>,
    result_session_id: Option<String>,
) -> Result<db::QueryResult, String> {
    let registered_query =
        execution_id.as_ref().filter(|id| !id.trim().is_empty()).map(|id| state.running_queries.register(id.clone()));
    let cancel_token = registered_query.as_ref().map(|query| query.token());

    dbx_core::query::execute_sql_statement_with_options(
        &state,
        &connection_id,
        &database,
        &sql,
        schema.as_deref(),
        cancel_token,
        dbx_core::query::QueryExecutionOptions { max_rows, fetch_size, page_size, result_session_id },
    )
    .await
}

#[tauri::command]
pub async fn execute_multi(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    sql: String,
    schema: Option<String>,
    execution_id: Option<String>,
    max_rows: Option<usize>,
    fetch_size: Option<usize>,
    page_size: Option<usize>,
    result_session_id: Option<String>,
) -> Result<Vec<db::QueryResult>, String> {
    let registered_query =
        execution_id.as_ref().filter(|id| !id.trim().is_empty()).map(|id| state.running_queries.register(id.clone()));
    let cancel_token = registered_query.as_ref().map(|query| query.token());
    let trace_id = execution_id.as_deref().unwrap_or("no-execution-id");
    log::info!(
        "[query][execute_multi:start] trace_id={} connection_id={} database={} schema={:?} sql={}",
        trace_id,
        connection_id,
        database,
        schema,
        sql
    );

    let result = dbx_core::query::execute_multi_core_with_options(
        &state,
        &connection_id,
        &database,
        &sql,
        schema.as_deref(),
        cancel_token,
        dbx_core::query::QueryExecutionOptions { max_rows, fetch_size, page_size, result_session_id },
    )
    .await;
    match &result {
        Ok(results) => log::info!(
            "[query][execute_multi:done] trace_id={} result_count={} row_counts={:?}",
            trace_id,
            results.len(),
            results.iter().map(|result| result.rows.len()).collect::<Vec<_>>()
        ),
        Err(error) => log::error!("[query][execute_multi:error] trace_id={} error={}", trace_id, error),
    }
    result
}

#[tauri::command]
pub async fn cancel_query(state: State<'_, Arc<AppState>>, execution_id: String) -> Result<bool, String> {
    Ok(state.running_queries.cancel(&execution_id))
}

#[tauri::command]
pub async fn close_query_session(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    session_id: String,
) -> Result<bool, String> {
    dbx_core::query::close_query_session(&state, &connection_id, &database, &session_id).await
}

#[tauri::command]
pub async fn execute_batch(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    statements: Vec<String>,
    schema: Option<String>,
) -> Result<db::QueryResult, String> {
    dbx_core::query::execute_statements(&state, &connection_id, &database, &statements, schema.as_deref()).await
}

#[tauri::command]
pub async fn execute_script(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    sql: String,
    schema: Option<String>,
) -> Result<db::QueryResult, String> {
    dbx_core::query::execute_statements(
        &state,
        &connection_id,
        &database,
        &split_sql_statements(&sql),
        schema.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn execute_in_transaction(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    database: String,
    statements: Vec<String>,
    schema: Option<String>,
) -> Result<db::QueryResult, String> {
    dbx_core::query::execute_statements_in_transaction(
        &state,
        &connection_id,
        &database,
        &statements,
        schema.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn analyze_sql_references(
    sql: String,
    dialect: Option<String>,
) -> Result<dbx_core::sql_analysis::SqlReferenceAnalysis, String> {
    dbx_core::sql_analysis::analyze_sql_references(&sql, dialect.as_deref())
}

#[tauri::command]
pub fn analyze_editable_query_editability(sql: String) -> Result<dbx_core::sql_editability::QueryEditability, String> {
    Ok(dbx_core::sql_editability::analyze_editable_query_editability(&sql))
}
