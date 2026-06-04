use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const CONFIG_FILE: &str = "mcp-http-config.json";
const STATUS_FILE: &str = "mcp-http.json";
const TOKEN_FILE: &str = "mcp-http-token";
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 7424;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpHttpConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpHttpStatus {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub endpoint: String,
    pub token: String,
    pub started_at: DateTime<Utc>,
}

impl McpHttpConfig {
    pub fn load(app_data_dir: &Path) -> Result<Self, String> {
        let saved = read_config(app_data_dir)?;
        let enabled = std::env::var("DBX_MCP_ENABLED")
            .map(|v| v != "0")
            .unwrap_or_else(|_| saved.as_ref().map(|config| config.enabled).unwrap_or(true));
        let host = std::env::var("DBX_MCP_HOST")
            .unwrap_or_else(|_| saved.as_ref().map(|config| config.host.clone()).unwrap_or_else(default_host));
        let port = std::env::var("DBX_MCP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .or_else(|| saved.as_ref().map(|config| config.port))
            .unwrap_or(DEFAULT_PORT);
        let token = std::env::var("DBX_MCP_TOKEN")
            .ok()
            .or_else(|| saved.as_ref().map(|config| config.token.clone()).filter(|token| !token.trim().is_empty()))
            .unwrap_or_else(|| load_or_create_token(app_data_dir));
        Ok(Self { enabled, host, port, token })
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}:{}/mcp", self.host, self.port)
    }
}

fn default_host() -> String {
    DEFAULT_HOST.to_string()
}

pub fn read_config(app_data_dir: &Path) -> Result<Option<McpHttpConfig>, String> {
    let path = app_data_dir.join(CONFIG_FILE);
    match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub fn write_config(app_data_dir: &Path, config: &McpHttpConfig) -> Result<McpHttpConfig, String> {
    let token = config.token.trim();
    let normalized = McpHttpConfig {
        enabled: config.enabled,
        host: match config.host.trim() {
            "" => default_host(),
            host => host.to_string(),
        },
        port: if config.port == 0 { DEFAULT_PORT } else { config.port },
        token: if token.is_empty() { load_or_create_token(app_data_dir) } else { token.to_string() },
    };
    fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = app_data_dir.join(CONFIG_FILE);
    let json = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(normalized)
}

pub fn write_status(app_data_dir: &Path, config: &McpHttpConfig) -> Result<(), String> {
    let status = McpHttpStatus {
        enabled: config.enabled,
        host: config.host.clone(),
        port: config.port,
        endpoint: config.endpoint(),
        token: config.token.clone(),
        started_at: Utc::now(),
    };
    let path = app_data_dir.join(STATUS_FILE);
    let json = serde_json::to_string_pretty(&status).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn clear_status(app_data_dir: &Path) -> Result<(), String> {
    let path = app_data_dir.join(STATUS_FILE);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn read_status(app_data_dir: &Path) -> Result<Option<McpHttpStatus>, String> {
    let path = app_data_dir.join(STATUS_FILE);
    match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn load_or_create_token(app_data_dir: &Path) -> String {
    let path = app_data_dir.join(TOKEN_FILE);
    if let Ok(token) = fs::read_to_string(&path) {
        let token = token.trim();
        if !token.is_empty() {
            return token.to_string();
        }
    }
    let token = format!("dbx-{}", Uuid::new_v4().simple());
    let _ = fs::create_dir_all(app_data_dir);
    let _ = fs::write(path, &token);
    token
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_uses_host_port_and_mcp_path() {
        let config =
            McpHttpConfig { enabled: true, host: "127.0.0.1".to_string(), port: 7424, token: "dbx-test".to_string() };

        assert_eq!(config.endpoint(), "http://127.0.0.1:7424/mcp");
    }

    #[test]
    fn app_data_config_file_supplies_mcp_defaults() {
        let dir = std::env::temp_dir().join(format!("dbx-mcp-test-{}", Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).expect("create temp config dir");
        fs::write(dir.join(CONFIG_FILE), r#"{"enabled":false,"host":"0.0.0.0","port":8123,"token":"dbx-saved"}"#)
            .expect("write config");

        let config = McpHttpConfig::load(&dir).expect("load config");
        let _ = fs::remove_dir_all(dir);

        assert!(!config.enabled);
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8123);
        assert_eq!(config.token, "dbx-saved");
    }

    #[test]
    fn write_config_normalizes_empty_host_port_and_token() {
        let dir = std::env::temp_dir().join(format!("dbx-mcp-test-{}", Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).expect("create temp config dir");

        let config = McpHttpConfig { enabled: false, host: " ".to_string(), port: 0, token: " ".to_string() };
        let saved = write_config(&dir, &config).expect("write config");
        let loaded = read_config(&dir).expect("read config").expect("config exists");
        let _ = fs::remove_dir_all(dir);

        assert!(!saved.enabled);
        assert_eq!(saved.host, DEFAULT_HOST);
        assert_eq!(saved.port, DEFAULT_PORT);
        assert!(saved.token.starts_with("dbx-"));
        assert_eq!(loaded, saved);
    }
}
