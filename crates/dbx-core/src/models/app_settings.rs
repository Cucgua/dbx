use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub oracle_client_lib_dir: Option<String>,
    #[serde(default)]
    pub oracle_client_config_dir: Option<String>,
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
}
