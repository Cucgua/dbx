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
    requested
        .or_else(|| config.default_database.clone())
        .or_else(|| if config.db_type == DatabaseType::Oracle { None } else { config.database.clone() })
        .unwrap_or_default()
}

pub fn resolve_schema(config: &ConnectionConfig, database: &str, requested: Option<String>) -> String {
    if let Some(schema) = requested {
        return schema;
    }

    match &config.db_type {
        DatabaseType::Mysql | DatabaseType::Doris | DatabaseType::StarRocks => database.to_string(),
        DatabaseType::Oracle => database.to_string(),
        DatabaseType::Postgres | DatabaseType::Redshift => "public".to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbx_core::models::connection::OracleConnectMethod;

    fn config(db_type: DatabaseType, database: Option<&str>, default_database: Option<&str>) -> ConnectionConfig {
        ConnectionConfig {
            id: "id".to_string(),
            name: "name".to_string(),
            db_type,
            driver_profile: None,
            driver_label: None,
            url_params: None,
            host: "127.0.0.1".to_string(),
            port: 1521,
            username: "user".to_string(),
            password: "secret".to_string(),
            database: database.map(str::to_string),
            default_database: default_database.map(str::to_string),
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
    fn resolve_database_uses_independent_default_database_first() {
        let config = config(DatabaseType::Mysql, Some("app"), Some("analytics"));

        assert_eq!(resolve_database(&config, None), "analytics");
        assert_eq!(resolve_database(&config, Some("requested".to_string())), "requested");
    }

    #[test]
    fn resolve_database_does_not_use_oracle_service_identifier_as_database() {
        let config = config(DatabaseType::Oracle, Some("ORCL"), None);

        assert_eq!(resolve_database(&config, None), "");
        assert_eq!(resolve_schema(&config, "MCHS", None), "MCHS");
    }
}
