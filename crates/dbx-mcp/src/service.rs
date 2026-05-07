use std::sync::Arc;

use dbx_core::models::connection::ConnectionConfig;
use rmcp::{
    handler::server::{tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content},
    tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler,
};
use serde::Serialize;
use serde_json::json;

use crate::events::DesktopEventSink;
use crate::events::{McpExecuteQueryEvent, McpOpenTableEvent};
use crate::tools::{
    resolve_database, resolve_schema, DescribeTableArgs, ExecuteQueryArgs, ListDatabasesArgs, ListSchemasArgs,
    ListTablesArgs, OpenTableArgs, QUERY_ROW_LIMIT,
};

#[derive(Clone)]
pub struct DbxMcpService {
    pub state: Arc<dbx_core::connection::AppState>,
    pub events: Arc<dyn DesktopEventSink>,
    tool_router: ToolRouter<Self>,
}

impl DbxMcpService {
    pub fn new(state: Arc<dbx_core::connection::AppState>, events: Arc<dyn DesktopEventSink>) -> Self {
        Self { state, events, tool_router: Self::tool_router() }
    }

    async fn find_connection(&self, name: &str) -> Result<ConnectionConfig, McpError> {
        let configs = self.state.storage.load_connections().await.map_err(internal_error)?;
        let config = configs
            .into_iter()
            .find(|c| c.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| McpError::invalid_params(format!("Connection \"{name}\" not found"), None))?;
        self.state.configs.lock().await.insert(config.id.clone(), config.clone());
        Ok(config)
    }
}

#[tool_router]
impl DbxMcpService {
    #[tool(description = "List all database connections configured in DBX desktop")]
    async fn dbx_list_connections(&self) -> Result<CallToolResult, McpError> {
        let configs = self.state.storage.load_connections().await.map_err(internal_error)?;
        let value = configs
            .into_iter()
            .map(|c| {
                json!({
                    "name": c.name,
                    "type": c.db_type,
                    "host": c.host,
                    "port": c.port,
                    "database": c.database
                })
            })
            .collect::<Vec<_>>();
        structured_result(value)
    }

    #[tool(description = "List databases for a DBX connection")]
    async fn dbx_list_databases(
        &self,
        Parameters(args): Parameters<ListDatabasesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let rows = dbx_core::schema::list_databases_core(&self.state, &config.id).await.map_err(internal_error)?;
        structured_result(rows)
    }

    #[tool(description = "List schemas for a DBX connection")]
    async fn dbx_list_schemas(
        &self,
        Parameters(args): Parameters<ListSchemasArgs>,
    ) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        let rows =
            dbx_core::schema::list_schemas_core(&self.state, &config.id, &database).await.map_err(internal_error)?;
        structured_result(rows)
    }

    #[tool(description = "List tables and views for a DBX connection")]
    async fn dbx_list_tables(&self, Parameters(args): Parameters<ListTablesArgs>) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        let schema = resolve_schema(&config, &database, args.schema);
        let rows = dbx_core::schema::list_tables_core(&self.state, &config.id, &database, &schema)
            .await
            .map_err(internal_error)?;
        structured_result(rows)
    }

    #[tool(description = "Describe columns for a table in a DBX connection")]
    async fn dbx_describe_table(
        &self,
        Parameters(args): Parameters<DescribeTableArgs>,
    ) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        let schema = resolve_schema(&config, &database, args.schema);
        let rows = dbx_core::schema::get_columns_core(&self.state, &config.id, &database, &schema, &args.table)
            .await
            .map_err(internal_error)?;
        structured_result(rows)
    }

    #[tool(description = "Execute a SQL query through DBX desktop and return at most 100 rows")]
    async fn dbx_execute_query(
        &self,
        Parameters(args): Parameters<ExecuteQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        let mut result = dbx_core::query::execute_sql_statement(
            &self.state,
            &config.id,
            &database,
            &args.sql,
            args.schema.as_deref(),
            None,
        )
        .await
        .map_err(internal_error)?;

        if result.rows.len() > QUERY_ROW_LIMIT {
            result.rows.truncate(QUERY_ROW_LIMIT);
            result.truncated = true;
        }

        structured_result(result)
    }

    #[tool(description = "Open a DBX table tab in the running desktop UI")]
    async fn dbx_open_table(&self, Parameters(args): Parameters<OpenTableArgs>) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        self.events
            .open_table(McpOpenTableEvent {
                connection_id: config.id,
                database,
                schema: args.schema,
                table: args.table.clone(),
            })
            .await
            .map_err(internal_error)?;
        Ok(CallToolResult::success(vec![Content::text(format!("Opened {} in DBX", args.table))]))
    }

    #[tool(description = "Execute SQL in the running DBX desktop UI and show the result tab there")]
    async fn dbx_execute_and_show(
        &self,
        Parameters(args): Parameters<ExecuteQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let config = self.find_connection(&args.connection_name).await?;
        let database = resolve_database(&config, args.database);
        self.events
            .execute_query(McpExecuteQueryEvent { connection_id: config.id, database, sql: args.sql })
            .await
            .map_err(internal_error)?;
        Ok(CallToolResult::success(vec![Content::text("Query sent to DBX")]))
    }
}

#[tool_handler(
    name = "dbx-desktop-mcp",
    version = "0.1.0",
    instructions = "Use DBX desktop connections to inspect schemas and execute database queries."
)]
impl ServerHandler for DbxMcpService {}

fn structured_result<T: Serialize>(value: T) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::structured(json!(value)))
}

fn internal_error(message: String) -> McpError {
    McpError::internal_error(message, None)
}
