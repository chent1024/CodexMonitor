use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Once;
use uuid::Uuid;

const EMBEDDING_DIM: usize = 64;
const VECTOR_TABLE_SQL: &str =
    "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[64]);";

static SQLITE_VEC_INIT: Once = Once::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryFilters {
    pub(crate) user_id: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) app_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) workspace_id: Option<String>,
    pub(crate) workspace_path: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) scope: Option<String>,
    pub(crate) kind: Option<String>,
    #[serde(default)]
    pub(crate) categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddMemoryInput {
    #[serde(default)]
    pub(crate) content: String,
    #[serde(default)]
    pub(crate) scope: Option<String>,
    #[serde(default)]
    pub(crate) kind: Option<String>,
    #[serde(default)]
    pub(crate) metadata: Value,
    #[serde(default)]
    pub(crate) categories: Vec<String>,
    #[serde(default)]
    pub(crate) filters: MemoryFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchMemoryInput {
    #[serde(default)]
    pub(crate) query: String,
    #[serde(default)]
    pub(crate) limit: Option<u32>,
    #[serde(default)]
    pub(crate) filters: MemoryFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListMemoryInput {
    #[serde(default)]
    pub(crate) limit: Option<u32>,
    #[serde(default)]
    pub(crate) filters: MemoryFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryRecord {
    pub(crate) id: String,
    pub(crate) scope: String,
    pub(crate) workspace_id: Option<String>,
    pub(crate) workspace_path: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) agent_id: Option<String>,
    pub(crate) app_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) kind: String,
    pub(crate) content: String,
    pub(crate) metadata: Value,
    pub(crate) categories: Vec<String>,
    pub(crate) confidence: f64,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    pub(crate) last_used_at: Option<i64>,
    pub(crate) expires_at: Option<i64>,
    pub(crate) supersedes_id: Option<String>,
    pub(crate) superseded_by_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemorySearchResult {
    #[serde(flatten)]
    pub(crate) memory: MemoryRecord,
    pub(crate) score: f64,
    pub(crate) semantic_score: f64,
    pub(crate) keyword_score: f64,
    pub(crate) scope_score: f64,
    pub(crate) temporal_score: f64,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryDebugStatus {
    pub(crate) db_path: String,
    pub(crate) vector_backend: String,
    pub(crate) vector_available: bool,
    pub(crate) embedding_dim: usize,
    pub(crate) memory_count: u64,
    pub(crate) vector_count: u64,
    pub(crate) fts_count: u64,
}

#[derive(Debug, Clone)]
struct MemoryRow {
    rowid: i64,
    record: MemoryRecord,
}

#[derive(Debug, Clone, Default)]
struct CandidateScore {
    semantic_score: f64,
    keyword_score: f64,
}

pub(crate) struct LocalMemoryStore {
    db_path: PathBuf,
    conn: Connection,
    vector_available: bool,
}

impl LocalMemoryStore {
    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        register_sqlite_vec();
        let db_path = path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|err| err.to_string())?;
        let mut store = Self {
            db_path,
            conn,
            vector_available: false,
        };
        store.migrate()?;
        Ok(store)
    }

    pub(crate) fn add_memory(&self, input: AddMemoryInput) -> Result<MemoryRecord, String> {
        let content = input.content.trim();
        if content.is_empty() {
            return Err("memory content is empty".to_string());
        }
        let now = Utc::now().timestamp();
        let id = Uuid::new_v4().to_string();
        let scope = normalize_optional(input.scope.or(input.filters.scope), "global");
        let kind = normalize_optional(input.kind.or(input.filters.kind), "task_learnings");
        let metadata = if input.metadata.is_null() {
            json!({})
        } else {
            input.metadata
        };
        let categories = merge_categories(input.categories, input.filters.categories);
        let content_hash = stable_hash_hex(content);
        let metadata_raw = serde_json::to_string(&metadata).map_err(|err| err.to_string())?;
        let categories_raw = serde_json::to_string(&categories).map_err(|err| err.to_string())?;

        self.conn
            .execute(
                "INSERT INTO memories (
                    id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id, app_id,
                    run_id, kind, content, content_hash, metadata, categories, confidence,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    id,
                    scope,
                    empty_to_none(input.filters.workspace_id),
                    empty_to_none(input.filters.workspace_path),
                    empty_to_none(input.filters.thread_id),
                    empty_to_none(input.filters.user_id),
                    empty_to_none(input.filters.agent_id),
                    empty_to_none(input.filters.app_id),
                    empty_to_none(input.filters.run_id),
                    kind,
                    content,
                    content_hash,
                    metadata_raw,
                    categories_raw,
                    0.7_f64,
                    now,
                    now
                ],
            )
            .map_err(|err| err.to_string())?;
        let rowid = self.conn.last_insert_rowid();
        self.upsert_indexes(rowid, content)?;
        self.get_memory_by_rowid(rowid)?
            .map(|row| row.record)
            .ok_or_else(|| "inserted memory was not found".to_string())
    }

    pub(crate) fn list_memories(
        &self,
        input: ListMemoryInput,
    ) -> Result<Vec<MemoryRecord>, String> {
        let limit = input.limit.unwrap_or(100).clamp(1, 500) as usize;
        Ok(self
            .load_recent_rows(1000)?
            .into_iter()
            .filter(|row| filters_match(&row.record, &input.filters))
            .take(limit)
            .map(|row| row.record)
            .collect())
    }

    pub(crate) fn get_memory(&self, id: &str) -> Result<Option<MemoryRecord>, String> {
        self.get_memory_row(id).map(|row| row.map(|row| row.record))
    }

    pub(crate) fn search_memories(
        &self,
        input: SearchMemoryInput,
    ) -> Result<Vec<MemorySearchResult>, String> {
        let query = input.query.trim();
        if query.is_empty() {
            return Ok(self
                .list_memories(ListMemoryInput {
                    limit: input.limit,
                    filters: input.filters,
                })?
                .into_iter()
                .map(|memory| MemorySearchResult {
                    memory,
                    score: 0.0,
                    semantic_score: 0.0,
                    keyword_score: 0.0,
                    scope_score: 0.0,
                    temporal_score: 0.0,
                    reason: "recent".to_string(),
                })
                .collect());
        }

        let limit = input.limit.unwrap_or(10).clamp(1, 100) as usize;
        let mut candidate_scores: HashMap<i64, CandidateScore> = HashMap::new();

        if self.vector_available {
            for (rank, (rowid, distance)) in self
                .semantic_candidates(query, 100)?
                .into_iter()
                .enumerate()
            {
                let semantic_score = 1.0 / (1.0 + distance.max(0.0));
                let entry = candidate_scores.entry(rowid).or_default();
                entry.semantic_score = entry.semantic_score.max(semantic_score + rank_boost(rank));
            }
        }

        for (rank, rowid) in self.keyword_candidates(query, 100)?.into_iter().enumerate() {
            let entry = candidate_scores.entry(rowid).or_default();
            entry.keyword_score = entry.keyword_score.max(1.0 + rank_boost(rank));
        }

        if candidate_scores.is_empty() {
            for row in self.load_recent_rows(100)? {
                candidate_scores.insert(
                    row.rowid,
                    CandidateScore {
                        semantic_score: 0.0,
                        keyword_score: lexical_overlap_score(query, &row.record.content),
                    },
                );
            }
        }

        let mut results = Vec::new();
        for (rowid, scores) in candidate_scores {
            let Some(row) = self.get_memory_by_rowid(rowid)? else {
                continue;
            };
            if !filters_match(&row.record, &input.filters) {
                continue;
            }
            let scope_score = scope_score(&row.record, &input.filters);
            let temporal_score = temporal_score(&row.record);
            let score = 0.45 * scores.semantic_score
                + 0.25 * scores.keyword_score
                + 0.10 * scope_score
                + 0.05 * row.record.confidence
                + temporal_score;
            results.push(MemorySearchResult {
                memory: row.record,
                score,
                semantic_score: scores.semantic_score,
                keyword_score: scores.keyword_score,
                scope_score,
                temporal_score,
                reason: reason_for(scores.semantic_score, scores.keyword_score),
            });
        }

        results.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);

        let now = Utc::now().timestamp();
        for item in &results {
            let _ = self.conn.execute(
                "UPDATE memories SET last_used_at = ?1 WHERE id = ?2",
                params![now, item.memory.id],
            );
        }

        Ok(results)
    }

    pub(crate) fn update_memory(
        &self,
        id: &str,
        content: &str,
    ) -> Result<Option<MemoryRecord>, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("memory content is empty".to_string());
        }
        let now = Utc::now().timestamp();
        let affected = self
            .conn
            .execute(
                "UPDATE memories SET content = ?1, content_hash = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
                params![content, stable_hash_hex(content), now, id],
            )
            .map_err(|err| err.to_string())?;
        if affected == 0 {
            return Ok(None);
        }
        let Some(row) = self.get_memory_row(id)? else {
            return Ok(None);
        };
        self.upsert_indexes(row.rowid, content)?;
        Ok(Some(row.record))
    }

    pub(crate) fn delete_memory(&self, id: &str) -> Result<bool, String> {
        let Some(row) = self.get_memory_row(id)? else {
            return Ok(false);
        };
        let now = Utc::now().timestamp();
        self.conn
            .execute(
                "UPDATE memories SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|err| err.to_string())?;
        self.delete_indexes(row.rowid)?;
        Ok(true)
    }

    pub(crate) fn delete_all_memories(&self) -> Result<u64, String> {
        let now = Utc::now().timestamp();
        let count = self
            .conn
            .execute(
                "UPDATE memories SET deleted_at = ?1, updated_at = ?1 WHERE deleted_at IS NULL",
                params![now],
            )
            .map_err(|err| err.to_string())? as u64;
        self.conn
            .execute("DELETE FROM memory_fts", [])
            .map_err(|err| err.to_string())?;
        if self.vector_available {
            let _ = self.conn.execute("DELETE FROM memory_vec", []);
        }
        Ok(count)
    }

    pub(crate) fn debug_status(&self) -> Result<LocalMemoryDebugStatus, String> {
        Ok(LocalMemoryDebugStatus {
            db_path: self.db_path.to_string_lossy().to_string(),
            vector_backend: "sqlite-vec".to_string(),
            vector_available: self.vector_available,
            embedding_dim: EMBEDDING_DIM,
            memory_count: count_table(&self.conn, "memories", "deleted_at IS NULL")?,
            vector_count: if self.vector_available {
                count_table(&self.conn, "memory_vec", "1 = 1")?
            } else {
                0
            },
            fts_count: count_table(&self.conn, "memory_fts", "1 = 1")?,
        })
    }

    fn migrate(&mut self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS memories (
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
                CREATE INDEX IF NOT EXISTS idx_memories_active_updated ON memories(deleted_at, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, workspace_id, workspace_path);
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(memory_rowid UNINDEXED, content);
                CREATE TABLE IF NOT EXISTS entities (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  normalized_name TEXT NOT NULL,
                  kind TEXT,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_entities (
                  memory_id TEXT NOT NULL,
                  entity_id TEXT NOT NULL,
                  weight REAL NOT NULL DEFAULT 1.0,
                  PRIMARY KEY (memory_id, entity_id)
                );
                CREATE TABLE IF NOT EXISTS memory_access_log (
                  id TEXT PRIMARY KEY,
                  memory_id TEXT NOT NULL,
                  query TEXT,
                  event TEXT NOT NULL,
                  created_at INTEGER NOT NULL
                );
                ",
            )
            .map_err(|err| err.to_string())?;

        self.vector_available = self.conn.execute_batch(VECTOR_TABLE_SQL).is_ok();
        Ok(())
    }

    fn upsert_indexes(&self, rowid: i64, content: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM memory_fts WHERE memory_rowid = ?1",
                params![rowid],
            )
            .map_err(|err| err.to_string())?;
        self.conn
            .execute(
                "INSERT INTO memory_fts(memory_rowid, content) VALUES (?1, ?2)",
                params![rowid, content],
            )
            .map_err(|err| err.to_string())?;
        if self.vector_available {
            let embedding = embedding_blob(content);
            let _ = self
                .conn
                .execute("DELETE FROM memory_vec WHERE rowid = ?1", params![rowid]);
            self.conn
                .execute(
                    "INSERT INTO memory_vec(rowid, embedding) VALUES (?1, ?2)",
                    params![rowid, embedding],
                )
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn delete_indexes(&self, rowid: i64) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM memory_fts WHERE memory_rowid = ?1",
                params![rowid],
            )
            .map_err(|err| err.to_string())?;
        if self.vector_available {
            let _ = self
                .conn
                .execute("DELETE FROM memory_vec WHERE rowid = ?1", params![rowid]);
        }
        Ok(())
    }

    fn semantic_candidates(&self, query: &str, limit: u32) -> Result<Vec<(i64, f64)>, String> {
        let embedding = embedding_blob(query);
        let mut stmt = self
            .conn
            .prepare(
                "SELECT rowid, distance FROM memory_vec WHERE embedding MATCH ?1 AND k = ?2 ORDER BY distance",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![embedding, limit], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn keyword_candidates(&self, query: &str, limit: u32) -> Result<Vec<i64>, String> {
        let Some(fts_query) = fts_query(query) else {
            return Ok(Vec::new());
        };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT m.rowid
                 FROM memory_fts f
                 JOIN memories m ON m.rowid = f.memory_rowid
                 WHERE memory_fts MATCH ?1 AND m.deleted_at IS NULL
                 ORDER BY bm25(memory_fts)
                 LIMIT ?2",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![fts_query, limit], |row| row.get::<_, i64>(0))
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_recent_rows(&self, limit: u32) -> Result<Vec<MemoryRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT rowid, id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id,
                    app_id, run_id, kind, content, metadata, categories, confidence, created_at,
                    updated_at, last_used_at, expires_at, supersedes_id, superseded_by_id
                 FROM memories
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC
                 LIMIT ?1",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![limit], memory_row_from_sql)
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn get_memory_row(&self, id: &str) -> Result<Option<MemoryRow>, String> {
        self.conn
            .query_row(
                "SELECT rowid, id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id,
                    app_id, run_id, kind, content, metadata, categories, confidence, created_at,
                    updated_at, last_used_at, expires_at, supersedes_id, superseded_by_id
                 FROM memories
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                memory_row_from_sql,
            )
            .optional()
            .map_err(|err| err.to_string())
    }

    fn get_memory_by_rowid(&self, rowid: i64) -> Result<Option<MemoryRow>, String> {
        self.conn
            .query_row(
                "SELECT rowid, id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id,
                    app_id, run_id, kind, content, metadata, categories, confidence, created_at,
                    updated_at, last_used_at, expires_at, supersedes_id, superseded_by_id
                 FROM memories
                 WHERE rowid = ?1 AND deleted_at IS NULL",
                params![rowid],
                memory_row_from_sql,
            )
            .optional()
            .map_err(|err| err.to_string())
    }
}

fn register_sqlite_vec() {
    SQLITE_VEC_INIT.call_once(|| unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

fn memory_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryRow> {
    let metadata_raw: String = row.get(12)?;
    let categories_raw: String = row.get(13)?;
    Ok(MemoryRow {
        rowid: row.get(0)?,
        record: MemoryRecord {
            id: row.get(1)?,
            scope: row.get(2)?,
            workspace_id: row.get(3)?,
            workspace_path: row.get(4)?,
            thread_id: row.get(5)?,
            user_id: row.get(6)?,
            agent_id: row.get(7)?,
            app_id: row.get(8)?,
            run_id: row.get(9)?,
            kind: row.get(10)?,
            content: row.get(11)?,
            metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| json!({})),
            categories: serde_json::from_str(&categories_raw).unwrap_or_default(),
            confidence: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
            last_used_at: row.get(17)?,
            expires_at: row.get(18)?,
            supersedes_id: row.get(19)?,
            superseded_by_id: row.get(20)?,
        },
    })
}

fn count_table(conn: &Connection, table: &str, where_clause: &str) -> Result<u64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {where_clause}");
    conn.query_row(sql.as_str(), [], |row| row.get::<_, u64>(0))
        .map_err(|err| err.to_string())
}

fn filters_match(memory: &MemoryRecord, filters: &MemoryFilters) -> bool {
    matches_opt(&memory.user_id, &filters.user_id)
        && matches_opt(&memory.agent_id, &filters.agent_id)
        && matches_opt(&memory.app_id, &filters.app_id)
        && matches_opt(&memory.run_id, &filters.run_id)
        && matches_opt(&memory.workspace_id, &filters.workspace_id)
        && matches_opt(&memory.workspace_path, &filters.workspace_path)
        && matches_opt(&memory.thread_id, &filters.thread_id)
        && matches_str(&memory.scope, &filters.scope)
        && matches_str(&memory.kind, &filters.kind)
        && categories_match(&memory.categories, &filters.categories)
}

fn matches_opt(left: &Option<String>, right: &Option<String>) -> bool {
    let Some(right) = right
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    left.as_deref()
        .is_some_and(|left| left.eq_ignore_ascii_case(right))
}

fn matches_str(left: &str, right: &Option<String>) -> bool {
    let Some(right) = right
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    left.eq_ignore_ascii_case(right)
}

fn categories_match(left: &[String], right: &[String]) -> bool {
    if right.is_empty() {
        return true;
    }
    let existing = left
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    right
        .iter()
        .any(|value| existing.contains(&value.to_ascii_lowercase()))
}

fn normalize_optional(value: Option<String>, fallback: &str) -> String {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn empty_to_none(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn merge_categories(left: Vec<String>, right: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    left.into_iter()
        .chain(right)
        .filter_map(|value| {
            let normalized = value.trim().to_string();
            if normalized.is_empty() || !seen.insert(normalized.to_ascii_lowercase()) {
                None
            } else {
                Some(normalized)
            }
        })
        .collect()
}

fn rank_boost(rank: usize) -> f64 {
    1.0 / (rank as f64 + 2.0)
}

fn reason_for(semantic_score: f64, keyword_score: f64) -> String {
    match (semantic_score > 0.0, keyword_score > 0.0) {
        (true, true) => "semantic+keyword".to_string(),
        (true, false) => "semantic".to_string(),
        (false, true) => "keyword".to_string(),
        (false, false) => "fallback".to_string(),
    }
}

fn scope_score(memory: &MemoryRecord, filters: &MemoryFilters) -> f64 {
    if matches_str(&memory.scope, &filters.scope) {
        return 1.0;
    }
    if filters.workspace_id.is_some() && memory.workspace_id == filters.workspace_id {
        return 0.9;
    }
    if filters.workspace_path.is_some() && memory.workspace_path == filters.workspace_path {
        return 0.9;
    }
    if memory.scope.eq_ignore_ascii_case("global") {
        0.35
    } else {
        0.5
    }
}

fn temporal_score(memory: &MemoryRecord) -> f64 {
    let now = Utc::now().timestamp();
    let age_days = ((now - memory.updated_at).max(0) as f64) / 86_400.0;
    let half_life = match memory.kind.as_str() {
        "session_state" => 3.0,
        "environment_state" => 7.0,
        "task_learnings" => 45.0,
        "bug_fixes" => 90.0,
        "tooling_setup" => 120.0,
        _ => return 0.08,
    };
    0.16 * 2_f64.powf(-age_days / half_life)
}

fn fts_query(query: &str) -> Option<String> {
    let tokens = query
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
        .map(str::trim)
        .filter(|value| value.len() >= 2)
        .take(16)
        .map(|value| format!("\"{}\"", value.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" OR "))
    }
}

fn lexical_overlap_score(query: &str, content: &str) -> f64 {
    let query_tokens = token_set(query);
    if query_tokens.is_empty() {
        return 0.0;
    }
    let content_tokens = token_set(content);
    let hits = query_tokens
        .iter()
        .filter(|token| content_tokens.contains(*token))
        .count();
    hits as f64 / query_tokens.len() as f64
}

fn token_set(value: &str) -> HashSet<String> {
    value
        .split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| token.len() >= 2)
        .collect()
}

fn embedding_blob(value: &str) -> Vec<u8> {
    let mut vector = [0.0_f32; EMBEDDING_DIM];
    for token in token_set(value) {
        let hash = fnv1a64(token.as_bytes());
        let index = (hash as usize) % EMBEDDING_DIM;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[index] += sign;
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for item in &mut vector {
            *item /= norm;
        }
    }
    let mut bytes = Vec::with_capacity(EMBEDDING_DIM * std::mem::size_of::<f32>());
    for item in vector {
        bytes.extend_from_slice(&item.to_le_bytes());
    }
    bytes
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn stable_hash_hex(value: &str) -> String {
    format!("{:016x}", fnv1a64(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_adds_and_searches_keyword_memory() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "Use npm run tauri:dev:win on Windows for CodexMonitor.".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("tooling_setup".to_string()),
                metadata: json!({}),
                categories: vec!["startup".to_string()],
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
            })
            .expect("add memory");
        let results = store
            .search_memories(SearchMemoryInput {
                query: "Windows tauri dev command".to_string(),
                limit: Some(5),
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
            })
            .expect("search");
        assert_eq!(results.len(), 1);
        assert!(results[0].memory.content.contains("tauri:dev:win"));
        let _ = fs::remove_file(path);
    }
}
