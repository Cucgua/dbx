use super::file_validator::validate_file_path;
use std::sync::Arc;
use std::sync::Mutex;

/// Connects to a DuckDb database file with file validation.
///
/// # Arguments
/// * `path` - The file path to the DuckDb database
///
/// # Returns
/// * `Ok(Arc<Mutex<duckdb::Connection>>)` on successful connection
/// * `Err(String)` with descriptive error message if connection fails
pub fn connect_path(path: &str) -> Result<Arc<Mutex<duckdb::Connection>>, String> {
    let is_memory = is_memory_database_path(path);
    if !is_memory {
        validate_file_path(path, is_network_path)?;
    }

    let connection = if is_memory { duckdb::Connection::open_in_memory() } else { duckdb::Connection::open(path) }
        .map_err(|e| format!("DuckDb connection failed: {e}"))?;

    Ok(Arc::new(Mutex::new(connection)))
}

fn is_network_path(path: &str) -> bool {
    path.starts_with("\\\\") || path.starts_with("//") || path.contains("wsl.localhost") || path.contains("wsl$")
}

pub fn is_memory_database_path(path: &str) -> bool {
    path.trim().eq_ignore_ascii_case(":memory:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_path_supports_memory_database() {
        let con = connect_path(":memory:").expect("connect in-memory DuckDB");
        let locked = con.lock().expect("lock connection");

        locked.execute_batch("CREATE TABLE memory_probe AS SELECT 42 AS id;").expect("create table");
        let value: i32 = locked.query_row("SELECT id FROM memory_probe;", [], |row| row.get(0)).expect("select row");

        assert_eq!(value, 42);
    }
}
