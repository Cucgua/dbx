use std::time::Instant;

use odbc_api::{buffers::TextRowSet, ConnectionOptions, Cursor, ResultSetMetadata};

use crate::types::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, QueryResult, TableInfo, TriggerInfo};

use super::CONNECTION_TIMEOUT_SECS;

pub struct GaussdbClient {
    conn: odbc_api::Connection<'static>,
}

unsafe impl Send for GaussdbClient {}

impl GaussdbClient {
    pub fn query_rows(&self, sql: &str) -> Result<Vec<Vec<String>>, String> {
        match self.conn.execute(sql, (), None).map_err(|e| e.to_string())? {
            Some(cursor) => read_cursor(cursor),
            None => Ok(vec![]),
        }
    }

    fn query_single_column(&self, sql: &str) -> Result<Vec<String>, String> {
        Ok(self.query_rows(sql)?.into_iter().filter_map(|r| r.into_iter().next()).collect())
    }
}

fn read_cursor(cursor: impl Cursor) -> Result<Vec<Vec<String>>, String> {
    let mut cursor = cursor;
    let col_count = cursor.num_result_cols().map_err(|e| e.to_string())? as u16;
    let buffer = TextRowSet::for_cursor(1000, &mut cursor, Some(8192)).map_err(|e| e.to_string())?;
    let mut row_cursor = cursor.bind_buffer(buffer).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    while let Some(batch) = row_cursor.fetch().map_err(|e| e.to_string())? {
        for row_idx in 0..batch.num_rows() {
            let vals: Vec<String> = (0..col_count as usize)
                .map(|col| {
                    batch.at(col, row_idx).and_then(|bytes| std::str::from_utf8(bytes).ok()).unwrap_or("").to_string()
                })
                .collect();
            rows.push(vals);
        }
    }
    Ok(rows)
}

pub async fn connect(host: &str, port: u16, database: &str, user: &str, pass: &str) -> Result<GaussdbClient, String> {
    let conn_str = format!(
        "Driver={{GaussDBA}};Servername={host};Port={port};Database={db};UID={user};PWD={pass}",
        host = host,
        port = port,
        db = database,
        user = user,
        pass = pass,
    );

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(CONNECTION_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            super::ODBC_ENV.connect_with_connection_string(&conn_str, ConnectionOptions::default())
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("Data source name not found") || msg.contains("Can't open lib") {
                        format!(
                            "GaussDB ODBC driver not found. Please install the GaussDB ODBC driver \
                             and register it in odbcinst.ini (Linux/macOS) or the ODBC Data Source Administrator (Windows). \
                             Original error: {msg}"
                        )
                    } else {
                        format!("GaussDB connection failed: {msg}")
                    }
                })
                .map(|conn| GaussdbClient { conn })
        }),
    )
    .await
    .map_err(|_| format!("GaussDB connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?
    .map_err(|e| format!("GaussDB connection task failed: {e}"))?;

    result
}

pub fn list_databases(client: &GaussdbClient) -> Result<Vec<DatabaseInfo>, String> {
    let rows =
        client.query_single_column("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")?;
    Ok(rows.into_iter().map(|name| DatabaseInfo { name }).collect())
}

pub fn list_schemas(client: &GaussdbClient) -> Result<Vec<String>, String> {
    client.query_single_column(
        "SELECT DISTINCT nspname FROM pg_catalog.pg_namespace n \
         WHERE nspname NOT LIKE 'pg_%' \
         AND nspname NOT IN ('information_schema', 'cstore', 'snapshot', 'db4ai', 'dbe_perf', \
           'dbe_pldebugger', 'dbe_pldeveloper', 'pkg_service', 'pkg_util', 'sqladvisor', 'blockchain') \
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'v', 'm')) \
         ORDER BY nspname",
    )
}

pub fn list_tables(client: &GaussdbClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let s = schema.replace('\'', "''");
    let sql = format!(
        "SELECT c.relname, CASE c.relkind WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'VIEW' ELSE 'TABLE' END \
         FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = '{s}' AND c.relkind IN ('r', 'v', 'm') \
         ORDER BY c.relname"
    );
    let rows = client.query_rows(&sql)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let raw_type = r.get(1).cloned().unwrap_or_default();
            TableInfo {
                name: r.first().cloned().unwrap_or_default(),
                table_type: if raw_type.contains("VIEW") { "VIEW".to_string() } else { "TABLE".to_string() },
            }
        })
        .collect())
}

pub fn get_columns(client: &GaussdbClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");

    let pk_rows = client.query_single_column(&format!(
        "SELECT a.attname FROM pg_catalog.pg_index i \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
         WHERE i.indrelid = (SELECT oid FROM pg_catalog.pg_class WHERE relname = '{t}' \
           AND relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = '{s}')) \
         AND i.indisprimary"
    ))?;
    let pk_names: std::collections::HashSet<String> = pk_rows.into_iter().collect();

    let col_rows = client.query_rows(&format!(
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
    ))?;

    Ok(col_rows
        .into_iter()
        .map(|r| {
            let name = r.first().cloned().unwrap_or_default();
            let data_type = r.get(1).cloned().unwrap_or_default();
            let num_prec = r.get(4).and_then(|v| v.parse::<i32>().ok());
            let num_scale = r.get(5).and_then(|v| v.parse::<i32>().ok());
            let char_len = r.get(6).and_then(|v| v.parse::<i32>().ok());
            ColumnInfo {
                is_primary_key: pk_names.contains(&name),
                name,
                data_type,
                is_nullable: r.get(2).map(|v| v == "YES").unwrap_or(false),
                column_default: r.get(3).filter(|v| !v.is_empty()).cloned(),
                extra: None,
                comment: None,
                numeric_precision: num_prec,
                numeric_scale: num_scale,
                character_maximum_length: char_len,
            }
        })
        .collect())
}

pub fn list_indexes(client: &GaussdbClient, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let sql = format!(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '{s}' AND tablename = '{t}' ORDER BY indexname"
    );
    let rows = client.query_rows(&sql)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let name = r.first().cloned().unwrap_or_default();
            let def = r.get(1).cloned().unwrap_or_default();
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

pub fn list_foreign_keys(client: &GaussdbClient, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, String> {
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
    let rows = client.query_rows(&sql)?;
    Ok(rows
        .into_iter()
        .map(|r| ForeignKeyInfo {
            name: r.first().cloned().unwrap_or_default(),
            column: r.get(1).cloned().unwrap_or_default(),
            ref_table: r.get(2).cloned().unwrap_or_default(),
            ref_column: r.get(3).cloned().unwrap_or_default(),
        })
        .collect())
}

pub fn list_triggers(client: &GaussdbClient, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let sql = format!(
        "SELECT t.tgname, em.event, CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END \
         FROM pg_catalog.pg_trigger t \
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         CROSS JOIN LATERAL ( \
           SELECT CASE \
             WHEN t.tgtype & 4 = 4 THEN 'INSERT' \
             WHEN t.tgtype & 8 = 8 THEN 'DELETE' \
             WHEN t.tgtype & 16 = 16 THEN 'UPDATE' \
             ELSE 'UNKNOWN' END AS event \
         ) em \
         WHERE NOT t.tgisinternal AND n.nspname = '{s}' AND c.relname = '{t}' \
         ORDER BY t.tgname"
    );
    let rows = client.query_rows(&sql)?;
    Ok(rows
        .into_iter()
        .map(|r| TriggerInfo {
            name: r.first().cloned().unwrap_or_default(),
            event: r.get(1).cloned().unwrap_or_default(),
            timing: r.get(2).cloned().unwrap_or_default(),
        })
        .collect())
}

pub fn execute_query_sync(client: &GaussdbClient, sql: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let sql = sql.trim().trim_end_matches(';');
    let trimmed = sql.to_uppercase();

    if trimmed.starts_with("SELECT")
        || trimmed.starts_with("WITH")
        || trimmed.starts_with("SHOW")
        || trimmed.starts_with("DESCRIBE")
        || trimmed.starts_with("EXPLAIN")
    {
        match client.conn.execute(sql, (), None).map_err(|e| e.to_string())? {
            Some(mut cursor) => {
                let col_count = cursor.num_result_cols().map_err(|e| e.to_string())? as u16;
                let columns: Vec<String> = (1..=col_count)
                    .map(|i| cursor.col_name(i).map_err(|e| e.to_string()).unwrap_or_else(|_| format!("col{i}")))
                    .collect();

                let buffer = TextRowSet::for_cursor(1000, &mut cursor, Some(8192)).map_err(|e| e.to_string())?;
                let mut row_cursor = cursor.bind_buffer(buffer).map_err(|e| e.to_string())?;

                let mut rows = Vec::new();
                while let Some(batch) = row_cursor.fetch().map_err(|e| e.to_string())? {
                    for row_idx in 0..batch.num_rows() {
                        let vals: Vec<serde_json::Value> = (0..col_count as usize)
                            .map(|col| {
                                batch
                                    .at(col, row_idx)
                                    .and_then(|bytes| std::str::from_utf8(bytes).ok())
                                    .map(|s| serde_json::Value::String(s.to_string()))
                                    .unwrap_or(serde_json::Value::Null)
                            })
                            .collect();
                        rows.push(vals);
                        if rows.len() >= crate::query::MAX_ROWS {
                            break;
                        }
                    }
                    if rows.len() >= crate::query::MAX_ROWS {
                        break;
                    }
                }

                let truncated = rows.len() >= crate::query::MAX_ROWS;
                Ok(QueryResult {
                    columns,
                    rows,
                    affected_rows: 0,
                    execution_time_ms: start.elapsed().as_millis(),
                    truncated,
                })
            }
            None => Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: 0,
                execution_time_ms: start.elapsed().as_millis(),
                truncated: false,
            }),
        }
    } else {
        match client.conn.execute(sql, (), None) {
            Ok(Some(_cursor)) => Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: 0,
                execution_time_ms: start.elapsed().as_millis(),
                truncated: false,
            }),
            Ok(None) => Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: 0,
                execution_time_ms: start.elapsed().as_millis(),
                truncated: false,
            }),
            Err(e) => Err(e.to_string()),
        }
    }
}
