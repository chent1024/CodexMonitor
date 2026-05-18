use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::types::WorkspaceEntry;

const DEFAULT_SEARCH_LIMIT: u32 = 50;
const DEFAULT_REBUILD_MAX_THREADS: u32 = 250;
const DEFAULT_REBUILD_MAX_PAGES: u32 = 5;
const MAX_INDEXED_CONTENT_CHARS: usize = 300_000;
const MAX_INDEXED_PART_CHARS: usize = 60_000;
const THREAD_LIST_PAGE_SIZE: u32 = 100;
const THREAD_TURNS_INDEX_LIMIT: u32 = 300;
const THREAD_LIST_SOURCE_KINDS: &[&str] = &[
    "cli",
    "vscode",
    "appServer",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "unknown",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchThreadsInput {
    #[serde(default)]
    pub(crate) query: String,
    #[serde(default)]
    pub(crate) workspace_ids: Vec<String>,
    #[serde(default)]
    pub(crate) limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadSearchResult {
    pub(crate) workspace_id: String,
    pub(crate) workspace_name: String,
    pub(crate) workspace_path: String,
    pub(crate) thread_id: String,
    pub(crate) title: String,
    pub(crate) updated_at: i64,
    pub(crate) match_kind: String,
    pub(crate) snippet: String,
    pub(crate) source: String,
    pub(crate) score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RebuildThreadSearchIndexInput {
    #[serde(default = "default_rebuild_source")]
    pub(crate) source: String,
    #[serde(default)]
    pub(crate) workspace_ids: Vec<String>,
    #[serde(default)]
    pub(crate) reset: bool,
    #[serde(default)]
    pub(crate) codex_home: Option<String>,
    #[serde(default)]
    pub(crate) max_threads: Option<u32>,
    #[serde(default)]
    pub(crate) max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadSearchIndexStats {
    pub(crate) source: String,
    pub(crate) indexed_threads: u64,
    pub(crate) scanned_files: u64,
    pub(crate) scanned_threads: u64,
    pub(crate) skipped: u64,
    pub(crate) error_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadSearchIndexSourceCount {
    pub(crate) source: String,
    pub(crate) count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThreadSearchIndexStatus {
    pub(crate) db_path: String,
    pub(crate) exists: bool,
    pub(crate) db_bytes: u64,
    pub(crate) wal_bytes: u64,
    pub(crate) shm_bytes: u64,
    pub(crate) total_bytes: u64,
    pub(crate) indexed_threads: u64,
    pub(crate) indexed_workspaces: u64,
    pub(crate) fts_rows: u64,
    pub(crate) title_bytes: u64,
    pub(crate) content_bytes: u64,
    pub(crate) last_indexed_at: Option<i64>,
    pub(crate) source_counts: Vec<ThreadSearchIndexSourceCount>,
}

#[derive(Debug, Clone)]
struct WorkspaceInfoLite {
    id: String,
    name: String,
    path: String,
}

#[derive(Debug, Clone)]
struct ThreadSearchDocument {
    workspace_id: String,
    workspace_name: String,
    workspace_path: String,
    thread_id: String,
    title: String,
    content: String,
    updated_at: i64,
    source: String,
}

struct ThreadSearchStatusDetails {
    indexed_threads: u64,
    indexed_workspaces: u64,
    fts_rows: u64,
    title_bytes: u64,
    content_bytes: u64,
    last_indexed_at: Option<i64>,
    source_counts: Vec<ThreadSearchIndexSourceCount>,
}

fn default_rebuild_source() -> String {
    "codex_sessions".to_string()
}

pub(crate) fn thread_search_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("thread-search.sqlite")
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

pub(crate) fn search_threads(
    data_dir: &Path,
    input: SearchThreadsInput,
) -> Result<Vec<ThreadSearchResult>, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let store = ThreadSearchStore::open(thread_search_db_path(data_dir))?;
    store.search(
        query,
        &input.workspace_ids,
        input.limit.unwrap_or(DEFAULT_SEARCH_LIMIT),
    )
}

pub(crate) fn get_thread_search_index_status(
    data_dir: &Path,
) -> Result<ThreadSearchIndexStatus, String> {
    let db_path = thread_search_db_path(data_dir);
    let exists = db_path.is_file();
    let db_bytes = file_size(&db_path);
    let wal_bytes = file_size(&db_path.with_extension("sqlite-wal"));
    let shm_bytes = file_size(&db_path.with_extension("sqlite-shm"));
    let mut status = ThreadSearchIndexStatus {
        db_path: db_path.to_string_lossy().to_string(),
        exists,
        db_bytes,
        wal_bytes,
        shm_bytes,
        total_bytes: db_bytes + wal_bytes + shm_bytes,
        ..ThreadSearchIndexStatus::default()
    };
    if !exists {
        return Ok(status);
    }

    let store = ThreadSearchStore::open(db_path)?;
    let details = store.status_details()?;
    status.indexed_threads = details.indexed_threads;
    status.indexed_workspaces = details.indexed_workspaces;
    status.fts_rows = details.fts_rows;
    status.title_bytes = details.title_bytes;
    status.content_bytes = details.content_bytes;
    status.last_indexed_at = details.last_indexed_at;
    status.source_counts = details.source_counts;
    Ok(status)
}

pub(crate) fn clear_thread_search_index(
    data_dir: &Path,
) -> Result<ThreadSearchIndexStatus, String> {
    let db_path = thread_search_db_path(data_dir);
    remove_file_if_exists(&db_path)?;
    remove_file_if_exists(&db_path.with_extension("sqlite-wal"))?;
    remove_file_if_exists(&db_path.with_extension("sqlite-shm"))?;
    get_thread_search_index_status(data_dir)
}

pub(crate) async fn rebuild_thread_search_index_from_codex_sessions(
    data_dir: &Path,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    input: RebuildThreadSearchIndexInput,
) -> Result<ThreadSearchIndexStats, String> {
    let workspace_list = workspace_filter(workspaces, &input.workspace_ids).await;
    let workspace_lookup = WorkspacePathLookup::new(&workspace_list);
    let codex_home = input
        .codex_home
        .as_deref()
        .map(PathBuf::from)
        .or_else(default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())?;
    let sessions_dir = codex_home.join("sessions");
    let store = ThreadSearchStore::open(thread_search_db_path(data_dir))?;
    if input.reset {
        store.clear()?;
    }

    let mut stats = ThreadSearchIndexStats {
        source: "codex_sessions".to_string(),
        ..ThreadSearchIndexStats::default()
    };
    if !sessions_dir.is_dir() {
        return Ok(stats);
    }
    let max_threads = input.max_threads.unwrap_or(DEFAULT_REBUILD_MAX_THREADS) as usize;
    for file in collect_jsonl_files(&sessions_dir, max_threads.saturating_mul(4)) {
        stats.scanned_files += 1;
        match document_from_codex_session_file(&file, &workspace_lookup) {
            Ok(Some(document)) => {
                store.upsert_document(&document)?;
                stats.indexed_threads += 1;
                stats.scanned_threads += 1;
                if stats.indexed_threads as usize >= max_threads {
                    break;
                }
            }
            Ok(None) => {
                stats.skipped += 1;
            }
            Err(_) => {
                stats.error_count += 1;
            }
        }
    }
    Ok(stats)
}

pub(crate) async fn rebuild_thread_search_index_from_app_server(
    data_dir: &Path,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    input: RebuildThreadSearchIndexInput,
) -> Result<ThreadSearchIndexStats, String> {
    let workspace_list = workspace_filter(workspaces, &input.workspace_ids).await;
    let workspace_lookup = WorkspacePathLookup::new(&workspace_list);
    let workspace_by_id = workspace_list
        .iter()
        .map(|workspace| (workspace.id.clone(), workspace.clone()))
        .collect::<HashMap<_, _>>();
    let store = ThreadSearchStore::open(thread_search_db_path(data_dir))?;
    if input.reset {
        store.clear()?;
    }
    let mut stats = ThreadSearchIndexStats {
        source: "app_server".to_string(),
        ..ThreadSearchIndexStats::default()
    };
    let max_threads = input.max_threads.unwrap_or(DEFAULT_REBUILD_MAX_THREADS);
    let max_pages = input.max_pages.unwrap_or(DEFAULT_REBUILD_MAX_PAGES).max(1);

    for workspace in workspace_list {
        let session = {
            let sessions = sessions.lock().await;
            sessions.get(&workspace.id).cloned()
        };
        let Some(session) = session else {
            stats.skipped += 1;
            continue;
        };
        let mut cursor: Option<String> = None;
        for _ in 0..max_pages {
            let response = session
                .send_request_for_workspace(
                    &workspace.id,
                    "thread/list",
                    json!({
                        "cursor": cursor,
                        "limit": THREAD_LIST_PAGE_SIZE,
                        "sortKey": "updated_at",
                        "sourceKinds": THREAD_LIST_SOURCE_KINDS,
                    }),
                )
                .await?;
            let result = unwrap_result(&response);
            let data = result
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for thread in data {
                if stats.indexed_threads >= max_threads as u64 {
                    return Ok(stats);
                }
                let thread_id = string_at(&thread, &["id"]);
                if thread_id.is_empty() {
                    stats.skipped += 1;
                    continue;
                }
                let cwd = string_at(&thread, &["cwd"]);
                let resolved_workspace = workspace_lookup
                    .resolve(&cwd)
                    .and_then(|id| workspace_by_id.get(id))
                    .unwrap_or(&workspace);
                let turns = session
                    .send_request_for_workspace(
                        &workspace.id,
                        "thread/turns/list",
                        json!({
                            "threadId": thread_id,
                            "cursor": Value::Null,
                            "limit": THREAD_TURNS_INDEX_LIMIT,
                            "itemsView": "items",
                        }),
                    )
                    .await
                    .unwrap_or_else(|_| json!({}));
                let content = collect_conversation_text(&turns);
                let preview = string_at(&thread, &["preview"]);
                let title = first_non_empty(&[
                    string_at(&thread, &["name"]),
                    first_line(&content),
                    preview,
                ])
                .unwrap_or_else(|| thread_id.clone());
                let document = ThreadSearchDocument {
                    workspace_id: resolved_workspace.id.clone(),
                    workspace_name: resolved_workspace.name.clone(),
                    workspace_path: resolved_workspace.path.clone(),
                    thread_id,
                    title: truncate_chars(&title, 240),
                    content,
                    updated_at: timestamp_ms_from_value(
                        thread
                            .get("updatedAt")
                            .or_else(|| thread.get("updated_at"))
                            .or_else(|| thread.get("createdAt"))
                            .or_else(|| thread.get("created_at")),
                    ),
                    source: "app_server".to_string(),
                };
                store.upsert_document(&document)?;
                stats.indexed_threads += 1;
                stats.scanned_threads += 1;
            }
            cursor = next_cursor(result);
            if cursor.is_none() {
                break;
            }
        }
    }
    Ok(stats)
}

struct ThreadSearchStore {
    conn: Connection,
}

impl ThreadSearchStore {
    fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS thread_search_docs (
                    workspace_id TEXT NOT NULL,
                    workspace_name TEXT NOT NULL,
                    workspace_path TEXT NOT NULL,
                    thread_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    indexed_at INTEGER NOT NULL,
                    PRIMARY KEY (workspace_id, thread_id)
                );
                "#,
            )
            .map_err(|err| err.to_string())?;
        if self.fts_exists()? && !self.fts_has_column("search_terms")? {
            self.conn
                .execute_batch(
                    r#"
                    DROP TABLE thread_search_fts;
                    DELETE FROM thread_search_docs;
                    "#,
                )
                .map_err(|err| err.to_string())?;
        }
        self.conn
            .execute_batch(
                r#"
                CREATE VIRTUAL TABLE IF NOT EXISTS thread_search_fts USING fts5(
                    workspace_id UNINDEXED,
                    thread_id UNINDEXED,
                    title,
                    content,
                    workspace_name,
                    search_terms,
                    source UNINDEXED
                );
                "#,
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn fts_exists(&self) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_search_fts'",
                [],
                |_| Ok(true),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(|err| err.to_string())
    }

    fn fts_has_column(&self, column_name: &str) -> Result<bool, String> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(thread_search_fts)")
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|err| err.to_string())?;
        for row in rows {
            if row.map_err(|err| err.to_string())? == column_name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn clear(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                r#"
                DELETE FROM thread_search_docs;
                DELETE FROM thread_search_fts;
                PRAGMA wal_checkpoint(TRUNCATE);
                VACUUM;
                "#,
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn status_details(&self) -> Result<ThreadSearchStatusDetails, String> {
        let indexed_threads = self
            .conn
            .query_row("SELECT COUNT(*) FROM thread_search_docs", [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap_or(0);
        let indexed_workspaces = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT workspace_id) FROM thread_search_docs",
                [],
                |row| row.get::<_, u64>(0),
            )
            .unwrap_or(0);
        let fts_rows = self
            .conn
            .query_row("SELECT COUNT(*) FROM thread_search_fts", [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap_or(0);
        let (title_bytes, content_bytes, last_indexed_at) = self
            .conn
            .query_row(
                r#"
                SELECT
                    COALESCE(SUM(length(CAST(title AS BLOB))), 0),
                    COALESCE(SUM(length(CAST(content AS BLOB))), 0),
                    MAX(indexed_at)
                FROM thread_search_docs
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, u64>(0)?,
                        row.get::<_, u64>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .unwrap_or((0, 0, None));
        let mut source_counts = Vec::new();
        if let Ok(mut stmt) = self.conn.prepare(
            r#"
            SELECT source, COUNT(*)
            FROM thread_search_docs
            GROUP BY source
            ORDER BY COUNT(*) DESC, source ASC
            "#,
        ) {
            let rows = stmt.query_map([], |row| {
                Ok(ThreadSearchIndexSourceCount {
                    source: row.get(0)?,
                    count: row.get(1)?,
                })
            });
            if let Ok(rows) = rows {
                for row in rows {
                    source_counts.push(row.map_err(|err| err.to_string())?);
                }
            }
        }
        Ok(ThreadSearchStatusDetails {
            indexed_threads,
            indexed_workspaces,
            fts_rows,
            title_bytes,
            content_bytes,
            last_indexed_at,
            source_counts,
        })
    }

    fn upsert_document(&self, document: &ThreadSearchDocument) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM thread_search_fts WHERE workspace_id = ?1 AND thread_id = ?2",
                params![document.workspace_id, document.thread_id],
            )
            .map_err(|err| err.to_string())?;
        self.conn
            .execute(
                r#"
                INSERT INTO thread_search_docs(
                    workspace_id, workspace_name, workspace_path, thread_id,
                    title, content, updated_at, source, indexed_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                ON CONFLICT(workspace_id, thread_id) DO UPDATE SET
                    workspace_name = excluded.workspace_name,
                    workspace_path = excluded.workspace_path,
                    title = excluded.title,
                    content = excluded.content,
                    updated_at = excluded.updated_at,
                    source = excluded.source,
                    indexed_at = excluded.indexed_at
                "#,
                params![
                    document.workspace_id,
                    document.workspace_name,
                    document.workspace_path,
                    document.thread_id,
                    document.title,
                    document.content,
                    document.updated_at,
                    document.source,
                    Utc::now().timestamp_millis(),
                ],
            )
            .map_err(|err| err.to_string())?;
        self.conn
            .execute(
                r#"
                INSERT INTO thread_search_fts(
                    workspace_id, thread_id, title, content, workspace_name, search_terms, source
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    document.workspace_id,
                    document.thread_id,
                    document.title,
                    document.content,
                    "",
                    search_terms(&format!("{}\n{}", document.title, document.content)),
                    document.source,
                ],
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn search(
        &self,
        query: &str,
        workspace_ids: &[String],
        limit: u32,
    ) -> Result<Vec<ThreadSearchResult>, String> {
        let mut keys = HashSet::<(String, String)>::new();
        if let Some(fts_query) = fts_query(query) {
            let mut stmt = self
                .conn
                .prepare(
                    r#"
                    SELECT workspace_id, thread_id
                    FROM thread_search_fts
                    WHERE thread_search_fts MATCH ?1
                    ORDER BY bm25(thread_search_fts)
                    LIMIT ?2
                    "#,
                )
                .map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(params![fts_query, limit.saturating_mul(4)], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|err| err.to_string())?;
            for row in rows {
                keys.insert(row.map_err(|err| err.to_string())?);
            }
        }

        let like_query = format!("%{}%", query.to_lowercase());
        let mut stmt = self
            .conn
            .prepare(
                r#"
                SELECT workspace_id, thread_id
                FROM thread_search_docs
                WHERE lower(title) LIKE ?1
                ORDER BY updated_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![like_query, limit.saturating_mul(4)], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| err.to_string())?;
        for row in rows {
            keys.insert(row.map_err(|err| err.to_string())?);
        }

        let workspace_filter = workspace_ids
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        let mut results = Vec::new();
        for (workspace_id, thread_id) in keys {
            if !workspace_filter.is_empty() && !workspace_filter.contains(&workspace_id) {
                continue;
            }
            if let Some(document) = self.load_document(&workspace_id, &thread_id)? {
                if let Some(result) = build_search_result(&document, query) {
                    results.push(result);
                }
            }
        }
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });
        results.truncate(limit as usize);
        Ok(results)
    }

    fn load_document(
        &self,
        workspace_id: &str,
        thread_id: &str,
    ) -> Result<Option<ThreadSearchDocument>, String> {
        self.conn
            .query_row(
                r#"
                SELECT workspace_id, workspace_name, workspace_path, thread_id,
                       title, content, updated_at, source
                FROM thread_search_docs
                WHERE workspace_id = ?1 AND thread_id = ?2
                "#,
                params![workspace_id, thread_id],
                |row| {
                    Ok(ThreadSearchDocument {
                        workspace_id: row.get(0)?,
                        workspace_name: row.get(1)?,
                        workspace_path: row.get(2)?,
                        thread_id: row.get(3)?,
                        title: row.get(4)?,
                        content: row.get(5)?,
                        updated_at: row.get(6)?,
                        source: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|err| err.to_string())
    }
}

fn build_search_result(document: &ThreadSearchDocument, query: &str) -> Option<ThreadSearchResult> {
    let query_lower = query.to_lowercase();
    let title_match = contains_query(&document.title, query, &query_lower);
    let content_match = contains_query(&document.content, query, &query_lower);
    let match_kind = if title_match {
        "title"
    } else if content_match {
        "content"
    } else {
        "token"
    };
    let snippet_source = if title_match {
        &document.title
    } else {
        &document.content
    };
    let mut score = 1.0;
    if title_match {
        score += 4.0;
    }
    if content_match {
        score += 2.0;
    }
    Some(ThreadSearchResult {
        workspace_id: document.workspace_id.clone(),
        workspace_name: document.workspace_name.clone(),
        workspace_path: document.workspace_path.clone(),
        thread_id: document.thread_id.clone(),
        title: document.title.clone(),
        updated_at: document.updated_at,
        match_kind: match_kind.to_string(),
        snippet: make_snippet(snippet_source, query, 180),
        source: document.source.clone(),
        score,
    })
}

fn contains_query(value: &str, query: &str, query_lower: &str) -> bool {
    value.contains(query) || value.to_lowercase().contains(query_lower)
}

async fn workspace_filter(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_ids: &[String],
) -> Vec<WorkspaceInfoLite> {
    let filter = workspace_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let workspaces = workspaces.lock().await;
    workspaces
        .values()
        .filter(|workspace| filter.is_empty() || filter.contains(&workspace.id))
        .map(|workspace| WorkspaceInfoLite {
            id: workspace.id.clone(),
            name: workspace.name.clone(),
            path: workspace.path.clone(),
        })
        .collect()
}

struct WorkspacePathLookup {
    entries: Vec<WorkspaceInfoLite>,
}

impl WorkspacePathLookup {
    fn new(workspaces: &[WorkspaceInfoLite]) -> Self {
        let mut entries = workspaces.to_vec();
        entries.sort_by(|a, b| b.path.len().cmp(&a.path.len()));
        Self { entries }
    }

    fn resolve<'a>(&'a self, cwd: &str) -> Option<&'a str> {
        let normalized = normalize_root_path(cwd);
        self.entries
            .iter()
            .find(|workspace| is_within_root(&normalized, &normalize_root_path(&workspace.path)))
            .map(|workspace| workspace.id.as_str())
    }

    fn resolve_workspace<'a>(&'a self, cwd: &str) -> Option<&'a WorkspaceInfoLite> {
        let normalized = normalize_root_path(cwd);
        self.entries
            .iter()
            .find(|workspace| is_within_root(&normalized, &normalize_root_path(&workspace.path)))
    }
}

fn document_from_codex_session_file(
    path: &Path,
    workspace_lookup: &WorkspacePathLookup,
) -> Result<Option<ThreadSearchDocument>, String> {
    let file = fs::File::open(path).map_err(|err| err.to_string())?;
    let reader = BufReader::new(file);
    let mut thread_id = String::new();
    let mut cwd = String::new();
    let mut first_user = String::new();
    let mut content_parts = Vec::new();
    let mut updated_at = 0i64;

    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        updated_at = updated_at.max(timestamp_ms_from_value(value.get("timestamp")));
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "session_meta" => {
                let payload = value.get("payload").unwrap_or(&Value::Null);
                thread_id = string_at(payload, &["id"]);
                cwd = string_at(payload, &["cwd"]);
                updated_at = updated_at.max(timestamp_ms_from_value(payload.get("timestamp")));
            }
            "response_item" => {
                let payload = value.get("payload").unwrap_or(&Value::Null);
                let role = payload
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let payload_type = payload
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let text = match payload_type {
                    "message" if matches!(role, "user" | "assistant") => {
                        collect_message_text(payload)
                    }
                    _ => String::new(),
                };
                let trimmed_text = text.trim();
                if role == "user"
                    && first_user.is_empty()
                    && !trimmed_text.is_empty()
                    && !should_skip_search_text(trimmed_text)
                {
                    first_user = first_line(trimmed_text);
                }
                push_part(&mut content_parts, text);
                truncate_parts(&mut content_parts, MAX_INDEXED_CONTENT_CHARS);
            }
            _ => {}
        }
    }

    if thread_id.is_empty() || cwd.is_empty() {
        return Ok(None);
    }
    let Some(workspace) = workspace_lookup.resolve_workspace(&cwd) else {
        return Ok(None);
    };
    let content = truncate_chars(&content_parts.join("\n\n"), MAX_INDEXED_CONTENT_CHARS);
    let title = if first_user.is_empty() {
        thread_id.clone()
    } else {
        truncate_chars(&first_user, 240)
    };
    Ok(Some(ThreadSearchDocument {
        workspace_id: workspace.id.clone(),
        workspace_name: workspace.name.clone(),
        workspace_path: workspace.path.clone(),
        thread_id,
        title,
        content,
        updated_at,
        source: "codex_sessions".to_string(),
    }))
}

fn collect_jsonl_files(root: &Path, max_files: usize) -> Vec<PathBuf> {
    fn visit(dir: &Path, files: &mut Vec<PathBuf>, max_files: usize) {
        if files.len() >= max_files {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());
        entries.reverse();
        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, files, max_files);
            } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
                files.push(path);
                if files.len() >= max_files {
                    break;
                }
            }
        }
    }
    let mut files = Vec::new();
    visit(root, &mut files, max_files);
    files
}

fn collect_conversation_text(value: &Value) -> String {
    collect_message_texts(value).join("\n\n")
}

fn collect_message_text(value: &Value) -> String {
    let role = message_role(value);
    if let Some(content) = value.get("content") {
        return collect_text_from_message_content(content, role);
    }
    ["text", "message"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn collect_text_from_message_content(value: &Value, role: Option<&str>) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let content_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                let allowed = match role {
                    Some("user") => matches!(content_type, "" | "input_text" | "text"),
                    Some("assistant") => matches!(content_type, "" | "output_text" | "text"),
                    _ => matches!(content_type, "" | "input_text" | "output_text" | "text"),
                };
                if !allowed {
                    return None;
                }
                item.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.get("output_text").and_then(Value::as_str))
                    .or_else(|| item.get("input_text").and_then(Value::as_str))
                    .map(str::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn collect_message_texts(value: &Value) -> Vec<String> {
    fn walk(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Array(items) => {
                for item in items {
                    walk(item, output);
                }
            }
            Value::Object(map) => {
                if is_message_value(value) {
                    let text = collect_message_text(value);
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && !should_skip_search_text(trimmed) {
                        output.push(trimmed.to_string());
                    }
                    return;
                }
                for child in map.values() {
                    walk(child, output);
                }
            }
            _ => {}
        }
    }
    let mut output = Vec::new();
    walk(value, &mut output);
    output
}

fn is_message_value(value: &Value) -> bool {
    let value_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if value_type == "message" {
        return matches!(message_role(value), Some("user" | "assistant"));
    }
    matches!(
        value_type,
        "userMessage" | "user-message" | "assistantMessage" | "assistant-message" | "agentMessage"
    )
}

fn message_role(value: &Value) -> Option<&'static str> {
    match value.get("role").and_then(Value::as_str) {
        Some("user") => return Some("user"),
        Some("assistant") => return Some("assistant"),
        _ => {}
    }
    match value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "userMessage" | "user-message" => Some("user"),
        "assistantMessage" | "assistant-message" | "agentMessage" => Some("assistant"),
        _ => None,
    }
}

fn fts_query(query: &str) -> Option<String> {
    let tokens = token_set(query)
        .into_iter()
        .map(|token| fts_safe_token(&token))
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

fn search_terms(value: &str) -> String {
    let mut tokens = token_set(value)
        .into_iter()
        .map(|token| fts_safe_token(&token))
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens.join(" ")
}

fn fts_safe_token(value: &str) -> String {
    let lower = value.trim().to_lowercase();
    if lower.is_empty() {
        return String::new();
    }
    if lower
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return lower;
    }
    let mut encoded = String::from("u");
    for ch in lower.chars() {
        encoded.push_str(&format!("{:x}", ch as u32));
        encoded.push('_');
    }
    encoded
}

fn token_set(value: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    for token in value.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-') {
        let normalized = token.trim().to_lowercase();
        if normalized.chars().count() >= 2 {
            tokens.insert(normalized);
        }
    }
    let cjk = value.chars().filter(|ch| is_cjk(*ch)).collect::<Vec<_>>();
    for window in cjk.windows(2) {
        tokens.insert(window.iter().collect::<String>());
    }
    tokens
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF
    )
}

fn make_snippet(value: &str, query: &str, max_chars: usize) -> String {
    let value_chars = value.chars().count();
    if value_chars <= max_chars {
        return collapse_whitespace(value);
    }
    let char_index = find_query_char_index(value, query).unwrap_or(0);
    let half = max_chars / 2;
    let start = char_index.saturating_sub(half);
    let snippet = collapse_whitespace(
        &value
            .chars()
            .skip(start)
            .take(max_chars)
            .collect::<String>(),
    );
    format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        snippet,
        if start + max_chars < value_chars {
            "..."
        } else {
            ""
        }
    )
}

fn find_query_char_index(value: &str, query: &str) -> Option<usize> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    if let Some(byte_index) = value.find(query) {
        return Some(value[..byte_index].chars().count());
    }
    let lower = value.to_lowercase();
    let query_lower = query.to_lowercase();
    lower.find(&query_lower).and_then(|byte_index| {
        value
            .is_char_boundary(byte_index)
            .then(|| value[..byte_index].chars().count())
    })
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_root_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        return String::new();
    }
    let lower = normalized.to_ascii_lowercase();
    if lower.starts_with("//?/unc/") {
        format!("//{}", &normalized[8..])
    } else if lower.starts_with("//?/") || lower.starts_with("//./") {
        normalized[4..].to_string()
    } else {
        normalized.to_string()
    }
}

fn is_within_root(path: &str, root: &str) -> bool {
    !path.is_empty()
        && !root.is_empty()
        && (path == root
            || (path.len() > root.len()
                && path.starts_with(root)
                && path.as_bytes().get(root.len()) == Some(&b'/')))
}

fn unwrap_result(value: &Value) -> &Value {
    value.get("result").unwrap_or(value)
}

fn next_cursor(result: &Value) -> Option<String> {
    result
        .get("nextCursor")
        .or_else(|| result.get("next_cursor"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn string_at(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn first_non_empty(values: &[String]) -> Option<String> {
    values
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn first_line(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn push_part(parts: &mut Vec<String>, value: String) {
    let trimmed = value.trim();
    if trimmed.is_empty() || should_skip_search_text(trimmed) {
        return;
    }
    parts.push(truncate_chars(trimmed, MAX_INDEXED_PART_CHARS));
}

fn truncate_parts(parts: &mut Vec<String>, max_chars: usize) {
    let mut total = 0usize;
    let mut keep = parts.len();
    for (index, part) in parts.iter().enumerate() {
        total += part.chars().count();
        if total > max_chars {
            keep = index + 1;
            break;
        }
    }
    parts.truncate(keep);
    let before_last = parts
        .iter()
        .take(parts.len().saturating_sub(1))
        .map(|part| part.chars().count())
        .sum::<usize>();
    if let Some(last) = parts.last_mut() {
        let remaining = max_chars.saturating_sub(before_last);
        *last = truncate_chars(last, remaining);
    }
}

fn should_skip_search_text(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with("# AGENTS.md instructions for ")
        || trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<permissions instructions>")
        || trimmed.starts_with("<skills_instructions>")
        || trimmed.starts_with("<plugins_instructions>")
        || trimmed.starts_with("========= MEMORY_SUMMARY BEGINS =========")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    output.push_str("...");
    output
}

fn timestamp_ms_from_value(value: Option<&Value>) -> i64 {
    let raw = match value {
        Some(Value::Number(number)) => number.as_i64().unwrap_or_default(),
        Some(Value::String(text)) => DateTime::parse_from_rfc3339(text)
            .map(|value| value.timestamp_millis())
            .unwrap_or_default(),
        _ => 0,
    };
    if raw > 0 && raw < 1_000_000_000_000 {
        raw * 1000
    } else {
        raw
    }
}

fn default_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "codex-monitor-thread-search-test-{}.sqlite",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn searches_indexed_thread_title_and_content() {
        let path = temp_db_path();
        let store = ThreadSearchStore::open(path.clone()).expect("open store");
        store
            .upsert_document(&ThreadSearchDocument {
                workspace_id: "ws-1".to_string(),
                workspace_name: "coChat".to_string(),
                workspace_path: "/tmp/coChat".to_string(),
                thread_id: "thread-1".to_string(),
                title: "会话搜索功能".to_string(),
                content: "Need to index Codex session content and support 中文查询.".to_string(),
                updated_at: 1_700_000_000_000,
                source: "test".to_string(),
            })
            .expect("index document");

        let results = store
            .search("中文查询", &["ws-1".to_string()], 10)
            .expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].thread_id, "thread-1");
        assert!(results[0].snippet.contains("中文查询"));

        let title_results = store.search("会话搜索", &[], 10).expect("search title");
        assert_eq!(title_results[0].match_kind, "title");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn searches_cjk_content_without_content_like_fallback() {
        let path = temp_db_path();
        let store = ThreadSearchStore::open(path.clone()).expect("open store");
        store
            .upsert_document(&ThreadSearchDocument {
                workspace_id: "ws-1".to_string(),
                workspace_name: "coChat".to_string(),
                workspace_path: "/tmp/coChat".to_string(),
                thread_id: "thread-cjk".to_string(),
                title: "游戏设定".to_string(),
                content: format!(
                    "{}人族和魔法单位需要进入索引{}",
                    "这是一段很长的中文上下文。".repeat(20),
                    "后面还有很多中文。".repeat(20)
                ),
                updated_at: 1_700_000_000_001,
                source: "test".to_string(),
            })
            .expect("index document");

        let results = store.search("人族", &[], 10).expect("search cjk");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].thread_id, "thread-cjk");
        assert!(results[0].snippet.contains("人族"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn does_not_search_workspace_name() {
        let path = temp_db_path();
        let store = ThreadSearchStore::open(path.clone()).expect("open store");
        store
            .upsert_document(&ThreadSearchDocument {
                workspace_id: "ws-1".to_string(),
                workspace_name: "UniqueWorkspaceName".to_string(),
                workspace_path: "/tmp/coChat".to_string(),
                thread_id: "thread-workspace".to_string(),
                title: "普通标题".to_string(),
                content: "普通输入和输出".to_string(),
                updated_at: 1_700_000_000_002,
                source: "test".to_string(),
            })
            .expect("index document");

        let results = store
            .search("UniqueWorkspaceName", &[], 10)
            .expect("search workspace name");
        assert!(results.is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn builds_document_from_codex_session_jsonl() {
        let dir = std::env::temp_dir().join(format!(
            "codex-monitor-thread-search-jsonl-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("rollout-test.jsonl");
        std::fs::write(
            &path,
            r#"{"timestamp":"2026-05-18T00:00:00Z","type":"session_meta","payload":{"id":"thread-jsonl","cwd":"/tmp/coChat","timestamp":"2026-05-18T00:00:00Z"}}
{"timestamp":"2026-05-18T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"帮我实现会话搜索"}]}}
{"timestamp":"2026-05-18T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"已建立 SQLite FTS 索引"}]}}
"#,
        )
        .expect("write jsonl");
        let lookup = WorkspacePathLookup::new(&[WorkspaceInfoLite {
            id: "ws-1".to_string(),
            name: "coChat".to_string(),
            path: "/tmp/coChat".to_string(),
        }]);

        let document = document_from_codex_session_file(&path, &lookup)
            .expect("parse jsonl")
            .expect("document");
        assert_eq!(document.thread_id, "thread-jsonl");
        assert_eq!(document.title, "帮我实现会话搜索");
        assert!(document.content.contains("SQLite FTS"));
        assert_eq!(document.workspace_id, "ws-1");

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn excludes_tools_reasoning_and_diffs_from_codex_session_document() {
        let dir = std::env::temp_dir().join(format!(
            "codex-monitor-thread-search-jsonl-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("rollout-test.jsonl");
        std::fs::write(
            &path,
            r#"{"timestamp":"2026-05-18T00:00:00Z","type":"session_meta","payload":{"id":"thread-jsonl","cwd":"/tmp/coChat","timestamp":"2026-05-18T00:00:00Z"}}
{"timestamp":"2026-05-18T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"索引用户输入"}]}}
{"timestamp":"2026-05-18T00:00:02Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"工具运行内容不应进入索引"}}
{"timestamp":"2026-05-18T00:00:03Z","type":"response_item","payload":{"type":"custom_tool_call_output","output":"命令输出不应进入索引"}}
{"timestamp":"2026-05-18T00:00:04Z","type":"response_item","payload":{"type":"reasoning","summary":[{"text":"推理摘要不应进入索引"}]}}
{"timestamp":"2026-05-18T00:00:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"索引助手输出"}]}}
"#,
        )
        .expect("write jsonl");
        let lookup = WorkspacePathLookup::new(&[WorkspaceInfoLite {
            id: "ws-1".to_string(),
            name: "coChat".to_string(),
            path: "/tmp/coChat".to_string(),
        }]);

        let document = document_from_codex_session_file(&path, &lookup)
            .expect("parse jsonl")
            .expect("document");
        assert!(document.content.contains("索引用户输入"));
        assert!(document.content.contains("索引助手输出"));
        assert!(!document.content.contains("工具运行内容"));
        assert!(!document.content.contains("命令输出"));
        assert!(!document.content.contains("推理摘要"));

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn collects_only_message_text_from_app_server_turns() {
        let turns = json!({
            "result": {
                "data": [
                    {
                        "items": [
                            {
                                "type": "message",
                                "role": "user",
                                "content": [{ "type": "input_text", "text": "app server 用户输入" }]
                            },
                            {
                                "type": "function_call",
                                "arguments": "app server 工具参数"
                            },
                            {
                                "type": "message",
                                "role": "assistant",
                                "content": [{ "type": "output_text", "text": "app server 助手输出" }]
                            },
                            {
                                "type": "diff",
                                "text": "app server 文件编辑"
                            }
                        ]
                    }
                ]
            }
        });

        let content = collect_conversation_text(&turns);
        assert!(content.contains("app server 用户输入"));
        assert!(content.contains("app server 助手输出"));
        assert!(!content.contains("app server 工具参数"));
        assert!(!content.contains("app server 文件编辑"));
    }

    #[test]
    fn skips_agent_context_when_building_codex_session_document() {
        let dir = std::env::temp_dir().join(format!(
            "codex-monitor-thread-search-jsonl-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("rollout-test.jsonl");
        std::fs::write(
            &path,
            r##"{"timestamp":"2026-05-18T00:00:00Z","type":"session_meta","payload":{"id":"thread-jsonl","cwd":"/tmp/coChat","timestamp":"2026-05-18T00:00:00Z"}}
{"timestamp":"2026-05-18T00:00:01Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /tmp/coChat\n\n<environment_context>\n不要把这些运行上下文作为会话标题或搜索正文。"}]}}
{"timestamp":"2026-05-18T00:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"查找人族配置"}]}}
"##,
        )
        .expect("write jsonl");
        let lookup = WorkspacePathLookup::new(&[WorkspaceInfoLite {
            id: "ws-1".to_string(),
            name: "coChat".to_string(),
            path: "/tmp/coChat".to_string(),
        }]);

        let document = document_from_codex_session_file(&path, &lookup)
            .expect("parse jsonl")
            .expect("document");
        assert_eq!(document.title, "查找人族配置");
        assert!(document.content.contains("查找人族配置"));
        assert!(!document.content.contains("AGENTS.md instructions"));
        assert!(!document.content.contains("运行上下文"));

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn reports_and_clears_thread_search_index_status() {
        let dir = std::env::temp_dir().join(format!(
            "codex-monitor-thread-search-status-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let store = ThreadSearchStore::open(thread_search_db_path(&dir)).expect("open store");
        store
            .upsert_document(&ThreadSearchDocument {
                workspace_id: "ws-1".to_string(),
                workspace_name: "coChat".to_string(),
                workspace_path: "/tmp/coChat".to_string(),
                thread_id: "thread-status".to_string(),
                title: "索引状态".to_string(),
                content: "只统计标题和输入输出正文".to_string(),
                updated_at: 1_700_000_000_003,
                source: "test".to_string(),
            })
            .expect("index document");
        drop(store);

        let status = get_thread_search_index_status(&dir).expect("status");
        assert!(status.exists);
        assert!(status.total_bytes > 0);
        assert_eq!(status.indexed_threads, 1);
        assert_eq!(status.indexed_workspaces, 1);
        assert_eq!(status.fts_rows, 1);
        assert!(status.content_bytes > 0);
        assert_eq!(status.source_counts[0].source, "test");
        assert_eq!(status.source_counts[0].count, 1);

        let cleared = clear_thread_search_index(&dir).expect("clear");
        assert!(!cleared.exists);
        assert_eq!(cleared.total_bytes, 0);

        let _ = std::fs::remove_dir(dir);
    }
}
