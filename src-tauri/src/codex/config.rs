use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::shared::config_toml_core;
use crate::shared::local_memory_core::{
    AddMemoryInput, ImportMemoriesInput, ImportMemoriesResult, ListMemoryEventsInput,
    ListMemoryInput, LocalMemoryAccessLogEntry, LocalMemoryDebugStatus, LocalMemoryEmbeddingModel,
    LocalMemoryStore, MemoryEntity, MemoryRecord, MemorySearchResult, SearchMemoryInput,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use toml_edit::{value, Array, Item, Table};

const LOCAL_MEMORY_SERVER_NAME: &str = "local_memory";
const LOCAL_MEMORY_FEATURE_FLAG: &str = "memories";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryConfigStatus {
    pub(crate) enabled: bool,
    #[serde(default = "default_local_memory_server_name", alias = "server_name")]
    pub(crate) server_name: String,
    #[serde(default, alias = "config_path")]
    pub(crate) config_path: Option<String>,
    #[serde(default, alias = "command_path")]
    pub(crate) command_path: String,
    #[serde(default, alias = "db_path")]
    pub(crate) db_path: String,
    #[serde(default = "default_vector_backend", alias = "vector_backend")]
    pub(crate) vector_backend: String,
    #[serde(default = "default_embedding_model_id", alias = "embedding_model")]
    pub(crate) embedding_model: String,
    #[serde(default = "default_embedding_dim", alias = "embedding_dim")]
    pub(crate) embedding_dim: usize,
    #[serde(default = "default_embedding_models", alias = "embedding_models")]
    pub(crate) embedding_models: Vec<LocalMemoryEmbeddingModel>,
    #[serde(default, alias = "index_rebuild_recommended")]
    pub(crate) index_rebuild_recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryDebugSnapshot {
    pub(crate) config: LocalMemoryConfigStatus,
    #[serde(default)]
    pub(crate) database: Option<LocalMemoryDebugStatus>,
    #[serde(default)]
    pub(crate) error: Option<String>,
}

fn default_local_memory_server_name() -> String {
    LOCAL_MEMORY_SERVER_NAME.to_string()
}

fn default_vector_backend() -> String {
    "sqlite-vec".to_string()
}

fn default_embedding_model_id() -> String {
    LocalMemoryStore::embedding_model_id().to_string()
}

fn default_embedding_dim() -> usize {
    LocalMemoryStore::embedding_dim()
}

fn default_embedding_models() -> Vec<LocalMemoryEmbeddingModel> {
    LocalMemoryStore::embedding_models()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetLocalMemoryDbPathInput {
    pub(crate) db_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetLocalMemoryEmbeddingModelInput {
    pub(crate) embedding_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryConnectionCheck {
    pub(crate) ok: bool,
    pub(crate) protocol_version: Option<String>,
    pub(crate) tool_count: Option<usize>,
    pub(crate) error: Option<String>,
    pub(crate) checked_at: i64,
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
    let default_db_path = resolve_default_local_memory_db_path()?;
    let config_path = config_toml_path().map(|path| path.to_string_lossy().to_string());
    let Some(root) = resolve_default_codex_home() else {
        return Ok(LocalMemoryConfigStatus {
            enabled: false,
            server_name: LOCAL_MEMORY_SERVER_NAME.to_string(),
            config_path,
            command_path: command_path.to_string_lossy().to_string(),
            db_path: default_db_path.to_string_lossy().to_string(),
            vector_backend: "sqlite-vec".to_string(),
            embedding_model: LocalMemoryStore::embedding_model_id().to_string(),
            embedding_dim: LocalMemoryStore::embedding_dim(),
            embedding_models: LocalMemoryStore::embedding_models(),
            index_rebuild_recommended: false,
        });
    };
    let (_, document) = config_toml_core::load_global_config_document(&root)?;
    let db_path = read_local_memory_db_path_from_document(&document).unwrap_or(default_db_path);
    let embedding_model = read_local_memory_embedding_model_from_document(&document);
    let mcp_configured = document
        .get("mcp_servers")
        .and_then(Item::as_table_like)
        .and_then(|table| table.get(LOCAL_MEMORY_SERVER_NAME))
        .and_then(Item::as_table_like)
        .and_then(|table| table.get("command"))
        .and_then(Item::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let feature_enabled =
        config_toml_core::read_feature_flag(&document, LOCAL_MEMORY_FEATURE_FLAG).unwrap_or(false);
    Ok(LocalMemoryConfigStatus {
        enabled: feature_enabled && mcp_configured,
        server_name: LOCAL_MEMORY_SERVER_NAME.to_string(),
        config_path,
        command_path: command_path.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        vector_backend: "sqlite-vec".to_string(),
        embedding_model: embedding_model.clone(),
        embedding_dim: LocalMemoryStore::embedding_dim(),
        embedding_models: LocalMemoryStore::embedding_models(),
        index_rebuild_recommended: is_local_memory_index_rebuild_recommended(
            &db_path,
            &embedding_model,
        ),
    })
}

pub(crate) fn write_local_memory_enabled(enabled: bool) -> Result<LocalMemoryConfigStatus, String> {
    let Some(root) = resolve_default_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let command_path = resolve_local_memory_command_path()?;
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let db_path = read_local_memory_db_path_from_document(&document)
        .unwrap_or(resolve_default_local_memory_db_path()?);
    let embedding_model = read_local_memory_embedding_model_from_document(&document);
    config_toml_core::set_feature_flag(&mut document, LOCAL_MEMORY_FEATURE_FLAG, enabled)?;
    if enabled {
        set_local_memory_server_table(&mut document, &command_path, &db_path, &embedding_model)?;
    } else if let Some(mcp_servers) = document.get_mut("mcp_servers").and_then(Item::as_table_mut) {
        let _ = mcp_servers.remove(LOCAL_MEMORY_SERVER_NAME);
    }
    config_toml_core::persist_global_config_document(&root, &document)?;
    read_local_memory_status()
}

pub(crate) fn write_local_memory_db_path(
    input: SetLocalMemoryDbPathInput,
) -> Result<LocalMemoryConfigStatus, String> {
    let db_path_raw = input.db_path.trim();
    if db_path_raw.is_empty() {
        return Err("Local memory database path is empty.".to_string());
    }
    let db_path = PathBuf::from(db_path_raw);
    let Some(root) = resolve_default_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let command_path = resolve_local_memory_command_path()?;
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let embedding_model = read_local_memory_embedding_model_from_document(&document);
    set_local_memory_server_table(&mut document, &command_path, &db_path, &embedding_model)?;
    config_toml_core::persist_global_config_document(&root, &document)?;
    read_local_memory_status()
}

pub(crate) fn write_local_memory_embedding_model(
    input: SetLocalMemoryEmbeddingModelInput,
) -> Result<LocalMemoryConfigStatus, String> {
    let embedding_model = normalize_local_memory_embedding_model(&input.embedding_model)?;
    let Some(root) = resolve_default_codex_home() else {
        return Err("Unable to resolve CODEX_HOME".to_string());
    };
    let command_path = resolve_local_memory_command_path()?;
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    let db_path = read_local_memory_db_path_from_document(&document)
        .unwrap_or(resolve_default_local_memory_db_path()?);
    set_local_memory_config_table(&mut document, &embedding_model);
    set_local_memory_server_table(&mut document, &command_path, &db_path, &embedding_model)?;
    config_toml_core::persist_global_config_document(&root, &document)?;
    read_local_memory_status()
}

pub(crate) fn check_local_memory_connection() -> Result<LocalMemoryConnectionCheck, String> {
    let status = read_local_memory_status()?;
    let checked_at = Utc::now().timestamp();
    if !status.enabled {
        return Ok(LocalMemoryConnectionCheck {
            ok: false,
            protocol_version: None,
            tool_count: None,
            error: Some("Local memory MCP is disabled.".to_string()),
            checked_at,
        });
    }

    let mut child = Command::new(&status.command_path)
        .arg("--db")
        .arg(&status.db_path)
        .arg("--embedding-model")
        .arg(&status.embedding_model)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start local memory MCP: {err}"))?;

    {
        let Some(stdin) = child.stdin.as_mut() else {
            return Err("Failed to open local memory MCP stdin.".to_string());
        };
        stdin
            .write_all(
                br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
"#,
            )
            .map_err(|err| err.to_string())?;
    }
    drop(child.stdin.take());

    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Ok(LocalMemoryConnectionCheck {
            ok: false,
            protocol_version: None,
            tool_count: None,
            error: Some(if stderr.is_empty() {
                format!("Local memory MCP exited with status {}", output.status)
            } else {
                stderr
            }),
            checked_at,
        });
    }

    let mut protocol_version = None;
    let mut tool_count = None;
    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(err) => {
                return Ok(LocalMemoryConnectionCheck {
                    ok: false,
                    protocol_version: None,
                    tool_count: None,
                    error: Some(format!("Invalid MCP response: {err}")),
                    checked_at,
                });
            }
        };
        if value.get("id").and_then(serde_json::Value::as_i64) == Some(1) {
            protocol_version = value
                .get("result")
                .and_then(|result| result.get("protocolVersion"))
                .and_then(serde_json::Value::as_str)
                .map(ToString::to_string);
        }
        if value.get("id").and_then(serde_json::Value::as_i64) == Some(2) {
            tool_count = value
                .get("result")
                .and_then(|result| result.get("tools"))
                .and_then(serde_json::Value::as_array)
                .map(Vec::len);
        }
    }

    Ok(LocalMemoryConnectionCheck {
        ok: protocol_version.is_some() && tool_count.unwrap_or_default() > 0,
        protocol_version,
        tool_count,
        error: None,
        checked_at,
    })
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

    match LocalMemoryStore::open_with_embedding_model(
        Path::new(&config.db_path),
        &config.embedding_model,
    ) {
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

pub(crate) fn add_local_memory(input: AddMemoryInput) -> Result<MemoryRecord, String> {
    open_enabled_local_memory_store()?.add_memory(input)
}

pub(crate) fn search_local_memories(
    input: SearchMemoryInput,
) -> Result<Vec<MemorySearchResult>, String> {
    open_enabled_local_memory_store()?.search_memories(input)
}

pub(crate) fn list_local_memories(input: ListMemoryInput) -> Result<Vec<MemoryRecord>, String> {
    open_enabled_local_memory_store()?.list_memories(input)
}

pub(crate) fn get_local_memory(id: &str) -> Result<Option<MemoryRecord>, String> {
    open_enabled_local_memory_store()?.get_memory(id)
}

pub(crate) fn update_local_memory(id: &str, content: &str) -> Result<Option<MemoryRecord>, String> {
    open_enabled_local_memory_store()?.update_memory(id, content)
}

pub(crate) fn delete_local_memory(id: &str) -> Result<bool, String> {
    open_enabled_local_memory_store()?.delete_memory(id)
}

pub(crate) fn delete_all_local_memories() -> Result<u64, String> {
    open_enabled_local_memory_store()?.delete_all_memories()
}

pub(crate) fn import_local_memories(
    input: ImportMemoriesInput,
) -> Result<ImportMemoriesResult, String> {
    open_enabled_local_memory_store()?.import_memories(input)
}

pub(crate) fn list_local_memory_review_queue(
    limit: Option<u32>,
) -> Result<Vec<MemoryRecord>, String> {
    open_enabled_local_memory_store()?.list_review_queue(limit)
}

pub(crate) fn approve_local_memory(id: &str) -> Result<Option<MemoryRecord>, String> {
    open_enabled_local_memory_store()?.approve_memory(id)
}

pub(crate) fn reject_local_memory(id: &str) -> Result<bool, String> {
    open_enabled_local_memory_store()?.reject_memory(id)
}

pub(crate) fn list_local_memory_entities() -> Result<Vec<MemoryEntity>, String> {
    open_enabled_local_memory_store()?.list_entities()
}

pub(crate) fn delete_local_memory_entities() -> Result<u64, String> {
    open_enabled_local_memory_store()?.delete_entities()
}

pub(crate) fn rebuild_local_memory_indexes() -> Result<LocalMemoryDebugStatus, String> {
    open_enabled_local_memory_store()?.rebuild_indexes()
}

pub(crate) fn list_local_memory_events(
    input: ListMemoryEventsInput,
) -> Result<Vec<LocalMemoryAccessLogEntry>, String> {
    open_enabled_local_memory_store()?.list_events(input)
}

pub(crate) fn get_local_memory_event_status(
    id: &str,
) -> Result<Option<LocalMemoryAccessLogEntry>, String> {
    open_enabled_local_memory_store()?.get_event_status(id)
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

fn resolve_default_local_memory_db_path() -> Result<PathBuf, String> {
    resolve_default_codex_home()
        .map(|home| home.join("local-memory").join("memory.sqlite"))
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

fn read_local_memory_db_path_from_document(document: &toml_edit::Document) -> Option<PathBuf> {
    let server = document
        .get("mcp_servers")
        .and_then(Item::as_table_like)?
        .get(LOCAL_MEMORY_SERVER_NAME)?
        .as_table_like()?;
    let args = server.get("args")?.as_array()?;
    let mut previous_was_db = false;
    for item in args.iter() {
        if previous_was_db {
            return item.as_str().map(PathBuf::from);
        }
        previous_was_db = item.as_str().is_some_and(|value| value == "--db");
    }
    None
}

fn read_local_memory_embedding_model_from_document(document: &toml_edit::Document) -> String {
    document
        .get("local_memory")
        .and_then(Item::as_table_like)
        .and_then(|table| table.get("embedding_model"))
        .and_then(Item::as_str)
        .and_then(|value| normalize_local_memory_embedding_model(value).ok())
        .unwrap_or_else(|| LocalMemoryStore::embedding_model_id().to_string())
}

fn normalize_local_memory_embedding_model(value: &str) -> Result<String, String> {
    let value = value.trim();
    let models = LocalMemoryStore::embedding_models();
    if let Some(model) = models
        .iter()
        .find(|model| model.id.eq_ignore_ascii_case(value))
    {
        return Ok(model.id.clone());
    }
    if value.eq_ignore_ascii_case("hash") || value.eq_ignore_ascii_case("hash-v2") {
        return Ok(LocalMemoryStore::embedding_model_id().to_string());
    }
    if value.eq_ignore_ascii_case("ngram") || value.eq_ignore_ascii_case("local-ngram") {
        if let Some(model) = models.iter().find(|model| model.id.contains("ngram")) {
            return Ok(model.id.clone());
        }
    }
    Err(format!("Unsupported local memory embedding model: {value}"))
}

fn set_local_memory_config_table(document: &mut toml_edit::Document, embedding_model: &str) {
    if !document["local_memory"].is_table() {
        document["local_memory"] = Item::Table(Table::new());
    }
    document["local_memory"]["embedding_model"] = value(embedding_model);
}

fn set_local_memory_server_table(
    document: &mut toml_edit::Document,
    command_path: &Path,
    db_path: &Path,
    embedding_model: &str,
) -> Result<(), String> {
    set_local_memory_config_table(document, embedding_model);
    let mut server = Table::new();
    server["command"] = value(path_string(command_path));
    let mut args = Array::default();
    args.push("--db");
    args.push(path_string(db_path));
    args.push("--embedding-model");
    args.push(embedding_model);
    server["args"] = value(args);
    let mcp_servers = config_toml_core::ensure_table(document, "mcp_servers")?;
    mcp_servers[LOCAL_MEMORY_SERVER_NAME] = Item::Table(server);
    Ok(())
}

fn is_local_memory_index_rebuild_recommended(db_path: &Path, embedding_model: &str) -> bool {
    if !db_path.exists() {
        return false;
    }
    match LocalMemoryStore::open_with_embedding_model(db_path, embedding_model)
        .and_then(|store| store.index_rebuild_recommended())
    {
        Ok(value) => value,
        Err(_) => false,
    }
}

fn open_enabled_local_memory_store() -> Result<LocalMemoryStore, String> {
    let status = read_local_memory_status()?;
    if !status.enabled {
        return Err("Local memory is disabled.".to_string());
    }
    LocalMemoryStore::open_with_embedding_model(Path::new(&status.db_path), &status.embedding_model)
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
    use super::{
        normalize_personality_value, read_personality_from_document, LocalMemoryDebugSnapshot,
    };
    use crate::shared::config_toml_core;
    use crate::shared::local_memory_core::LocalMemoryStore;
    use serde_json::json;

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

    #[test]
    fn local_memory_debug_snapshot_accepts_older_payload_without_embedding_metadata() {
        let snapshot: LocalMemoryDebugSnapshot = serde_json::from_value(json!({
            "config": {
                "enabled": true,
                "serverName": "local_memory",
                "configPath": null,
                "commandPath": "codex-monitor-memory-mcp",
                "dbPath": "memory.sqlite",
                "vectorBackend": "sqlite-vec"
            },
            "database": {
                "dbPath": "memory.sqlite",
                "vectorBackend": "sqlite-vec",
                "vectorAvailable": true,
                "memoryCount": 1,
                "vectorCount": 1,
                "ftsCount": 1
            },
            "error": null
        }))
        .expect("deserialize older local memory debug snapshot");

        assert_eq!(
            snapshot.config.embedding_model,
            LocalMemoryStore::embedding_model_id()
        );
        assert_eq!(
            snapshot.config.embedding_dim,
            LocalMemoryStore::embedding_dim()
        );
        assert_eq!(
            snapshot.config.embedding_models.len(),
            LocalMemoryStore::embedding_models().len()
        );
        let database = snapshot.database.expect("database status");
        assert_eq!(
            database.embedding_model,
            LocalMemoryStore::embedding_model_id()
        );
        assert_eq!(database.embedding_dim, LocalMemoryStore::embedding_dim());
        assert!(database.recent_accesses.is_empty());
    }
}
