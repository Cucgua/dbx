use std::time::Instant;

use crate::types::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, QueryResult, TableInfo, TriggerInfo};

use super::CONNECTION_TIMEOUT_SECS;

pub struct GaussdbClient {
    client: rust_gaussdb::Client,
}

unsafe impl Send for GaussdbClient {}

impl GaussdbClient {
    async fn query_rows(&mut self, sql: &str) -> Result<Vec<Vec<Option<String>>>, String> {
        let rows = self.client.query(sql, &[]).await.map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in &rows {
            let mut vals = Vec::new();
            for i in 0..row.columns().len() {
                vals.push(row.try_get::<String>(i));
            }
            result.push(vals);
        }
        Ok(result)
    }

    async fn query_single_column(&mut self, sql: &str) -> Result<Vec<String>, String> {
        Ok(self.query_rows(sql).await?.into_iter().filter_map(|r| r.into_iter().next().flatten()).collect())
    }
}

pub async fn connect(host: &str, port: u16, database: &str, user: &str, pass: &str) -> Result<GaussdbClient, String> {
    let database = normalize_database(database);
    let dsn = format!("host={host} port={port} user={user} password={pass} dbname={database}");

    let result = tokio::time::timeout(std::time::Duration::from_secs(CONNECTION_TIMEOUT_SECS), async {
        rust_gaussdb::Client::connect(&dsn).await.map_err(|e| format!("GaussDB connection failed: {e}"))
    })
    .await
    .map_err(|_| format!("GaussDB connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?;

    result.map(|client| GaussdbClient { client })
}

fn normalize_database(database: &str) -> &str {
    let database = database.trim();
    if database.is_empty() {
        "postgres"
    } else {
        database
    }
}

pub async fn list_databases(client: &mut GaussdbClient) -> Result<Vec<DatabaseInfo>, String> {
    let rows = client
        .query_single_column("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
        .await?;
    Ok(rows.into_iter().map(|name| DatabaseInfo { name }).collect())
}

pub async fn list_schemas(client: &mut GaussdbClient) -> Result<Vec<String>, String> {
    client
        .query_single_column(
            "SELECT DISTINCT nspname FROM pg_catalog.pg_namespace n \
             WHERE nspname NOT LIKE 'pg_%' \
             AND nspname NOT IN ('information_schema', 'cstore', 'snapshot', 'db4ai', 'dbe_perf', \
               'dbe_pldebugger', 'dbe_pldeveloper', 'pkg_service', 'pkg_util', 'sqladvisor', 'blockchain') \
             ORDER BY nspname",
        )
        .await
}

pub async fn list_tables(client: &mut GaussdbClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let s = schema.replace('\'', "''");
    let sql = format!(
        "SELECT c.relname, CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'VIEW' ELSE 'TABLE' END \
         FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = '{s}' AND c.relkind IN ('r', 'v', 'm') \
         ORDER BY c.relname"
    );
    let rows = client.query_rows(&sql).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let raw_type = r.get(1).and_then(|v| v.clone()).unwrap_or_default();
            TableInfo {
                name: r.first().and_then(|v| v.clone()).unwrap_or_default(),
                table_type: if raw_type.contains("VIEW") { "VIEW".to_string() } else { "TABLE".to_string() },
                comment: None,
            }
        })
        .collect())
}

pub async fn get_columns(client: &mut GaussdbClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");

    let pk_rows = client
        .query_single_column(&format!(
            "SELECT a.attname FROM pg_catalog.pg_index i \
             JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = (SELECT oid FROM pg_catalog.pg_class WHERE relname = '{t}' \
               AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = '{s}')) \
             AND i.indisprimary"
        ))
        .await?;
    let pk_names: std::collections::HashSet<String> = pk_rows.into_iter().collect();

    let col_rows = client
        .query_rows(&format!(
            "SELECT a.attname, format_type(a.atttypid, a.atttypmod), \
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
             pg_catalog.pg_get_expr(d.adbin, d.adrelid), \
             CASE WHEN t.typname IN ('numeric', 'float4', 'float8') THEN COALESCE(((a.atttypmod - 4) >> 16) & 65535, -1) ELSE NULL END, \
             CASE WHEN t.typname = 'numeric' THEN COALESCE((a.atttypmod - 4) & 65535, -1) ELSE NULL END, \
             CASE WHEN a.atttypmod > 0 AND t.typname IN ('varchar', 'bpchar') THEN a.atttypmod - 4 ELSE NULL END \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_type t ON t.oid = a.atttypid \
             LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE a.attrelid = (SELECT oid FROM pg_catalog.pg_class WHERE relname = '{t}' \
               AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = '{s}')) \
             AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum"
        ))
        .await?;

    Ok(col_rows
        .into_iter()
        .map(|r| {
            let name = r.first().and_then(|v| v.clone()).unwrap_or_default();
            let data_type = r.get(1).and_then(|v| v.clone()).unwrap_or_default();
            let num_prec = r.get(4).and_then(|v| v.as_ref()?.parse::<i32>().ok());
            let num_scale = r.get(5).and_then(|v| v.as_ref()?.parse::<i32>().ok());
            let char_len = r.get(6).and_then(|v| v.as_ref()?.parse::<i32>().ok());
            ColumnInfo {
                is_primary_key: pk_names.contains(&name),
                name,
                data_type,
                is_nullable: r.get(2).and_then(|v| v.as_ref()).map(|v| v == "YES").unwrap_or(false),
                column_default: r.get(3).and_then(|v| v.clone()).filter(|v| !v.is_empty()),
                extra: None,
                comment: None,
                numeric_precision: num_prec,
                numeric_scale: num_scale,
                character_maximum_length: char_len,
            }
        })
        .collect())
}

pub async fn list_indexes(client: &mut GaussdbClient, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let sql = format!(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '{s}' AND tablename = '{t}' ORDER BY indexname"
    );
    let rows = client.query_rows(&sql).await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.first().and_then(|v| v.clone()).unwrap_or_default();
            let def = r.get(1).and_then(|v| v.clone()).unwrap_or_default();
            let is_unique = def.to_uppercase().contains("UNIQUE");
            let is_primary = def.to_uppercase().contains("PRIMARY");
            let columns = def
                .rsplit_once('(')
                .and_then(|(_, rest)| rest.strip_suffix(')'))
                .map(|cols| cols.split(',').map(|c| c.trim().trim_matches('"').to_string()).collect())
                .unwrap_or_default();
            IndexInfo {
                name,
                columns,
                is_unique,
                is_primary,
                filter: None,
                index_type: None,
                included_columns: None,
                comment: None,
            }
        })
        .collect())
}

pub async fn list_foreign_keys(
    client: &mut GaussdbClient,
    schema: &str,
    table: &str,
) -> Result<Vec<ForeignKeyInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let sql = format!(
        "SELECT con.conname, a.attname, cl2.relname, a2.attname \
         FROM pg_catalog.pg_constraint con \
         JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) \
         JOIN pg_catalog.pg_class cl2 ON cl2.oid = con.confrelid \
         JOIN pg_catalog.pg_attribute a2 ON a2.attrelid = con.confrelid AND a2.attnum = ANY(con.confkey) \
         WHERE con.contype = 'f' AND n.nspname = '{s}' AND cl.relname = '{t}' \
         ORDER BY con.conname"
    );
    let rows = client.query_rows(&sql).await?;
    Ok(rows
        .into_iter()
        .map(|r| ForeignKeyInfo {
            name: r.first().and_then(|v| v.clone()).unwrap_or_default(),
            column: r.get(1).and_then(|v| v.clone()).unwrap_or_default(),
            ref_table: r.get(2).and_then(|v| v.clone()).unwrap_or_default(),
            ref_column: r.get(3).and_then(|v| v.clone()).unwrap_or_default(),
        })
        .collect())
}

pub async fn list_triggers(client: &mut GaussdbClient, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let sql = format!(
        "SELECT t.tgname, \
         CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' WHEN t.tgtype & 8 = 8 THEN 'DELETE' \
         WHEN t.tgtype & 16 = 16 THEN 'UPDATE' ELSE 'UNKNOWN' END, \
         CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END \
         FROM pg_catalog.pg_trigger t \
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE NOT t.tgisinternal AND n.nspname = '{s}' AND c.relname = '{t}' \
         ORDER BY t.tgname"
    );
    let rows = client.query_rows(&sql).await?;
    Ok(rows
        .into_iter()
        .map(|r| TriggerInfo {
            name: r.first().and_then(|v| v.clone()).unwrap_or_default(),
            event: r.get(1).and_then(|v| v.clone()).unwrap_or_default(),
            timing: r.get(2).and_then(|v| v.clone()).unwrap_or_default(),
        })
        .collect())
}

pub async fn execute_query(client: &mut GaussdbClient, sql: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let sql = sql.trim().trim_end_matches(';');
    let trimmed = sql.to_uppercase();

    if trimmed.starts_with("SELECT")
        || trimmed.starts_with("WITH")
        || trimmed.starts_with("SHOW")
        || trimmed.starts_with("EXPLAIN")
    {
        let rows = client.client.query(sql, &[]).await.map_err(|e| e.to_string())?;

        let columns: Vec<String> = if let Some(first) = rows.first() {
            first.columns().iter().map(|c| c.name.clone()).collect()
        } else {
            Vec::new()
        };

        let mut result_rows = Vec::new();
        for row in &rows {
            let vals: Vec<serde_json::Value> = (0..row.columns().len())
                .map(|i| row.try_get::<String>(i).map(serde_json::Value::String).unwrap_or(serde_json::Value::Null))
                .collect();
            result_rows.push(vals);
            if result_rows.len() >= crate::query::MAX_ROWS {
                break;
            }
        }

        let truncated = result_rows.len() >= crate::query::MAX_ROWS;
        Ok(QueryResult {
            columns,
            rows: result_rows,
            affected_rows: 0,
            execution_time_ms: start.elapsed().as_millis(),
            truncated,
        })
    } else {
        let affected = client.client.execute(sql).await.map_err(|e| e.to_string())?;
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: affected,
            execution_time_ms: start.elapsed().as_millis(),
            truncated: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_database;

    #[test]
    fn normalize_database_defaults_blank_to_postgres() {
        assert_eq!(normalize_database(""), "postgres");
        assert_eq!(normalize_database("   "), "postgres");
    }

    #[test]
    fn normalize_database_keeps_explicit_database() {
        assert_eq!(normalize_database("app"), "app");
    }
}
