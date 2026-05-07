pub const QUERY_ROW_LIMIT: usize = 100;

use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use rmcp::schemars;
use serde::Deserialize;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListDatabasesArgs {
    pub connection_name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListSchemasArgs {
    pub connection_name: String,
    #[serde(default)]
    pub database: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListTablesArgs {
    pub connection_name: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DescribeTableArgs {
    pub connection_name: String,
    pub table: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ExecuteQueryArgs {
    pub connection_name: String,
    pub sql: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OpenTableArgs {
    pub connection_name: String,
    pub table: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

pub fn resolve_database(config: &ConnectionConfig, requested: Option<String>) -> String {
    requested.or_else(|| config.database.clone()).unwrap_or_default()
}

pub fn resolve_schema(config: &ConnectionConfig, database: &str, requested: Option<String>) -> String {
    if let Some(schema) = requested {
        return schema;
    }

    match &config.db_type {
        DatabaseType::Mysql | DatabaseType::Doris | DatabaseType::StarRocks => database.to_string(),
        DatabaseType::Postgres | DatabaseType::Redshift => "public".to_string(),
        _ => String::new(),
    }
}
