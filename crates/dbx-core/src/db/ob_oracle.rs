use sqlx::mysql::{MySqlPool, MySqlRow};
use sqlx::Row;

use crate::types::{ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, TableInfo, TriggerInfo};

fn quote_value(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn get_str(row: &MySqlRow, idx: usize) -> String {
    row.try_get::<String, _>(idx)
        .or_else(|_| row.try_get::<Vec<u8>, _>(idx).map(|b| String::from_utf8_lossy(&b).to_string()))
        .unwrap_or_default()
}

fn get_opt_str(row: &MySqlRow, idx: usize) -> Option<String> {
    row.try_get::<Option<String>, _>(idx).ok().flatten().or_else(|| {
        row.try_get::<Option<Vec<u8>>, _>(idx).ok().flatten().map(|b| String::from_utf8_lossy(&b).to_string())
    })
}

fn get_opt_i32(row: &MySqlRow, idx: usize) -> Option<i32> {
    row.try_get::<Option<i32>, _>(idx)
        .ok()
        .flatten()
        .or_else(|| row.try_get::<Option<i64>, _>(idx).ok().flatten().and_then(|v| i32::try_from(v).ok()))
}

pub async fn list_databases(pool: &MySqlPool) -> Result<Vec<DatabaseInfo>, String> {
    let rows: Vec<MySqlRow> = sqlx::raw_sql(
        "SELECT USERNAME FROM ALL_USERS \
         WHERE USERNAME NOT IN ('SYS','LBACSYS','ORAAUDITOR','__public') \
         ORDER BY USERNAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|row| DatabaseInfo { name: get_str(row, 0) }).collect())
}

pub async fn list_tables(pool: &MySqlPool, schema: &str) -> Result<Vec<TableInfo>, String> {
    let sql = format!(
        "SELECT TABLE_NAME, 'TABLE' AS TABLE_TYPE FROM ALL_TABLES WHERE OWNER = {s} \
         UNION ALL \
         SELECT VIEW_NAME, 'VIEW' AS TABLE_TYPE FROM ALL_VIEWS WHERE OWNER = {s} \
         ORDER BY 1",
        s = quote_value(schema),
    );
    let rows: Vec<MySqlRow> = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows.iter().map(|row| TableInfo { name: get_str(row, 0), table_type: get_str(row, 1), comment: None }).collect())
}

pub async fn get_columns(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let sql = format!(
        "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT, \
         c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, c.COLUMN_ID, \
         CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK \
         FROM ALL_TAB_COLUMNS c \
         LEFT JOIN ( \
           SELECT cols.OWNER, cols.TABLE_NAME, cols.COLUMN_NAME \
           FROM ALL_CONS_COLUMNS cols \
           JOIN ALL_CONSTRAINTS con ON con.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND con.OWNER = cols.OWNER \
           WHERE con.CONSTRAINT_TYPE = 'P' \
         ) cc ON cc.OWNER = c.OWNER AND cc.TABLE_NAME = c.TABLE_NAME AND cc.COLUMN_NAME = c.COLUMN_NAME \
         WHERE c.OWNER = {s} AND c.TABLE_NAME = {t} \
         ORDER BY c.COLUMN_ID",
        s = quote_value(schema),
        t = quote_value(table),
    );
    let rows: Vec<MySqlRow> = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            let data_type = get_str(row, 1);
            let precision = get_opt_i32(row, 5);
            let scale = get_opt_i32(row, 6);
            let length = get_opt_i32(row, 4);
            let display_type = format_oracle_type(&data_type, precision, scale, length);
            ColumnInfo {
                name: get_str(row, 0),
                data_type: display_type,
                is_nullable: get_str(row, 2) == "Y",
                column_default: get_opt_str(row, 3).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                is_primary_key: row.try_get::<i32, _>(8).unwrap_or(0) == 1,
                extra: None,
                comment: None,
                numeric_precision: precision,
                numeric_scale: scale,
                character_maximum_length: length,
            }
        })
        .collect())
}

fn format_oracle_type(data_type: &str, precision: Option<i32>, scale: Option<i32>, length: Option<i32>) -> String {
    match data_type.to_uppercase().as_str() {
        "NUMBER" => match (precision, scale) {
            (Some(p), Some(s)) if s > 0 => format!("NUMBER({p},{s})"),
            (Some(p), _) => format!("NUMBER({p})"),
            _ => "NUMBER".to_string(),
        },
        "VARCHAR2" | "NVARCHAR2" | "CHAR" | "NCHAR" | "RAW" => match length {
            Some(l) => format!("{data_type}({l})"),
            None => data_type.to_string(),
        },
        _ => data_type.to_string(),
    }
}

pub async fn list_indexes(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
    let sql = format!(
        "SELECT ai.INDEX_NAME, \
         LISTAGG(aic.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY aic.COLUMN_POSITION) AS COLUMNS, \
         ai.UNIQUENESS, \
         CASE WHEN ac.CONSTRAINT_TYPE = 'P' THEN 1 ELSE 0 END AS IS_PRIMARY \
         FROM ALL_INDEXES ai \
         JOIN ALL_IND_COLUMNS aic ON ai.INDEX_NAME = aic.INDEX_NAME AND ai.TABLE_OWNER = aic.TABLE_OWNER \
         LEFT JOIN ALL_CONSTRAINTS ac ON ac.INDEX_NAME = ai.INDEX_NAME AND ac.OWNER = ai.TABLE_OWNER AND ac.CONSTRAINT_TYPE = 'P' \
         WHERE ai.TABLE_OWNER = {s} AND ai.TABLE_NAME = {t} \
         GROUP BY ai.INDEX_NAME, ai.UNIQUENESS, ac.CONSTRAINT_TYPE \
         ORDER BY ai.INDEX_NAME",
        s = quote_value(schema),
        t = quote_value(table),
    );
    let rows: Vec<MySqlRow> = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            let cols_str = get_str(row, 1);
            IndexInfo {
                name: get_str(row, 0),
                columns: cols_str.split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
                is_unique: get_str(row, 2) == "UNIQUE",
                is_primary: row.try_get::<i32, _>(3).unwrap_or(0) == 1,
                filter: None,
                index_type: None,
                included_columns: None,
                comment: None,
            }
        })
        .collect())
}

pub async fn list_foreign_keys(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, String> {
    let sql = format!(
        "SELECT ac.CONSTRAINT_NAME, acc.COLUMN_NAME, \
         ac2.TABLE_NAME AS R_TABLE, acc2.COLUMN_NAME AS R_COLUMN \
         FROM ALL_CONSTRAINTS ac \
         JOIN ALL_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME AND ac.OWNER = acc.OWNER \
         JOIN ALL_CONSTRAINTS ac2 ON ac.R_CONSTRAINT_NAME = ac2.CONSTRAINT_NAME AND ac.R_OWNER = ac2.OWNER \
         JOIN ALL_CONS_COLUMNS acc2 ON ac2.CONSTRAINT_NAME = acc2.CONSTRAINT_NAME AND ac2.OWNER = acc2.OWNER \
           AND acc.POSITION = acc2.POSITION \
         WHERE ac.CONSTRAINT_TYPE = 'R' AND ac.OWNER = {s} AND ac.TABLE_NAME = {t} \
         ORDER BY ac.CONSTRAINT_NAME, acc.POSITION",
        s = quote_value(schema),
        t = quote_value(table),
    );
    let rows: Vec<MySqlRow> = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| ForeignKeyInfo {
            name: get_str(row, 0),
            column: get_str(row, 1),
            ref_table: get_str(row, 2),
            ref_column: get_str(row, 3),
        })
        .collect())
}

pub async fn list_triggers(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
    let sql = format!(
        "SELECT TRIGGER_NAME, TRIGGERING_EVENT, TRIGGER_TYPE \
         FROM ALL_TRIGGERS \
         WHERE TABLE_OWNER = {s} AND TABLE_NAME = {t} \
         ORDER BY TRIGGER_NAME",
        s = quote_value(schema),
        t = quote_value(table),
    );
    let rows: Vec<MySqlRow> = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            let trigger_type = get_str(row, 2);
            let timing = if trigger_type.contains("BEFORE") {
                "BEFORE"
            } else if trigger_type.contains("AFTER") {
                "AFTER"
            } else {
                "INSTEAD OF"
            };
            TriggerInfo { name: get_str(row, 0), event: get_str(row, 1), timing: timing.to_string() }
        })
        .collect())
}
