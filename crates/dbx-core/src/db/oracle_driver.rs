use log;
use rust_oracle::{Config, Connection};
use std::time::Instant;

use super::{connection_timeout, CONNECTION_TIMEOUT_SECS};
use crate::sql::starts_with_executable_sql_keyword;
use crate::types::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, QueryResult, TableInfo, TriggerInfo};

pub type OracleClient = Connection;

pub async fn connect(
    host: &str,
    port: u16,
    service: &str,
    user: &str,
    pass: &str,
    sysdba: bool,
) -> Result<OracleClient, String> {
    let config = Config::new(host, port, service, user, pass).with_statement_cache_size(0).sysdba_flag(sysdba);
    let conn = tokio::time::timeout(connection_timeout(), Connection::connect_with_config(config))
        .await
        .map_err(|_| format!("Oracle connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?
        .map_err(|e| format!("Oracle connection failed: {e}"))?;

    Ok(conn)
}

fn value_to_json(val: &rust_oracle::Value) -> serde_json::Value {
    match val {
        rust_oracle::Value::Null => serde_json::Value::Null,
        rust_oracle::Value::String(s) => serde_json::Value::String(s.clone()),
        rust_oracle::Value::Integer(n) => serde_json::Value::Number((*n).into()),
        rust_oracle::Value::Float(f) => {
            serde_json::Number::from_f64(*f).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        }
        rust_oracle::Value::Boolean(b) => serde_json::Value::Bool(*b),
        rust_oracle::Value::Json(v) => v.clone(),
        _ => serde_json::Value::String(format!("{val:?}")),
    }
}

pub async fn list_databases(conn: &OracleClient) -> Result<Vec<DatabaseInfo>, String> {
    let result = conn
        .query(
            "SELECT username FROM all_users \
             WHERE username NOT IN (\
               'SYS','SYSTEM','SYSMAN','DBSNMP','SYSBACKUP','SYSDG','SYSKM','OUTLN',\
               'AUDSYS','LBACSYS','DVF','DVSYS','APPQOSSYS','CTXSYS','MDSYS','MDDATA',\
               'ORDSYS','ORDDATA','ORDPLUGINS','XDB','ANONYMOUS','DIP','EXFSYS',\
               'GSMADMIN_INTERNAL','GSMCATUSER','GSMUSER','OJVMSYS','OLAPSYS',\
               'ORACLE_OCM','SI_INFORMTN_SCHEMA','WMSYS','XS$NULL','DBSFWUSER',\
               'REMOTE_SCHEDULER_AGENT','PDBADMIN','DGPDB_INT','OPS$ORACLE',\
               'GGSYS','FLOWS_FILES','APEX_PUBLIC_USER'\
             ) \
             AND username NOT LIKE 'APEX_%' \
             AND username NOT LIKE 'FLOWS_%' \
             AND username NOT LIKE '%$%' \
             ORDER BY username",
            &[],
        )
        .await
        .map_err(|e| {
            log::error!("[oracle] list_databases failed: {e}");
            e.to_string()
        })?;

    Ok(result.rows.iter().map(|row| DatabaseInfo { name: row.get_string(0).unwrap_or("").to_string() }).collect())
}

pub async fn list_schemas(conn: &OracleClient) -> Result<Vec<String>, String> {
    let dbs = list_databases(conn).await?;
    Ok(dbs.into_iter().map(|d| d.name).collect())
}

pub async fn list_tables(conn: &OracleClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let sql = format!(
        "SELECT object_name, \
         CASE object_type WHEN 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS table_type \
         FROM all_objects WHERE owner = '{s}' AND object_type IN ('TABLE','VIEW') \
         ORDER BY object_name",
        s = schema.replace('\'', "''")
    );
    log::debug!("[oracle] list_tables: schema={schema}, sql={sql}");
    let result = conn.query(&sql, &[]).await.map_err(|e| {
        log::error!("[oracle] list_tables failed: {e}");
        e.to_string()
    })?;
    Ok(result
        .rows
        .iter()
        .map(|row| TableInfo {
            name: row.get_string(0).unwrap_or("").to_string(),
            table_type: row.get_string(1).unwrap_or("TABLE").to_string(),
            comment: None,
        })
        .collect())
}

pub async fn get_columns(conn: &OracleClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    log::debug!("[oracle] get_columns: schema={schema}, table={table}");
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");

    let pk_result = conn
        .query(
            &format!(
                "SELECT cols.COLUMN_NAME FROM ALL_CONS_COLUMNS cols \
             JOIN ALL_CONSTRAINTS cons ON cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME AND cols.OWNER = cons.OWNER \
             WHERE cons.CONSTRAINT_TYPE = 'P' AND cons.OWNER = '{s}' AND cons.TABLE_NAME = '{t}'"
            ),
            &[],
        )
        .await
        .map_err(|e| {
            log::error!("[oracle] get_columns pk query failed: {e}");
            e.to_string()
        })?;
    let pk_names: std::collections::HashSet<String> =
        pk_result.rows.iter().filter_map(|row| row.get_string(0).map(|s| s.to_string())).collect();

    let col_result = conn
        .query(
            &format!(
                "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_PRECISION, DATA_SCALE, DATA_LENGTH, CHAR_LENGTH \
             FROM ALL_TAB_COLUMNS \
             WHERE OWNER = '{s}' AND TABLE_NAME = '{t}' \
             ORDER BY COLUMN_ID"
            ),
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(col_result
        .rows
        .iter()
        .map(|row| {
            let name = row.get_string(0).unwrap_or("").to_string();
            let base = row.get_string(1).unwrap_or("").to_string();
            let data_len = row.get_i64(5).map(|v| v as i32);
            let char_len = row.get_i64(6).map(|v| v as i32);
            let num_prec = row.get_i64(3).map(|v| v as i32);
            let num_scale = row.get_i64(4).map(|v| v as i32);
            let data_type = match base.to_uppercase().as_str() {
                "VARCHAR2" | "NVARCHAR2" | "CHAR" | "NCHAR" => {
                    let len = char_len.or(data_len);
                    match len {
                        Some(n) => format!("{base}({n})"),
                        None => base,
                    }
                }
                "NUMBER" => match (num_prec, num_scale) {
                    (Some(p), Some(s)) if s > 0 => format!("NUMBER({p},{s})"),
                    (Some(p), _) if p > 0 => format!("NUMBER({p})"),
                    _ => "NUMBER".to_string(),
                },
                "RAW" => match data_len {
                    Some(n) => format!("RAW({n})"),
                    None => "RAW".to_string(),
                },
                _ => base,
            };
            ColumnInfo {
                is_primary_key: pk_names.contains(&name),
                name,
                data_type,
                is_nullable: row.get_string(2).unwrap_or("N") == "Y",
                column_default: None,
                extra: None,
                comment: None,
                numeric_precision: num_prec,
                numeric_scale: num_scale,
                character_maximum_length: char_len,
            }
        })
        .collect())
}

pub async fn list_indexes(conn: &OracleClient, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let sql = format!(
        "SELECT i.INDEX_NAME, \
         LISTAGG(ic.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY ic.COLUMN_POSITION) AS columns, \
         i.UNIQUENESS, \
         CASE WHEN c.CONSTRAINT_TYPE = 'P' THEN 1 ELSE 0 END AS IS_PK, \
         i.INDEX_TYPE \
         FROM ALL_INDEXES i \
         JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER AND i.TABLE_OWNER = ic.TABLE_OWNER \
         LEFT JOIN ALL_CONSTRAINTS c ON i.INDEX_NAME = c.INDEX_NAME AND i.TABLE_OWNER = c.OWNER \
           AND c.CONSTRAINT_TYPE = 'P' \
         WHERE i.TABLE_OWNER = '{s}' AND i.TABLE_NAME = '{t}' \
         GROUP BY i.INDEX_NAME, i.UNIQUENESS, c.CONSTRAINT_TYPE, i.INDEX_TYPE \
         ORDER BY i.INDEX_NAME",
        s = schema.replace('\'', "''"), t = table.replace('\'', "''")
    );
    let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
    Ok(result
        .rows
        .iter()
        .map(|row| {
            let cols_str = row.get_string(1).unwrap_or("");
            IndexInfo {
                name: row.get_string(0).unwrap_or("").to_string(),
                columns: cols_str.split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
                is_unique: row.get_string(2).unwrap_or("") == "UNIQUE",
                is_primary: row.get_i64(3).unwrap_or(0) == 1,
                filter: None,
                index_type: row.get_string(4).map(|s| s.to_string()),
                included_columns: None,
                comment: None,
            }
        })
        .collect())
}

pub async fn list_foreign_keys(conn: &OracleClient, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, String> {
    let sql = format!(
        "SELECT c.CONSTRAINT_NAME, cc.COLUMN_NAME, rc.TABLE_NAME, rcc.COLUMN_NAME \
         FROM ALL_CONSTRAINTS c \
         JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER \
         JOIN ALL_CONSTRAINTS rc ON c.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND c.R_OWNER = rc.OWNER \
         JOIN ALL_CONS_COLUMNS rcc ON rc.CONSTRAINT_NAME = rcc.CONSTRAINT_NAME AND rc.OWNER = rcc.OWNER \
         WHERE c.CONSTRAINT_TYPE = 'R' AND c.OWNER = '{s}' AND c.TABLE_NAME = '{t}' \
         ORDER BY c.CONSTRAINT_NAME",
        s = schema.replace('\'', "''"),
        t = table.replace('\'', "''")
    );
    let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
    Ok(result
        .rows
        .iter()
        .map(|row| ForeignKeyInfo {
            name: row.get_string(0).unwrap_or("").to_string(),
            column: row.get_string(1).unwrap_or("").to_string(),
            ref_table: row.get_string(2).unwrap_or("").to_string(),
            ref_column: row.get_string(3).unwrap_or("").to_string(),
        })
        .collect())
}

pub async fn list_triggers(conn: &OracleClient, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
    let sql = format!(
        "SELECT TRIGGER_NAME, TRIGGERING_EVENT, TRIGGER_TYPE \
         FROM ALL_TRIGGERS \
         WHERE OWNER = '{s}' AND TABLE_NAME = '{t}' \
         ORDER BY TRIGGER_NAME",
        s = schema.replace('\'', "''"),
        t = table.replace('\'', "''")
    );
    let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
    Ok(result
        .rows
        .iter()
        .map(|row| TriggerInfo {
            name: row.get_string(0).unwrap_or("").to_string(),
            event: row.get_string(1).unwrap_or("").to_string(),
            timing: row.get_string(2).unwrap_or("").to_string(),
        })
        .collect())
}

pub async fn execute_query(conn: &OracleClient, sql: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let sql = sql.trim().trim_end_matches(';');

    // Rewrite FETCH FIRST N ROWS ONLY → ROWNUM for Oracle 11g compatibility
    let sql = rewrite_fetch_first(sql);
    let sql = sql.as_ref();

    if starts_with_executable_sql_keyword(sql, &["SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN"]) {
        let result = conn.query(sql, &[]).await.map_err(|e| {
            log::error!("[oracle] execute_query SELECT failed: {e}");
            e.to_string()
        })?;
        let columns: Vec<String> = result.columns.iter().map(|c| c.name.clone()).collect();
        let rows: Vec<Vec<serde_json::Value>> = result
            .rows
            .iter()
            .map(|row| {
                (0..columns.len())
                    .map(|i| row.get(i).map(|v| value_to_json(v)).unwrap_or(serde_json::Value::Null))
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows,
            affected_rows: 0,
            execution_time_ms: start.elapsed().as_millis(),
            truncated: false,
        })
    } else {
        match conn.execute(sql, &[]).await {
            Ok(result) => {
                let _ = conn.commit().await;
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: result.rows_affected,
                    execution_time_ms: start.elapsed().as_millis(),
                    truncated: false,
                })
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("Server rejected") || msg.contains("closed the connection") {
                    Err("Operation failed (connection closed) — possibly a constraint violation (foreign key, unique, or check constraint).".to_string())
                } else {
                    Err(msg)
                }
            }
        }
    }
}

fn rewrite_fetch_first(sql: &str) -> std::borrow::Cow<'_, str> {
    let upper = sql.to_uppercase();
    // Match: ... [OFFSET M ROWS] FETCH FIRST|NEXT N ROWS ONLY
    let fetch_pos = upper.find("FETCH FIRST").or_else(|| upper.find("FETCH NEXT"));
    let Some(fpos) = fetch_pos else { return std::borrow::Cow::Borrowed(sql) };
    let after_fetch = &upper[fpos..];
    let Some(end) = after_fetch.find("ROWS ONLY") else { return std::borrow::Cow::Borrowed(sql) };
    let keyword_len = if after_fetch.starts_with("FETCH FIRST") { 11 } else { 10 };
    let between = sql[fpos + keyword_len..fpos + end].trim();
    let Ok(n) = between.parse::<u64>() else { return std::borrow::Cow::Borrowed(sql) };

    // Check for OFFSET M ROWS before FETCH
    let mut base = &sql[..fpos];
    let base_upper = base.to_uppercase();
    if let Some(opos) = base_upper.rfind("OFFSET ") {
        let after_offset = base_upper[opos + 7..].trim();
        if let Some(rpos) = after_offset.find(" ROWS") {
            let offset_str = after_offset[..rpos].trim();
            if let Ok(offset) = offset_str.parse::<u64>() {
                let inner = sql[..opos].trim_end();
                return std::borrow::Cow::Owned(format!(
                    "SELECT * FROM (SELECT a.*, ROWNUM rn__ FROM ({inner}) a WHERE ROWNUM <= {}) WHERE rn__ > {offset}",
                    offset + n
                ));
            }
        }
        base = sql[..opos].trim_end();
    } else {
        base = base.trim_end();
    }

    std::borrow::Cow::Owned(format!("SELECT * FROM ({base}) WHERE ROWNUM <= {n}"))
}
