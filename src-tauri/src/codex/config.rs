use std::path::{Path, PathBuf};

use crate::shared::config_toml_core;
use crate::shared::local_memory_core::{LocalMemoryDebugStatus, LocalMemoryStore};
use serde::{Deserialize, Serialize};
use toml_edit::{value, Array, Item, Table};

const LOCAL_MEMORY_SERVER_NAME: &str = "local_memory";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryConfigStatus {
    pub(crate) enabled: bool,
    pub(crate) server_name: String,
    pub(crate) config_path: Option<String>,
    pub(crate) command_path: String,
    pub(crate) db_path: String,
    pub(crate) vector_backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryDebugSnapshot {
    pub(crate) config: LocalMemoryConfigStatus,
    pub(crate) database: Option<LocalMemoryDebugStatus>,
    pub(crate) error: Option<String>,
}

pub(crate) fn read_steer_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("steer")
}

pub(crate) fn read_collaboration_modes_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("collaboration_modes")
}

pub(crate) fn read_unified_exec_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("unified_exec")
}

pub(crate) fn read_apps_enabled() -> Result<Option<bool>, String> {
    read_feature_flag("apps")
}

pub(crate) fn read_personality() -> Result<Option<String>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(read_personality_from_document(&document))
}

pub(crate) fn write_steer_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("steer", enabled)
}

pub(crate) fn write_collaboration_modes_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("collaboration_modes", enabled)
}

pub(crate) fn write_unified_exec_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("unified_exec", enabled)
}

pub(crate) fn write_apps_enabled(enabled: bool) -> Result<(), String> {
    write_feature_flag("apps", enabled)
}

pub(crate) fn write_feature_enabled(feature_key: &str, enabled: bool) -> Result<(), String> {
    let key = feature_key.trim();
    if key.is_empty() {
        return Err("feature key is empty".to_string());
    }
    if key.eq_ignore_ascii_case("collab") {
        return Err("feature key `collab` is no longer supported; use `multi_agent`".to_string());
    }
    write_feature_flag(key, enabled)
}

pub(crate) fn read_feature_enabled(feature_key: &str) -> Result<bool, String> {
    let key = feature_key.trim();
    if key.is_empty() {
        return Err("feature key is empty".to_string());
    }
    if key.eq_ignore_ascii_case("collab") {
        return Err("feature key `collab` is no longer supported; use `multi_agent`".to_string());
    }
    Ok(read_feature_flag(key)?.unwrap_or(false))
}

pub(crate) fn read_local_memory_status() -> Result<LocalMemoryConfigStatus, String> {
    let command_path = resolve_local_memory_command_path()?;
    let db_path = resolve_local_memory_db_path()?;
    let config_path = config_toml_path().map(|path| path.to_string_lossy().to_string());
    let Some(root) = resolve_default_codex_home() else {
        return Ok(LocalMemoryConfigStatus {
            enabled: false,
            server_name: LOCAL_MEMORY_SERVER_NAME.to_string(),
            config_path,
            command_path: command_path.to_string_lossy().to_string(),
            db_path: db_path.to_string_lossy().to_string(),
            vector_backend: "sqlite-vec".to_string(),
        });
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    let enabled = document
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|table| table.get(LOCAL_MEMORY_SERVER_NAME))
        .and_then(Item::as_table_like)
        .and_then(|table| table.get("command"))
        .and_then(Item::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    Ok(LocalMemoryConfigStatus {
        enabled,
        server_name: LOCAL_MEMORY_SERVER_NAME.to_string(),
        config_path,
        command_path: command_path.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        vector_backend: "sqlite-vec".to_string(),
    })
}

pub(crate) fn write_local_memory_enabled(enabled: bool) -> Result<LocalMemoryConfigStatus, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let command_path = resolve_local_memory_command_path()?;
    let db_path = resolve_local_memory_db_path()?;
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    if enabled {
        let mut server = Table::new();
        server["command"] = value(path_string(&command_path));
        let mut args = Array::default();
        args.push("--db");
        args.push(path_string(&db_path));
        server["args"] = value(args);
        let mcp_servers = config_toml_core::ensure_table(&mut document, "mcp_servers")?;
        mcp_servers[LOCAL_MEMORY_SERVER_NAME] = Item::Table(server);
    } else if let Some(mcp_servers) = document.get_mut("mcp_servers").and_then(Item::as_table_mut) {
        let _ = mcp_servers.remove(LOCAL_MEMORY_SERVER_NAME);
    }
    config_toml_core::persist_global_config_document(&root, &document)?;
    read_local_memory_status()
}

pub(crate) fn read_local_memory_debug_status() -> Result<LocalMemoryDebugSnapshot, String> {
    let config = read_local_memory_status()?;
    if !config.enabled {
        return Ok(LocalMemoryDebugSnapshot {
            config,
            database: None,
            error: Some("Local memory MCP is disabled.".to_string()),
        });
    }

    match LocalMemoryStore::open(Path::new(&config.db_path)) {
        Ok(store) => match store.debug_status() {
            Ok(database) => Ok(LocalMemoryDebugSnapshot {
                config,
                database: Some(database),
                error: None,
            }),
            Err(error) => Ok(LocalMemoryDebugSnapshot {
                config,
                database: None,
                error: Some(error),
            }),
        },
        Err(error) => Ok(LocalMemoryDebugSnapshot {
            config,
            database: None,
            error: Some(error),
        }),
    }
}

pub(crate) fn write_personality(personality: &str) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let normalized = normalize_personality_value(personality);
    config_toml_core::set_top_level_string(&mut document, "personality", normalized);
    config_toml_core::persist_global_config_document(&root, &document)
}

fn read_feature_flag(key: &str) -> Result<Option<bool>, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(None);
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_feature_flag(&document, key))
}

fn write_feature_flag(key: &str, enabled: bool) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    config_toml_core::set_feature_flag(&mut document, key, enabled)?;
    config_toml_core::persist_global_config_document(&root, &document)
}

pub(crate) fn config_toml_path() -> Option<PathBuf> {
    resolve_default_codex_home().map(|home| home.join("config.toml"))
}

pub(crate) fn read_config_model(codex_home: Option<PathBuf>) -> Result<Option<String>, String> {
    let root = codex_home.or_else(resolve_default_codex_home);
    let Some(root) = root else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    Ok(config_toml_core::read_top_level_string(&document, "model"))
}

fn resolve_default_codex_home() -> Option<PathBuf> {
    crate::codex::home::resolve_default_codex_home()
}

fn resolve_local_memory_db_path() -> Result<PathBuf, String> {
    resolve_default_codex_home()
        .map(|home| home.join("local-memory").join("memory.sqlite"))
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

fn resolve_local_memory_command_path() -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let dir = current
        .parent()
        .ok_or_else(|| "Unable to resolve current executable directory".to_string())?;
    let file_name = if cfg!(windows) {
        "codex-monitor-memory-mcp.exe"
    } else {
        "codex-monitor-memory-mcp"
    };
    Ok(dir.join(file_name))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn read_personality_from_document(document: &toml_edit::Document) -> Option<String> {
    config_toml_core::read_top_level_string(document, "personality")
        .as_deref()
        .and_then(normalize_personality_value)
        .map(|value| value.to_string())
}

fn normalize_personality_value(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "friendly" => Some("friendly"),
        "pragmatic" => Some("pragmatic"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_personality_value, read_personality_from_document};
    use crate::shared::config_toml_core;

    #[test]
    fn parse_personality_reads_supported_values() {
        let friendly =
            config_toml_core::parse_document("personality = \"friendly\"\n").expect("parse");
        let pragmatic =
            config_toml_core::parse_document("personality = \"pragmatic\"\n").expect("parse");
        let unknown =
            config_toml_core::parse_document("personality = \"unknown\"\n").expect("parse");

        assert_eq!(
            read_personality_from_document(&friendly),
            Some("friendly".to_string())
        );
        assert_eq!(
            read_personality_from_document(&pragmatic),
            Some("pragmatic".to_string())
        );
        assert_eq!(read_personality_from_document(&unknown), None);
    }

    #[test]
    fn normalize_personality_is_case_insensitive() {
        assert_eq!(normalize_personality_value("Friendly"), Some("friendly"));
        assert_eq!(normalize_personality_value("PRAGMATIC"), Some("pragmatic"));
        assert_eq!(normalize_personality_value("unknown"), None);
    }
}
