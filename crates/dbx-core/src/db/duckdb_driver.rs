use std::sync::Arc;
use std::sync::Mutex;
use super::file_validator::validate_file_path;

/// Connects to a DuckDb database file with file validation.
/// 
/// # Arguments
/// * `path` - The file path to the DuckDb database
/// 
/// # Returns
/// * `Ok(Arc<Mutex<duckdb::Connection>>)` on successful connection
/// * `Err(String)` with descriptive error message if connection fails
pub fn connect_path(path: &str) -> Result<Arc<Mutex<duckdb::Connection>>, String> {
    // Validate file path using universal validator
    validate_file_path(path, is_network_path)?;

    let connection = duckdb::Connection::open(path)
        .map_err(|e| format!("DuckDb connection failed: {e}"))?;

    Ok(Arc::new(Mutex::new(connection)))
}

fn is_network_path(path: &str) -> bool {
    path.starts_with("\\\\") || path.starts_with("//") || path.contains("wsl.localhost") || path.contains("wsl$")
}
