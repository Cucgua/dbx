fn main() {
    // In dev mode, skip framework bundling to avoid requiring libodbc/libltdl locally.
    // CI copies the dylibs into src-tauri/ before release builds.
    #[cfg(target_os = "macos")]
    if std::env::var("TAURI_CONFIG").is_err() && !std::path::Path::new("libodbc.2.dylib").exists() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"macOS":{"frameworks":[]}}}"#);
    }
    tauri_build::build()
}
