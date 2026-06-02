use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
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
        .unwrap_or_else(|| workspace_dir.join("target").join("dbx-schema-rag-sidecar"));

    println!("cargo:rerun-if-changed={}", workspace_dir.join("crates/dbx-schema-rag-sidecar").display());
    println!("cargo:rerun-if-env-changed=DBX_SKIP_SCHEMA_RAG_SIDECAR_BUILD");

    if env::var_os("DBX_SKIP_SCHEMA_RAG_SIDECAR_BUILD").is_some() {
        return;
    }

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
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
    let status = command.status().expect("failed to start cargo build for schema RAG sidecar");
    if !status.success() {
        panic!("schema RAG sidecar build failed");
    }

    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let source = sidecar_target_dir.join(&target).join(&profile).join(format!("dbx-schema-rag-sidecar{exe_suffix}"));
    if !source.exists() {
        panic!("schema RAG sidecar binary was not produced at {}", source.display());
    }
    let dest_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&dest_dir).expect("failed to create src-tauri/binaries");
    let dest = dest_dir.join(format!("dbx-schema-rag-sidecar-{target}{exe_suffix}"));
    copy_file(&source, &dest);
}

fn copy_file(source: &Path, dest: &Path) {
    if dest.exists() {
        fs::remove_file(dest).expect("failed to remove stale schema RAG sidecar binary");
    }
    fs::copy(source, dest).expect("failed to copy schema RAG sidecar binary");
}
