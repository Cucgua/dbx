use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use dbx_core::models::app_settings::AppSettings;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    pub fn load(app_data_dir: &Path, app_settings: Option<&AppSettings>) -> Result<Self, String> {
        let enabled = std::env::var("DBX_MCP_ENABLED")
            .map(|v| v != "0")
            .unwrap_or_else(|_| app_settings.and_then(|settings| settings.mcp_http_enabled).unwrap_or(true));
        let host = std::env::var("DBX_MCP_HOST").unwrap_or_else(|_| {
            app_settings.and_then(|settings| settings.mcp_http_host()).unwrap_or("127.0.0.1").to_string()
        });
        let port = std::env::var("DBX_MCP_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .or_else(|| app_settings.and_then(|settings| settings.mcp_http_port))
            .unwrap_or(7424);
        let token = std::env::var("DBX_MCP_TOKEN").unwrap_or_else(|_| load_or_create_token(app_data_dir));
        Ok(Self { enabled, host, port, token })
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}:{}/mcp", self.host, self.port)
    }
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
    let path = app_data_dir.join("mcp-http.json");
    let json = serde_json::to_string_pretty(&status).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_status(app_data_dir: &Path) -> Result<Option<McpHttpStatus>, String> {
    let path = app_data_dir.join("mcp-http.json");
    match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn load_or_create_token(app_data_dir: &Path) -> String {
    let path = app_data_dir.join("mcp-http-token");
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
    fn app_settings_supply_mcp_defaults() {
        let settings = AppSettings {
            mcp_http_enabled: Some(false),
            mcp_http_host: Some("0.0.0.0".to_string()),
            mcp_http_port: Some(8123),
            ..Default::default()
        };

        let dir = std::env::temp_dir().join(format!("dbx-mcp-test-{}", Uuid::new_v4().simple()));
        let config = McpHttpConfig::load(&dir, Some(&settings)).expect("load config");
        let _ = fs::remove_dir_all(dir);

        assert!(!config.enabled);
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8123);
    }
}
