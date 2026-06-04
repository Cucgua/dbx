use std::env;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let target = env::var("TARGET").unwrap_or_default();
    if target.ends_with("windows-msvc") {
        println!("cargo:rustc-link-lib=static:+whole-archive=kuzu_rs");
    }
}
