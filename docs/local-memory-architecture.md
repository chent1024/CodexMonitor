# Local Memory Architecture

Canonical implementation plan for a local, Mem0-compatible memory system in CodexMonitor.

## Goal

CodexMonitor provides a local long-term memory layer for Codex agents without using the Mem0 cloud service.

The implementation exposes a local MCP server with Mem0-compatible tool names, stores all data in a local SQLite database, and uses local embeddings plus hybrid retrieval for search quality.

## Non-Goals

- Do not call `https://mcp.mem0.ai/mcp`.
- Do not require `MEM0_API_KEY`.
- Do not run the full Mem0 self-hosted web stack inside CodexMonitor.
- Do not store memory state in React thread state.
- Do not duplicate backend behavior between the app and daemon.
- Do not physically delete long-lived memories only because they are old.

## Integration Shape

```text
Codex app-server
  -> local_memory MCP server over stdio
  -> SQLite database
     - structured memory rows
     - FTS5 keyword index
     - sqlite-vec vector index
     - entity links
     - audit and access logs
  -> local embedding provider
     - Ollama, local GGUF, or another local embedding backend
```

The Codex MCP config should point to a local stdio server:

```toml
[mcp_servers.local_memory]
command = "G:\\code\\codex-app\\target\\debug\\codex-monitor-memory-mcp.exe"
args = ["--db", "C:\\Users\\ql\\.codex\\local-memory\\memory.sqlite"]
```

The server name should be `local_memory`. Do not also configure the remote `mem0` MCP server in the same Codex profile.

## Repository Placement

Add shared behavior first:

- Shared source of truth: `src-tauri/src/shared/local_memory_core.rs`
- Shared submodules: `src-tauri/src/shared/local_memory_core/*`
- Local MCP binary: `src-tauri/src/bin/codex_monitor_memory_mcp.rs`
- App adapter and commands: `src-tauri/src/codex/*` or a focused memory adapter module
- Frontend IPC wrapper: `src/services/tauri.ts`
- Frontend settings UI: `src/features/settings/*`
- Daemon RPC parity: `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` and `rpc/*`

If the memory feature can be used remotely through the daemon, keep all business logic in shared core and expose matching app and daemon surfaces.

## MCP Tool Contract

Expose Mem0-compatible tool names where practical:

- `add_memory`
- `search_memories`
- `get_memories`
- `get_memory`
- `update_memory`
- `delete_memory`
- `delete_all_memories`
- `list_entities`
- `delete_entities`

Tool payloads should support these common filters:

- `user_id`
- `agent_id`
- `app_id`
- `run_id`
- `workspace_id`
- `workspace_path`
- `thread_id`
- `scope`
- `kind`
- `categories`

Use filters for search and listing. Do not rely on top-level user or entity arguments for search APIs.

## Storage Model

Use one SQLite database under CODEX_HOME by default:

```text
CODEX_HOME/local-memory/memory.sqlite
```

Core tables:

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  workspace_id TEXT,
  workspace_path TEXT,
  thread_id TEXT,
  user_id TEXT,
  agent_id TEXT,
  app_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  categories TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.7,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  deleted_at INTEGER
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid'
);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  kind TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memory_entities (
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (memory_id, entity_id)
);

CREATE TABLE memory_access_log (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  query TEXT,
  event TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Vector storage should use `sqlite-vec` with a dimension fixed by the selected embedding model. Store the embedding model id and dimension in metadata or a settings table so index rebuilds are explicit when the model changes.

Prefer `sqlite-vec` over `sqlite-vss`. `sqlite-vec` is the actively developed successor, has no Faiss dependency, and is easier to package for Windows.

## Memory Kinds

Use stable memory kinds so retrieval, retention, and UI behavior are predictable:

- `user_preferences`
- `coding_conventions`
- `architecture_decisions`
- `tooling_setup`
- `bug_fixes`
- `task_learnings`
- `session_state`
- `environment_state`

Long-lived kinds should be superseded or tombstoned, not removed by age. Short-lived kinds can use `expires_at`.

## Write Pipeline

Use add-only extraction as the default.

```text
input conversation or fact
  -> normalize scope and metadata
  -> retrieve related memories for deduplication context
  -> extract distinct new facts
  -> hash exact content for duplicate prevention
  -> embed extracted memories
  -> extract and link entities
  -> insert memory rows and indexes
```

Do not default to UPDATE or DELETE decisions during extraction. If a new memory replaces old state, mark the old memory with `superseded_by_id` and keep an audit trail.

## Search Pipeline

Use hybrid retrieval:

```text
query
  -> normalize filters and scope
  -> embed query
  -> semantic candidates from sqlite-vec
  -> keyword scores from FTS5/BM25
  -> entity matches from entities and memory_entities
  -> score fusion
  -> temporal adjustment
  -> top-k output with reasons and scores
```

Use semantic search as the recall base. Keyword and entity signals can boost ranking and can also provide fallback candidates when the vector index is unavailable.

## Fusion And Decay

Implement score fusion. Implement decay only as a ranking feature, not as automatic deletion.

Recommended baseline:

```text
score =
  0.45 * semantic_score
+ 0.25 * keyword_score
+ 0.15 * entity_score
+ 0.10 * scope_score
+ 0.05 * confidence_score
+ temporal_adjustment
- contradiction_penalty
```

Decay policy by kind:

| Kind | Decay policy |
| --- | --- |
| `user_preferences` | No decay or very slow decay |
| `coding_conventions` | No time decay; scope and supersession decide |
| `architecture_decisions` | No time decay; supersession decides |
| `tooling_setup` | Medium decay, 90-180 day half-life |
| `bug_fixes` | Medium decay, 60-120 day half-life |
| `task_learnings` | Faster decay, 30-60 day half-life |
| `session_state` | TTL or 1-7 day half-life |
| `environment_state` | TTL or fast decay unless confirmed current |

Temporal adjustment must respect dated queries. A query about current setup should prefer the latest non-superseded memory; a query about a past event should be allowed to retrieve older dated memories.

## Scope Rules

Scopes are part of correctness, not only filtering.

Recommended specificity order:

1. `thread`
2. `workspace`
3. `repo`
4. `agent`
5. `user`
6. `global`

Search should prefer narrower matching scopes, then fall back to broader scopes. Workspace and repo memories must not leak into unrelated workspaces unless explicitly marked global.

## Codex Hooks And Skills

The local MCP server provides storage and retrieval. Hooks and skills drive agent behavior.

Recommended Codex behavior:

- `SessionStart`: retrieve workspace and user bootstrap memories.
- `UserPromptSubmit`: inject relevant memories for the current prompt.
- `Stop`: ask the agent to persist durable learnings and session state.
- Before compaction: persist unresolved session state.

Codex plugin hooks are not required for the MCP server itself, but they are useful for automatic capture. Hook installation should be explicit and reversible.

## Settings UI

Add a settings surface only after the local MCP server works from config.

Minimum settings:

- Enable local memory MCP.
- Select database path.
- Select embedding provider and model.
- Show embedding dimension and index status.
- Rebuild vector index.
- View, search, edit, tombstone, and export memories.
- Show MCP connection status.

Avoid storing API keys for remote Mem0. Local embedding credentials, if any, should follow existing secret-handling patterns.

## Validation

For documentation-only changes, no code validation is required.

For implementation changes:

- Always run `npm run typecheck`.
- For frontend settings changes, run `npm run test`.
- For Rust backend changes, run `cd src-tauri && cargo check`.
- For local memory core, add focused Rust tests around schema migration, add/search/delete, score fusion, decay, and supersession.
- For MCP behavior, add protocol-level tests for each tool payload and error shape.

## Implementation Order

1. Add `local_memory_core` schema, migrations, and repository API.
2. Add local embedding provider abstraction and one Ollama-backed implementation.
3. Add `sqlite-vec` vector indexing and FTS5 keyword indexing.
4. Add hybrid search, score fusion, and kind-aware decay.
5. Add the stdio MCP binary and Mem0-compatible tools.
6. Wire Codex config helper commands for enabling the local MCP server.
7. Add settings UI and daemon parity.
8. Add hooks and skills for automatic retrieval and capture.

