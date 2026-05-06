pub mod clickhouse_driver;
pub mod dm_driver;
pub mod duckdb_driver;
pub mod elasticsearch_driver;
pub mod file_validator;
pub mod mongo_driver;
pub mod mysql;
pub mod oracle_driver;
pub mod postgres;
pub mod redis_driver;
pub mod sqlite;
pub mod sqlserver;
pub mod ssh_tunnel;

use std::future::Future;
use std::time::Duration;

// Re-export types so that `db::QueryResult` etc. work within dbx-core
pub use crate::types::*;
pub use file_validator::validate_file_path;

pub const CONNECTION_TIMEOUT_SECS: u64 = 5;
pub const TCP_PROBE_TIMEOUT_SECS: u64 = 3;

pub fn connection_timeout() -> Duration {
    Duration::from_secs(CONNECTION_TIMEOUT_SECS)
}

pub fn tcp_probe_timeout() -> Duration {
    Duration::from_secs(TCP_PROBE_TIMEOUT_SECS)
}

pub async fn with_connection_timeout<T, F>(label: &str, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(connection_timeout(), future)
        .await
        .map_err(|_| format!("{label} connection timed out ({CONNECTION_TIMEOUT_SECS}s)"))?
}

pub async fn probe_tcp_endpoint(label: &str, host: &str, port: u16) -> Result<(), String> {
    tokio::time::timeout(tcp_probe_timeout(), tokio::net::TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("{label} TCP connection timed out ({TCP_PROBE_TIMEOUT_SECS}s)"))?
        .map(|_| ())
        .map_err(|e| format!("{label} TCP connection failed: {e}"))
}
