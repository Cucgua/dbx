use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connection::AppState;
use crate::models::connection::DatabaseType;
use crate::query::{execute_sql_statement_with_options, QueryExecutionOptions};
use crate::sql_dialect::{
    build_count_table_sql, build_table_select_sql, qualified_table_name, quote_table_identifier, TableSelectSqlOptions,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDataRowsOptions {
    pub columns: Vec<String>,
    pub key_columns: Vec<String>,
    #[serde(default)]
    pub source_rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub target_rows: Vec<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataComparePreparationOptions {
    pub table_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub columns: Vec<String>,
    pub key_columns: Vec<String>,
    #[serde(default)]
    pub source_rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub target_rows: Vec<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_type: Option<DatabaseType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareFromTablesOptions {
    pub source_connection_id: String,
    pub source_database: String,
    pub source_schema: String,
    pub source_table: String,
    pub target_connection_id: String,
    pub target_database: String,
    pub target_schema: String,
    pub target_table: String,
    pub columns: Vec<String>,
    pub key_columns: Vec<String>,
    pub row_limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareChangedCell {
    pub column: String,
    pub source: Value,
    pub target: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareRow {
    pub key: String,
    pub key_values: HashMap<String, Value>,
    pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareModifiedRow {
    pub key: String,
    pub key_values: HashMap<String, Value>,
    pub source_values: HashMap<String, Value>,
    pub target_values: HashMap<String, Value>,
    pub changes: Vec<DataCompareChangedCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareResult {
    pub added: Vec<DataCompareRow>,
    pub removed: Vec<DataCompareRow>,
    pub modified: Vec<DataCompareModifiedRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataComparePreparation {
    pub result: DataCompareResult,
    pub sync_statements: Vec<String>,
    pub sync_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataCompareFromTablesPreparation {
    pub result: DataCompareResult,
    pub sync_statements: Vec<String>,
    pub sync_sql: String,
    pub source_row_count: u64,
    pub target_row_count: u64,
    pub source_truncated: bool,
    pub target_truncated: bool,
}

pub fn prepare_data_compare(options: DataComparePreparationOptions) -> Result<DataComparePreparation, String> {
    let result = compare_data_rows(CompareDataRowsOptions {
        columns: options.columns.clone(),
        key_columns: options.key_columns.clone(),
        source_rows: options.source_rows,
        target_rows: options.target_rows,
    })?;
    let sync_statements = generate_data_sync_statements(&GenerateDataSyncSqlOptions {
        table_name: options.table_name,
        schema: options.schema,
        columns: options.columns,
        key_columns: options.key_columns,
        diff: result.clone(),
        database_type: options.database_type,
    });
    let sync_sql = sync_statements.join("\n");
    Ok(DataComparePreparation { result, sync_statements, sync_sql })
}

pub async fn prepare_data_compare_from_tables(
    state: &AppState,
    options: DataCompareFromTablesOptions,
) -> Result<DataCompareFromTablesPreparation, String> {
    let source_database_type = connection_database_type(state, &options.source_connection_id).await?;
    let target_database_type = connection_database_type(state, &options.target_connection_id).await?;
    let row_limit = options.row_limit.max(1);

    let source_count_sql =
        build_count_table_sql(Some(source_database_type), Some(&options.source_schema), &options.source_table);
    let target_count_sql =
        build_count_table_sql(Some(target_database_type), Some(&options.target_schema), &options.target_table);

    let source_count_result = execute_sql_statement_with_options(
        state,
        &options.source_connection_id,
        &options.source_database,
        &source_count_sql,
        Some(&options.source_schema),
        None,
        QueryExecutionOptions { max_rows: Some(1), ..Default::default() },
    )
    .await?;
    let target_count_result = execute_sql_statement_with_options(
        state,
        &options.target_connection_id,
        &options.target_database,
        &target_count_sql,
        Some(&options.target_schema),
        None,
        QueryExecutionOptions { max_rows: Some(1), ..Default::default() },
    )
    .await?;
    let source_row_count = first_count(&source_count_result.rows)?;
    let target_row_count = first_count(&target_count_result.rows)?;

    let source_sql = build_data_compare_select_sql(
        source_database_type,
        &options.source_schema,
        &options.source_table,
        &options.columns,
        &options.key_columns,
        row_limit,
    );
    let target_sql = build_data_compare_select_sql(
        target_database_type,
        &options.target_schema,
        &options.target_table,
        &options.columns,
        &options.key_columns,
        row_limit,
    );

    let source_result = execute_sql_statement_with_options(
        state,
        &options.source_connection_id,
        &options.source_database,
        &source_sql,
        Some(&options.source_schema),
        None,
        QueryExecutionOptions { max_rows: Some(row_limit), ..Default::default() },
    )
    .await?;
    let target_result = execute_sql_statement_with_options(
        state,
        &options.target_connection_id,
        &options.target_database,
        &target_sql,
        Some(&options.target_schema),
        None,
        QueryExecutionOptions { max_rows: Some(row_limit), ..Default::default() },
    )
    .await?;

    let preparation = prepare_data_compare(DataComparePreparationOptions {
        table_name: options.target_table,
        schema: Some(options.target_schema),
        columns: options.columns,
        key_columns: options.key_columns,
        source_rows: source_result.rows,
        target_rows: target_result.rows,
        database_type: Some(target_database_type),
    })?;

    Ok(DataCompareFromTablesPreparation {
        result: preparation.result,
        sync_statements: preparation.sync_statements,
        sync_sql: preparation.sync_sql,
        source_row_count,
        target_row_count,
        source_truncated: source_row_count > row_limit as u64,
        target_truncated: target_row_count > row_limit as u64,
    })
}

pub fn compare_data_rows(options: CompareDataRowsOptions) -> Result<DataCompareResult, String> {
    if options.key_columns.is_empty() {
        return Err("At least one key column is required for data comparison".to_string());
    }

    let mut source: HashMap<String, HashMap<String, Value>> = HashMap::new();
    let mut target: HashMap<String, HashMap<String, Value>> = HashMap::new();
    let mut source_order = Vec::new();
    let mut target_order = Vec::new();

    for row in &options.source_rows {
        let item = row_object(&options.columns, row);
        let key = key_for(&item, &options.key_columns);
        if source.contains_key(&key) {
            return Err(format!("Duplicate source key: {key}"));
        }
        source_order.push(key.clone());
        source.insert(key, item);
    }

    for row in &options.target_rows {
        let item = row_object(&options.columns, row);
        let key = key_for(&item, &options.key_columns);
        if target.contains_key(&key) {
            return Err(format!("Duplicate target key: {key}"));
        }
        target_order.push(key.clone());
        target.insert(key, item);
    }

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();

    for key in &source_order {
        let source_values = source.get(key).expect("source key should exist");
        let Some(target_values) = target.get(key) else {
            added.push(DataCompareRow {
                key: key.clone(),
                key_values: key_values(source_values, &options.key_columns),
                values: source_values.clone(),
            });
            continue;
        };

        let changes: Vec<DataCompareChangedCell> = options
            .columns
            .iter()
            .filter(|column| !options.key_columns.contains(column))
            .filter(|column| value_for(source_values, column) != value_for(target_values, column))
            .map(|column| DataCompareChangedCell {
                column: column.clone(),
                source: value_for(source_values, column),
                target: value_for(target_values, column),
            })
            .collect();

        if !changes.is_empty() {
            modified.push(DataCompareModifiedRow {
                key: key.clone(),
                key_values: key_values(source_values, &options.key_columns),
                source_values: source_values.clone(),
                target_values: target_values.clone(),
                changes,
            });
        }
    }

    for key in &target_order {
        if let Some(target_values) = target.get(key).filter(|_| !source.contains_key(key)) {
            removed.push(DataCompareRow {
                key: key.clone(),
                key_values: key_values(target_values, &options.key_columns),
                values: target_values.clone(),
            });
        }
    }

    Ok(DataCompareResult { added, removed, modified })
}

#[derive(Debug, Clone)]
struct GenerateDataSyncSqlOptions {
    table_name: String,
    schema: Option<String>,
    columns: Vec<String>,
    key_columns: Vec<String>,
    diff: DataCompareResult,
    database_type: Option<DatabaseType>,
}

fn row_object(columns: &[String], row: &[Value]) -> HashMap<String, Value> {
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| (column.clone(), row.get(index).cloned().unwrap_or(Value::Null)))
        .collect()
}

fn key_for(row: &HashMap<String, Value>, key_columns: &[String]) -> String {
    key_columns.iter().map(|column| json_stringify(&value_for(row, column))).collect::<Vec<_>>().join("\u{001f}")
}

fn key_values(row: &HashMap<String, Value>, key_columns: &[String]) -> HashMap<String, Value> {
    key_columns.iter().map(|column| (column.clone(), value_for(row, column))).collect()
}

fn value_for(row: &HashMap<String, Value>, column: &str) -> Value {
    row.get(column).cloned().unwrap_or(Value::Null)
}

fn json_stringify(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn generate_data_sync_statements(options: &GenerateDataSyncSqlOptions) -> Vec<String> {
    let table = qualified_table_name(options.database_type, options.schema.as_deref(), &options.table_name);
    let mut statements = Vec::new();

    for row in &options.diff.added {
        let columns = options
            .columns
            .iter()
            .map(|column| quote_table_identifier(options.database_type, column))
            .collect::<Vec<_>>()
            .join(", ");
        let values = options
            .columns
            .iter()
            .map(|column| {
                format_grid_sql_literal(row.values.get(column).unwrap_or(&Value::Null), options.database_type)
            })
            .collect::<Vec<_>>()
            .join(", ");
        statements.push(format!("INSERT INTO {table} ({columns}) VALUES ({values});"));
    }

    for row in &options.diff.modified {
        let assignments = row
            .changes
            .iter()
            .map(|change| {
                format!(
                    "{} = {}",
                    quote_table_identifier(options.database_type, &change.column),
                    format_grid_sql_literal(&change.source, options.database_type)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        statements.push(format!(
            "UPDATE {table} SET {assignments} WHERE {};",
            where_by_key(&row.key_values, &options.key_columns, options.database_type)
        ));
    }

    for row in &options.diff.removed {
        statements.push(format!(
            "DELETE FROM {table} WHERE {};",
            where_by_key(&row.key_values, &options.key_columns, options.database_type)
        ));
    }

    statements
}

async fn connection_database_type(state: &AppState, connection_id: &str) -> Result<DatabaseType, String> {
    state
        .configs
        .read()
        .await
        .get(connection_id)
        .map(|config| config.db_type)
        .ok_or_else(|| format!("Connection config not found: {connection_id}"))
}

fn first_count(rows: &[Vec<Value>]) -> Result<u64, String> {
    let value = rows.first().and_then(|row| row.first()).ok_or_else(|| "COUNT query returned no rows".to_string())?;
    match value {
        Value::Number(number) => {
            number.as_u64().or_else(|| number.as_i64().and_then(|value| u64::try_from(value).ok()))
        }
        Value::String(text) => text.parse::<u64>().ok(),
        _ => None,
    }
    .ok_or_else(|| format!("COUNT query returned non-numeric value: {value}"))
}

fn build_data_compare_select_sql(
    database_type: DatabaseType,
    schema: &str,
    table_name: &str,
    columns: &[String],
    key_columns: &[String],
    row_limit: usize,
) -> String {
    build_table_select_sql(TableSelectSqlOptions {
        database_type: Some(database_type),
        schema: Some(schema),
        table_name,
        columns,
        order_columns: key_columns,
        limit: row_limit,
    })
}

fn where_by_key(
    key_values: &HashMap<String, Value>,
    key_columns: &[String],
    database_type: Option<DatabaseType>,
) -> String {
    key_columns
        .iter()
        .map(|column| {
            format!(
                "{} = {}",
                quote_table_identifier(database_type, column),
                format_grid_sql_literal(key_values.get(column).unwrap_or(&Value::Null), database_type)
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn format_grid_sql_literal(value: &Value, database_type: Option<DatabaseType>) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(number) => number.to_string(),
        Value::String(text) if text.is_empty() && database_type == Some(DatabaseType::SqlServer) => "N''".to_string(),
        Value::String(text) if text.is_empty() => "''".to_string(),
        Value::String(text) => {
            let escaped = format!("'{}'", literal_text(text, database_type).replace('\\', "\\\\").replace('\'', "''"));
            if database_type == Some(DatabaseType::SqlServer) {
                format!("N{escaped}")
            } else {
                escaped
            }
        }
        other => {
            let text = other.to_string();
            let escaped = format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''"));
            if database_type == Some(DatabaseType::SqlServer) {
                format!("N{escaped}")
            } else {
                escaped
            }
        }
    }
}

fn literal_text(text: &str, database_type: Option<DatabaseType>) -> String {
    if database_type == Some(DatabaseType::Tdengine) {
        return format_tdengine_timestamp_literal_text(text);
    }
    text.to_string()
}

fn format_tdengine_timestamp_literal_text(text: &str) -> String {
    // Keep non-timestamp text unchanged; TDengine timestamp normalization is UI-parity best effort in Rust.
    if text.len() < 19 || !text.as_bytes().get(10).is_some_and(|ch| *ch == b' ') {
        return text.to_string();
    }
    text.replacen(' ', "T", 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::connection::DatabaseType;
    use serde_json::json;

    #[test]
    fn compares_rows_by_primary_key_and_reports_added_removed_and_modified_rows() {
        let diff = compare_data_rows(CompareDataRowsOptions {
            columns: vec!["id".to_string(), "name".to_string(), "active".to_string()],
            key_columns: vec!["id".to_string()],
            source_rows: vec![
                vec![json!(1), json!("Ada"), json!(true)],
                vec![json!(2), json!("Bob"), json!(false)],
                vec![json!(4), json!("Dora"), json!(true)],
            ],
            target_rows: vec![
                vec![json!(1), json!("Ada"), json!(true)],
                vec![json!(2), json!("Bobby"), json!(false)],
                vec![json!(3), json!("Cara"), json!(true)],
            ],
        })
        .expect("data comparison should succeed");

        assert_eq!(
            diff.added.iter().map(|row| row.key_values.get("id").cloned()).collect::<Vec<_>>(),
            vec![Some(json!(4))]
        );
        assert_eq!(
            diff.removed.iter().map(|row| row.key_values.get("id").cloned()).collect::<Vec<_>>(),
            vec![Some(json!(3))]
        );
        assert_eq!(diff.modified[0].changes[0].column, "name");
        assert_eq!(diff.modified[0].changes[0].source, json!("Bob"));
        assert_eq!(diff.modified[0].changes[0].target, json!("Bobby"));
    }

    #[test]
    fn generates_data_synchronization_sql() {
        let preparation = prepare_data_compare(DataComparePreparationOptions {
            table_name: "users".to_string(),
            schema: Some("public".to_string()),
            columns: vec!["id".to_string(), "name".to_string(), "active".to_string()],
            key_columns: vec!["id".to_string()],
            source_rows: vec![vec![json!(1), json!("Ada"), json!(true)], vec![json!(2), json!("Bob"), json!(false)]],
            target_rows: vec![
                vec![json!(1), json!("Ada Lovelace"), json!(true)],
                vec![json!(3), json!("Cara"), json!(true)],
            ],
            database_type: Some(DatabaseType::Postgres),
        })
        .expect("data compare preparation should succeed");

        assert_eq!(
            preparation.sync_sql,
            [
                "INSERT INTO \"public\".\"users\" (\"id\", \"name\", \"active\") VALUES (2, 'Bob', FALSE);",
                "UPDATE \"public\".\"users\" SET \"name\" = 'Ada' WHERE \"id\" = 1;",
                "DELETE FROM \"public\".\"users\" WHERE \"id\" = 3;",
            ]
            .join("\n")
        );
        assert_eq!(preparation.sync_statements.len(), 3);
    }

    #[test]
    fn requires_at_least_one_key_column() {
        let err = compare_data_rows(CompareDataRowsOptions {
            columns: vec!["id".to_string()],
            key_columns: Vec::new(),
            source_rows: vec![vec![json!(1)]],
            target_rows: vec![vec![json!(1)]],
        })
        .expect_err("missing key columns should fail");

        assert!(err.contains("At least one key column"));
    }

    #[test]
    fn rejects_duplicate_row_keys() {
        let err = compare_data_rows(CompareDataRowsOptions {
            columns: vec!["id".to_string(), "name".to_string()],
            key_columns: vec!["id".to_string()],
            source_rows: vec![vec![json!(1), json!("Ada")], vec![json!(1), json!("Ada Clone")]],
            target_rows: vec![vec![json!(1), json!("Ada")]],
        })
        .expect_err("duplicate source keys should fail");

        assert!(err.contains("Duplicate source key"));
    }

    #[test]
    fn builds_backend_table_select_sql_with_explicit_columns_and_key_order() {
        assert_eq!(
            build_data_compare_select_sql(
                DatabaseType::Postgres,
                "public",
                "users",
                &["id".to_string(), "name".to_string()],
                &["id".to_string()],
                1000,
            ),
            "SELECT \"id\", \"name\" FROM \"public\".\"users\" ORDER BY \"id\" ASC LIMIT 1000;"
        );
    }

    #[test]
    fn builds_backend_table_select_sql_for_sqlserver_limit_syntax() {
        assert_eq!(
            build_data_compare_select_sql(
                DatabaseType::SqlServer,
                "dbo",
                "users",
                &["id".to_string(), "name".to_string()],
                &["id".to_string()],
                50,
            ),
            "SELECT TOP (50) [id], [name] FROM [dbo].[users] ORDER BY [id] ASC"
        );
    }

    #[test]
    fn shared_sql_dialect_helpers_build_data_compare_table_sql() {
        use crate::sql_dialect::{
            build_count_table_sql as build_shared_count_table_sql, build_table_select_sql, TableSelectSqlOptions,
        };

        assert_eq!(
            build_shared_count_table_sql(Some(DatabaseType::Postgres), Some("public"), "users"),
            "SELECT COUNT(*) AS row_count FROM \"public\".\"users\""
        );
        assert_eq!(
            build_table_select_sql(TableSelectSqlOptions {
                database_type: Some(DatabaseType::Oracle),
                schema: Some("APP"),
                table_name: "EVENTS",
                columns: &["ID".to_string(), "NAME".to_string()],
                order_columns: &["ID".to_string()],
                limit: 25,
            }),
            "SELECT \"ID\", \"NAME\" FROM \"APP\".\"EVENTS\" ORDER BY \"ID\" ASC FETCH FIRST 25 ROWS ONLY"
        );
    }
}
