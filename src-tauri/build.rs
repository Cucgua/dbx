use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Keep the Schema RAG sidecar available in Tauri bundles before frontend assets are embedded.
    prepare_schema_rag_sidecar();
    tauri_build::build()
}

fn prepare_schema_rag_sidecar() {
    let Ok(target) = env::var("TARGET") else {
        return;
    };
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let workspace_dir = manifest_dir.parent().expect("src-tauri has a workspace parent");
    let sidecar_target_dir = env::var_os("DBX_SCHEMA_RAG_SIDECAR_TARGET_DIR")
        .map(PathBuf::from)
        .map(|path| if path.is_absolute() { path } else { workspace_dir.join(path) })
        .unwrap_or_else(|| default_sidecar_target_dir(workspace_dir));

    println!("cargo:rerun-if-changed={}", workspace_dir.join("crates/dbx-schema-rag-sidecar").display());
    println!("cargo:rerun-if-env-changed=DBX_SKIP_SCHEMA_RAG_SIDECAR_BUILD");
    println!("cargo:rerun-if-env-changed=DBX_REQUIRE_SCHEMA_RAG_SIDECAR_BUILD");
    println!("cargo:rerun-if-env-changed=DBX_SCHEMA_RAG_SIDECAR_TARGET_DIR");

    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let dest_dir = manifest_dir.join("binaries");
    let dest = dest_dir.join(format!("dbx-schema-rag-sidecar-{target}{exe_suffix}"));

    if env::var_os("DBX_SKIP_SCHEMA_RAG_SIDECAR_BUILD").is_some() {
        write_placeholder_sidecar(&dest);
        return;
    }

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let require_sidecar = profile == "release" || env::var_os("DBX_REQUIRE_SCHEMA_RAG_SIDECAR_BUILD").is_some();
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let mut command = Command::new(cargo);
    command
        .arg("build")
        .arg("-p")
        .arg("dbx-schema-rag-sidecar")
        .arg("--locked")
        .arg("--target")
        .arg(&target)
        .arg("--target-dir")
        .arg(&sidecar_target_dir)
        .current_dir(workspace_dir);
    if profile == "release" {
        command.arg("--release");
    }
    let status = match command.status() {
        Ok(status) => status,
        Err(err) => {
            if require_sidecar {
                panic!("failed to start cargo build for schema RAG sidecar: {err}");
            }
            warn_placeholder_sidecar(&dest, &format!("failed to start schema RAG sidecar build: {err}"));
            return;
        }
    };
    if !status.success() {
        if require_sidecar {
            panic!("schema RAG sidecar build failed");
        }
        warn_placeholder_sidecar(&dest, "schema RAG sidecar build failed");
        return;
    }

    let source = sidecar_target_dir.join(&target).join(&profile).join(format!("dbx-schema-rag-sidecar{exe_suffix}"));
    if !source.exists() {
        if !require_sidecar {
            warn_placeholder_sidecar(
                &dest,
                &format!("schema RAG sidecar binary was not produced at {}", source.display()),
            );
            return;
        }
        panic!("schema RAG sidecar binary was not produced at {}", source.display());
    }
    fs::create_dir_all(&dest_dir).expect("failed to create src-tauri/binaries");
    copy_file(&source, &dest);
}

fn default_sidecar_target_dir(workspace_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        workspace_dir.hash(&mut hasher);
        let suffix = format!("{:08x}", hasher.finish() as u32);
        let base_dir = env::var_os("LOCALAPPDATA")
            .or_else(|| env::var_os("TEMP"))
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace_dir.join("target"));
        base_dir.join(format!("dbxsr-{suffix}"))
    }

    #[cfg(not(windows))]
    {
        workspace_dir.join("target").join("dbx-schema-rag-sidecar")
    }
}

fn warn_placeholder_sidecar(dest: &Path, reason: &str) {
    println!(
        "cargo:warning={reason}; writing placeholder schema RAG sidecar for this debug build. \
Set DBX_REQUIRE_SCHEMA_RAG_SIDECAR_BUILD=1 to make this failure fatal."
    );
    write_placeholder_sidecar(dest);
}

fn write_placeholder_sidecar(dest: &Path) {
    if dest.exists() {
        return;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).expect("failed to create src-tauri/binaries");
    }
    fs::write(dest, b"schema RAG sidecar build skipped\n").expect("failed to write placeholder schema RAG sidecar");
}

fn copy_file(source: &Path, dest: &Path) {
    if dest.exists() {
        fs::remove_file(dest).expect("failed to remove stale schema RAG sidecar binary");
    }
    fs::copy(source, dest).expect("failed to copy schema RAG sidecar binary");
}
