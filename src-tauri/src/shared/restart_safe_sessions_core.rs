use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const RESTART_SAFE_SESSION_PROTOCOL_VERSION: u32 = 1;
pub(crate) const DEFAULT_EVENT_RETENTION_COUNT: usize = 4096;
pub(crate) const DEFAULT_EVENT_RETENTION_AGE_MS: i64 = 6 * 60 * 60 * 1000;
pub(crate) const DEFAULT_EVENT_RETENTION_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RestartSafeSessionLifecycle {
    Live,
    Completed,
    Failed,
    Stopped,
    Detached,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PendingSessionRequestKind {
    Approval,
    UserInput,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartSafeSessionEvent {
    pub(crate) session_id: String,
    pub(crate) session_instance_id: String,
    pub(crate) workspace_id: String,
    #[serde(default)]
    pub(crate) thread_id: Option<String>,
    #[serde(default)]
    pub(crate) turn_id: Option<String>,
    pub(crate) event_seq: u64,
    pub(crate) timestamp_ms: i64,
    pub(crate) event_kind: String,
    pub(crate) payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingSessionRequest {
    pub(crate) session_id: String,
    pub(crate) workspace_id: String,
    #[serde(default)]
    pub(crate) thread_id: Option<String>,
    #[serde(default)]
    pub(crate) turn_id: Option<String>,
    pub(crate) request_id: Value,
    pub(crate) request_key: String,
    pub(crate) kind: PendingSessionRequestKind,
    pub(crate) payload: Value,
    pub(crate) created_at_ms: i64,
    #[serde(default)]
    pub(crate) resolved_at_ms: Option<i64>,
    #[serde(default)]
    pub(crate) response: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartSafeSessionStatus {
    pub(crate) session_id: String,
    pub(crate) session_instance_id: String,
    pub(crate) workspace_id: String,
    pub(crate) lifecycle: RestartSafeSessionLifecycle,
    #[serde(default)]
    pub(crate) active_thread_id: Option<String>,
    #[serde(default)]
    pub(crate) active_turn_id: Option<String>,
    pub(crate) pending_request_count: usize,
    pub(crate) last_event_seq: u64,
    pub(crate) journal_event_count: usize,
    pub(crate) attached_client_count: usize,
    pub(crate) started_at_ms: i64,
    pub(crate) updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartSafeReplay {
    pub(crate) session_id: String,
    pub(crate) session_instance_id: String,
    pub(crate) from_seq: u64,
    pub(crate) events: Vec<RestartSafeSessionEvent>,
    pub(crate) latest_seq: u64,
    pub(crate) oldest_available_seq: Option<u64>,
    pub(crate) retention_gap: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartSafeAttachResponse {
    pub(crate) status: RestartSafeSessionStatus,
    pub(crate) replay: RestartSafeReplay,
    pub(crate) pending_requests: Vec<PendingSessionRequest>,
    pub(crate) protocol_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestartSafeDebugStatus {
    pub(crate) protocol_version: u32,
    pub(crate) session_count: usize,
    pub(crate) active_session_count: usize,
    pub(crate) processing_session_count: usize,
    pub(crate) retained_session_count: usize,
    pub(crate) journal_event_count: usize,
    pub(crate) journal_event_bytes: usize,
    pub(crate) pending_request_count: usize,
    pub(crate) attached_client_count: usize,
    pub(crate) idle_shutdown_allowed: bool,
}

#[derive(Debug)]
struct RestartSafeSessionRecord {
    status: RestartSafeSessionStatus,
    events: VecDeque<RestartSafeSessionEvent>,
    event_bytes: VecDeque<usize>,
    journal_event_bytes: usize,
    pending_requests: HashMap<String, PendingSessionRequest>,
    resolved_requests: HashMap<String, PendingSessionRequest>,
    retention_count: usize,
    retention_age_ms: i64,
    retention_bytes: usize,
}

impl RestartSafeSessionRecord {
    fn new(session_id: String, workspace_id: String, now_ms: i64) -> Self {
        Self {
            status: RestartSafeSessionStatus {
                session_id: session_id.clone(),
                session_instance_id: session_instance_id(&workspace_id, now_ms),
                workspace_id,
                lifecycle: RestartSafeSessionLifecycle::Live,
                active_thread_id: None,
                active_turn_id: None,
                pending_request_count: 0,
                last_event_seq: 0,
                journal_event_count: 0,
                attached_client_count: 0,
                started_at_ms: now_ms,
                updated_at_ms: now_ms,
            },
            events: VecDeque::new(),
            event_bytes: VecDeque::new(),
            journal_event_bytes: 0,
            pending_requests: HashMap::new(),
            resolved_requests: HashMap::new(),
            retention_count: DEFAULT_EVENT_RETENTION_COUNT,
            retention_age_ms: DEFAULT_EVENT_RETENTION_AGE_MS,
            retention_bytes: DEFAULT_EVENT_RETENTION_BYTES,
        }
    }

    fn prune(&mut self, now_ms: i64) {
        while self.events.len() > self.retention_count {
            self.pop_front_event();
        }
        while let Some(front) = self.events.front() {
            if now_ms.saturating_sub(front.timestamp_ms) <= self.retention_age_ms {
                break;
            }
            self.pop_front_event();
        }
        while self.journal_event_bytes > self.retention_bytes && self.events.len() > 1 {
            self.pop_front_event();
        }
        self.resolved_requests.retain(|_, request| {
            let reference_ms = request.resolved_at_ms.unwrap_or(request.created_at_ms);
            now_ms.saturating_sub(reference_ms) <= self.retention_age_ms
        });
        self.status.journal_event_count = self.events.len();
    }

    fn push_event(&mut self, event: RestartSafeSessionEvent) {
        let bytes = estimate_event_bytes(&event);
        self.journal_event_bytes = self.journal_event_bytes.saturating_add(bytes);
        self.event_bytes.push_back(bytes);
        self.events.push_back(event);
    }

    fn pop_front_event(&mut self) {
        if self.events.pop_front().is_some() {
            let bytes = self.event_bytes.pop_front().unwrap_or(0);
            self.journal_event_bytes = self.journal_event_bytes.saturating_sub(bytes);
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct RestartSafeSessionStore {
    records: Mutex<HashMap<String, RestartSafeSessionRecord>>,
}

impl RestartSafeSessionStore {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn record_app_server_event(
        &self,
        workspace_id: &str,
        payload: Value,
    ) -> RestartSafeSessionEvent {
        self.record_event(workspace_id, None, payload)
    }

    pub(crate) fn record_lifecycle_event(
        &self,
        workspace_id: &str,
        event_kind: &str,
        payload: Value,
    ) -> RestartSafeSessionEvent {
        self.record_event(workspace_id, Some(event_kind.to_string()), payload)
    }

    fn record_event(
        &self,
        workspace_id: &str,
        forced_event_kind: Option<String>,
        payload: Value,
    ) -> RestartSafeSessionEvent {
        let now_ms = now_ms();
        let session_id = session_id_for_workspace(workspace_id);
        let event_kind = forced_event_kind.unwrap_or_else(|| {
            payload
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("app-server-event")
                .to_string()
        });
        let params = payload.get("params").unwrap_or(&payload);
        let thread_id = extract_string(params, &["threadId", "thread_id"]).or_else(|| {
            extract_string(
                payload.get("result").unwrap_or(&Value::Null),
                &["threadId", "thread_id"],
            )
        });
        let turn_id = extract_string(params, &["turnId", "turn_id"]).or_else(|| {
            params
                .get("turn")
                .and_then(|turn| extract_string(turn, &["id", "turnId", "turn_id"]))
        });
        let request_id = extract_request_id(&payload);

        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let record = records.entry(session_id.clone()).or_insert_with(|| {
            RestartSafeSessionRecord::new(session_id.clone(), workspace_id.to_string(), now_ms)
        });
        record.status.last_event_seq = record.status.last_event_seq.saturating_add(1);
        record.status.updated_at_ms = now_ms;
        record.status.lifecycle = lifecycle_after_event(&record.status.lifecycle, &event_kind);
        if let Some(thread_id) = thread_id.clone() {
            record.status.active_thread_id = Some(thread_id);
        }
        if event_kind == "turn/started" {
            record.status.active_turn_id = turn_id.clone();
        } else if matches!(event_kind.as_str(), "turn/completed" | "thread/closed") {
            record.status.active_turn_id = None;
        } else if turn_id.is_some() {
            record.status.active_turn_id = turn_id.clone();
        }

        let event = RestartSafeSessionEvent {
            session_id: session_id.clone(),
            session_instance_id: record.status.session_instance_id.clone(),
            workspace_id: workspace_id.to_string(),
            thread_id,
            turn_id,
            event_seq: record.status.last_event_seq,
            timestamp_ms: now_ms,
            event_kind: event_kind.clone(),
            payload: payload.clone(),
        };
        record.push_event(event.clone());

        if let Some(request_id) = request_id {
            let request_key = request_key(&request_id);
            if is_pending_request_event(&event_kind) {
                if !record.resolved_requests.contains_key(&request_key) {
                    record
                        .pending_requests
                        .entry(request_key.clone())
                        .or_insert_with(|| PendingSessionRequest {
                            session_id: session_id.clone(),
                            workspace_id: workspace_id.to_string(),
                            thread_id: event.thread_id.clone(),
                            turn_id: event.turn_id.clone(),
                            request_id,
                            request_key,
                            kind: pending_request_kind(&event_kind),
                            payload,
                            created_at_ms: now_ms,
                            resolved_at_ms: None,
                            response: None,
                        });
                }
            } else if event_kind == "serverRequest/resolved" {
                if let Some(mut request) = record.pending_requests.remove(&request_key) {
                    request.resolved_at_ms = Some(now_ms);
                    request.response = payload
                        .get("params")
                        .and_then(|params| params.get("result"))
                        .cloned();
                    record.resolved_requests.insert(request_key, request);
                }
            }
        }

        record.status.pending_request_count = record.pending_requests.len();
        record.prune(now_ms);
        event
    }

    pub(crate) fn list_statuses(
        &self,
        active_workspaces: &HashSet<String>,
    ) -> Vec<RestartSafeSessionStatus> {
        let now = now_ms();
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        for workspace_id in active_workspaces {
            let session_id = session_id_for_workspace(workspace_id);
            records.entry(session_id.clone()).or_insert_with(|| {
                RestartSafeSessionRecord::new(session_id, workspace_id.clone(), now)
            });
        }
        let mut statuses = records
            .values_mut()
            .map(|record| {
                if active_workspaces.contains(&record.status.workspace_id) {
                    record.status.lifecycle = RestartSafeSessionLifecycle::Live;
                }
                record.status.pending_request_count = record.pending_requests.len();
                record.status.journal_event_count = record.events.len();
                record.status.clone()
            })
            .collect::<Vec<_>>();
        statuses.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        statuses
    }

    pub(crate) fn status(&self, session_id: &str) -> Option<RestartSafeSessionStatus> {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        let record = records.get_mut(&key)?;
        record.status.pending_request_count = record.pending_requests.len();
        record.status.journal_event_count = record.events.len();
        Some(record.status.clone())
    }

    pub(crate) fn attach(
        &self,
        session_id: &str,
        from_seq: u64,
    ) -> Option<RestartSafeAttachResponse> {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        let record = records.get_mut(&key)?;
        record.status.attached_client_count = record.status.attached_client_count.saturating_add(1);
        let status = record.status.clone();
        let replay = replay_from_record(record, from_seq);
        let pending_requests = record.pending_requests.values().cloned().collect();
        Some(RestartSafeAttachResponse {
            status,
            replay,
            pending_requests,
            protocol_version: RESTART_SAFE_SESSION_PROTOCOL_VERSION,
        })
    }

    pub(crate) fn detach(&self, session_id: &str) -> Option<RestartSafeSessionStatus> {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        let record = records.get_mut(&key)?;
        record.status.attached_client_count = record.status.attached_client_count.saturating_sub(1);
        Some(record.status.clone())
    }

    pub(crate) fn replay(&self, session_id: &str, from_seq: u64) -> Option<RestartSafeReplay> {
        let records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        let record = records.get(&key)?;
        Some(replay_from_record(record, from_seq))
    }

    pub(crate) fn pending_requests(&self, session_id: &str) -> Vec<PendingSessionRequest> {
        let records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)
            .unwrap_or_else(|| session_id.to_string());
        records
            .get(&key)
            .map(|record| record.pending_requests.values().cloned().collect())
            .unwrap_or_default()
    }

    pub(crate) fn workspace_id_for_session(&self, session_id: &str) -> Option<String> {
        let records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        records
            .get(&key)
            .map(|record| record.status.workspace_id.clone())
    }

    #[cfg(test)]
    fn set_retention_for_test(&self, session_id: &str, count: usize, age_ms: i64) {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let Some(key) = record_key_for_session_id(&records, session_id) else {
            return;
        };
        if let Some(record) = records.get_mut(&key) {
            record.retention_count = count;
            record.retention_age_ms = age_ms;
        }
    }

    #[cfg(test)]
    fn set_retention_bytes_for_test(&self, session_id: &str, bytes: usize) {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let Some(key) = record_key_for_session_id(&records, session_id) else {
            return;
        };
        if let Some(record) = records.get_mut(&key) {
            record.retention_bytes = bytes;
        }
    }

    pub(crate) fn has_pending_request(&self, session_id: &str, request_id: &Value) -> bool {
        let records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let Some(key) = record_key_for_session_id(&records, session_id) else {
            return false;
        };
        let Some(record) = records.get(&key) else {
            return false;
        };
        record
            .pending_requests
            .contains_key(&request_key(request_id))
    }

    pub(crate) fn resolved_request(
        &self,
        session_id: &str,
        request_id: &Value,
    ) -> Option<PendingSessionRequest> {
        let records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        records.get(&key).and_then(|record| {
            record
                .resolved_requests
                .get(&request_key(request_id))
                .cloned()
        })
    }

    pub(crate) fn mark_request_resolved(
        &self,
        session_id: &str,
        request_id: &Value,
        response: Value,
    ) -> Option<PendingSessionRequest> {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let key = record_key_for_session_id(&records, session_id)?;
        let record = records.get_mut(&key)?;
        let key = request_key(request_id);
        let mut request = record.pending_requests.remove(&key)?;
        request.resolved_at_ms = Some(now_ms());
        request.response = Some(response);
        record.resolved_requests.insert(key, request.clone());
        record.status.pending_request_count = record.pending_requests.len();
        Some(request)
    }

    pub(crate) fn mark_stopped(&self, session_id: &str) {
        let now = now_ms();
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        if let Some(key) = record_key_for_session_id(&records, session_id) {
            let Some(record) = records.get_mut(&key) else {
                return;
            };
            record.status.lifecycle = RestartSafeSessionLifecycle::Stopped;
            record.status.updated_at_ms = now;
            record.pending_requests.clear();
            record.status.pending_request_count = 0;
        }
    }

    pub(crate) fn debug_status(&self) -> RestartSafeDebugStatus {
        let mut records = self
            .records
            .lock()
            .expect("restart-safe session store poisoned");
        let now = now_ms();
        for record in records.values_mut() {
            record.prune(now);
            record.status.pending_request_count = record.pending_requests.len();
        }
        let journal_event_count = records.values().map(|record| record.events.len()).sum();
        let journal_event_bytes = records
            .values()
            .map(|record| record.journal_event_bytes)
            .sum();
        let pending_request_count = records
            .values()
            .map(|record| record.pending_requests.len())
            .sum();
        let attached_client_count = records
            .values()
            .map(|record| record.status.attached_client_count)
            .sum();
        let active_session_count = records
            .values()
            .filter(|record| {
                (matches!(record.status.lifecycle, RestartSafeSessionLifecycle::Live)
                    && record.status.active_turn_id.is_some())
                    || !record.pending_requests.is_empty()
            })
            .count();
        let processing_session_count = records
            .values()
            .filter(|record| {
                matches!(record.status.lifecycle, RestartSafeSessionLifecycle::Live)
                    && record.status.active_turn_id.is_some()
            })
            .count();
        let retained_session_count = records
            .values()
            .filter(|record| !record.events.is_empty() || !record.resolved_requests.is_empty())
            .count();
        RestartSafeDebugStatus {
            protocol_version: RESTART_SAFE_SESSION_PROTOCOL_VERSION,
            session_count: records.len(),
            active_session_count,
            processing_session_count,
            retained_session_count,
            journal_event_count,
            journal_event_bytes,
            pending_request_count,
            attached_client_count,
            idle_shutdown_allowed: active_session_count == 0
                && pending_request_count == 0
                && attached_client_count == 0,
        }
    }
}

pub(crate) fn session_id_for_workspace(workspace_id: &str) -> String {
    format!("workspace:{workspace_id}")
}

pub(crate) fn session_instance_id_for_workspace(workspace_id: &str, started_at_ms: i64) -> String {
    format!("session:{workspace_id}:{started_at_ms:x}")
}

fn session_instance_id(workspace_id: &str, started_at_ms: i64) -> String {
    session_instance_id_for_workspace(workspace_id, started_at_ms)
}

fn record_key_for_session_id(
    records: &HashMap<String, RestartSafeSessionRecord>,
    session_id: &str,
) -> Option<String> {
    if records.contains_key(session_id) {
        return Some(session_id.to_string());
    }
    records
        .iter()
        .find(|(_, record)| record.status.session_instance_id == session_id)
        .map(|(key, _)| key.clone())
}

fn estimate_event_bytes(event: &RestartSafeSessionEvent) -> usize {
    serde_json::to_vec(&event.payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
        .saturating_add(event.session_id.len())
        .saturating_add(event.session_instance_id.len())
        .saturating_add(event.workspace_id.len())
        .saturating_add(event.thread_id.as_ref().map_or(0, String::len))
        .saturating_add(event.turn_id.as_ref().map_or(0, String::len))
        .saturating_add(event.event_kind.len())
        .saturating_add(128)
}

fn replay_from_record(record: &RestartSafeSessionRecord, from_seq: u64) -> RestartSafeReplay {
    let oldest_available_seq = record.events.front().map(|event| event.event_seq);
    let latest_seq = record.status.last_event_seq;
    let retention_gap =
        oldest_available_seq.is_some_and(|oldest| from_seq < oldest.saturating_sub(1));
    let events = record
        .events
        .iter()
        .filter(|event| event.event_seq > from_seq)
        .cloned()
        .collect();
    RestartSafeReplay {
        session_id: record.status.session_id.clone(),
        session_instance_id: record.status.session_instance_id.clone(),
        from_seq,
        events,
        latest_seq,
        oldest_available_seq,
        retention_gap,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as i64
}

fn extract_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key).and_then(Value::as_str) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn extract_request_id(value: &Value) -> Option<Value> {
    for candidate in [
        value.get("id"),
        value.get("requestId"),
        value.get("request_id"),
        value
            .get("params")
            .and_then(|params| params.get("requestId")),
        value
            .get("params")
            .and_then(|params| params.get("request_id")),
        value.get("params").and_then(|params| params.get("id")),
        value
            .get("params")
            .and_then(|params| params.get("request"))
            .and_then(|request| request.get("id")),
    ] {
        if let Some(id) = candidate.filter(|id| id.is_string() || id.is_number()) {
            return Some(id.clone());
        }
    }
    None
}

fn request_key(request_id: &Value) -> String {
    serde_json::to_string(request_id).unwrap_or_else(|_| json!(request_id.to_string()).to_string())
}

fn is_pending_request_event(event_kind: &str) -> bool {
    matches!(
        event_kind,
        "approval/request"
            | "item/permissions/requestApproval"
            | "workspace/requestApproval"
            | "item/tool/requestUserInput"
            | "mcpServer/elicitation/request"
    ) || event_kind.ends_with("requestApproval")
        || event_kind.ends_with("requestUserInput")
}

fn pending_request_kind(event_kind: &str) -> PendingSessionRequestKind {
    match event_kind {
        "item/tool/requestUserInput" | "mcpServer/elicitation/request" => {
            PendingSessionRequestKind::UserInput
        }
        "approval/request" | "item/permissions/requestApproval" | "workspace/requestApproval" => {
            PendingSessionRequestKind::Approval
        }
        _ => PendingSessionRequestKind::Other,
    }
}

fn lifecycle_after_event(
    current: &RestartSafeSessionLifecycle,
    event_kind: &str,
) -> RestartSafeSessionLifecycle {
    match event_kind {
        "turn/completed" | "thread/closed" => RestartSafeSessionLifecycle::Completed,
        "error" | "thread/realtime/error" => RestartSafeSessionLifecycle::Failed,
        "session/stop" => RestartSafeSessionLifecycle::Stopped,
        "session/start"
        | "session/resume"
        | "session/attach"
        | "session/interrupt"
        | "turn/started"
        | "item/started"
        | "item/agentMessage/delta" => RestartSafeSessionLifecycle::Live,
        _ => current.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_sequences_are_monotonic_per_session() {
        let store = RestartSafeSessionStore::new();
        let first = store.record_app_server_event("ws-1", json!({ "method": "turn/started" }));
        let second = store.record_app_server_event("ws-1", json!({ "method": "turn/completed" }));

        assert_eq!(first.event_seq, 1);
        assert_eq!(second.event_seq, 2);
        assert_eq!(first.session_id, "workspace:ws-1");
    }

    #[test]
    fn replay_returns_events_after_requested_sequence() {
        let store = RestartSafeSessionStore::new();
        store.record_app_server_event("ws-1", json!({ "method": "turn/started" }));
        store.record_app_server_event("ws-1", json!({ "method": "turn/completed" }));

        let replay = store.replay("workspace:ws-1", 1).expect("replay");
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].event_seq, 2);
        assert!(!replay.retention_gap);
    }

    #[test]
    fn session_instance_id_can_address_same_record() {
        let store = RestartSafeSessionStore::new();
        let event = store.record_app_server_event("ws-1", json!({ "method": "turn/started" }));

        assert_eq!(event.session_id, "workspace:ws-1");
        assert!(event.session_instance_id.starts_with("session:ws-1:"));
        assert_eq!(
            store.workspace_id_for_session(&event.session_instance_id),
            Some("ws-1".to_string())
        );

        let replay = store
            .replay(&event.session_instance_id, 0)
            .expect("instance id replays");
        assert_eq!(replay.session_id, "workspace:ws-1");
        assert_eq!(replay.session_instance_id, event.session_instance_id);
        assert_eq!(replay.events.len(), 1);
    }

    #[test]
    fn journal_prunes_by_retained_bytes() {
        let store = RestartSafeSessionStore::new();
        store.record_app_server_event(
            "ws-1",
            json!({ "method": "first", "payload": "x".repeat(128) }),
        );
        store.set_retention_bytes_for_test("workspace:ws-1", 1);
        store.record_app_server_event(
            "ws-1",
            json!({ "method": "second", "payload": "x".repeat(128) }),
        );

        let replay = store.replay("workspace:ws-1", 0).expect("replay");
        assert!(replay.events.len() <= 1);
        let debug = store.debug_status();
        assert_eq!(debug.journal_event_count, replay.events.len());
    }

    #[test]
    fn pending_requests_are_resolved_idempotently_by_key() {
        let store = RestartSafeSessionStore::new();
        store.record_app_server_event(
            "ws-1",
            json!({
                "id": "approval-1",
                "method": "item/permissions/requestApproval",
                "params": { "threadId": "thread-1" }
            }),
        );

        let pending = store.pending_requests("workspace:ws-1");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].kind, PendingSessionRequestKind::Approval);

        let resolved = store.mark_request_resolved(
            "workspace:ws-1",
            &json!("approval-1"),
            json!({ "decision": "accept" }),
        );
        assert!(resolved.is_some());
        assert!(store.pending_requests("workspace:ws-1").is_empty());
        assert!(store
            .mark_request_resolved("workspace:ws-1", &json!("approval-1"), json!({}))
            .is_none());
        assert!(store
            .resolved_request("workspace:ws-1", &json!("approval-1"))
            .is_some());
    }

    #[test]
    fn duplicate_pending_request_events_do_not_reopen_resolved_requests() {
        let store = RestartSafeSessionStore::new();
        let request = json!({
            "id": "approval-1",
            "method": "item/permissions/requestApproval",
            "params": { "threadId": "thread-1" }
        });
        store.record_app_server_event("ws-1", request.clone());
        store.mark_request_resolved(
            "workspace:ws-1",
            &json!("approval-1"),
            json!({ "decision": "accept" }),
        );

        store.record_app_server_event("ws-1", request);

        assert!(store.pending_requests("workspace:ws-1").is_empty());
        let resolved = store
            .resolved_request("workspace:ws-1", &json!("approval-1"))
            .expect("resolved request");
        assert_eq!(resolved.response, Some(json!({ "decision": "accept" })));
    }

    #[test]
    fn lifecycle_events_are_journaled() {
        let store = RestartSafeSessionStore::new();
        let event =
            store.record_lifecycle_event("ws-1", "session/attach", json!({ "client": "ui" }));

        assert_eq!(event.event_kind, "session/attach");
        let replay = store.replay("workspace:ws-1", 0).expect("replay");
        assert_eq!(replay.events.len(), 1);
        assert_eq!(replay.events[0].payload, json!({ "client": "ui" }));
    }

    #[test]
    fn debug_status_reports_idle_policy_inputs() {
        let store = RestartSafeSessionStore::new();
        let empty = store.debug_status();
        assert!(empty.idle_shutdown_allowed);

        store.record_lifecycle_event("ws-1", "session/start", json!({}));
        let active = store.debug_status();
        assert_eq!(active.active_session_count, 0);
        assert_eq!(active.processing_session_count, 0);
        assert_eq!(active.retained_session_count, 1);
        assert!(active.idle_shutdown_allowed);
    }

    #[test]
    fn debug_status_distinguishes_live_sessions_from_processing_turns() {
        let store = RestartSafeSessionStore::new();
        store.record_lifecycle_event("ws-idle", "session/attach", json!({}));
        store.record_app_server_event(
            "ws-busy",
            json!({
                "method": "turn/started",
                "params": { "threadId": "thread-1", "turnId": "turn-1" }
            }),
        );

        let debug = store.debug_status();

        assert_eq!(debug.active_session_count, 1);
        assert_eq!(debug.processing_session_count, 1);

        store.record_app_server_event(
            "ws-busy",
            json!({
                "method": "turn/completed",
                "params": { "threadId": "thread-1", "turnId": "turn-1" }
            }),
        );

        let completed = store.debug_status();

        assert_eq!(completed.active_session_count, 0);
        assert_eq!(completed.processing_session_count, 0);
    }

    #[test]
    fn resolved_requests_expire_with_retention() {
        let store = RestartSafeSessionStore::new();
        store.record_app_server_event(
            "ws-1",
            json!({
                "id": "approval-1",
                "method": "item/permissions/requestApproval",
                "params": { "threadId": "thread-1" }
            }),
        );
        store.mark_request_resolved(
            "workspace:ws-1",
            &json!("approval-1"),
            json!({ "decision": "accept" }),
        );
        store.mark_stopped("workspace:ws-1");
        store.set_retention_for_test("workspace:ws-1", 0, -1);

        let debug = store.debug_status();

        assert_eq!(debug.retained_session_count, 0);
        assert!(debug.idle_shutdown_allowed);
    }

    #[test]
    fn request_id_extraction_accepts_nested_request_id_shapes() {
        let store = RestartSafeSessionStore::new();
        store.record_app_server_event(
            "ws-1",
            json!({
                "method": "custom/requestApproval",
                "params": {
                    "request": { "id": "nested-approval" },
                    "threadId": "thread-1"
                }
            }),
        );

        let pending = store.pending_requests("workspace:ws-1");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, json!("nested-approval"));
    }
}
