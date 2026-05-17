fn main() {
    prepare_daemon_sidecar_placeholders();

    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        println!("cargo:rustc-link-lib=z");
        println!("cargo:rustc-link-lib=iconv");
    }
}

fn prepare_daemon_sidecar_placeholders() {
    let target = match std::env::var("TARGET") {
        Ok(value) => value,
        Err(_) => return,
    };
    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(value) => std::path::PathBuf::from(value),
        Err(_) => return,
    };
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let sidecars_dir = manifest_dir.join("target").join("sidecars");
    if let Err(error) = std::fs::create_dir_all(&sidecars_dir) {
        println!("cargo:warning=failed to create sidecar placeholder dir: {error}");
        return;
    }

    for name in ["codex_monitor_daemon", "codex_monitor_daemonctl"] {
        let path = sidecars_dir.join(format!("{name}-{target}{extension}"));
        if path.exists() {
            continue;
        }
        if let Err(error) = std::fs::write(&path, placeholder_contents(name)) {
            println!(
                "cargo:warning=failed to create sidecar placeholder {}: {error}",
                path.display()
            );
        }
    }
}

fn placeholder_contents(name: &str) -> String {
    format!(
        "placeholder for {name}; release builds replace this file via scripts/tauri-before-build.mjs\n"
    )
}
