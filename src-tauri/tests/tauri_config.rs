use std::fs;
use std::path::PathBuf;

use serde_json::Value;

const DAEMON_EXTERNAL_BINS: &[&str] = &[
    "target/sidecars/codex_monitor_daemon",
    "target/sidecars/codex_monitor_daemonctl",
];

#[test]
fn macos_private_api_feature_matches_config() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("tauri.conf.json");
    let config_contents = fs::read_to_string(&config_path)
        .unwrap_or_else(|error| panic!("Failed to read {config_path:?}: {error}"));
    let config: Value = serde_json::from_str(&config_contents)
        .unwrap_or_else(|error| panic!("Failed to parse tauri.conf.json: {error}"));
    let macos_private_api = config
        .get("app")
        .and_then(|app| app.get("macOSPrivateApi"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if macos_private_api {
        let cargo_path = manifest_dir.join("Cargo.toml");
        let cargo_contents = fs::read_to_string(&cargo_path)
            .unwrap_or_else(|error| panic!("Failed to read {cargo_path:?}: {error}"));
        let mut in_dependencies = false;
        let mut has_feature = false;

        for line in cargo_contents.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                in_dependencies = trimmed == "[dependencies]";
                continue;
            }
            if !in_dependencies {
                continue;
            }
            if trimmed.starts_with("tauri") && trimmed.contains("macos-private-api") {
                has_feature = true;
                break;
            }
        }

        assert!(
            has_feature,
            "Cargo.toml [dependencies] must enable macos-private-api when app.macOSPrivateApi is true"
        );
    }
}

#[test]
fn desktop_configs_bundle_daemon_sidecars() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for file_name in [
        "tauri.linux.conf.json",
        "tauri.macos.conf.json",
        "tauri.windows.conf.json",
    ] {
        let config_path = manifest_dir.join(file_name);
        let config_contents = fs::read_to_string(&config_path)
            .unwrap_or_else(|error| panic!("Failed to read {config_path:?}: {error}"));
        let config: Value = serde_json::from_str(&config_contents)
            .unwrap_or_else(|error| panic!("Failed to parse {file_name}: {error}"));
        let external_bins = config
            .get("bundle")
            .and_then(|bundle| bundle.get("externalBin"))
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("{file_name} must define bundle.externalBin"));

        for expected in DAEMON_EXTERNAL_BINS {
            assert!(
                external_bins
                    .iter()
                    .any(|value| value.as_str() == Some(expected)),
                "{file_name} must bundle {expected}"
            );
        }
    }
}

#[test]
fn linux_window_uses_app_chrome() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("tauri.linux.conf.json");
    let config_contents = fs::read_to_string(&config_path)
        .unwrap_or_else(|error| panic!("Failed to read {config_path:?}: {error}"));
    let config: Value = serde_json::from_str(&config_contents)
        .unwrap_or_else(|error| panic!("Failed to parse tauri.linux.conf.json: {error}"));
    let window = config
        .get("app")
        .and_then(|app| app.get("windows"))
        .and_then(Value::as_array)
        .and_then(|windows| windows.first())
        .unwrap_or_else(|| panic!("tauri.linux.conf.json must define app.windows[0]"));

    assert_eq!(
        window.get("decorations").and_then(Value::as_bool),
        Some(false)
    );
    assert_eq!(
        window.get("titleBarStyle").and_then(Value::as_str),
        Some("Overlay")
    );
    assert_eq!(
        window.get("hiddenTitle").and_then(Value::as_bool),
        Some(true)
    );
}
