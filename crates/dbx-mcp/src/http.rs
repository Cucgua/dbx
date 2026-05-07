use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::State,
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tokio_util::sync::CancellationToken;

use crate::config::{write_status, McpHttpConfig};
use crate::service::DbxMcpService;
use crate::McpRuntimeOptions;

#[derive(Clone)]
struct AuthState {
    token: String,
}

pub async fn start_http_server(options: McpRuntimeOptions) -> Result<(), String> {
    let app_settings = options.state.storage.load_app_settings().await?;
    let config = McpHttpConfig::load(&options.app_data_dir, Some(&app_settings))?;
    if !config.enabled {
        write_status(&options.app_data_dir, &config)?;
        log::info!("DBX MCP HTTP server disabled");
        return Ok(());
    }

    let addr: SocketAddr =
        format!("{}:{}", config.host, config.port).parse::<SocketAddr>().map_err(|e| e.to_string())?;
    let cancellation = CancellationToken::new();
    let state = options.state.clone();
    let events = options.events.clone();

    let service = StreamableHttpService::new(
        move || Ok(DbxMcpService::new(state.clone(), events.clone())),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default().with_cancellation_token(cancellation.child_token()),
    );

    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(AuthState { token: config.token.clone() }, require_bearer_token));

    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    write_status(&options.app_data_dir, &config)?;
    log::info!("DBX MCP HTTP server listening on {}", config.endpoint());

    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            cancellation.cancelled().await;
        })
        .await
        .map_err(|e| e.to_string())
}

async fn require_bearer_token(
    State(state): State<AuthState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let expected = format!("Bearer {}", state.token);
    let authorized = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == expected)
        .unwrap_or(false);

    if authorized {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}
