use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub oracle_client_lib_dir: Option<String>,
    #[serde(default)]
    pub oracle_client_config_dir: Option<String>,
    #[serde(default)]
    pub mcp_http_enabled: Option<bool>,
    #[serde(default)]
    pub mcp_http_host: Option<String>,
    #[serde(default)]
    pub mcp_http_port: Option<u16>,
}

impl AppSettings {
    pub fn oracle_client_lib_dir(&self) -> Option<&str> {
        self.oracle_client_lib_dir.as_deref().map(str::trim).filter(|value| !value.is_empty())
    }

    pub fn oracle_client_config_dir(&self) -> Option<&str> {
        self.oracle_client_config_dir.as_deref().map(str::trim).filter(|value| !value.is_empty())
    }

    pub fn has_oracle_client_settings(&self) -> bool {
        self.oracle_client_lib_dir().is_some() || self.oracle_client_config_dir().is_some()
    }

    pub fn mcp_http_host(&self) -> Option<&str> {
        self.mcp_http_host.as_deref().map(str::trim).filter(|value| !value.is_empty())
    }
}
