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
const HASH_EMBEDDING_MODEL_ID: &str = "codex-monitor-hash-embedding-v2";
const LOCAL_NGRAM_EMBEDDING_MODEL_ID: &str = "codex-monitor-local-ngram-v1";
const PENDING_REVIEW_CATEGORY: &str = "pending-review";
const APPROVED_REVIEW_CATEGORY: &str = "approved";
const MIN_SEMANTIC_ONLY_SCORE: f64 = 0.78;
const VECTOR_TABLE_SQL: &str =
    "CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[64]);";

static SQLITE_VEC_INIT: Once = Once::new();

trait EmbeddingProvider {
    fn model_id(&self) -> &'static str;
    fn dimension(&self) -> usize;
    fn embedding_blob(&self, value: &str) -> Vec<u8>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalEmbeddingProvider {
    HashV2,
    LocalNgramV1,
}

impl Default for LocalEmbeddingProvider {
    fn default() -> Self {
        Self::HashV2
    }
}

impl LocalEmbeddingProvider {
    fn from_model_id(value: &str) -> Self {
        match value.trim() {
            LOCAL_NGRAM_EMBEDDING_MODEL_ID | "local-ngram" | "ngram" => Self::LocalNgramV1,
            _ => Self::HashV2,
        }
    }
}

impl EmbeddingProvider for LocalEmbeddingProvider {
    fn model_id(&self) -> &'static str {
        match self {
            Self::HashV2 => HASH_EMBEDDING_MODEL_ID,
            Self::LocalNgramV1 => LOCAL_NGRAM_EMBEDDING_MODEL_ID,
        }
    }

    fn dimension(&self) -> usize {
        EMBEDDING_DIM
    }

    fn embedding_blob(&self, value: &str) -> Vec<u8> {
        match self {
            Self::HashV2 => hash_embedding_blob(value),
            Self::LocalNgramV1 => local_ngram_embedding_blob(value),
        }
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    #[serde(default)]
    pub(crate) confidence: Option<f64>,
    #[serde(default)]
    pub(crate) expires_at: Option<i64>,
    #[serde(default)]
    pub(crate) supersedes_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportMemoryRecord {
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
    #[serde(default)]
    pub(crate) confidence: Option<f64>,
    #[serde(default)]
    pub(crate) expires_at: Option<i64>,
    #[serde(default)]
    pub(crate) supersedes_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportMemoriesInput {
    #[serde(default)]
    pub(crate) memories: Vec<ImportMemoryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportMemoriesResult {
    pub(crate) imported: u64,
    pub(crate) skipped: u64,
    pub(crate) rebuilt_indexes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryEmbeddingModel {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) dim: usize,
    pub(crate) default: bool,
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
    #[serde(default, alias = "skip_access_log")]
    pub(crate) skip_access_log: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListMemoryInput {
    #[serde(default)]
    pub(crate) limit: Option<u32>,
    #[serde(default)]
    pub(crate) filters: MemoryFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListMemoryEventsInput {
    #[serde(default)]
    pub(crate) limit: Option<u32>,
    #[serde(default)]
    pub(crate) memory_id: Option<String>,
    #[serde(default)]
    pub(crate) run_id: Option<String>,
    #[serde(default)]
    pub(crate) event: Option<String>,
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
    pub(crate) entity_score: f64,
    pub(crate) scope_score: f64,
    pub(crate) temporal_score: f64,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEntity {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) normalized_name: String,
    pub(crate) kind: Option<String>,
    pub(crate) memory_count: u64,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryDebugStatus {
    #[serde(default, alias = "db_path")]
    pub(crate) db_path: String,
    #[serde(default = "default_vector_backend", alias = "vector_backend")]
    pub(crate) vector_backend: String,
    #[serde(default, alias = "vector_available")]
    pub(crate) vector_available: bool,
    #[serde(default = "default_embedding_model_id", alias = "embedding_model")]
    pub(crate) embedding_model: String,
    #[serde(default = "default_embedding_dim", alias = "embedding_dim")]
    pub(crate) embedding_dim: usize,
    #[serde(default, alias = "memory_count")]
    pub(crate) memory_count: u64,
    #[serde(default, alias = "vector_count")]
    pub(crate) vector_count: u64,
    #[serde(default, alias = "fts_count")]
    pub(crate) fts_count: u64,
    #[serde(default, alias = "recent_accesses")]
    pub(crate) recent_accesses: Vec<LocalMemoryAccessLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMemoryAccessLogEntry {
    pub(crate) id: String,
    pub(crate) memory_id: Option<String>,
    pub(crate) query: Option<String>,
    pub(crate) event: String,
    pub(crate) status: String,
    pub(crate) result_count: Option<u64>,
    pub(crate) score: Option<f64>,
    pub(crate) thread_id: Option<String>,
    pub(crate) run_id: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) created_at: i64,
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
    entity_score: f64,
}

fn default_vector_backend() -> String {
    "sqlite-vec".to_string()
}

fn default_embedding_model_id() -> String {
    HASH_EMBEDDING_MODEL_ID.to_string()
}

fn default_embedding_dim() -> usize {
    EMBEDDING_DIM
}

pub(crate) struct LocalMemoryStore {
    db_path: PathBuf,
    conn: Connection,
    vector_available: bool,
    embedding_provider: LocalEmbeddingProvider,
}

impl LocalMemoryStore {
    #[allow(dead_code)]
    pub(crate) fn embedding_model_id() -> &'static str {
        HASH_EMBEDDING_MODEL_ID
    }

    #[allow(dead_code)]
    pub(crate) fn embedding_dim() -> usize {
        EMBEDDING_DIM
    }

    pub(crate) fn embedding_models() -> Vec<LocalMemoryEmbeddingModel> {
        vec![
            LocalMemoryEmbeddingModel {
                id: HASH_EMBEDDING_MODEL_ID.to_string(),
                label: "Hash embedding v2".to_string(),
                dim: EMBEDDING_DIM,
                default: true,
            },
            LocalMemoryEmbeddingModel {
                id: LOCAL_NGRAM_EMBEDDING_MODEL_ID.to_string(),
                label: "Local n-gram embedding".to_string(),
                dim: EMBEDDING_DIM,
                default: false,
            },
        ]
    }

    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        Self::open_with_embedding_model(path, HASH_EMBEDDING_MODEL_ID)
    }

    pub(crate) fn open_with_embedding_model(
        path: impl AsRef<Path>,
        embedding_model: &str,
    ) -> Result<Self, String> {
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
            embedding_provider: LocalEmbeddingProvider::from_model_id(embedding_model),
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
        let filters = input.filters;
        let scope = normalize_optional(input.scope.or(filters.scope.clone()), "global");
        let kind = normalize_optional(input.kind.or(filters.kind.clone()), "task_learnings");
        let metadata = if input.metadata.is_null() {
            json!({})
        } else {
            input.metadata
        };
        let categories = merge_categories(input.categories, filters.categories.clone());
        let content_hash = stable_hash_hex(content);
        let confidence = input.confidence.unwrap_or(0.7).clamp(0.0, 1.0);
        let expires_at = input.expires_at;
        let metadata_raw = serde_json::to_string(&metadata).map_err(|err| err.to_string())?;
        let categories_raw = serde_json::to_string(&categories).map_err(|err| err.to_string())?;
        if let Some(existing) =
            self.find_duplicate_memory(content_hash.as_str(), &scope, &kind, &filters)?
        {
            self.log_access(
                "dedupe",
                Some(&existing.id),
                None,
                Some(1),
                None,
                Some(&filters),
                None,
            );
            return Ok(existing);
        }
        let supersedes_id = clean_optional_string(input.supersedes_id).or_else(|| {
            self.find_supersession_candidate(content, &scope, &kind, &filters)
                .ok()?
        });

        self.conn
            .execute(
                "INSERT INTO memories (
                    id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id, app_id,
                    run_id, kind, content, content_hash, metadata, categories, confidence,
                    created_at, updated_at, expires_at, supersedes_id
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    id,
                    scope,
                    empty_to_none(filters.workspace_id.clone()),
                    empty_to_none(filters.workspace_path.clone()),
                    empty_to_none(filters.thread_id.clone()),
                    empty_to_none(filters.user_id.clone()),
                    empty_to_none(filters.agent_id.clone()),
                    empty_to_none(filters.app_id.clone()),
                    empty_to_none(filters.run_id.clone()),
                    kind,
                    content,
                    content_hash,
                    metadata_raw,
                    categories_raw,
                    confidence,
                    now,
                    now,
                    expires_at,
                    supersedes_id
                ],
            )
            .map_err(|err| err.to_string())?;
        let rowid = self.conn.last_insert_rowid();
        if !is_pending_review_categories(&categories) {
            self.upsert_indexes(rowid, content)?;
        }
        let record = self
            .get_memory_by_rowid_including_inactive(rowid)?
            .map(|row| row.record)
            .ok_or_else(|| "inserted memory was not found".to_string())?;
        if !is_pending_review_categories(&record.categories) {
            self.upsert_entities_for_memory(&record.id, content)?;
        }
        if let Some(supersedes_id) = record.supersedes_id.as_deref() {
            self.mark_superseded(supersedes_id, &record.id)?;
        }
        self.log_access(
            "add",
            Some(&record.id),
            None,
            Some(1),
            None,
            Some(&filters),
            None,
        );
        Ok(record)
    }

    pub(crate) fn import_memories(
        &self,
        input: ImportMemoriesInput,
    ) -> Result<ImportMemoriesResult, String> {
        let mut result = ImportMemoriesResult::default();
        for memory in input.memories {
            let content = memory.content.trim().to_string();
            if content.is_empty() {
                result.skipped += 1;
                continue;
            }
            let add_input = AddMemoryInput {
                content,
                scope: memory.scope,
                kind: memory.kind,
                metadata: if memory.metadata.is_null() {
                    json!({})
                } else {
                    memory.metadata
                },
                categories: merge_categories(memory.categories, vec!["imported".to_string()]),
                filters: memory.filters,
                confidence: memory.confidence,
                expires_at: memory.expires_at,
                supersedes_id: memory.supersedes_id,
            };
            match self.add_memory(add_input) {
                Ok(_) => result.imported += 1,
                Err(_) => result.skipped += 1,
            }
        }
        if result.imported > 0 {
            let _ = self.rebuild_indexes()?;
            result.rebuilt_indexes = true;
        }
        self.log_access(
            "import",
            None,
            None,
            Some(result.imported),
            None,
            None,
            None,
        );
        Ok(result)
    }

    pub(crate) fn list_review_queue(
        &self,
        limit: Option<u32>,
    ) -> Result<Vec<MemoryRecord>, String> {
        self.list_memories(ListMemoryInput {
            limit,
            filters: MemoryFilters {
                categories: vec![PENDING_REVIEW_CATEGORY.to_string()],
                ..MemoryFilters::default()
            },
        })
    }

    pub(crate) fn approve_memory(&self, id: &str) -> Result<Option<MemoryRecord>, String> {
        let Some(row) = self.get_memory_row(id)? else {
            return Ok(None);
        };
        if !is_pending_review_categories(&row.record.categories) {
            return Ok(Some(row.record));
        }
        let now = Utc::now().timestamp();
        let categories = approve_categories(row.record.categories.clone());
        let categories_raw = serde_json::to_string(&categories).map_err(|err| err.to_string())?;
        self.conn
            .execute(
                "UPDATE memories SET categories = ?1, updated_at = ?2 WHERE id = ?3",
                params![categories_raw, now, id],
            )
            .map_err(|err| err.to_string())?;
        self.upsert_indexes(row.rowid, &row.record.content)?;
        self.upsert_entities_for_memory(&row.record.id, &row.record.content)?;
        self.log_access("approve", Some(id), None, Some(1), None, None, None);
        self.get_memory(id)
    }

    pub(crate) fn reject_memory(&self, id: &str) -> Result<bool, String> {
        let Some(row) = self.get_memory_row(id)? else {
            return Ok(false);
        };
        if !is_pending_review_categories(&row.record.categories) {
            return Ok(false);
        }
        self.delete_memory(id)
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
        let record = self
            .get_memory_row(id)
            .map(|row| row.map(|row| row.record))?;
        if record.is_some() {
            self.log_access("get", Some(id), None, Some(1), None, None, None);
        }
        Ok(record)
    }

    pub(crate) fn search_memories(
        &self,
        input: SearchMemoryInput,
    ) -> Result<Vec<MemorySearchResult>, String> {
        let query = input.query.trim();
        if query.is_empty() {
            let results = self
                .list_memories(ListMemoryInput {
                    limit: input.limit,
                    filters: input.filters.clone(),
                })?
                .into_iter()
                .map(|memory| MemorySearchResult {
                    memory,
                    score: 0.0,
                    semantic_score: 0.0,
                    keyword_score: 0.0,
                    entity_score: 0.0,
                    scope_score: 0.0,
                    temporal_score: 0.0,
                    reason: "recent".to_string(),
                })
                .collect::<Vec<_>>();
            if !input.skip_access_log {
                self.log_search_accesses("", &input.filters, &results);
            }
            return Ok(results);
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

        for (rowid, entity_score) in self.entity_candidates(query)? {
            let entry = candidate_scores.entry(rowid).or_default();
            entry.entity_score = entry.entity_score.max(entity_score);
        }

        if candidate_scores.is_empty() {
            for row in self.load_recent_rows(100)? {
                candidate_scores.insert(
                    row.rowid,
                    CandidateScore {
                        semantic_score: 0.0,
                        keyword_score: lexical_overlap_score(query, &row.record.content),
                        entity_score: 0.0,
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
            let lexical_score = lexical_overlap_score(query, &row.record.content);
            if !candidate_is_relevant(&scores, lexical_score) {
                continue;
            }
            let scope_score = scope_score(&row.record, &input.filters);
            let temporal_score = temporal_score(&row.record);
            let score = 0.45 * scores.semantic_score
                + 0.25 * scores.keyword_score
                + 0.15 * scores.entity_score
                + 0.10 * scope_score
                + 0.05 * row.record.confidence
                + temporal_score;
            results.push(MemorySearchResult {
                memory: row.record,
                score,
                semantic_score: scores.semantic_score,
                keyword_score: scores.keyword_score,
                entity_score: scores.entity_score,
                scope_score,
                temporal_score,
                reason: reason_for(
                    scores.semantic_score,
                    scores.keyword_score,
                    scores.entity_score,
                ),
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
        if !input.skip_access_log {
            self.log_search_accesses(query, &input.filters, &results);
        }

        Ok(results)
    }

    pub(crate) fn active_memory_count(&self) -> Result<u64, String> {
        count_active_memories(&self.conn)
    }

    pub(crate) fn log_search_context_access(
        &self,
        query: &str,
        result_count: u64,
        thread_id: Option<&str>,
    ) {
        let filters = MemoryFilters {
            thread_id: thread_id.map(str::to_string),
            ..MemoryFilters::default()
        };
        self.log_access(
            "search_context",
            None,
            Some(query),
            Some(result_count),
            None,
            Some(&filters),
            None,
        );
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
                "UPDATE memories
                 SET content = ?1, content_hash = ?2, updated_at = ?3
                 WHERE id = ?4
                   AND deleted_at IS NULL
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > strftime('%s','now'))",
                params![content, stable_hash_hex(content), now, id],
            )
            .map_err(|err| err.to_string())?;
        if affected == 0 {
            return Ok(None);
        }
        let Some(row) = self.get_memory_row(id)? else {
            return Ok(None);
        };
        if is_pending_review_categories(&row.record.categories) {
            self.delete_indexes(row.rowid)?;
            self.delete_entity_links(&row.record.id)?;
        } else {
            self.upsert_indexes(row.rowid, content)?;
            self.upsert_entities_for_memory(&row.record.id, content)?;
        }
        self.log_access("update", Some(id), None, Some(1), None, None, None);
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
        self.delete_entity_links(id)?;
        self.log_access("delete", Some(id), None, Some(1), None, None, None);
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
        self.conn
            .execute("DELETE FROM memory_entities", [])
            .map_err(|err| err.to_string())?;
        self.conn
            .execute("DELETE FROM entities", [])
            .map_err(|err| err.to_string())?;
        self.log_access("delete_all", None, None, Some(count), None, None, None);
        Ok(count)
    }

    pub(crate) fn list_entities(&self) -> Result<Vec<MemoryEntity>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT e.id, e.name, e.normalized_name, e.kind, COUNT(m.id) AS memory_count,
                    e.created_at, e.updated_at
                 FROM entities e
                 LEFT JOIN memory_entities me ON me.entity_id = e.id
                  LEFT JOIN memories m ON m.id = me.memory_id
                     AND m.deleted_at IS NULL
                     AND m.superseded_by_id IS NULL
                     AND (m.expires_at IS NULL OR m.expires_at > strftime('%s','now'))
                     AND m.categories NOT LIKE '%\"pending-review\"%'
                 GROUP BY e.id, e.name, e.normalized_name, e.kind, e.created_at, e.updated_at
                 ORDER BY memory_count DESC, e.updated_at DESC, e.name ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| {
                let count: i64 = row.get(4)?;
                Ok(MemoryEntity {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    normalized_name: row.get(2)?,
                    kind: row.get(3)?,
                    memory_count: u64::try_from(count).unwrap_or_default(),
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    pub(crate) fn delete_entities(&self) -> Result<u64, String> {
        let count = self
            .conn
            .execute("DELETE FROM entities", [])
            .map_err(|err| err.to_string())? as u64;
        self.conn
            .execute("DELETE FROM memory_entities", [])
            .map_err(|err| err.to_string())?;
        self.log_access("delete_entities", None, None, Some(count), None, None, None);
        Ok(count)
    }

    pub(crate) fn rebuild_indexes(&self) -> Result<LocalMemoryDebugStatus, String> {
        self.conn
            .execute("DELETE FROM memory_fts", [])
            .map_err(|err| err.to_string())?;
        if self.vector_available {
            let _ = self.conn.execute("DELETE FROM memory_vec", []);
        }
        self.conn
            .execute("DELETE FROM memory_entities", [])
            .map_err(|err| err.to_string())?;
        self.conn
            .execute("DELETE FROM entities", [])
            .map_err(|err| err.to_string())?;

        for row in self.load_recent_rows(10_000)? {
            if is_pending_review_categories(&row.record.categories) {
                continue;
            }
            self.upsert_indexes(row.rowid, &row.record.content)?;
            self.upsert_entities_for_memory(&row.record.id, &row.record.content)?;
        }
        self.write_meta("embedding_model", self.embedding_provider.model_id())?;
        self.log_access("rebuild_indexes", None, None, None, None, None, None);
        self.debug_status()
    }

    pub(crate) fn list_events(
        &self,
        input: ListMemoryEventsInput,
    ) -> Result<Vec<LocalMemoryAccessLogEntry>, String> {
        let limit = input.limit.unwrap_or(100).clamp(1, 500);
        let memory_id = clean_optional_string(input.memory_id);
        let run_id = clean_optional_string(input.run_id);
        let event = clean_optional_string(input.event);
        let mut statement = self
            .conn
            .prepare(
                "SELECT id, memory_id, query, event, result_count, score, thread_id, run_id, error, created_at
                 FROM memory_access_log
                 WHERE (?1 IS NULL OR memory_id = ?1)
                   AND (?2 IS NULL OR run_id = ?2)
                   AND (?3 IS NULL OR event = ?3)
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?4",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(
                params![memory_id, run_id, event, limit],
                access_log_entry_from_sql,
            )
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    pub(crate) fn get_event_status(
        &self,
        id: &str,
    ) -> Result<Option<LocalMemoryAccessLogEntry>, String> {
        let id = id.trim();
        if id.is_empty() {
            return Err("event id is empty".to_string());
        }
        self.conn
            .query_row(
                "SELECT id, memory_id, query, event, result_count, score, thread_id, run_id, error, created_at
                 FROM memory_access_log
                 WHERE id = ?1",
                params![id],
                access_log_entry_from_sql,
            )
            .optional()
            .map_err(|err| err.to_string())
    }

    pub(crate) fn debug_status(&self) -> Result<LocalMemoryDebugStatus, String> {
        Ok(LocalMemoryDebugStatus {
            db_path: self.db_path.to_string_lossy().to_string(),
            vector_backend: "sqlite-vec".to_string(),
            vector_available: self.vector_available,
            embedding_model: self.embedding_provider.model_id().to_string(),
            embedding_dim: self.embedding_provider.dimension(),
            memory_count: count_active_memories(&self.conn)?,
            vector_count: if self.vector_available {
                count_table(&self.conn, "memory_vec", "1 = 1")?
            } else {
                0
            },
            fts_count: count_table(&self.conn, "memory_fts", "1 = 1")?,
            recent_accesses: self.recent_accesses(25)?,
        })
    }

    pub(crate) fn index_rebuild_recommended(&self) -> Result<bool, String> {
        if count_active_memories(&self.conn)? == 0 {
            return Ok(false);
        }
        Ok(self
            .read_meta("embedding_model")?
            .is_none_or(|value| value != self.embedding_provider.model_id()))
    }

    fn log_search_accesses(
        &self,
        query: &str,
        filters: &MemoryFilters,
        results: &[MemorySearchResult],
    ) {
        if results.is_empty() {
            self.log_access(
                "search",
                None,
                Some(query),
                Some(0),
                None,
                Some(filters),
                None,
            );
            return;
        }
        let result_count = Some(results.len() as u64);
        for result in results {
            self.log_access(
                "search",
                Some(&result.memory.id),
                Some(query),
                result_count,
                Some(result.score),
                Some(filters),
                None,
            );
        }
    }

    fn log_access(
        &self,
        event: &str,
        memory_id: Option<&str>,
        query: Option<&str>,
        result_count: Option<u64>,
        score: Option<f64>,
        filters: Option<&MemoryFilters>,
        error: Option<&str>,
    ) {
        let now = Utc::now().timestamp();
        let filters = filters.cloned().unwrap_or_default();
        let _ = self.conn.execute(
            "INSERT INTO memory_access_log (
                id, memory_id, query, event, result_count, score, thread_id, run_id, error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                Uuid::new_v4().to_string(),
                memory_id.unwrap_or(""),
                query.map(str::trim).filter(|value| !value.is_empty()),
                event,
                result_count,
                score,
                empty_to_none(filters.thread_id),
                empty_to_none(filters.run_id),
                error.map(str::trim).filter(|value| !value.is_empty()),
                now,
            ],
        );
    }

    fn recent_accesses(&self, limit: u32) -> Result<Vec<LocalMemoryAccessLogEntry>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT id, memory_id, query, event, result_count, score, thread_id, run_id, error, created_at
                 FROM memory_access_log
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?1",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(params![limit.clamp(1, 200)], access_log_entry_from_sql)
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
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
                CREATE INDEX IF NOT EXISTS idx_entities_normalized_name ON entities(normalized_name);
                CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
                CREATE TABLE IF NOT EXISTS memory_access_log (
                  id TEXT PRIMARY KEY,
                  memory_id TEXT,
                  query TEXT,
                  event TEXT NOT NULL,
                  result_count INTEGER,
                  score REAL,
                  thread_id TEXT,
                  run_id TEXT,
                  error TEXT,
                  created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS local_memory_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                );
                ",
            )
            .map_err(|err| err.to_string())?;

        self.ensure_access_log_columns()?;
        self.vector_available = self.conn.execute_batch(VECTOR_TABLE_SQL).is_ok();
        Ok(())
    }

    fn read_meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM local_memory_meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())
    }

    fn write_meta(&self, key: &str, value: &str) -> Result<(), String> {
        let now = Utc::now().timestamp();
        self.conn
            .execute(
                "INSERT INTO local_memory_meta(key, value, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, value, now],
            )
            .map(|_| ())
            .map_err(|err| err.to_string())
    }

    fn ensure_access_log_columns(&self) -> Result<(), String> {
        ensure_column(&self.conn, "memory_access_log", "result_count", "INTEGER")?;
        ensure_column(&self.conn, "memory_access_log", "score", "REAL")?;
        ensure_column(&self.conn, "memory_access_log", "thread_id", "TEXT")?;
        ensure_column(&self.conn, "memory_access_log", "run_id", "TEXT")?;
        ensure_column(&self.conn, "memory_access_log", "error", "TEXT")?;
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
            let embedding = self.embedding_provider.embedding_blob(content);
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

    fn find_duplicate_memory(
        &self,
        content_hash: &str,
        scope: &str,
        kind: &str,
        filters: &MemoryFilters,
    ) -> Result<Option<MemoryRecord>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT rowid, id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id,
                    app_id, run_id, kind, content, metadata, categories, confidence, created_at,
                    updated_at, last_used_at, expires_at, supersedes_id, superseded_by_id
                 FROM memories
                 WHERE deleted_at IS NULL
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > strftime('%s','now'))
                   AND content_hash = ?1
                   AND scope = ?2
                   AND kind = ?3
                 ORDER BY updated_at DESC",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(params![content_hash, scope, kind], memory_row_from_sql)
            .map_err(|err| err.to_string())?;
        for row in rows {
            let row = row.map_err(|err| err.to_string())?;
            if same_optional_string(&row.record.workspace_id, &filters.workspace_id)
                && same_optional_string(&row.record.workspace_path, &filters.workspace_path)
                && same_optional_string(&row.record.thread_id, &filters.thread_id)
                && same_optional_string(&row.record.user_id, &filters.user_id)
                && same_optional_string(&row.record.agent_id, &filters.agent_id)
                && same_optional_string(&row.record.app_id, &filters.app_id)
                && same_optional_string(&row.record.run_id, &filters.run_id)
            {
                return Ok(Some(row.record));
            }
        }
        Ok(None)
    }

    fn find_supersession_candidate(
        &self,
        content: &str,
        scope: &str,
        kind: &str,
        filters: &MemoryFilters,
    ) -> Result<Option<String>, String> {
        if !kind_supports_supersession(kind) {
            return Ok(None);
        }
        let new_subject = subject_key(content);
        let new_entities = extract_entity_names(content);
        let mut best: Option<(String, f64)> = None;
        let now = Utc::now().timestamp();
        let mut statement = self
            .conn
            .prepare(
                "SELECT rowid, id, scope, workspace_id, workspace_path, thread_id, user_id, agent_id,
                    app_id, run_id, kind, content, metadata, categories, confidence, created_at,
                    updated_at, last_used_at, expires_at, supersedes_id, superseded_by_id
                 FROM memories
                 WHERE deleted_at IS NULL
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > ?1)
                   AND scope = ?2
                   AND kind = ?3
                 ORDER BY updated_at DESC
                 LIMIT 100",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(params![now, scope, kind], memory_row_from_sql)
            .map_err(|err| err.to_string())?;
        for row in rows {
            let row = row.map_err(|err| err.to_string())?;
            if !same_memory_namespace(&row.record, filters) {
                continue;
            }
            let subject_match = new_subject
                .as_ref()
                .zip(subject_key(&row.record.content).as_ref())
                .is_some_and(|(left, right)| left == right);
            let entity_score =
                jaccard_score(&new_entities, &extract_entity_names(&row.record.content));
            let lexical_score = lexical_overlap_score(content, &row.record.content);
            let score = if subject_match {
                0.8_f64.max(lexical_score)
            } else {
                (0.65 * lexical_score) + (0.35 * entity_score)
            };
            if score >= 0.58
                && best
                    .as_ref()
                    .is_none_or(|(_, best_score)| score > *best_score)
            {
                best = Some((row.record.id, score));
            }
        }
        Ok(best.map(|(id, _)| id))
    }

    fn mark_superseded(&self, old_id: &str, new_id: &str) -> Result<(), String> {
        if old_id == new_id {
            return Ok(());
        }
        let Some(row) = self.get_memory_row(old_id)? else {
            return Ok(());
        };
        let now = Utc::now().timestamp();
        self.conn
            .execute(
                "UPDATE memories SET superseded_by_id = ?1, updated_at = ?2
                 WHERE id = ?3 AND deleted_at IS NULL AND superseded_by_id IS NULL",
                params![new_id, now, old_id],
            )
            .map_err(|err| err.to_string())?;
        self.delete_indexes(row.rowid)?;
        self.delete_entity_links(old_id)?;
        self.log_access("supersede", Some(old_id), None, Some(1), None, None, None);
        Ok(())
    }

    fn upsert_entities_for_memory(&self, memory_id: &str, content: &str) -> Result<(), String> {
        self.delete_entity_links(memory_id)?;
        let now = Utc::now().timestamp();
        for entity in extract_entities(content) {
            let existing_id = self
                .conn
                .query_row(
                    "SELECT id FROM entities WHERE normalized_name = ?1 LIMIT 1",
                    params![entity.normalized_name],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|err| err.to_string())?;
            let entity_id = if let Some(id) = existing_id {
                self.conn
                    .execute(
                        "UPDATE entities SET name = ?1, kind = COALESCE(kind, ?2), updated_at = ?3 WHERE id = ?4",
                        params![entity.name, entity.kind, now, id],
                    )
                    .map_err(|err| err.to_string())?;
                id
            } else {
                let id = Uuid::new_v4().to_string();
                self.conn
                    .execute(
                        "INSERT INTO entities (id, name, normalized_name, kind, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![id, entity.name, entity.normalized_name, entity.kind, now, now],
                    )
                    .map_err(|err| err.to_string())?;
                id
            };
            self.conn
                .execute(
                    "INSERT OR REPLACE INTO memory_entities (memory_id, entity_id, weight)
                     VALUES (?1, ?2, ?3)",
                    params![memory_id, entity_id, entity.weight],
                )
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn delete_entity_links(&self, memory_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM memory_entities WHERE memory_id = ?1",
                params![memory_id],
            )
            .map(|_| ())
            .map_err(|err| err.to_string())
    }

    fn semantic_candidates(&self, query: &str, limit: u32) -> Result<Vec<(i64, f64)>, String> {
        let embedding = self.embedding_provider.embedding_blob(query);
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
                 WHERE memory_fts MATCH ?1
                   AND m.deleted_at IS NULL
                   AND m.superseded_by_id IS NULL
                   AND (m.expires_at IS NULL OR m.expires_at > strftime('%s','now'))
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

    fn entity_candidates(&self, query: &str) -> Result<Vec<(i64, f64)>, String> {
        let entities = extract_entities(query);
        if entities.is_empty() {
            return Ok(Vec::new());
        }

        let mut scores: HashMap<i64, f64> = HashMap::new();
        let denominator = entities.len().max(1) as f64;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT m.rowid, SUM(me.weight) AS entity_weight
                 FROM entities e
                 JOIN memory_entities me ON me.entity_id = e.id
                 JOIN memories m ON m.id = me.memory_id
                 WHERE e.normalized_name = ?1
                   AND m.deleted_at IS NULL
                   AND m.superseded_by_id IS NULL
                   AND (m.expires_at IS NULL OR m.expires_at > strftime('%s','now'))
                 GROUP BY m.rowid",
            )
            .map_err(|err| err.to_string())?;

        for entity in entities {
            let rows = stmt
                .query_map(params![entity.normalized_name], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
                })
                .map_err(|err| err.to_string())?;
            for row in rows {
                let (rowid, weight) = row.map_err(|err| err.to_string())?;
                let entry = scores.entry(rowid).or_default();
                *entry += weight.max(0.0) / denominator;
            }
        }

        let mut results = scores
            .into_iter()
            .map(|(rowid, score)| (rowid, score.min(1.0)))
            .collect::<Vec<_>>();
        results.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(100);
        Ok(results)
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
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > strftime('%s','now'))
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
                 WHERE id = ?1
                   AND deleted_at IS NULL
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > strftime('%s','now'))",
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
                 WHERE rowid = ?1
                   AND deleted_at IS NULL
                   AND superseded_by_id IS NULL
                   AND (expires_at IS NULL OR expires_at > strftime('%s','now'))",
                params![rowid],
                memory_row_from_sql,
            )
            .optional()
            .map_err(|err| err.to_string())
    }

    fn get_memory_by_rowid_including_inactive(
        &self,
        rowid: i64,
    ) -> Result<Option<MemoryRow>, String> {
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

fn access_log_entry_from_sql(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<LocalMemoryAccessLogEntry> {
    let memory_id: Option<String> = row.get(1)?;
    let result_count: Option<i64> = row.get(4)?;
    Ok(LocalMemoryAccessLogEntry {
        id: row.get(0)?,
        memory_id: memory_id.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }),
        query: row.get(2)?,
        event: row.get(3)?,
        status: if row.get::<_, Option<String>>(8)?.is_some() {
            "failed".to_string()
        } else {
            "completed".to_string()
        },
        result_count: result_count.and_then(|value| u64::try_from(value).ok()),
        score: row.get(5)?,
        thread_id: row.get(6)?,
        run_id: row.get(7)?,
        error: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn count_table(conn: &Connection, table: &str, where_clause: &str) -> Result<u64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {where_clause}");
    conn.query_row(sql.as_str(), [], |row| row.get::<_, u64>(0))
        .map_err(|err| err.to_string())
}

fn count_active_memories(conn: &Connection) -> Result<u64, String> {
    conn.query_row(
        "SELECT COUNT(*)
         FROM memories
         WHERE deleted_at IS NULL
           AND superseded_by_id IS NULL
           AND (expires_at IS NULL OR expires_at > strftime('%s','now'))
           AND categories NOT LIKE '%\"pending-review\"%'",
        [],
        |row| row.get::<_, u64>(0),
    )
    .map_err(|err| err.to_string())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| err.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?;
    for existing in columns {
        if existing
            .map_err(|err| err.to_string())?
            .eq_ignore_ascii_case(column)
        {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn filters_match(memory: &MemoryRecord, filters: &MemoryFilters) -> bool {
    if is_pending_review_categories(&memory.categories)
        && !filter_requests_pending_review(&filters.categories)
    {
        return false;
    }
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

fn filter_requests_pending_review(categories: &[String]) -> bool {
    categories
        .iter()
        .any(|value| value.eq_ignore_ascii_case(PENDING_REVIEW_CATEGORY))
}

fn is_pending_review_categories(categories: &[String]) -> bool {
    categories
        .iter()
        .any(|value| value.eq_ignore_ascii_case(PENDING_REVIEW_CATEGORY))
}

fn approve_categories(categories: Vec<String>) -> Vec<String> {
    merge_categories(
        categories
            .into_iter()
            .filter(|value| !value.eq_ignore_ascii_case(PENDING_REVIEW_CATEGORY))
            .collect(),
        vec![APPROVED_REVIEW_CATEGORY.to_string()],
    )
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
    clean_optional_string(value)
}

fn clean_optional_string(value: Option<String>) -> Option<String> {
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

fn reason_for(semantic_score: f64, keyword_score: f64, entity_score: f64) -> String {
    match (
        semantic_score > 0.0,
        keyword_score > 0.0,
        entity_score > 0.0,
    ) {
        (true, true, true) => "semantic+keyword+entity".to_string(),
        (true, true, false) => "semantic+keyword".to_string(),
        (true, false, true) => "semantic+entity".to_string(),
        (false, true, true) => "keyword+entity".to_string(),
        (true, false, false) => "semantic".to_string(),
        (false, true, false) => "keyword".to_string(),
        (false, false, true) => "entity".to_string(),
        (false, false, false) => "fallback".to_string(),
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
    let tokens = tokenize_terms(query)
        .into_iter()
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

fn candidate_is_relevant(scores: &CandidateScore, lexical_score: f64) -> bool {
    scores.keyword_score > 0.0
        || scores.entity_score > 0.0
        || (scores.semantic_score >= MIN_SEMANTIC_ONLY_SCORE && lexical_score > 0.0)
}

fn jaccard_score(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = left.intersection(right).count() as f64;
    let union = left.union(right).count() as f64;
    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn extract_entity_names(content: &str) -> HashSet<String> {
    extract_entities(content)
        .into_iter()
        .map(|entity| entity.normalized_name)
        .collect()
}

fn kind_supports_supersession(kind: &str) -> bool {
    matches!(
        kind,
        "user_preferences"
            | "coding_conventions"
            | "architecture_decisions"
            | "tooling_setup"
            | "bug_fixes"
            | "environment_state"
    )
}

fn subject_key(content: &str) -> Option<String> {
    let normalized = normalize_for_subject(content);
    let separators = [" should ", " uses ", " use ", " is ", " = ", ": "];
    for separator in separators {
        if let Some((left, _)) = normalized.split_once(separator) {
            let key = left
                .trim()
                .trim_start_matches("user instruction or durable project fact")
                .trim_start_matches("assistant result or durable task learning")
                .trim_start_matches("user asked")
                .trim_matches(|ch: char| ch == ':' || ch.is_whitespace())
                .to_string();
            if key.chars().count() >= 8 {
                return Some(key);
            }
        }
    }
    None
}

fn normalize_for_subject(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn token_set(value: &str) -> HashSet<String> {
    tokenize_terms(value).into_iter().collect()
}

fn tokenize_terms(value: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    for ch in value.chars() {
        if is_memory_token_char(ch) {
            current.push(ch);
        } else {
            push_memory_token_terms(&mut terms, &current);
            current.clear();
        }
    }
    push_memory_token_terms(&mut terms, &current);
    dedupe_terms(terms)
}

fn is_memory_token_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '-'
}

fn push_memory_token_terms(terms: &mut Vec<String>, token: &str) {
    let normalized = token.trim().to_ascii_lowercase();
    if normalized.chars().count() < 2 {
        return;
    }
    terms.push(normalized.clone());
    if normalized.chars().any(is_cjk_char) {
        for ngram in char_ngrams(&normalized, 2)
            .into_iter()
            .chain(char_ngrams(&normalized, 3))
        {
            if ngram.chars().count() >= 2 {
                terms.push(ngram);
            }
        }
    }
}

fn is_cjk_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
    )
}

fn dedupe_terms(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect()
}

fn same_memory_namespace(memory: &MemoryRecord, filters: &MemoryFilters) -> bool {
    same_optional_string(&memory.workspace_id, &filters.workspace_id)
        && same_optional_string(&memory.workspace_path, &filters.workspace_path)
        && same_optional_string(&memory.thread_id, &filters.thread_id)
        && same_optional_string(&memory.user_id, &filters.user_id)
        && same_optional_string(&memory.agent_id, &filters.agent_id)
        && same_optional_string(&memory.app_id, &filters.app_id)
        && same_optional_string(&memory.run_id, &filters.run_id)
}

fn hash_embedding_blob(value: &str) -> Vec<u8> {
    let mut vector = [0.0_f32; EMBEDDING_DIM];
    for token in token_set(value) {
        add_hashed_feature(&mut vector, &token, 1.0);
        for ngram in char_ngrams(&token, 3) {
            add_hashed_feature(&mut vector, &ngram, 0.35);
        }
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

fn local_ngram_embedding_blob(value: &str) -> Vec<u8> {
    let mut vector = [0.0_f32; EMBEDDING_DIM];
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    for token in token_set(&normalized) {
        add_hashed_feature(&mut vector, &format!("tok:{token}"), 0.65);
        for ngram in char_ngrams(&format!("^{token}$"), 2) {
            add_hashed_feature(&mut vector, &format!("c2:{ngram}"), 0.45);
        }
        for ngram in char_ngrams(&format!("^{token}$"), 3) {
            add_hashed_feature(&mut vector, &format!("c3:{ngram}"), 0.7);
        }
    }
    for ngram in word_ngrams(&normalized, 2) {
        add_hashed_feature(&mut vector, &format!("w2:{ngram}"), 1.1);
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

fn add_hashed_feature(vector: &mut [f32; EMBEDDING_DIM], feature: &str, weight: f32) {
    let hash = fnv1a64(feature.as_bytes());
    let index = (hash as usize) % EMBEDDING_DIM;
    let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
    vector[index] += sign * weight;
}

fn char_ngrams(value: &str, n: usize) -> Vec<String> {
    let chars = value.chars().collect::<Vec<_>>();
    if chars.len() < n {
        return Vec::new();
    }
    chars
        .windows(n)
        .map(|window| window.iter().collect::<String>())
        .collect()
}

fn word_ngrams(value: &str, n: usize) -> Vec<String> {
    let mut tokens = token_set(value).into_iter().collect::<Vec<_>>();
    tokens.sort();
    if tokens.len() < n {
        return Vec::new();
    }
    tokens.windows(n).map(|window| window.join(" ")).collect()
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

fn same_optional_string(left: &Option<String>, right: &Option<String>) -> bool {
    let left = left
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let right = right
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match (left, right) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        (None, None) => true,
        _ => false,
    }
}

#[derive(Debug, Clone)]
struct ExtractedEntity {
    name: String,
    normalized_name: String,
    kind: Option<String>,
    weight: f64,
}

fn extract_entities(content: &str) -> Vec<ExtractedEntity> {
    let mut seen = HashSet::new();
    let mut entities = Vec::new();
    for token in content
        .split(|ch: char| {
            !(ch.is_ascii_alphanumeric()
                || ch == '_'
                || ch == '-'
                || ch == '.'
                || ch == '/'
                || ch == '\\'
                || ch == ':')
        })
        .map(str::trim)
        .filter(|value| value.len() >= 3)
        .take(64)
    {
        let normalized = token
            .trim_matches(|ch: char| ch == '.' || ch == ',' || ch == ':' || ch == ';')
            .to_ascii_lowercase();
        if normalized.len() < 3 || !seen.insert(normalized.clone()) {
            continue;
        }
        let kind = if token.contains('/') || token.contains('\\') {
            Some("path".to_string())
        } else if token.contains('.') {
            Some("file_or_symbol".to_string())
        } else if token.chars().any(|ch| ch.is_ascii_uppercase()) {
            Some("symbol".to_string())
        } else {
            Some("term".to_string())
        };
        entities.push(ExtractedEntity {
            name: token.to_string(),
            normalized_name: normalized,
            kind,
            weight: 1.0,
        });
    }
    entities
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
                ..AddMemoryInput::default()
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
                skip_access_log: false,
            })
            .expect("search");
        assert_eq!(results.len(), 1);
        assert!(results[0].memory.content.contains("tauri:dev:win"));
        let debug = store.debug_status().expect("debug status");
        assert_eq!(debug.memory_count, 1);
        assert!(debug
            .recent_accesses
            .iter()
            .any(|entry| entry.event == "search"
                && entry.query.as_deref() == Some("Windows tauri dev command")
                && entry.result_count == Some(1)));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn memory_store_dedupes_and_indexes_entities() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-entities-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let input = AddMemoryInput {
            content: "Use src-tauri/src/shared/local_memory_core.rs for LocalMemoryStore."
                .to_string(),
            scope: Some("workspace".to_string()),
            kind: Some("architecture_decisions".to_string()),
            metadata: json!({}),
            categories: vec![],
            filters: MemoryFilters {
                workspace_id: Some("ws-1".to_string()),
                ..MemoryFilters::default()
            },
            ..AddMemoryInput::default()
        };
        let first = store.add_memory(input.clone()).expect("add memory");
        let second = store.add_memory(input).expect("dedupe memory");

        assert_eq!(first.id, second.id);
        assert_eq!(store.debug_status().expect("debug").memory_count, 1);

        let entities = store.list_entities().expect("list entities");
        assert!(entities
            .iter()
            .any(|entity| entity.normalized_name.contains("local_memory_core.rs")));

        let rebuilt = store.rebuild_indexes().expect("rebuild indexes");
        assert_eq!(rebuilt.memory_count, 1);
        assert!(store.delete_entities().expect("delete entities") > 0);
        assert!(store.list_entities().expect("list entities").is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn memory_search_uses_entity_score() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-entity-search-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content:
                    "LocalMemoryStore owns src-tauri/src/shared/local_memory_core.rs indexing."
                        .to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("architecture_decisions".to_string()),
                metadata: json!({}),
                categories: vec![],
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
                ..AddMemoryInput::default()
            })
            .expect("add entity memory");

        let results = store
            .search_memories(SearchMemoryInput {
                query: "LocalMemoryStore".to_string(),
                limit: Some(5),
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
                skip_access_log: false,
            })
            .expect("search");

        assert_eq!(results.len(), 1);
        assert!(results[0].entity_score > 0.0);
        assert!(results[0].reason.contains("entity"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn memory_search_handles_chinese_without_unrelated_recall() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-chinese-search-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "用户偏好：以后默认用中文回答，并先给结论。".to_string(),
                scope: Some("user".to_string()),
                kind: Some("user_preferences".to_string()),
                ..AddMemoryInput::default()
            })
            .expect("add chinese memory");

        let matches = store
            .search_memories(SearchMemoryInput {
                query: "默认用中文回答".to_string(),
                limit: Some(5),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search chinese memory");
        assert_eq!(matches.len(), 1);
        assert!(matches[0].memory.content.contains("默认用中文回答"));

        let unrelated = store
            .search_memories(SearchMemoryInput {
                query: "unrelated database schema migration".to_string(),
                limit: Some(5),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search unrelated memory");
        assert!(unrelated.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn memory_search_filters_zero_overlap_fallback_candidates() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-zero-overlap-search-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "Use npm run tauri:dev for the local desktop app.".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("tooling_setup".to_string()),
                ..AddMemoryInput::default()
            })
            .expect("add memory");

        let unrelated = store
            .search_memories(SearchMemoryInput {
                query: "kubernetes ingress certificate rotation".to_string(),
                limit: Some(5),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search unrelated memory");
        assert!(unrelated.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn memory_events_can_be_listed_and_read() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-events-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let memory = store
            .add_memory(AddMemoryInput {
                content: "Remember memory events are backed by access logs.".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("architecture_decisions".to_string()),
                metadata: json!({}),
                categories: vec![],
                filters: MemoryFilters {
                    run_id: Some("run-1".to_string()),
                    ..MemoryFilters::default()
                },
                ..AddMemoryInput::default()
            })
            .expect("add memory");

        let events = store
            .list_events(ListMemoryEventsInput {
                limit: Some(10),
                memory_id: Some(memory.id.clone()),
                ..ListMemoryEventsInput::default()
            })
            .expect("list events");
        assert!(!events.is_empty());
        assert_eq!(events[0].status, "completed");

        let event = store
            .get_event_status(&events[0].id)
            .expect("get event")
            .expect("event");
        assert_eq!(event.id, events[0].id);
        assert_eq!(event.status, "completed");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn pending_review_memories_require_approval_before_retrieval() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-review-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let pending = store
            .add_memory(AddMemoryInput {
                content: "Auto captured fact should wait for review.".to_string(),
                scope: Some("thread".to_string()),
                kind: Some("session_state".to_string()),
                categories: vec![PENDING_REVIEW_CATEGORY.to_string()],
                ..AddMemoryInput::default()
            })
            .expect("add pending memory");
        assert_eq!(store.active_memory_count().expect("active count"), 0);

        assert!(store
            .list_memories(ListMemoryInput {
                limit: Some(10),
                filters: MemoryFilters::default(),
            })
            .expect("list")
            .is_empty());
        assert!(store
            .search_memories(SearchMemoryInput {
                query: "captured fact".to_string(),
                limit: Some(10),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search")
            .is_empty());

        let review_queue = store.list_review_queue(Some(10)).expect("review queue");
        assert_eq!(review_queue.len(), 1);
        assert_eq!(review_queue[0].id, pending.id);

        store
            .update_memory(
                &pending.id,
                "Updated auto captured fact still waits for review.",
            )
            .expect("update pending memory")
            .expect("pending memory");
        assert_eq!(store.debug_status().expect("debug").fts_count, 0);

        let approved = store
            .approve_memory(&pending.id)
            .expect("approve")
            .expect("approved memory");
        assert!(!approved
            .categories
            .contains(&PENDING_REVIEW_CATEGORY.to_string()));
        assert!(approved
            .categories
            .contains(&APPROVED_REVIEW_CATEGORY.to_string()));
        assert_eq!(store.active_memory_count().expect("active count"), 1);

        let results = store
            .search_memories(SearchMemoryInput {
                query: "captured fact".to_string(),
                limit: Some(10),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search approved");
        assert_eq!(results.len(), 1);
        assert_eq!(
            store
                .list_review_queue(Some(10))
                .expect("review queue")
                .len(),
            0
        );

        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejecting_pending_review_memory_tombstones_it() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-review-reject-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let pending = store
            .add_memory(AddMemoryInput {
                content: "Rejected auto capture should disappear.".to_string(),
                scope: Some("thread".to_string()),
                kind: Some("session_state".to_string()),
                categories: vec![PENDING_REVIEW_CATEGORY.to_string()],
                ..AddMemoryInput::default()
            })
            .expect("add pending memory");

        assert!(store.reject_memory(&pending.id).expect("reject"));
        assert!(store
            .list_review_queue(Some(10))
            .expect("review queue")
            .is_empty());
        assert!(store.get_memory(&pending.id).expect("get").is_none());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn embedding_model_change_recommends_index_rebuild_until_rebuilt() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-embedding-model-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "Embedding model metadata tracks rebuild requirements.".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("architecture_decisions".to_string()),
                ..AddMemoryInput::default()
            })
            .expect("add memory");

        assert!(store
            .index_rebuild_recommended()
            .expect("rebuild recommended before first rebuild"));
        store.rebuild_indexes().expect("rebuild hash indexes");
        assert!(!store
            .index_rebuild_recommended()
            .expect("no rebuild after current model rebuild"));

        drop(store);
        let ngram_store =
            LocalMemoryStore::open_with_embedding_model(&path, LOCAL_NGRAM_EMBEDDING_MODEL_ID)
                .expect("open ngram store");
        assert!(ngram_store
            .index_rebuild_recommended()
            .expect("rebuild recommended after model switch"));
        ngram_store
            .rebuild_indexes()
            .expect("rebuild ngram indexes");
        assert!(!ngram_store
            .index_rebuild_recommended()
            .expect("no rebuild after ngram rebuild"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn expired_memories_are_hidden_from_list_and_search() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-expiry-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "Expired terminal setup should not be returned.".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("environment_state".to_string()),
                expires_at: Some(Utc::now().timestamp() - 60),
                ..AddMemoryInput::default()
            })
            .expect("add expired memory");

        assert!(store
            .list_memories(ListMemoryInput {
                limit: Some(10),
                filters: MemoryFilters::default(),
            })
            .expect("list")
            .is_empty());
        assert!(store
            .search_memories(SearchMemoryInput {
                query: "terminal setup".to_string(),
                limit: Some(10),
                filters: MemoryFilters::default(),
                skip_access_log: false,
            })
            .expect("search")
            .is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn newer_memory_supersedes_same_subject_memory() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-supersede-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let old = store
            .add_memory(AddMemoryInput {
                content: "Default terminal shell is powershell.exe".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("tooling_setup".to_string()),
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
                ..AddMemoryInput::default()
            })
            .expect("add old memory");
        let new = store
            .add_memory(AddMemoryInput {
                content: "Default terminal shell is pwsh.exe".to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("tooling_setup".to_string()),
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
                ..AddMemoryInput::default()
            })
            .expect("add new memory");

        assert_eq!(new.supersedes_id.as_deref(), Some(old.id.as_str()));
        let listed = store
            .list_memories(ListMemoryInput {
                limit: Some(10),
                filters: MemoryFilters {
                    workspace_id: Some("ws-1".to_string()),
                    ..MemoryFilters::default()
                },
            })
            .expect("list");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].content.contains("pwsh.exe"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn imports_exported_memory_records() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-import-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        let result = store
            .import_memories(ImportMemoriesInput {
                memories: vec![ImportMemoryRecord {
                    content: "Imported memory payloads rebuild indexes.".to_string(),
                    scope: Some("workspace".to_string()),
                    kind: Some("tooling_setup".to_string()),
                    categories: vec!["backup".to_string()],
                    ..ImportMemoryRecord::default()
                }],
            })
            .expect("import");

        assert_eq!(result.imported, 1);
        assert!(result.rebuilt_indexes);
        assert_eq!(store.debug_status().expect("debug").memory_count, 1);

        let _ = fs::remove_file(path);
    }
}
