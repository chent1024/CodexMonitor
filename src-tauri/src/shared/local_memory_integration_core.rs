use serde_json::json;
use std::collections::HashSet;
use std::path::Path;

use crate::codex::config as codex_config;
use crate::shared::local_memory_core::{
    AddMemoryInput, ListMemoryInput, LocalMemoryStore, MemoryFilters, MemorySearchResult,
    SearchMemoryInput,
};

const MAX_MEMORY_RESULTS: usize = 8;
const MAX_MEMORY_CHARS: usize = 360;
const MAX_CONTEXT_CHARS: usize = 3_200;
const MIN_CAPTURE_CHARS: usize = 8;
const MIN_ASSISTANT_CAPTURE_CHARS: usize = 24;
const MAX_CAPTURE_FACTS: usize = 5;
const MIN_DURABLE_FACT_CHARS: usize = 16;
const PENDING_REVIEW_CATEGORY: &str = "pending-review";

#[derive(Debug, Clone, Default)]
pub(crate) struct LocalMemoryTurnContext {
    pub(crate) text: String,
    pub(crate) retrieved_count: usize,
}

#[derive(Debug, Clone)]
struct CapturePlan {
    content: String,
    scope: String,
    kind: String,
    categories: Vec<String>,
}

trait MemoryFactExtractor {
    fn extract_user_facts(&self, text: &str) -> Vec<String>;
    fn extract_assistant_facts(&self, text: &str) -> Vec<String>;
}

#[derive(Debug, Clone, Copy, Default)]
struct HeuristicFactExtractor;

impl MemoryFactExtractor for HeuristicFactExtractor {
    fn extract_user_facts(&self, text: &str) -> Vec<String> {
        split_candidate_facts(text)
    }

    fn extract_assistant_facts(&self, text: &str) -> Vec<String> {
        split_candidate_facts(text)
            .into_iter()
            .filter(|fact| is_assistant_learning_fact(fact))
            .take(MAX_CAPTURE_FACTS)
            .collect()
    }
}

pub(crate) fn prepare_user_turn(
    text: String,
    workspace_id: &str,
    workspace_path: &str,
    thread_id: &str,
) -> LocalMemoryTurnContext {
    let Some(store) = open_enabled_store() else {
        return LocalMemoryTurnContext {
            text,
            retrieved_count: 0,
        };
    };

    let memories =
        retrieve_relevant_memories(&store, &text, workspace_id, workspace_path, thread_id);
    let Some(context_block) = build_context_block(&memories) else {
        return LocalMemoryTurnContext {
            text,
            retrieved_count: 0,
        };
    };

    LocalMemoryTurnContext {
        text: append_context_block(text, &context_block),
        retrieved_count: memories.len(),
    }
}

pub(crate) fn capture_user_turn(
    original_text: &str,
    workspace_id: &str,
    workspace_path: &str,
    thread_id: &str,
    retrieved_count: usize,
) {
    let plans = plan_capture_facts(original_text);
    if plans.is_empty() {
        return;
    }
    let Some(store) = open_enabled_store() else {
        return;
    };

    for (fact_index, plan) in plans.into_iter().enumerate() {
        let filters = MemoryFilters {
            workspace_id: Some(workspace_id.to_string()),
            workspace_path: Some(workspace_path.to_string()),
            thread_id: if plan.scope == "thread" {
                Some(thread_id.to_string())
            } else {
                None
            },
            scope: Some(plan.scope.clone()),
            kind: Some(plan.kind.clone()),
            ..MemoryFilters::default()
        };

        if has_exact_memory(&store, &plan.content, &filters) {
            continue;
        }

        let _ = store.add_memory(AddMemoryInput {
            content: plan.content,
            scope: Some(plan.scope),
            kind: Some(plan.kind),
            metadata: json!({
                "source": "codex-monitor-auto",
                "capture": "user_prompt",
                "extractor": "heuristic-v1",
                "workspaceId": workspace_id,
                "workspacePath": workspace_path,
                "threadId": thread_id,
                "retrievedCount": retrieved_count,
                "factIndex": fact_index,
            }),
            categories: plan.categories,
            filters,
            ..AddMemoryInput::default()
        });
    }
}

pub(crate) fn capture_assistant_turn(
    assistant_text: &str,
    workspace_id: &str,
    workspace_path: &str,
    thread_id: &str,
    turn_id: &str,
) {
    let plans = plan_assistant_capture_facts(assistant_text);
    if plans.is_empty() {
        return;
    }
    let Some(store) = open_enabled_store() else {
        return;
    };

    for (fact_index, plan) in plans.into_iter().enumerate() {
        let filters = MemoryFilters {
            workspace_id: Some(workspace_id.to_string()),
            workspace_path: if workspace_path.trim().is_empty() {
                None
            } else {
                Some(workspace_path.to_string())
            },
            thread_id: Some(thread_id.to_string()),
            scope: Some(plan.scope.clone()),
            kind: Some(plan.kind.clone()),
            ..MemoryFilters::default()
        };

        if has_exact_memory(&store, &plan.content, &filters) {
            continue;
        }

        let _ = store.add_memory(AddMemoryInput {
            content: plan.content,
            scope: Some(plan.scope),
            kind: Some(plan.kind),
            metadata: json!({
                "source": "codex-monitor-auto",
                "capture": "assistant_output",
                "extractor": "heuristic-v1",
                "workspaceId": workspace_id,
                "workspacePath": workspace_path,
                "threadId": thread_id,
                "turnId": turn_id,
                "factIndex": fact_index,
            }),
            categories: plan.categories,
            filters,
            ..AddMemoryInput::default()
        });
    }
}

pub(crate) fn capture_lifecycle_checkpoint(
    workspace_id: &str,
    workspace_path: &str,
    thread_id: Option<&str>,
    trigger: &str,
) {
    let Some(store) = open_enabled_store() else {
        return;
    };
    let trigger = trigger.trim();
    if trigger.is_empty() {
        return;
    }
    let thread_label = thread_id
        .map(|value| format!(" thread {value}"))
        .unwrap_or_default();
    let timing = if trigger.eq_ignore_ascii_case("session_start") {
        "at"
    } else {
        "before"
    };
    let content = format!(
        "Lifecycle checkpoint {timing} {trigger}: workspace {workspace_path}{thread_label} should preserve durable user instructions, unresolved goals, and current task state."
    );
    let filters = MemoryFilters {
        workspace_id: Some(workspace_id.to_string()),
        workspace_path: if workspace_path.trim().is_empty() {
            None
        } else {
            Some(workspace_path.to_string())
        },
        thread_id: thread_id.map(str::to_string),
        scope: Some(
            if thread_id.is_some() {
                "thread"
            } else {
                "workspace"
            }
            .to_string(),
        ),
        kind: Some("session_state".to_string()),
        ..MemoryFilters::default()
    };
    if has_exact_memory(&store, &content, &filters) {
        return;
    }
    let _ = store.add_memory(AddMemoryInput {
        content,
        scope: filters.scope.clone(),
        kind: filters.kind.clone(),
        metadata: json!({
            "source": "codex-monitor-auto",
            "capture": "lifecycle_checkpoint",
            "trigger": trigger,
            "workspaceId": workspace_id,
            "workspacePath": workspace_path,
            "threadId": thread_id,
        }),
        categories: vec![
            "auto-captured".to_string(),
            "lifecycle".to_string(),
            PENDING_REVIEW_CATEGORY.to_string(),
        ],
        filters,
        confidence: Some(0.45),
        ..AddMemoryInput::default()
    });
}

fn open_enabled_store() -> Option<LocalMemoryStore> {
    let status = codex_config::read_local_memory_status().ok()?;
    if !status.enabled {
        return None;
    }
    LocalMemoryStore::open_with_embedding_model(Path::new(&status.db_path), &status.embedding_model)
        .ok()
}

fn retrieve_relevant_memories(
    store: &LocalMemoryStore,
    query: &str,
    workspace_id: &str,
    workspace_path: &str,
    thread_id: &str,
) -> Vec<MemorySearchResult> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }

    let searches = [
        MemoryFilters {
            workspace_id: Some(workspace_id.to_string()),
            workspace_path: Some(workspace_path.to_string()),
            thread_id: Some(thread_id.to_string()),
            scope: Some("thread".to_string()),
            ..MemoryFilters::default()
        },
        MemoryFilters {
            workspace_id: Some(workspace_id.to_string()),
            workspace_path: Some(workspace_path.to_string()),
            scope: Some("workspace".to_string()),
            ..MemoryFilters::default()
        },
        MemoryFilters {
            workspace_id: Some(workspace_id.to_string()),
            scope: Some("workspace".to_string()),
            ..MemoryFilters::default()
        },
        MemoryFilters {
            workspace_path: Some(workspace_path.to_string()),
            scope: Some("workspace".to_string()),
            ..MemoryFilters::default()
        },
        MemoryFilters {
            scope: Some("user".to_string()),
            ..MemoryFilters::default()
        },
        MemoryFilters {
            scope: Some("global".to_string()),
            ..MemoryFilters::default()
        },
    ];

    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for filters in searches {
        let Ok(items) = store.search_memories(SearchMemoryInput {
            query: query.to_string(),
            limit: Some(4),
            filters,
        }) else {
            continue;
        };
        for item in items {
            if seen.insert(item.memory.id.clone()) {
                results.push(item);
            }
        }
    }

    results.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(MAX_MEMORY_RESULTS);
    results
}

fn build_context_block(memories: &[MemorySearchResult]) -> Option<String> {
    if memories.is_empty() {
        return None;
    }

    let mut block = String::from(
        "Local memory context. These are locally stored memories that may be relevant; treat them as potentially stale and use only when they help answer the user.\n",
    );
    for memory in memories {
        let line = format!(
            "- [{}:{}] {}\n",
            memory.memory.scope,
            memory.memory.kind,
            truncate_for_prompt(&memory.memory.content, MAX_MEMORY_CHARS)
        );
        if block.len() + line.len() > MAX_CONTEXT_CHARS {
            break;
        }
        block.push_str(&line);
    }

    Some(block.trim_end().to_string())
}

fn append_context_block(text: String, context_block: &str) -> String {
    if text.trim().is_empty() {
        return context_block.to_string();
    }
    format!("{text}\n\n<local_memory_context>\n{context_block}\n</local_memory_context>")
}

#[allow(dead_code)]
fn plan_capture(text: &str) -> Option<CapturePlan> {
    plan_capture_facts(text).into_iter().next()
}

fn plan_capture_facts(text: &str) -> Vec<CapturePlan> {
    let normalized = normalize_content(text);
    if normalized.chars().count() < MIN_CAPTURE_CHARS {
        return Vec::new();
    }
    if normalized.contains("<local_memory_context>") {
        return Vec::new();
    }

    let extractor = HeuristicFactExtractor;
    let facts = extractor.extract_user_facts(&normalized);
    let mut plans = facts
        .into_iter()
        .filter_map(|fact| {
            let fact = normalize_content(&fact);
            if fact.chars().count() < MIN_CAPTURE_CHARS {
                return None;
            }
            let (scope, kind) = classify_capture(&fact);
            if kind == "session_state" && fact.chars().count() < MIN_DURABLE_FACT_CHARS {
                return None;
            }
            Some(build_user_capture_plan(&fact, scope, kind))
        })
        .collect::<Vec<_>>();

    if plans.is_empty() {
        let (scope, kind) = classify_capture(&normalized);
        plans.push(build_user_capture_plan(&normalized, scope, kind));
    }

    dedupe_capture_plans(plans)
}

fn build_user_capture_plan(text: &str, scope: String, kind: String) -> CapturePlan {
    let mut categories = vec![
        "auto-captured".to_string(),
        "user-prompt".to_string(),
        PENDING_REVIEW_CATEGORY.to_string(),
    ];
    if kind != "session_state" {
        categories.push("durable".to_string());
    }
    let prefix = if kind == "session_state" {
        "User asked"
    } else {
        "User instruction or durable project fact"
    };

    CapturePlan {
        content: format!("{prefix}: {}", truncate_for_storage(text)),
        scope,
        kind,
        categories,
    }
}

#[allow(dead_code)]
fn plan_assistant_capture(text: &str) -> Option<CapturePlan> {
    plan_assistant_capture_facts(text).into_iter().next()
}

fn plan_assistant_capture_facts(text: &str) -> Vec<CapturePlan> {
    let normalized = normalize_content(text);
    if normalized.chars().count() < MIN_ASSISTANT_CAPTURE_CHARS {
        return Vec::new();
    }
    if normalized.contains("<local_memory_context>") {
        return Vec::new();
    }

    let extractor = HeuristicFactExtractor;
    let mut plans = extractor
        .extract_assistant_facts(&normalized)
        .into_iter()
        .filter(|fact| fact.chars().count() >= MIN_ASSISTANT_CAPTURE_CHARS)
        .map(|fact| build_assistant_capture_plan(&fact))
        .collect::<Vec<_>>();

    if plans.is_empty() {
        plans.push(build_assistant_capture_plan(&normalized));
    }

    dedupe_capture_plans(plans)
}

fn build_assistant_capture_plan(text: &str) -> CapturePlan {
    CapturePlan {
        content: format!(
            "Assistant result or durable task learning: {}",
            truncate_for_storage(text)
        ),
        scope: "thread".to_string(),
        kind: "task_learnings".to_string(),
        categories: vec![
            "auto-captured".to_string(),
            "assistant-output".to_string(),
            "durable".to_string(),
            PENDING_REVIEW_CATEGORY.to_string(),
        ],
    }
}

fn classify_capture(text: &str) -> (String, String) {
    let lower = text.to_ascii_lowercase();
    if contains_any(
        &lower,
        &[
            "remember",
            "prefer",
            "always",
            "never",
            "default",
            "\u{8bb0}\u{4f4f}",
            "\u{9ed8}\u{8ba4}",
            "\u{4ee5}\u{540e}",
            "\u{4e0d}\u{8981}",
            "\u{522b}",
            "\u{504f}\u{597d}",
            "\u{4e60}\u{60ef}",
        ],
    ) {
        return ("user".to_string(), "user_preferences".to_string());
    }
    if contains_any(
        &lower,
        &[
            "windows",
            "powershell",
            "daemon",
            "terminal",
            "npm",
            "cargo",
            "mcp",
            "config.toml",
            "\u{7ec8}\u{7aef}",
            "\u{914d}\u{7f6e}",
            "\u{73af}\u{5883}",
            "\u{542f}\u{52a8}",
        ],
    ) {
        return ("workspace".to_string(), "tooling_setup".to_string());
    }
    if contains_any(
        &lower,
        &[
            "architecture",
            "design",
            "contract",
            "\u{67b6}\u{6784}",
            "\u{8bbe}\u{8ba1}",
            "\u{65b9}\u{6848}",
            "\u{89c4}\u{5219}",
        ],
    ) {
        return (
            "workspace".to_string(),
            "architecture_decisions".to_string(),
        );
    }
    if contains_any(
        &lower,
        &[
            "bug",
            "fix",
            "regression",
            "error",
            "\u{9519}\u{8bef}",
            "\u{4fee}\u{590d}",
            "\u{95ee}\u{9898}",
        ],
    ) {
        return ("workspace".to_string(), "bug_fixes".to_string());
    }
    ("thread".to_string(), "session_state".to_string())
}

fn has_exact_memory(store: &LocalMemoryStore, content: &str, filters: &MemoryFilters) -> bool {
    let expected = normalize_for_compare(content);
    let Ok(existing) = store.list_memories(ListMemoryInput {
        limit: Some(500),
        filters: filters.clone(),
    }) else {
        return false;
    };
    existing
        .iter()
        .any(|memory| normalize_for_compare(&memory.content) == expected)
}

fn normalize_content(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_for_compare(value: &str) -> String {
    normalize_content(value).to_ascii_lowercase()
}

fn truncate_for_storage(value: &str) -> String {
    truncate_chars(value, 1_200)
}

fn truncate_for_prompt(value: &str, max_chars: usize) -> String {
    truncate_chars(value, max_chars)
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

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn split_candidate_facts(text: &str) -> Vec<String> {
    let normalized = normalize_content(text);
    if normalized.is_empty() {
        return Vec::new();
    }

    let mut facts = Vec::new();
    let mut current = String::new();
    let chars = normalized.chars().collect::<Vec<_>>();
    for (index, ch) in chars.iter().copied().enumerate() {
        current.push(ch);
        if is_fact_boundary(&chars, index) {
            push_candidate_fact(&mut facts, &current);
            current.clear();
        }
    }
    push_candidate_fact(&mut facts, &current);

    if facts.is_empty() {
        facts.push(normalized);
    }

    dedupe_strings(facts, MAX_CAPTURE_FACTS)
}

fn is_fact_boundary(chars: &[char], index: usize) -> bool {
    let Some(ch) = chars.get(index).copied() else {
        return false;
    };
    if matches!(ch, '!' | '?' | ';') {
        return true;
    }
    if ch != '.' {
        return false;
    }
    let next = chars
        .iter()
        .skip(index + 1)
        .find(|next| !next.is_whitespace())
        .copied();
    match next {
        None => true,
        Some(next) => next.is_ascii_uppercase() || next.is_ascii_digit(),
    }
}

fn push_candidate_fact(facts: &mut Vec<String>, candidate: &str) {
    let fact = candidate
        .trim()
        .trim_start_matches(|ch: char| {
            ch.is_ascii_whitespace()
                || ch == '-'
                || ch == '*'
                || ch == '+'
                || ch == ':'
                || ch == '.'
        })
        .trim();
    if fact.chars().count() >= MIN_CAPTURE_CHARS {
        facts.push(fact.to_string());
    }
}

fn dedupe_strings(values: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for value in values {
        let normalized = normalize_for_compare(&value);
        if normalized.is_empty() || !seen.insert(normalized) {
            continue;
        }
        output.push(value);
        if output.len() >= limit {
            break;
        }
    }
    output
}

fn dedupe_capture_plans(plans: Vec<CapturePlan>) -> Vec<CapturePlan> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for plan in plans {
        let key = format!(
            "{}:{}:{}",
            plan.scope,
            plan.kind,
            normalize_for_compare(&plan.content)
        );
        if seen.insert(key) {
            output.push(plan);
        }
        if output.len() >= MAX_CAPTURE_FACTS {
            break;
        }
    }
    output
}

fn is_assistant_learning_fact(fact: &str) -> bool {
    let lower = fact.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "implemented",
            "added",
            "updated",
            "fixed",
            "changed",
            "wired",
            "verified",
            "tested",
            "passed",
            "documented",
            "refactored",
            "removed",
            "created",
            "completed",
        ],
    ) || fact.contains('/')
        || fact.contains('\\')
        || fact.contains(".rs")
        || fact.contains(".ts")
        || fact.contains(".tsx")
        || fact.contains(".md")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::local_memory_core::AddMemoryInput;
    use uuid::Uuid;

    #[test]
    fn builds_context_block_from_ranked_memories() {
        let path = std::env::temp_dir().join(format!(
            "codex-monitor-memory-integration-test-{}.sqlite",
            Uuid::new_v4()
        ));
        let store = LocalMemoryStore::open(&path).expect("open store");
        store
            .add_memory(AddMemoryInput {
                content: "Use npm.cmd rather than npm.ps1 in this PowerShell environment."
                    .to_string(),
                scope: Some("workspace".to_string()),
                kind: Some("tooling_setup".to_string()),
                metadata: json!({}),
                categories: vec!["startup".to_string()],
                filters: MemoryFilters {
                    workspace_id: Some("ws".to_string()),
                    workspace_path: Some("G:\\code\\codex-app".to_string()),
                    ..MemoryFilters::default()
                },
                ..AddMemoryInput::default()
            })
            .expect("add memory");

        let results = retrieve_relevant_memories(
            &store,
            "why does npm fail in powershell",
            "ws",
            "G:\\code\\codex-app",
            "thread-1",
        );
        let block = build_context_block(&results).expect("context block");

        assert!(block.contains("Local memory context"));
        assert!(block.contains("npm.ps1"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn classifies_preferences_as_user_scope() {
        let plan = plan_capture("remember to use PowerShell by default").expect("plan");
        assert_eq!(plan.scope, "user");
        assert_eq!(plan.kind, "user_preferences");
        assert!(plan.categories.contains(&"durable".to_string()));
    }

    #[test]
    fn classifies_regular_prompts_as_thread_state() {
        let plan = plan_capture("continue the current task").expect("plan");
        assert_eq!(plan.scope, "thread");
        assert_eq!(plan.kind, "session_state");
    }

    #[test]
    fn extracts_multiple_user_facts() {
        let plans = plan_capture_facts(
            "Remember to use npm.cmd on Windows. The architecture contract says backend logic belongs in shared core.",
        );

        assert_eq!(plans.len(), 2);
        assert!(plans.iter().any(|plan| plan.kind == "user_preferences"));
        assert!(plans
            .iter()
            .any(|plan| plan.kind == "architecture_decisions"));
        assert!(plans.iter().all(|plan| plan
            .categories
            .contains(&PENDING_REVIEW_CATEGORY.to_string())));
    }

    #[test]
    fn captures_assistant_output_as_task_learning() {
        let plan = plan_assistant_capture(
            "Implemented the Windows terminal fallback and verified cargo check.",
        )
        .expect("plan");

        assert_eq!(plan.scope, "thread");
        assert_eq!(plan.kind, "task_learnings");
        assert!(plan.categories.contains(&"assistant-output".to_string()));
        assert!(plan.content.contains("Windows terminal fallback"));
    }

    #[test]
    fn extracts_assistant_learning_facts() {
        let plans = plan_assistant_capture_facts(
            "Implemented entity scoring in local_memory_core.rs. Verified cargo test --lib local_memory_core. This paragraph is commentary.",
        );

        assert_eq!(plans.len(), 2);
        assert!(plans[0].content.contains("Implemented entity scoring"));
        assert!(plans[1].content.contains("Verified cargo test"));
        assert!(plans.iter().all(|plan| plan
            .categories
            .contains(&PENDING_REVIEW_CATEGORY.to_string())));
    }
}
