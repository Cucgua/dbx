use async_trait::async_trait;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct McpOpenTableEvent {
    pub connection_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub table: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct McpExecuteQueryEvent {
    pub connection_id: String,
    pub database: String,
    pub sql: String,
    pub allow_writes: bool,
    pub allow_dangerous: bool,
}

#[async_trait]
pub trait DesktopEventSink: Send + Sync {
    async fn open_table(&self, event: McpOpenTableEvent) -> Result<(), String>;
    async fn execute_query(&self, event: McpExecuteQueryEvent) -> Result<(), String>;
    async fn reload_connections(&self) -> Result<(), String>;
}
