#[path = "../shared/local_memory_core.rs"]
mod local_memory_core;

use local_memory_core::{
    AddMemoryInput, ImportMemoriesInput, ListMemoryEventsInput, ListMemoryInput, LocalMemoryStore,
    SearchMemoryInput,
};
use serde_json::{json, Value};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

fn main() {
    if let Err(err) = run() {
        let _ = writeln!(io::stderr(), "{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let options = parse_options()?;
    let store =
        LocalMemoryStore::open_with_embedding_model(options.db_path, &options.embedding_model)?;
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(err) => {
                write_response(
                    &mut stdout,
                    json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": { "code": -32700, "message": err.to_string() }
                    }),
                )?;
                continue;
            }
        };
        if request.get("id").is_none() {
            continue;
        }
        let response = handle_request(&store, request);
        write_response(&mut stdout, response)?;
    }

    Ok(())
}

struct McpOptions {
    db_path: PathBuf,
    embedding_model: String,
}

fn parse_options() -> Result<McpOptions, String> {
    let mut db_path = None;
    let mut embedding_model = LocalMemoryStore::embedding_model_id().to_string();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--db" {
            let value = args.next().ok_or("--db requires a path")?;
            db_path = Some(PathBuf::from(value));
        } else if arg == "--embedding-model" {
            embedding_model = args.next().ok_or("--embedding-model requires a value")?;
        }
    }
    if let Some(db_path) = db_path {
        return Ok(McpOptions {
            db_path,
            embedding_model,
        });
    }
    let home = env::var("CODEX_HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            env::var("USERPROFILE")
                .ok()
                .map(|home| PathBuf::from(home).join(".codex"))
        })
        .or_else(|| {
            env::var("HOME")
                .ok()
                .map(|home| PathBuf::from(home).join(".codex"))
        })
        .ok_or_else(|| "Unable to resolve CODEX_HOME for local memory database".to_string())?;
    Ok(McpOptions {
        db_path: home.join("local-memory").join("memory.sqlite"),
        embedding_model,
    })
}

fn write_response(stdout: &mut io::Stdout, value: Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdout, &value).map_err(|err| err.to_string())?;
    stdout.write_all(b"\n").map_err(|err| err.to_string())?;
    stdout.flush().map_err(|err| err.to_string())
}

fn handle_request(store: &LocalMemoryStore, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "codex-monitor-local-memory",
                "version": env!("CARGO_PKG_VERSION")
            }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_descriptors() })),
        "tools/call" => {
            handle_tool_call(store, request.get("params").cloned().unwrap_or(Value::Null))
        }
        _ => Err(format!("unsupported method `{method}`")),
    };
    match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(message) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32603, "message": message }
        }),
    }
}

fn handle_tool_call(store: &LocalMemoryStore, params: Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "tools/call missing name".to_string())?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let output = match name {
        "add_memory" => {
            let input = normalize_add_memory(arguments)?;
            serde_json::to_value(store.add_memory(input)?).map_err(|err| err.to_string())?
        }
        "search_memories" => {
            let input = normalize_search_memory(arguments)?;
            serde_json::to_value(store.search_memories(input)?).map_err(|err| err.to_string())?
        }
        "get_memories" => {
            let input: ListMemoryInput =
                serde_json::from_value(arguments).map_err(|err| err.to_string())?;
            serde_json::to_value(store.list_memories(input)?).map_err(|err| err.to_string())?
        }
        "get_memory" => {
            let id = required_string(&arguments, "id")?;
            serde_json::to_value(store.get_memory(&id)?).map_err(|err| err.to_string())?
        }
        "update_memory" => {
            let id = required_string(&arguments, "id")?;
            let content = required_string(&arguments, "content")?;
            serde_json::to_value(store.update_memory(&id, &content)?)
                .map_err(|err| err.to_string())?
        }
        "delete_memory" => {
            let id = required_string(&arguments, "id")?;
            json!({ "deleted": store.delete_memory(&id)? })
        }
        "delete_all_memories" => json!({ "deleted": store.delete_all_memories()? }),
        "import_memories" => {
            let input: ImportMemoriesInput =
                serde_json::from_value(arguments).map_err(|err| err.to_string())?;
            serde_json::to_value(store.import_memories(input)?).map_err(|err| err.to_string())?
        }
        "list_review_queue" => {
            let limit = arguments
                .get("limit")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            serde_json::to_value(store.list_review_queue(limit)?).map_err(|err| err.to_string())?
        }
        "approve_memory" => {
            let id = required_string(&arguments, "id")?;
            serde_json::to_value(store.approve_memory(&id)?).map_err(|err| err.to_string())?
        }
        "reject_memory" => {
            let id = required_string(&arguments, "id")?;
            json!({ "rejected": store.reject_memory(&id)? })
        }
        "list_entities" => json!({ "entities": store.list_entities()? }),
        "delete_entities" => json!({ "deleted": store.delete_entities()? }),
        "rebuild_indexes" => {
            serde_json::to_value(store.rebuild_indexes()?).map_err(|err| err.to_string())?
        }
        "list_events" => {
            let input: ListMemoryEventsInput =
                serde_json::from_value(arguments).map_err(|err| err.to_string())?;
            serde_json::to_value(store.list_events(input)?).map_err(|err| err.to_string())?
        }
        "get_event_status" => {
            let id = required_string(&arguments, "id")
                .or_else(|_| required_string(&arguments, "event_id"))
                .or_else(|_| required_string(&arguments, "eventId"))?;
            serde_json::to_value(store.get_event_status(&id)?).map_err(|err| err.to_string())?
        }
        "debug_status" => {
            serde_json::to_value(store.debug_status()?).map_err(|err| err.to_string())?
        }
        _ => return Err(format!("unknown tool `{name}`")),
    };
    Ok(json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&output).map_err(|err| err.to_string())?
            }
        ],
        "structuredContent": output
    }))
}

fn normalize_add_memory(value: Value) -> Result<AddMemoryInput, String> {
    let mut input: AddMemoryInput =
        serde_json::from_value(value.clone()).map_err(|err| err.to_string())?;
    if input.content.trim().is_empty() {
        input.content = optional_string(&value, "text")
            .or_else(|| optional_string(&value, "memory"))
            .unwrap_or_default();
    }
    Ok(input)
}

fn normalize_search_memory(value: Value) -> Result<SearchMemoryInput, String> {
    let mut input: SearchMemoryInput =
        serde_json::from_value(value.clone()).map_err(|err| err.to_string())?;
    if input.query.trim().is_empty() {
        input.query = optional_string(&value, "text").unwrap_or_default();
    }
    Ok(input)
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    optional_string(value, key).ok_or_else(|| format!("missing `{key}`"))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn tool_descriptors() -> Value {
    let filters = json!({
        "type": "object",
        "properties": {
            "userId": { "type": "string" },
            "agentId": { "type": "string" },
            "appId": { "type": "string" },
            "runId": { "type": "string" },
            "workspaceId": { "type": "string" },
            "workspacePath": { "type": "string" },
            "threadId": { "type": "string" },
            "scope": { "type": "string" },
            "kind": { "type": "string" },
            "categories": { "type": "array", "items": { "type": "string" } }
        }
    });
    json!([
        {
            "name": "add_memory",
            "description": "Persist a durable local memory.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "text": { "type": "string" },
                    "memory": { "type": "string" },
                    "scope": { "type": "string" },
                    "kind": { "type": "string" },
                    "metadata": { "type": "object" },
                    "categories": { "type": "array", "items": { "type": "string" } },
                    "filters": filters.clone()
                }
            }
        },
        {
            "name": "search_memories",
            "description": "Search local memories using hybrid vector and keyword retrieval.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "text": { "type": "string" },
                    "limit": { "type": "integer" },
                    "filters": filters.clone()
                }
            }
        },
        { "name": "get_memories", "description": "List local memories.", "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer" }, "filters": filters.clone() } } },
        { "name": "get_memory", "description": "Read one local memory by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } },
        { "name": "update_memory", "description": "Update memory content by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" }, "content": { "type": "string" } }, "required": ["id", "content"] } },
        { "name": "delete_memory", "description": "Tombstone one local memory by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } },
        { "name": "delete_all_memories", "description": "Tombstone all local memories.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "import_memories", "description": "Import memories from an export payload.", "inputSchema": { "type": "object", "properties": { "memories": { "type": "array", "items": { "type": "object" } } } } },
        { "name": "list_review_queue", "description": "List auto-captured memories waiting for local approval.", "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer" } } } },
        { "name": "approve_memory", "description": "Approve a pending local memory by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } },
        { "name": "reject_memory", "description": "Reject a pending local memory by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } },
        { "name": "list_entities", "description": "List known entities.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "delete_entities", "description": "Delete all indexed entities and links without deleting memories.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "rebuild_indexes", "description": "Rebuild FTS, vector, and entity indexes from active memories.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "list_events", "description": "List local memory events and access-log entries.", "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer" }, "memoryId": { "type": "string" }, "runId": { "type": "string" }, "event": { "type": "string" } } } },
        { "name": "get_event_status", "description": "Read one local memory event by id.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" }, "event_id": { "type": "string" }, "eventId": { "type": "string" } } } },
        { "name": "debug_status", "description": "Inspect local memory database and index status.", "inputSchema": { "type": "object", "properties": {} } }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_store() -> (LocalMemoryStore, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-mcp-protocol-test-{}.sqlite",
            Uuid::new_v4()
        ));
        (LocalMemoryStore::open(&path).expect("open store"), path)
    }

    #[test]
    fn initialize_and_tools_list_return_mcp_shapes() {
        let (store, path) = test_store();
        let initialized = handle_request(
            &store,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
        );
        assert_eq!(initialized["jsonrpc"], "2.0");
        assert_eq!(
            initialized["result"]["serverInfo"]["name"],
            "codex-monitor-local-memory"
        );

        let tools = handle_request(
            &store,
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
        );
        let names = tools["result"]["tools"]
            .as_array()
            .expect("tools")
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(names.contains(&"add_memory"));
        assert!(names.contains(&"search_memories"));
        assert!(names.contains(&"get_event_status"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn tools_call_add_search_and_error_shapes() {
        let (store, path) = test_store();
        let added = handle_request(
            &store,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "add_memory",
                    "arguments": {
                        "content": "Use local MCP protocol tests for local memory.",
                        "scope": "workspace",
                        "kind": "tooling_setup"
                    }
                }
            }),
        );
        assert!(added.get("error").is_none());
        assert_eq!(
            added["result"]["structuredContent"]["content"],
            "Use local MCP protocol tests for local memory."
        );

        let search = handle_request(
            &store,
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "search_memories",
                    "arguments": { "query": "MCP protocol", "limit": 5 }
                }
            }),
        );
        assert!(search["result"]["structuredContent"]
            .as_array()
            .expect("results")
            .iter()
            .any(|item| item["content"]
                .as_str()
                .is_some_and(|content| content.contains("MCP protocol"))));

        let error = handle_request(
            &store,
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": { "name": "missing_tool", "arguments": {} }
            }),
        );
        assert_eq!(error["error"]["code"], -32603);
        assert!(error["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("unknown tool")));

        let _ = std::fs::remove_file(path);
    }
}
