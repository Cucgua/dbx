pub const QUERY_ROW_LIMIT: usize = 100;

use dbx_core::models::connection::{
    default_connect_timeout_secs, default_query_timeout_secs, default_ssh_connect_timeout_secs, ConnectionConfig,
    DatabaseType, ProxyType,
};
use rmcp::schemars;
use serde::{Deserialize, Serialize};

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
pub struct ExecuteAndShowArgs {
    pub connection_name: String,
    pub sql: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub allow_writes: Option<bool>,
    #[serde(default)]
    pub allow_dangerous: Option<bool>,
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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateConnectionArgs {
    #[serde(alias = "connection_name")]
    pub name: String,
    #[serde(alias = "type")]
    pub db_type: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub driver_profile: Option<String>,
    #[serde(default)]
    pub driver_label: Option<String>,
    #[serde(default)]
    pub url_params: Option<String>,
    #[serde(default)]
    pub visible_databases: Option<Vec<String>>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub ssl: Option<bool>,
    #[serde(default)]
    pub sysdba: Option<bool>,
    #[serde(default)]
    pub connection_string: Option<String>,
    #[serde(default)]
    pub ssh_enabled: Option<bool>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
    #[serde(default)]
    pub ssh_key_path: Option<String>,
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
    #[serde(default)]
    pub ssh_expose_lan: Option<bool>,
    #[serde(default)]
    pub ssh_connect_timeout_secs: Option<u64>,
    #[serde(default)]
    pub connect_timeout_secs: Option<u64>,
    #[serde(default)]
    pub query_timeout_secs: Option<u64>,
    #[serde(default)]
    pub proxy_enabled: Option<bool>,
    #[serde(default)]
    pub proxy_type: Option<String>,
    #[serde(default)]
    pub proxy_host: Option<String>,
    #[serde(default)]
    pub proxy_port: Option<u16>,
    #[serde(default)]
    pub proxy_username: Option<String>,
    #[serde(default)]
    pub proxy_password: Option<String>,
    #[serde(default)]
    pub jdbc_driver_class: Option<String>,
    #[serde(default)]
    pub jdbc_driver_paths: Option<Vec<String>>,
    #[serde(default)]
    pub redis_cluster_nodes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreatedConnectionResult {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub driver_profile: Option<String>,
    pub driver_label: Option<String>,
}

#[derive(Clone, Copy)]
struct ProfileDefaults {
    db_type: DatabaseType,
    driver_profile: Option<&'static str>,
    driver_label: Option<&'static str>,
    port: u16,
    username: &'static str,
}

fn parse_database_type(value: &str) -> Result<DatabaseType, String> {
    let normalized = value.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("db_type cannot be empty".to_string());
    }
    serde_json::from_value(serde_json::Value::String(normalized.clone()))
        .map_err(|_| format!("Unsupported db_type: {value}"))
}

fn parse_proxy_type(value: Option<String>) -> Result<ProxyType, String> {
    match clean_optional(value) {
        Some(proxy_type) => serde_json::from_value(serde_json::Value::String(proxy_type.to_lowercase()))
            .map_err(|_| format!("Unsupported proxy_type: {proxy_type}")),
        None => Ok(ProxyType::Socks5),
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

fn profile_defaults(kind: &str) -> Result<ProfileDefaults, String> {
    let normalized = kind.trim().to_lowercase();
    let defaults = match normalized.as_str() {
        "mariadb" => ProfileDefaults {
            db_type: DatabaseType::Mysql,
            driver_profile: Some("mariadb"),
            driver_label: Some("MariaDB"),
            port: 3306,
            username: "root",
        },
        "tidb" => ProfileDefaults {
            db_type: DatabaseType::Mysql,
            driver_profile: Some("tidb"),
            driver_label: Some("TiDB"),
            port: 4000,
            username: "root",
        },
        "oceanbase" => ProfileDefaults {
            db_type: DatabaseType::Mysql,
            driver_profile: Some("oceanbase"),
            driver_label: Some("OceanBase"),
            port: 2881,
            username: "root",
        },
        "doris" | "selectdb" | "starrocks" => ProfileDefaults {
            db_type: DatabaseType::Mysql,
            driver_profile: Some(match normalized.as_str() {
                "selectdb" => "selectdb",
                "starrocks" => "starrocks",
                _ => "doris",
            }),
            driver_label: Some(match normalized.as_str() {
                "selectdb" => "SelectDB",
                "starrocks" => "StarRocks",
                _ => "Doris",
            }),
            port: 9030,
            username: "root",
        },
        "cockroachdb" => ProfileDefaults {
            db_type: DatabaseType::Postgres,
            driver_profile: Some("cockroachdb"),
            driver_label: Some("CockroachDB"),
            port: 26257,
            username: "root",
        },
        "opengauss" => ProfileDefaults {
            db_type: DatabaseType::Gaussdb,
            driver_profile: Some("opengauss"),
            driver_label: Some("openGauss"),
            port: 5432,
            username: "gaussdb",
        },
        _ => {
            let db_type = parse_database_type(&normalized)?;
            ProfileDefaults {
                db_type,
                driver_profile: None,
                driver_label: None,
                port: default_port(db_type),
                username: default_username(db_type),
            }
        }
    };
    Ok(defaults)
}

fn default_port(db_type: DatabaseType) -> u16 {
    match db_type {
        DatabaseType::Mysql | DatabaseType::Goldendb => 3306,
        DatabaseType::Postgres | DatabaseType::Gaussdb | DatabaseType::OpenGauss | DatabaseType::Vastbase => 5432,
        DatabaseType::Redshift => 5439,
        DatabaseType::Sqlite | DatabaseType::DuckDb | DatabaseType::Access | DatabaseType::Jdbc => 0,
        DatabaseType::Redis => 6379,
        DatabaseType::ClickHouse => 8123,
        DatabaseType::SqlServer => 1433,
        DatabaseType::MongoDb => 27017,
        DatabaseType::Oracle => 1521,
        DatabaseType::Elasticsearch => 9200,
        DatabaseType::Doris | DatabaseType::StarRocks => 9030,
        DatabaseType::Dameng => 5236,
        DatabaseType::Kingbase => 54321,
        DatabaseType::Highgo => 5866,
        DatabaseType::Yashandb => 1688,
        DatabaseType::Databricks => 443,
        DatabaseType::SapHana => 30015,
        DatabaseType::Teradata => 1025,
        DatabaseType::Vertica => 5433,
        DatabaseType::Firebird => 3050,
        DatabaseType::Exasol => 8563,
        DatabaseType::OceanbaseOracle => 2881,
        DatabaseType::Gbase => 5258,
        DatabaseType::H2 => 9092,
        DatabaseType::Snowflake | DatabaseType::Bigquery => 443,
        DatabaseType::Trino => 8080,
        DatabaseType::Hive => 10000,
        DatabaseType::Db2 => 50000,
        DatabaseType::Informix => 9088,
        DatabaseType::Neo4j => 7687,
        DatabaseType::Cassandra => 9042,
        DatabaseType::Kylin => 7070,
        DatabaseType::Sundb => 22000,
        DatabaseType::Tdengine => 6041,
        DatabaseType::Xugu => 5138,
        DatabaseType::Iris => 1972,
    }
}

fn default_username(db_type: DatabaseType) -> &'static str {
    match db_type {
        DatabaseType::Mysql
        | DatabaseType::Doris
        | DatabaseType::StarRocks
        | DatabaseType::Goldendb
        | DatabaseType::Sundb
        | DatabaseType::Tdengine => "root",
        DatabaseType::Postgres | DatabaseType::Vastbase => "postgres",
        DatabaseType::Redshift => "awsuser",
        DatabaseType::Gaussdb | DatabaseType::OpenGauss => "gaussdb",
        DatabaseType::SqlServer => "sa",
        DatabaseType::Oracle | DatabaseType::Kingbase => "system",
        DatabaseType::ClickHouse => "default",
        DatabaseType::Dameng => "SYSDBA",
        DatabaseType::Highgo => "highgo",
        DatabaseType::Yashandb => "sys",
        DatabaseType::Databricks => "token",
        DatabaseType::SapHana => "SYSTEM",
        DatabaseType::Vertica => "dbadmin",
        DatabaseType::Firebird => "SYSDBA",
        DatabaseType::Exasol => "sys",
        DatabaseType::OceanbaseOracle => "SYS",
        DatabaseType::Gbase => "gbasedbt",
        DatabaseType::H2 => "sa",
        DatabaseType::Hive
        | DatabaseType::Trino
        | DatabaseType::Snowflake
        | DatabaseType::Bigquery
        | DatabaseType::Xugu => "",
        DatabaseType::Db2 => "db2inst1",
        DatabaseType::Informix => "informix",
        DatabaseType::Neo4j => "neo4j",
        DatabaseType::Cassandra => "cassandra",
        DatabaseType::Kylin => "ADMIN",
        DatabaseType::Iris => "_SYSTEM",
        DatabaseType::Teradata => "",
        DatabaseType::Sqlite
        | DatabaseType::Redis
        | DatabaseType::DuckDb
        | DatabaseType::Access
        | DatabaseType::MongoDb
        | DatabaseType::Elasticsearch
        | DatabaseType::Jdbc => "",
    }
}

pub fn build_connection_config(args: CreateConnectionArgs, id: String) -> Result<ConnectionConfig, String> {
    let name = args.name.trim().to_string();
    if name.is_empty() {
        return Err("name cannot be empty".to_string());
    }

    let defaults = profile_defaults(&args.db_type)?;
    let driver_profile = clean_optional(args.driver_profile).or_else(|| defaults.driver_profile.map(str::to_string));
    let driver_label = clean_optional(args.driver_label).or_else(|| defaults.driver_label.map(str::to_string));

    Ok(ConnectionConfig {
        id,
        name,
        db_type: defaults.db_type,
        driver_profile,
        driver_label,
        url_params: clean_optional(args.url_params),
        host: clean_optional(args.host).unwrap_or_default(),
        port: args.port.unwrap_or(defaults.port),
        username: clean_optional(args.username).unwrap_or_else(|| defaults.username.to_string()),
        password: args.password.unwrap_or_default(),
        database: clean_optional(args.database),
        visible_databases: args.visible_databases,
        attached_databases: Vec::new(),
        color: clean_optional(args.color),
        ssh_enabled: args.ssh_enabled.unwrap_or(false),
        ssh_host: clean_optional(args.ssh_host).unwrap_or_default(),
        ssh_port: args.ssh_port.unwrap_or(22),
        ssh_user: clean_optional(args.ssh_user).unwrap_or_default(),
        ssh_password: args.ssh_password.unwrap_or_default(),
        ssh_key_path: clean_optional(args.ssh_key_path).unwrap_or_default(),
        ssh_key_passphrase: args.ssh_key_passphrase.unwrap_or_default(),
        ssh_tunnels: Vec::new(),
        ssh_expose_lan: args.ssh_expose_lan.unwrap_or(false),
        ssh_connect_timeout_secs: args.ssh_connect_timeout_secs.unwrap_or_else(default_ssh_connect_timeout_secs),
        connect_timeout_secs: args.connect_timeout_secs.unwrap_or_else(default_connect_timeout_secs),
        query_timeout_secs: args.query_timeout_secs.unwrap_or_else(default_query_timeout_secs),
        proxy_enabled: args.proxy_enabled.unwrap_or(false),
        proxy_type: parse_proxy_type(args.proxy_type)?,
        proxy_host: clean_optional(args.proxy_host).unwrap_or_default(),
        proxy_port: args.proxy_port.unwrap_or(1080),
        proxy_username: clean_optional(args.proxy_username).unwrap_or_default(),
        proxy_password: args.proxy_password.unwrap_or_default(),
        ssl: args.ssl.unwrap_or(false),
        ca_cert_path: String::new(),
        sysdba: args.sysdba.unwrap_or(false),
        oracle_connection_type: None,
        connection_string: clean_optional(args.connection_string),
        redis_connection_mode: None,
        redis_sentinel_master: String::new(),
        redis_sentinel_nodes: String::new(),
        redis_sentinel_username: String::new(),
        redis_sentinel_password: String::new(),
        redis_sentinel_tls: false,
        redis_cluster_nodes: clean_optional(args.redis_cluster_nodes).unwrap_or_default(),
        external_config: None,
        jdbc_driver_class: clean_optional(args.jdbc_driver_class),
        jdbc_driver_paths: args.jdbc_driver_paths.unwrap_or_default(),
        one_time: false,
    }
    .canonicalized())
}

pub fn created_connection_result(config: &ConnectionConfig) -> CreatedConnectionResult {
    CreatedConnectionResult {
        id: config.id.clone(),
        name: config.name.clone(),
        db_type: config.db_type,
        host: config.host.clone(),
        port: config.port,
        database: config.database.clone(),
        driver_profile: config.driver_profile.clone(),
        driver_label: config.driver_label.clone(),
    }
}

pub fn resolve_database(config: &ConnectionConfig, requested: Option<String>) -> String {
    if let Some(database) = clean_optional(requested) {
        return database;
    }

    if matches!(config.db_type, DatabaseType::Oracle | DatabaseType::OceanbaseOracle) {
        return String::new();
    }

    config.effective_database().unwrap_or_default().to_string()
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
    use dbx_core::models::connection::{
        default_connect_timeout_secs, default_query_timeout_secs, default_ssh_connect_timeout_secs, ProxyType,
    };

    fn config(db_type: DatabaseType, database: Option<&str>) -> ConnectionConfig {
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
            visible_databases: None,
            attached_databases: Vec::new(),
            color: None,
            ssh_enabled: false,
            ssh_host: String::new(),
            ssh_port: 22,
            ssh_user: String::new(),
            ssh_password: String::new(),
            ssh_key_path: String::new(),
            ssh_key_passphrase: String::new(),
            ssh_tunnels: Vec::new(),
            ssh_expose_lan: false,
            ssh_connect_timeout_secs: default_ssh_connect_timeout_secs(),
            connect_timeout_secs: default_connect_timeout_secs(),
            query_timeout_secs: default_query_timeout_secs(),
            proxy_enabled: false,
            proxy_type: ProxyType::Socks5,
            proxy_host: String::new(),
            proxy_port: 1080,
            proxy_username: String::new(),
            proxy_password: String::new(),
            ssl: false,
            ca_cert_path: String::new(),
            sysdba: false,
            oracle_connection_type: None,
            connection_string: None,
            redis_connection_mode: None,
            redis_sentinel_master: String::new(),
            redis_sentinel_nodes: String::new(),
            redis_sentinel_username: String::new(),
            redis_sentinel_password: String::new(),
            redis_sentinel_tls: false,
            redis_cluster_nodes: String::new(),
            external_config: None,
            jdbc_driver_class: None,
            jdbc_driver_paths: Vec::new(),
            one_time: false,
        }
    }

    fn create_args() -> CreateConnectionArgs {
        CreateConnectionArgs {
            name: "app postgres".to_string(),
            db_type: "postgres".to_string(),
            host: Some("127.0.0.1".to_string()),
            port: None,
            username: Some("app".to_string()),
            password: Some("secret".to_string()),
            database: Some("appdb".to_string()),
            driver_profile: None,
            driver_label: None,
            url_params: None,
            visible_databases: None,
            color: None,
            ssl: None,
            sysdba: None,
            connection_string: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_path: None,
            ssh_key_passphrase: None,
            ssh_expose_lan: None,
            ssh_connect_timeout_secs: None,
            connect_timeout_secs: None,
            query_timeout_secs: None,
            proxy_enabled: None,
            proxy_type: None,
            proxy_host: None,
            proxy_port: None,
            proxy_username: None,
            proxy_password: None,
            jdbc_driver_class: None,
            jdbc_driver_paths: None,
            redis_cluster_nodes: None,
        }
    }

    #[test]
    fn resolve_database_uses_requested_database_first() {
        let config = config(DatabaseType::Mysql, Some("app"));

        assert_eq!(resolve_database(&config, None), "app");
        assert_eq!(resolve_database(&config, Some("requested".to_string())), "requested");
    }

    #[test]
    fn resolve_database_falls_back_to_configured_database() {
        let config = config(DatabaseType::Postgres, Some("appdb"));

        assert_eq!(resolve_database(&config, None), "appdb");
    }

    #[test]
    fn resolve_database_does_not_use_oracle_service_as_database() {
        let config = config(DatabaseType::Oracle, Some("ORCL"));

        assert_eq!(resolve_database(&config, None), "");
        assert_eq!(resolve_database(&config, Some("MCHS".to_string())), "MCHS");
        assert_eq!(resolve_schema(&config, "MCHS", None), "MCHS");
    }

    #[test]
    fn create_connection_config_uses_upstream_connection_fields() {
        let config = build_connection_config(create_args(), "generated-id".to_string()).unwrap();

        assert_eq!(config.id, "generated-id");
        assert_eq!(config.name, "app postgres");
        assert_eq!(config.db_type, DatabaseType::Postgres);
        assert_eq!(config.port, 5432);
        assert_eq!(config.database.as_deref(), Some("appdb"));
        assert_eq!(config.ca_cert_path, "");
        assert_eq!(config.redis_connection_mode, None);
        assert_eq!(config.redis_sentinel_master, "");
        assert_eq!(config.redis_sentinel_nodes, "");
        assert_eq!(config.redis_sentinel_username, "");
        assert_eq!(config.redis_sentinel_password, "");
        assert!(!config.redis_sentinel_tls);
    }

    #[test]
    fn create_connection_config_uses_defaults_for_agent_database_types() {
        let mut args = create_args();
        args.db_type = "yashandb".to_string();
        args.host = Some("10.1.2.3".to_string());
        args.port = None;
        args.username = None;
        args.database = None;

        let config = build_connection_config(args, "generated-id".to_string()).unwrap();

        assert_eq!(config.db_type, DatabaseType::Yashandb);
        assert_eq!(config.port, 1688);
        assert_eq!(config.username, "sys");
    }

    #[test]
    fn create_connection_config_keeps_secret_fields_for_storage_layer() {
        let mut args = create_args();
        args.connection_string = Some("MY_TNS_ALIAS".to_string());
        args.proxy_enabled = Some(true);
        args.proxy_password = Some("proxy-secret".to_string());

        let config = build_connection_config(args, "generated-id".to_string()).unwrap();

        assert_eq!(config.password, "secret");
        assert_eq!(config.connection_string.as_deref(), Some("MY_TNS_ALIAS"));
        assert!(config.proxy_enabled);
        assert_eq!(config.proxy_password, "proxy-secret");
    }
}
