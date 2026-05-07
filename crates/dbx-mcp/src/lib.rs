mod config;
mod events;
mod http;
mod service;
mod tools;

use std::path::PathBuf;
use std::sync::Arc;

pub use config::{read_status, McpHttpConfig, McpHttpStatus};
pub use events::{DesktopEventSink, McpExecuteQueryEvent, McpOpenTableEvent};

pub struct McpRuntimeOptions {
    pub app_data_dir: PathBuf,
    pub state: Arc<dbx_core::connection::AppState>,
    pub events: Arc<dyn DesktopEventSink>,
}

pub async fn run(options: McpRuntimeOptions) -> Result<(), String> {
    http::start_http_server(options).await
}
