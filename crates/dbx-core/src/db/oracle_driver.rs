use log;
use oracle as oracle_oci;
use oracle_oci::sql_type::OracleType as OciOracleType;
use rust_oracle::{Config, Connection as ThinConnection};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{connection_timeout, CONNECTION_TIMEOUT_SECS};
use crate::models::app_settings::AppSettings;
use crate::models::connection::{ConnectionConfig, OracleConnectMethod};
use crate::types::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, QueryResult, TableInfo, TriggerInfo};

pub enum OracleClient {
    Thin(ThinConnection),
    Oci(Arc<Mutex<oracle_oci::Connection>>),
}

impl OracleClient {
    pub fn is_closed(&self) -> bool {
        match self {
            OracleClient::Thin(conn) => conn.is_closed(),
            OracleClient::Oci(conn) => {
                let Ok(conn) = conn.lock() else {
                    return true;
                };
                !matches!(conn.status(), Ok(oracle_oci::ConnStatus::Normal))
            }
        }
    }
}

pub async fn connect(
    host: &str,
    port: u16,
    service: &str,
    user: &str,
    pass: &str,
    sysdba: bool,
) -> Result<OracleClient, String> {
    connect_thin(host, port, service, user, pass, sysdba, OracleConnectMethod::ServiceName).await
}

pub async fn connect_config(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
    app_settings: Option<&AppSettings>,
) -> Result<OracleClient, String> {
    let identifier = config.database.as_deref().unwrap_or("ORCL");
    if config.is_oracle_oci() {
        return connect_oci(
            build_oci_connect_string(config, host, port),
            config.username.clone(),
            config.password.clone(),
            config.sysdba,
            app_settings.cloned(),
        )
        .await;
    }

    connect_thin(
        host,
        port,
        identifier,
        &config.username,
        &config.password,
        config.sysdba,
        config.oracle_connect_method.clone(),
    )
    .await
}

pub fn build_oci_connect_string(config: &ConnectionConfig, host: &str, port: u16) -> String {
    if let Some(value) = config.connection_string.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        return value.to_string();
    }

    let identifier = config.database.as_deref().filter(|value| !value.is_empty()).unwrap_or("ORCL");
    match config.oracle_connect_method {
        OracleConnectMethod::Sid => format!("{host}:{port}:{identifier}"),
        OracleConnectMethod::ConnectString => identifier.to_string(),
        OracleConnectMethod::ServiceName => format!("{host}:{port}/{identifier}"),
    }
}

async fn connect_thin(
    host: &str,
    port: u16,
    identifier: &str,
    user: &str,
    pass: &str,
    sysdba: bool,
    method: OracleConnectMethod,
) -> Result<OracleClient, String> {
    let mut config = match method {
        OracleConnectMethod::Sid => Config::with_sid(host, port, identifier, user, pass),
        OracleConnectMethod::ServiceName | OracleConnectMethod::ConnectString => {
            Config::new(host, port, identifier, user, pass)
        }
    };
    config.sysdba = sysdba;
    tokio::time::timeout(connection_timeout(), ThinConnection::connect_with_config(config))
        .await
        .map_err(|_| format!("Oracle connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?
        .map(OracleClient::Thin)
        .map_err(|e| format!("Oracle connection failed: {e}"))
}

async fn connect_oci(
    connect_string: String,
    user: String,
    pass: String,
    sysdba: bool,
    app_settings: Option<AppSettings>,
) -> Result<OracleClient, String> {
    let task = tokio::task::spawn_blocking(move || {
        init_oci_client(app_settings.as_ref())?;
        let conn = if sysdba {
            oracle_oci::Connector::new(user, pass, connect_string).privilege(oracle_oci::Privilege::Sysdba).connect()
        } else {
            oracle_oci::Connection::connect(user, pass, connect_string)
        }
        .map_err(|e| format!("Oracle OCI connection failed: {e}"))?;
        conn.set_call_timeout(Some(Duration::from_secs(CONNECTION_TIMEOUT_SECS)))
            .map_err(|e| format!("Oracle OCI call timeout setup failed: {e}"))?;
        Ok(OracleClient::Oci(Arc::new(Mutex::new(conn))))
    });

    let join = tokio::time::timeout(connection_timeout(), task)
        .await
        .map_err(|_| format!("Oracle OCI connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?;
    join.map_err(|e| e.to_string())?
}

fn init_oci_client(app_settings: Option<&AppSettings>) -> Result<(), String> {
    let Some(settings) = app_settings.filter(|settings| settings.has_oracle_client_settings()) else {
        return Ok(());
    };
    if oracle_oci::InitParams::is_initialized() {
        return Ok(());
    }

    let mut params = oracle_oci::InitParams::new();
    if let Some(dir) = settings.oracle_client_lib_dir() {
        params
            .oracle_client_lib_dir(normalize_oci_dir(dir))
            .map_err(|e| format!("Invalid Oracle OCI library directory: {e}"))?;
    }
    if let Some(dir) = settings.oracle_client_config_dir() {
        params
            .oracle_client_config_dir(normalize_oci_dir(dir))
            .map_err(|e| format!("Invalid Oracle OCI config directory: {e}"))?;
    }
    params.init().map_err(|e| format_oci_load_error(e.to_string(), settings))?;
    Ok(())
}

fn normalize_oci_dir(value: &str) -> String {
    let path = Path::new(value);
    if path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("oci.dll")) {
        return path.parent().map(|parent| parent.to_string_lossy().to_string()).unwrap_or_else(|| value.to_string());
    }
    value.to_string()
}

fn format_oci_load_error(message: String, settings: &AppSettings) -> String {
    if message.contains("DPI-1047") {
        let dir = settings.oracle_client_lib_dir().unwrap_or("");
        if dir.is_empty() {
            return format!("{message}. Set Oracle OCI library directory in Settings > System.");
        }
        return format!("{message}. Configured Oracle OCI library directory: {dir}");
    }
    message
}

async fn run_oci<T, F>(conn: &Arc<Mutex<oracle_oci::Connection>>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&oracle_oci::Connection) -> Result<T, String> + Send + 'static,
{
    let conn = conn.clone();
    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn value_to_json_thin(val: &rust_oracle::Value) -> serde_json::Value {
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

fn value_to_json_oci(val: &oracle_oci::SqlValue<'_>) -> serde_json::Value {
    if val.is_null().unwrap_or(false) {
        return serde_json::Value::Null;
    }
    if let Ok(Some(value)) = val.get::<Option<bool>>() {
        return serde_json::Value::Bool(value);
    }
    match val.oracle_type() {
        Ok(OciOracleType::Number(_, scale)) if *scale <= 0 => {
            if let Ok(Some(value)) = val.get::<Option<i64>>() {
                return serde_json::Value::Number(value.into());
            }
        }
        Ok(OciOracleType::Number(_, _))
        | Ok(OciOracleType::BinaryDouble)
        | Ok(OciOracleType::BinaryFloat)
        | Ok(OciOracleType::Float(_)) => {
            if let Ok(Some(value)) = val.get::<Option<f64>>() {
                return serde_json::Number::from_f64(value)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null);
            }
        }
        _ => {}
    }
    val.get::<Option<String>>()
        .ok()
        .flatten()
        .map(serde_json::Value::String)
        .unwrap_or_else(|| serde_json::Value::String(val.to_string()))
}

fn oci_string(row: &oracle_oci::Row, index: usize) -> String {
    row.sql_values().get(index).and_then(|value| value.get::<Option<String>>().ok().flatten()).unwrap_or_default()
}

fn oci_i64(row: &oracle_oci::Row, index: usize) -> Option<i64> {
    row.sql_values().get(index).and_then(|value| value.get::<Option<i64>>().ok().flatten())
}

fn oci_query_strings(conn: &oracle_oci::Connection, sql: &str) -> Result<Vec<String>, String> {
    let rows = conn.query(sql, &[]).map_err(|e| e.to_string())?;
    let mut values = Vec::new();
    for row in rows {
        values.push(oci_string(&row.map_err(|e| e.to_string())?, 0));
    }
    Ok(values)
}

const ORACLE_USER_FILTER_SQL: &str = "SELECT username FROM all_users \
     WHERE oracle_maintained = 'N' \
     OR NOT EXISTS (SELECT 1 FROM all_users WHERE oracle_maintained IS NOT NULL) \
     ORDER BY username";

const ORACLE_USER_FALLBACK_SQL: &str = "SELECT username FROM all_users \
     WHERE username NOT IN (\
       'SYS','SYSTEM','SYSMAN','DBSNMP','SYSBACKUP','SYSDG','SYSKM','OUTLN',\
       'AUDSYS','LBACSYS','DVF','DVSYS','APPQOSSYS','CTXSYS','MDSYS','MDDATA',\
       'ORDSYS','ORDDATA','ORDPLUGINS','XDB','ANONYMOUS','DIP','EXFSYS',\
       'GSMADMIN_INTERNAL','GSMCATUSER','GSMUSER','OJVMSYS','OLAPSYS',\
       'ORACLE_OCM','SI_INFORMTN_SCHEMA','WMSYS','XS$NULL','DBSFWUSER',\
       'REMOTE_SCHEDULER_AGENT','PDBADMIN','DGPDB_INT','OPS$ORACLE',\
       'GGSYS','FLOWS_FILES','APEX_PUBLIC_USER'\
     ) ORDER BY username";

async fn query_oracle_usernames_thin(conn: &ThinConnection) -> Result<Vec<String>, String> {
    let result = match conn.query(ORACLE_USER_FILTER_SQL, &[]).await {
        Ok(result) => result,
        Err(_) => conn.query(ORACLE_USER_FALLBACK_SQL, &[]).await.map_err(|e| {
            log::error!("[oracle] list_databases failed: {e}");
            e.to_string()
        })?,
    };

    Ok(result.rows.iter().map(|row| row.get_string(0).unwrap_or("").to_string()).collect())
}

fn query_oracle_usernames_oci(conn: &oracle_oci::Connection) -> Result<Vec<String>, String> {
    match oci_query_strings(conn, ORACLE_USER_FILTER_SQL) {
        Ok(names) => Ok(names),
        Err(_) => oci_query_strings(conn, ORACLE_USER_FALLBACK_SQL).map_err(|e| {
            log::error!("[oracle-oci] list_databases failed: {e}");
            e
        }),
    }
}

pub async fn list_databases(conn: &OracleClient) -> Result<Vec<DatabaseInfo>, String> {
    log::debug!("[oracle] list_databases: querying all_users");
    let names = match conn {
        OracleClient::Thin(conn) => query_oracle_usernames_thin(conn).await?,
        OracleClient::Oci(conn) => run_oci(conn, query_oracle_usernames_oci).await?,
    };
    Ok(names.into_iter().map(|name| DatabaseInfo { name }).collect())
}

pub async fn list_schemas(conn: &OracleClient) -> Result<Vec<String>, String> {
    let dbs = list_databases(conn).await?;
    Ok(dbs.into_iter().map(|d| d.name).collect())
}

pub async fn list_tables(conn: &OracleClient, schema: &str) -> Result<Vec<TableInfo>, String> {
    let sql = format!(
        "SELECT table_name, 'TABLE' AS table_type FROM all_tables WHERE owner = '{s}' \
         UNION ALL \
         SELECT view_name, 'VIEW' FROM all_views WHERE owner = '{s}' \
         ORDER BY 1",
        s = schema.replace('\'', "''")
    );
    log::debug!("[oracle] list_tables: schema={schema}, sql={sql}");
    match conn {
        OracleClient::Thin(conn) => {
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
        OracleClient::Oci(conn) => {
            run_oci(conn, move |conn| {
                let rows = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                let mut tables = Vec::new();
                for row in rows {
                    let row = row.map_err(|e| e.to_string())?;
                    tables.push(TableInfo {
                        name: oci_string(&row, 0),
                        table_type: oci_string(&row, 1),
                        comment: None,
                    });
                }
                Ok(tables)
            })
            .await
        }
    }
}

pub async fn get_columns(conn: &OracleClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    log::debug!("[oracle] get_columns: schema={schema}, table={table}");
    let s = schema.replace('\'', "''");
    let t = table.replace('\'', "''");
    let pk_sql = format!(
        "SELECT cols.COLUMN_NAME FROM ALL_CONS_COLUMNS cols \
         JOIN ALL_CONSTRAINTS cons ON cols.CONSTRAINT_NAME = cons.CONSTRAINT_NAME AND cols.OWNER = cons.OWNER \
         WHERE cons.CONSTRAINT_TYPE = 'P' AND cons.OWNER = '{s}' AND cons.TABLE_NAME = '{t}'"
    );
    let col_sql = format!(
        "SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_PRECISION, DATA_SCALE, DATA_LENGTH, CHAR_LENGTH \
         FROM ALL_TAB_COLUMNS \
         WHERE OWNER = '{s}' AND TABLE_NAME = '{t}' \
         ORDER BY COLUMN_ID"
    );

    match conn {
        OracleClient::Thin(conn) => get_columns_thin(conn, &pk_sql, &col_sql).await,
        OracleClient::Oci(conn) => run_oci(conn, move |conn| get_columns_oci(conn, &pk_sql, &col_sql)).await,
    }
}

async fn get_columns_thin(conn: &ThinConnection, pk_sql: &str, col_sql: &str) -> Result<Vec<ColumnInfo>, String> {
    let pk_result = conn.query(pk_sql, &[]).await.map_err(|e| {
        log::error!("[oracle] get_columns pk query failed: {e}");
        e.to_string()
    })?;
    let pk_names: std::collections::HashSet<String> =
        pk_result.rows.iter().filter_map(|row| row.get_string(0).map(|s| s.to_string())).collect();

    let col_result = conn.query(col_sql, &[]).await.map_err(|e| e.to_string())?;
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
            ColumnInfo {
                is_primary_key: pk_names.contains(&name),
                name,
                data_type: format_oracle_data_type(&base, data_len, char_len, num_prec, num_scale),
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

fn get_columns_oci(conn: &oracle_oci::Connection, pk_sql: &str, col_sql: &str) -> Result<Vec<ColumnInfo>, String> {
    let pk_names: std::collections::HashSet<String> = oci_query_strings(conn, pk_sql)?.into_iter().collect();
    let rows = conn.query(col_sql, &[]).map_err(|e| e.to_string())?;
    let mut columns = Vec::new();
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let name = oci_string(&row, 0);
        let base = oci_string(&row, 1);
        let data_len = oci_i64(&row, 5).map(|v| v as i32);
        let char_len = oci_i64(&row, 6).map(|v| v as i32);
        let num_prec = oci_i64(&row, 3).map(|v| v as i32);
        let num_scale = oci_i64(&row, 4).map(|v| v as i32);
        columns.push(ColumnInfo {
            is_primary_key: pk_names.contains(&name),
            name,
            data_type: format_oracle_data_type(&base, data_len, char_len, num_prec, num_scale),
            is_nullable: oci_string(&row, 2) == "Y",
            column_default: None,
            extra: None,
            comment: None,
            numeric_precision: num_prec,
            numeric_scale: num_scale,
            character_maximum_length: char_len,
        });
    }
    Ok(columns)
}

fn format_oracle_data_type(
    base: &str,
    data_len: Option<i32>,
    char_len: Option<i32>,
    num_prec: Option<i32>,
    num_scale: Option<i32>,
) -> String {
    match base.to_uppercase().as_str() {
        "VARCHAR2" | "NVARCHAR2" | "CHAR" | "NCHAR" => {
            char_len.or(data_len).map(|n| format!("{base}({n})")).unwrap_or_else(|| base.to_string())
        }
        "NUMBER" => match (num_prec, num_scale) {
            (Some(p), Some(s)) if s > 0 => format!("NUMBER({p},{s})"),
            (Some(p), _) if p > 0 => format!("NUMBER({p})"),
            _ => "NUMBER".to_string(),
        },
        "RAW" => data_len.map(|n| format!("RAW({n})")).unwrap_or_else(|| "RAW".to_string()),
        _ => base.to_string(),
    }
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
    match conn {
        OracleClient::Thin(conn) => {
            let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
            Ok(result.rows.iter().map(index_from_thin_row).collect())
        }
        OracleClient::Oci(conn) => {
            run_oci(conn, move |conn| {
                let rows = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                let mut indexes = Vec::new();
                for row in rows {
                    indexes.push(index_from_oci_row(&row.map_err(|e| e.to_string())?));
                }
                Ok(indexes)
            })
            .await
        }
    }
}

fn index_from_thin_row(row: &rust_oracle::Row) -> IndexInfo {
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
}

fn index_from_oci_row(row: &oracle_oci::Row) -> IndexInfo {
    let cols_str = oci_string(row, 1);
    IndexInfo {
        name: oci_string(row, 0),
        columns: cols_str.split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
        is_unique: oci_string(row, 2) == "UNIQUE",
        is_primary: oci_i64(row, 3).unwrap_or(0) == 1,
        filter: None,
        index_type: Some(oci_string(row, 4)).filter(|s| !s.is_empty()),
        included_columns: None,
        comment: None,
    }
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
    match conn {
        OracleClient::Thin(conn) => {
            let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
            Ok(result.rows.iter().map(foreign_key_from_thin_row).collect())
        }
        OracleClient::Oci(conn) => {
            run_oci(conn, move |conn| {
                let rows = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                let mut fkeys = Vec::new();
                for row in rows {
                    fkeys.push(foreign_key_from_oci_row(&row.map_err(|e| e.to_string())?));
                }
                Ok(fkeys)
            })
            .await
        }
    }
}

fn foreign_key_from_thin_row(row: &rust_oracle::Row) -> ForeignKeyInfo {
    ForeignKeyInfo {
        name: row.get_string(0).unwrap_or("").to_string(),
        column: row.get_string(1).unwrap_or("").to_string(),
        ref_table: row.get_string(2).unwrap_or("").to_string(),
        ref_column: row.get_string(3).unwrap_or("").to_string(),
    }
}

fn foreign_key_from_oci_row(row: &oracle_oci::Row) -> ForeignKeyInfo {
    ForeignKeyInfo {
        name: oci_string(row, 0),
        column: oci_string(row, 1),
        ref_table: oci_string(row, 2),
        ref_column: oci_string(row, 3),
    }
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
    match conn {
        OracleClient::Thin(conn) => {
            let result = conn.query(&sql, &[]).await.map_err(|e| e.to_string())?;
            Ok(result.rows.iter().map(trigger_from_thin_row).collect())
        }
        OracleClient::Oci(conn) => {
            run_oci(conn, move |conn| {
                let rows = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                let mut triggers = Vec::new();
                for row in rows {
                    triggers.push(trigger_from_oci_row(&row.map_err(|e| e.to_string())?));
                }
                Ok(triggers)
            })
            .await
        }
    }
}

fn trigger_from_thin_row(row: &rust_oracle::Row) -> TriggerInfo {
    TriggerInfo {
        name: row.get_string(0).unwrap_or("").to_string(),
        event: row.get_string(1).unwrap_or("").to_string(),
        timing: row.get_string(2).unwrap_or("").to_string(),
    }
}

fn trigger_from_oci_row(row: &oracle_oci::Row) -> TriggerInfo {
    TriggerInfo { name: oci_string(row, 0), event: oci_string(row, 1), timing: oci_string(row, 2) }
}

pub async fn execute_query(conn: &OracleClient, sql: &str) -> Result<QueryResult, String> {
    match conn {
        OracleClient::Thin(conn) => execute_query_thin(conn, sql).await,
        OracleClient::Oci(conn) => {
            let sql = sql.to_string();
            run_oci(conn, move |conn| execute_query_oci(conn, &sql)).await
        }
    }
}

async fn execute_query_thin(conn: &ThinConnection, sql: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let sql = sql.trim().trim_end_matches(';');
    let trimmed = sql.to_uppercase();
    log::debug!("[oracle] execute_query: sql={}", &sql[..sql.len().min(200)]);

    if is_query_statement(&trimmed) {
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
                    .map(|i| row.get(i).map(value_to_json_thin).unwrap_or(serde_json::Value::Null))
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
            Err(e) => map_oracle_execute_error(e.to_string()),
        }
    }
}

fn execute_query_oci(conn: &oracle_oci::Connection, sql: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let sql = sql.trim().trim_end_matches(';');
    let trimmed = sql.to_uppercase();
    log::debug!("[oracle-oci] execute_query: sql={}", &sql[..sql.len().min(200)]);

    if is_query_statement(&trimmed) {
        let rows = conn.query(sql, &[]).map_err(|e| {
            log::error!("[oracle-oci] execute_query SELECT failed: {e}");
            e.to_string()
        })?;
        let columns: Vec<String> = rows.column_info().iter().map(|c| c.name().to_string()).collect();
        let mut result_rows = Vec::new();
        for row in rows {
            let row = row.map_err(|e| e.to_string())?;
            let values = row.sql_values().iter().map(value_to_json_oci).collect();
            result_rows.push(values);
        }
        Ok(QueryResult {
            columns,
            rows: result_rows,
            affected_rows: 0,
            execution_time_ms: start.elapsed().as_millis(),
            truncated: false,
        })
    } else {
        match conn.execute(sql, &[]) {
            Ok(stmt) => {
                let _ = conn.commit();
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: stmt.row_count().unwrap_or(0),
                    execution_time_ms: start.elapsed().as_millis(),
                    truncated: false,
                })
            }
            Err(e) => map_oracle_execute_error(e.to_string()),
        }
    }
}

fn is_query_statement(trimmed_uppercase_sql: &str) -> bool {
    trimmed_uppercase_sql.starts_with("SELECT")
        || trimmed_uppercase_sql.starts_with("WITH")
        || trimmed_uppercase_sql.starts_with("SHOW")
        || trimmed_uppercase_sql.starts_with("DESCRIBE")
        || trimmed_uppercase_sql.starts_with("EXPLAIN")
}

fn map_oracle_execute_error<T>(msg: String) -> Result<T, String> {
    if msg.contains("Server rejected") || msg.contains("closed the connection") {
        Err(
            "Operation failed (connection closed) — possibly a constraint violation (foreign key, unique, or check constraint)."
                .to_string(),
        )
    } else {
        Err(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::build_oci_connect_string;
    use crate::models::connection::{ConnectionConfig, DatabaseType, OracleConnectMethod};

    fn oracle_oci_config(database: Option<&str>) -> ConnectionConfig {
        ConnectionConfig {
            id: "id".to_string(),
            name: "name".to_string(),
            db_type: DatabaseType::Oracle,
            driver_profile: Some("oracle_oci".to_string()),
            driver_label: Some("Oracle OCI (11g)".to_string()),
            url_params: None,
            host: "10.1.2.3".to_string(),
            port: 1521,
            username: "system".to_string(),
            password: "secret".to_string(),
            database: database.map(str::to_string),
            color: None,
            ssh_enabled: false,
            ssh_host: String::new(),
            ssh_port: 22,
            ssh_user: String::new(),
            ssh_password: String::new(),
            ssh_key_path: String::new(),
            ssh_key_passphrase: String::new(),
            ssh_expose_lan: false,
            ssl: false,
            sysdba: false,
            oracle_connect_method: OracleConnectMethod::ServiceName,
            connection_string: None,
        }
    }

    #[test]
    fn oci_service_name_uses_easy_connect_format() {
        let config = oracle_oci_config(Some("sales"));

        assert_eq!(build_oci_connect_string(&config, "127.0.0.1", 1522), "127.0.0.1:1522/sales");
    }

    #[test]
    fn oci_sid_uses_legacy_sid_format() {
        let mut config = oracle_oci_config(Some("ORCL"));
        config.oracle_connect_method = OracleConnectMethod::Sid;

        assert_eq!(build_oci_connect_string(&config, "127.0.0.1", 1521), "127.0.0.1:1521:ORCL");
    }

    #[test]
    fn oci_explicit_connect_string_wins() {
        let mut config = oracle_oci_config(None);
        config.connection_string = Some("MY_TNS_ALIAS".to_string());

        assert_eq!(build_oci_connect_string(&config, "127.0.0.1", 1521), "MY_TNS_ALIAS");
    }
}
