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
     - provider abstraction with a packaged deterministic local implementation
```

The Codex MCP config should point to a local stdio server:

```toml
[features]
memories = true

[mcp_servers.local_memory]
command = "G:\\code\\codex-app\\target\\debug\\codex-monitor-memory-mcp.exe"
args = ["--db", "C:\\Users\\ql\\.codex\\local-memory\\memory.sqlite"]
```

The server name should be `local_memory`. The feature flag and MCP server entry must both be present for CodexMonitor to treat local memory as enabled. Do not also configure the remote `mem0` MCP server in the same Codex profile.

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
- `import_memories`
- `rebuild_indexes`
- `list_events`
- `get_event_status`

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

Vector storage uses the local embedding provider selected by CodexMonitor. Packaged providers are `codex-monitor-hash-embedding-v2` and `codex-monitor-local-ngram-v1`, both with 64 dimensions and no network dependency. The provider exposes a model id and dimension through config/debug status so index rebuilds are explicit when the provider changes. The selected id is stored in `[local_memory].embedding_model` and passed to the MCP server as `--embedding-model`.

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

Active memory reads exclude tombstoned, superseded, and expired rows. Direct insertion may return the inserted row for acknowledgement, but list, search, entity, count, and normal get paths only expose active rows.

## Write Pipeline

Use add-only extraction as the default.

```text
input conversation or fact
  -> normalize scope and metadata
  -> retrieve related memories for deduplication context
  -> extract distinct new facts through the memory fact extractor
  -> hash exact content for duplicate prevention
  -> place automatic captures in pending review
  -> embed extracted memories
  -> extract and link entities
  -> insert memory rows and indexes
```

Do not default to UPDATE or DELETE decisions during extraction. If a new memory replaces old state, mark the old memory with `superseded_by_id` and keep an audit trail.

Current supersession behavior supports explicit `supersedes_id` on add/import and a conservative same-scope, same-kind subject match for long-lived memory kinds. Superseded rows remain in SQLite for auditability while their FTS/vector/entity links are removed from active retrieval.

Automatic captures are stored with the `pending-review` category. Pending rows remain visible through the review queue only; they are excluded from normal list, search, entity, count, and index rebuild paths until approved. Approving a row removes `pending-review`, adds `approved`, and indexes it. Rejecting a row tombstones it.

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

Use semantic search as the primary recall base. Keyword and entity signals boost ranking and can also provide fallback candidates when the vector index is unavailable.

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

Current runtime integration:

- `src-tauri/src/shared/local_memory_integration_core.rs` is the shared automatic memory integration layer.
- `src-tauri/src/shared/codex_core.rs` calls the integration layer from `send_user_message_core` and `turn_steer_core`, so local app mode and daemon mode use the same behavior.
- Before `turn/start` and `turn/steer`, CodexMonitor retrieves relevant thread, workspace, user, and global memories and appends them as a bounded `<local_memory_context>` block.
- `start_thread_core` writes a `session_start` lifecycle checkpoint after `thread/start` returns, scoped to the returned thread id when available.
- After a successful `turn/start` or `turn/steer`, CodexMonitor extracts bounded user facts from the original prompt and stores each fact separately. Durable instructions and project facts are classified into long-lived kinds; ordinary prompts are stored as thread-scoped `session_state`.
- `src-tauri/src/backend/app_server.rs` accumulates `item/agentMessage/delta` text. After `turn/completed`, CodexMonitor extracts bounded assistant learning facts and stores each fact as thread-scoped `task_learnings`.
- `compact_thread_core` writes a `pre_compaction` lifecycle checkpoint before `thread/compact/start`.
- The daemon `session_stop` path writes a `session_stop` lifecycle checkpoint before removing and killing the session process.
- `src-tauri/src/shared/local_memory_core.rs` uses semantic, keyword, entity, scope, confidence, and temporal signals in the fused search score.
- `src-tauri/src/shared/local_memory_core.rs` routes vector generation through an embedding provider abstraction; automatic capture uses the configured local embedding model.
- Memory add, update, delete, delete-all, import, entity listing, entity clearing, review approval, review rejection, and index rebuild are available through app commands, daemon RPC, and the local MCP server.
- Memory events are backed by `memory_access_log` and exposed through `list_events` and `get_event_status` in MCP, app commands, and daemon RPC.
- The configured database path is read from `[mcp_servers.local_memory].args`. The settings and daemon surfaces can update the `--db` path without disabling the memory server entry.
- MCP connectivity can be checked from the app or daemon by launching the configured stdio server and issuing `initialize` plus `tools/list`.
- Automatic memory failures are non-blocking; a memory database or retrieval issue must not fail the user turn.

Recommended Codex behavior:

- `SessionStart`: retrieve workspace and user bootstrap memories and capture the session-start checkpoint.
- `UserPromptSubmit`: inject relevant memories for the current prompt.
- `Stop`: ask the agent to persist durable learnings and session state.
- Before compaction: persist unresolved session state.

Codex plugin hooks are not required for the MCP server itself, but they are useful for automatic capture. Hook installation should be explicit and reversible.

## Settings UI

Add a settings surface only after the local MCP server works from config.

Current settings:

- Enable local memory MCP.
- Select database path.
- Apply database path.
- Check MCP connection status.
- Show feature status and database path.
- Select the local embedding provider model and show model id, dimension, and rebuild recommendation.
- Review, filter, batch approve, batch reject, and edit automatic memory captures before they enter retrieval.
- Search, refresh, edit, tombstone, delete all, import, and export memories.
- Add manual durable memories.
- List and clear extracted entities.
- Rebuild vector index.

Avoid storing API keys for remote Mem0. The current implementation does not expose an external embedding provider selector; if one is added later, local embedding credentials, if any, should follow existing secret-handling patterns.

## Validation

For documentation-only changes, no code validation is required.

For implementation changes:

- Always run `npm run typecheck`.
- For frontend settings changes, run `npm run test`.
- For Rust backend changes, run `cd src-tauri && cargo check`.
- For local memory core, add focused Rust tests around schema migration, add/search/delete, score fusion, decay, and supersession.
- For MCP behavior, add protocol-level tests for each tool payload and error shape.
- For end-to-end memory smoke checks, enable local memory, send a prompt that should be captured, confirm it appears in pending review, edit or approve it, verify search returns it, switch embedding model, rebuild indexes, and verify search still returns it.

## Implementation Order

1. Add `local_memory_core` schema, migrations, and repository API.
2. Add local embedding generation, vector indexing, and FTS5 keyword indexing.
3. Add hybrid search, score fusion, and kind-aware ranking.
4. Add entity extraction and linking.
5. Add the stdio MCP binary and Mem0-compatible tools.
6. Wire Codex config helper commands for enabling the local MCP server.
7. Add app commands, daemon RPC parity, and frontend IPC wrappers.
8. Add settings UI for status, manual memory management, entities, index rebuild, and export.
9. Keep automatic retrieval and capture wired through the shared turn integration; plugin hooks remain optional extensions for `SessionStart`, `Stop`, and pre-compaction capture.
