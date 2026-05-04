use tauri::{AppHandle, Manager};

// Re-export core types and functions
pub(super) use dbx_core::connection_secrets::{
    save_connections_to_file, load_connections_from_file,
    ConnectionSecretStore, FileSecretStore,
    secret_account,
};

const KEYRING_SERVICE: &str = "dev.dbx.connections";

pub(super) struct KeyringConnectionSecretStore;

impl ConnectionSecretStore for KeyringConnectionSecretStore {
    fn set_secret(&self, connection_id: &str, key: &str, secret: &str) -> Result<(), String> {
        let entry = keyring_entry(connection_id, key, "create")?;
        entry
            .set_password(secret)
            .map_err(|err| keyring_error("store", connection_id, key, err))
    }

    fn get_secret(&self, connection_id: &str, key: &str) -> Result<Option<String>, String> {
        let entry = keyring_entry(connection_id, key, "create")?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(keyring_error("read", connection_id, key, err)),
        }
    }

    fn delete_secret(&self, connection_id: &str, key: &str) -> Result<(), String> {
        let entry = keyring_entry(connection_id, key, "create")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keyring_error("delete", connection_id, key, err)),
        }
    }
}

pub(super) fn create_secret_store(app: &AppHandle) -> Box<dyn ConnectionSecretStore> {
    if cfg!(debug_assertions) {
        let dir = app.path().app_data_dir().expect("failed to resolve app data dir");
        std::fs::create_dir_all(&dir).ok();
        Box::new(FileSecretStore::new(dir.join("secrets.json")))
    } else {
        Box::new(KeyringConnectionSecretStore)
    }
}

fn keyring_entry(connection_id: &str, key: &str, action: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &secret_account(connection_id, key))
        .map_err(|err| keyring_error(action, connection_id, key, err))
}

fn keyring_error(action: &str, connection_id: &str, key: &str, err: keyring::Error) -> String {
    format!("Failed to {action} saved {key} for connection {connection_id}: {err}")
}
