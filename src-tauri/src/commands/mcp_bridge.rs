use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::connection::AppState;
use super::connection_secrets::{create_secret_store, load_connections_from_file};

const BIND_ADDR: &str = "127.0.0.1:0";

#[derive(Deserialize)]
struct OpenTableRequest {
    connection_name: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
}

#[derive(Clone, Serialize)]
pub struct McpOpenTableEvent {
    pub connection_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub table: String,
}

pub fn start(app_handle: AppHandle, _state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(BIND_ADDR).await {
            Ok(l) => l,
            Err(e) => {
                log::warn!("MCP bridge failed to bind {BIND_ADDR}: {e}");
                return;
            }
        };
        log::info!("MCP bridge listening on {BIND_ADDR}");
        let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        log::info!("MCP bridge assigned port {actual_port}");
        if let Ok(dir) = app_handle.path().app_data_dir() {
            let _ = std::fs::write(dir.join("mcp-bridge-port"), actual_port.to_string());
        }
        loop {
            let (mut stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let app = app_handle.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = match stream.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let request = String::from_utf8_lossy(&buf[..n]);
                let body = request.split("\r\n\r\n").nth(1).unwrap_or("");
                let first_line = request.lines().next().unwrap_or("");

                if !first_line.starts_with("POST /open-table") {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
                    return;
                }

                let req: OpenTableRequest = match serde_json::from_str(body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }
                };

                let configs = match load_configs_from_disk(&app) {
                    Ok(c) => c,
                    Err(_) => {
                        let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n").await;
                        return;
                    }
                };

                let found = configs.iter().find(|c| c.name.eq_ignore_ascii_case(&req.connection_name));
                let Some(config) = found else {
                    let resp = b"HTTP/1.1 404 Not Found\r\nContent-Length: 20\r\n\r\nConnection not found";
                    let _ = stream.write_all(resp).await;
                    return;
                };

                let event = McpOpenTableEvent {
                    connection_id: config.id.clone(),
                    database: req.database.unwrap_or_else(|| config.database.clone().unwrap_or_default()),
                    schema: req.schema,
                    table: req.table,
                };

                let _ = app.emit("mcp-open-table", &event);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await;
            });
        }
    });
}

fn load_configs_from_disk(app: &AppHandle) -> Result<Vec<crate::models::connection::ConnectionConfig>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("connections.json");
    let store = create_secret_store(app);
    load_connections_from_file(&path, &*store)
}
