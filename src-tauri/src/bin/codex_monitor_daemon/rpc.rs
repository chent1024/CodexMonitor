use super::*;
use serde::de::DeserializeOwned;
use serde::Deserialize;

#[path = "rpc/codex.rs"]
mod codex;
#[path = "rpc/daemon.rs"]
mod daemon;
#[path = "rpc/dispatcher.rs"]
mod dispatcher;
#[path = "rpc/git.rs"]
mod git;
#[path = "rpc/prompts.rs"]
mod prompts;
#[path = "rpc/session.rs"]
mod session;
#[path = "rpc/terminal.rs"]
mod terminal;
#[path = "rpc/workspace.rs"]
mod workspace;

pub(super) fn build_error_response(id: Option<u64>, message: &str) -> Option<String> {
    let id = id?;
    Some(
        serde_json::to_string(&json!({
            "id": id,
            "error": { "message": message }
        }))
        .unwrap_or_else(|_| {
            "{\"id\":0,\"error\":{\"message\":\"serialization failed\"}}".to_string()
        }),
    )
}

pub(super) fn build_result_response(id: Option<u64>, result: Value) -> Option<String> {
    let id = id?;
    Some(
        serde_json::to_string(&json!({ "id": id, "result": result })).unwrap_or_else(|_| {
            "{\"id\":0,\"error\":{\"message\":\"serialization failed\"}}".to_string()
        }),
    )
}

fn build_event_notification(event: DaemonEvent) -> Option<String> {
    let payload = match event {
        DaemonEvent::AppServer(payload) => json!({
            "method": "app-server-event",
            "params": payload,
        }),
        DaemonEvent::RestartSafeSession(payload) => json!({
            "method": "restart-safe-session-event",
            "params": payload,
        }),
        DaemonEvent::TerminalOutput(payload) => json!({
            "method": "terminal-output",
            "params": payload,
        }),
        DaemonEvent::TerminalExit(payload) => json!({
            "method": "terminal-exit",
            "params": payload,
        }),
    };
    serde_json::to_string(&payload).ok()
}

fn build_event_gap_notification(skipped: u64) -> Option<String> {
    let payload = json!({
        "method": "app-server-event",
        "params": {
            "workspace_id": "__daemon__",
            "message": {
                "method": "codex/event_gap",
                "params": {
                    "skipped": skipped,
                    "reason": "daemon-event-broadcast-lagged"
                }
            }
        }
    });
    serde_json::to_string(&payload).ok()
}

pub(super) async fn send_outbound(
    out_tx: &mpsc::Sender<String>,
    message: String,
) -> Result<(), mpsc::error::SendError<String>> {
    match tokio::time::timeout(Duration::from_secs(15), out_tx.send(message)).await {
        Ok(result) => result,
        Err(_) => Err(mpsc::error::SendError(String::new())),
    }
}

fn try_send_event_outbound(out_tx: &mpsc::Sender<String>, message: String) -> Result<(), ()> {
    out_tx.try_send(message).map_err(|_| ())
}

pub(super) fn parse_auth_token(params: &Value) -> Option<String> {
    match params {
        Value::String(value) => Some(value.clone()),
        Value::Object(map) => map
            .get("token")
            .and_then(|value| value.as_str())
            .map(|v| v.to_string()),
        _ => None,
    }
}

pub(super) fn parse_string(value: &Value, key: &str) -> Result<String, String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .ok_or_else(|| format!("missing or invalid `{key}`")),
        _ => Err(format!("missing `{key}`")),
    }
}

pub(super) fn parse_optional_string(value: &Value, key: &str) -> Option<String> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_str())
            .map(|v| v.to_string()),
        _ => None,
    }
}

pub(super) fn parse_optional_nullable_string(value: &Value, key: &str) -> Option<Option<String>> {
    match value {
        Value::Object(map) => match map.get(key) {
            Some(Value::Null) => Some(None),
            Some(Value::String(value)) => Some(Some(value.to_string())),
            Some(_) => None,
            None => None,
        },
        _ => None,
    }
}

pub(super) fn parse_optional_u32(value: &Value, key: &str) -> Option<u32> {
    match value {
        Value::Object(map) => map.get(key).and_then(|value| value.as_u64()).and_then(|v| {
            if v > u32::MAX as u64 {
                None
            } else {
                Some(v as u32)
            }
        }),
        _ => None,
    }
}

pub(super) fn parse_optional_bool(value: &Value, key: &str) -> Option<bool> {
    match value {
        Value::Object(map) => map.get(key).and_then(|value| value.as_bool()),
        _ => None,
    }
}

pub(super) fn parse_optional_string_array(value: &Value, key: &str) -> Option<Vec<String>> {
    match value {
        Value::Object(map) => map
            .get(key)
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(|value| value.to_string()))
                    .collect::<Vec<_>>()
            }),
        _ => None,
    }
}

pub(super) fn parse_string_array(value: &Value, key: &str) -> Result<Vec<String>, String> {
    parse_optional_string_array(value, key).ok_or_else(|| format!("missing `{key}`"))
}

pub(super) fn parse_optional_value(value: &Value, key: &str) -> Option<Value> {
    match value {
        Value::Object(map) => map.get(key).cloned(),
        _ => None,
    }
}

pub(super) fn parse_params<T: DeserializeOwned>(params: &Value) -> Result<T, String> {
    serde_json::from_value(params.clone()).map_err(|err| err.to_string())
}

pub(super) async fn handle_rpc_request(
    state: &DaemonState,
    method: &str,
    params: Value,
    client_version: String,
) -> Result<Value, String> {
    dispatcher::dispatch_rpc_request(state, method, &params, &client_version).await
}

#[derive(Clone, Debug, Default)]
struct DaemonEventFilter {
    workspace_ids: HashSet<String>,
    session_ids: HashSet<String>,
    terminal_ids: HashSet<String>,
}

impl DaemonEventFilter {
    fn matches(&self, event: &DaemonEvent) -> bool {
        if self.workspace_ids.is_empty()
            && self.session_ids.is_empty()
            && self.terminal_ids.is_empty()
        {
            return true;
        }

        match event {
            DaemonEvent::AppServer(payload) => self.workspace_ids.contains(&payload.workspace_id),
            DaemonEvent::RestartSafeSession(payload) => {
                self.workspace_ids.contains(&payload.workspace_id)
                    || self.session_ids.contains(&payload.session_id)
                    || self.session_ids.contains(&payload.session_instance_id)
            }
            DaemonEvent::TerminalOutput(payload) => {
                self.workspace_ids.contains(&payload.workspace_id)
                    || self.terminal_ids.contains(&payload.terminal_id)
            }
            DaemonEvent::TerminalExit(payload) => {
                self.workspace_ids.contains(&payload.workspace_id)
                    || self.terminal_ids.contains(&payload.terminal_id)
            }
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventSubscribeParams {
    #[serde(default)]
    workspace_ids: Vec<String>,
    #[serde(default)]
    session_ids: Vec<String>,
    #[serde(default)]
    terminal_ids: Vec<String>,
}

pub(super) struct RpcConnectionState {
    attached_restart_safe_sessions: Mutex<HashSet<String>>,
    event_filter: Mutex<DaemonEventFilter>,
    closed: std::sync::atomic::AtomicBool,
}

impl RpcConnectionState {
    pub(super) fn new() -> Self {
        Self {
            attached_restart_safe_sessions: Mutex::new(HashSet::new()),
            event_filter: Mutex::new(DaemonEventFilter::default()),
            closed: std::sync::atomic::AtomicBool::new(false),
        }
    }

    async fn update_event_filter(&self, params: EventSubscribeParams) -> Value {
        let filter = DaemonEventFilter {
            workspace_ids: params.workspace_ids.into_iter().collect(),
            session_ids: params.session_ids.into_iter().collect(),
            terminal_ids: params.terminal_ids.into_iter().collect(),
        };
        let workspace_count = filter.workspace_ids.len();
        let session_count = filter.session_ids.len();
        let terminal_count = filter.terminal_ids.len();
        *self.event_filter.lock().await = filter;
        json!({
            "ok": true,
            "workspaceFilterCount": workspace_count,
            "sessionFilterCount": session_count,
            "terminalFilterCount": terminal_count,
        })
    }

    async fn matches_event(&self, event: &DaemonEvent) -> bool {
        self.event_filter.lock().await.clone().matches(event)
    }

    async fn track_session_attach(&self, state: &DaemonState, session_id: String) {
        if self.closed.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = state.session_detach(session_id).await;
            return;
        }
        self.attached_restart_safe_sessions
            .lock()
            .await
            .insert(session_id);
    }

    async fn track_session_detach(&self, session_id: &str) {
        self.attached_restart_safe_sessions
            .lock()
            .await
            .remove(session_id);
    }

    pub(super) async fn close_and_detach(&self, state: &DaemonState) {
        self.closed.store(true, std::sync::atomic::Ordering::SeqCst);
        let session_ids = {
            let mut attached = self.attached_restart_safe_sessions.lock().await;
            attached.drain().collect::<Vec<_>>()
        };
        for session_id in session_ids {
            let _ = state.session_detach(session_id).await;
        }
    }
}

pub(super) async fn forward_events(
    mut rx: broadcast::Receiver<DaemonEvent>,
    out_tx_events: mpsc::Sender<String>,
    connection_state: Arc<RpcConnectionState>,
) {
    loop {
        let event = match rx.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                let Some(payload) = build_event_gap_notification(skipped) else {
                    continue;
                };
                if try_send_event_outbound(&out_tx_events, payload).is_err() {
                    break;
                }
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        if !connection_state.matches_event(&event).await {
            continue;
        }

        let Some(payload) = build_event_notification(event) else {
            continue;
        };

        if try_send_event_outbound(&out_tx_events, payload).is_err() {
            break;
        }
    }
}

pub(super) fn spawn_rpc_response_task(
    state: Arc<DaemonState>,
    out_tx: mpsc::Sender<String>,
    id: Option<u64>,
    method: String,
    params: Value,
    client_version: String,
    permit: tokio::sync::OwnedSemaphorePermit,
    connection_state: Arc<RpcConnectionState>,
) {
    tokio::spawn(async move {
        let session_id = parse_optional_string(&params, "sessionId");
        let result = if method == "event/subscribe" || method == "events/subscribe" {
            match parse_params::<EventSubscribeParams>(&params) {
                Ok(parsed) => Ok(connection_state.update_event_filter(parsed).await),
                Err(err) => Err(err),
            }
        } else {
            handle_rpc_request(&state, &method, params, client_version).await
        };
        if result.is_ok() {
            if let Some(session_id) = session_id.as_deref() {
                match method.as_str() {
                    "session/attach" => {
                        connection_state
                            .track_session_attach(&state, session_id.to_string())
                            .await;
                    }
                    "session/detach" => {
                        connection_state.track_session_detach(session_id).await;
                    }
                    _ => {}
                }
            }
        }
        let response = match result {
            Ok(result) => build_result_response(id, result),
            Err(message) => build_error_response(id, &message),
        };
        if let Some(response) = response {
            let _ = send_outbound(&out_tx, response).await;
        }
        drop(permit);
    });
}

#[cfg(test)]
mod tests {
    use super::{build_event_gap_notification, DaemonEventFilter};
    use crate::backend::events::AppServerEvent;
    use crate::shared::restart_safe_sessions_core::RestartSafeSessionEvent;
    use crate::DaemonEvent;
    use serde_json::{json, Value};
    use std::collections::HashSet;

    #[test]
    fn event_gap_notification_is_app_server_event() {
        let payload = build_event_gap_notification(7).expect("serializes");
        let value: Value = serde_json::from_str(&payload).expect("json");
        assert_eq!(
            value.get("method").and_then(Value::as_str),
            Some("app-server-event")
        );
        let params = value.get("params").expect("params");
        assert_eq!(
            params.get("workspace_id").and_then(Value::as_str),
            Some("__daemon__")
        );
        let message = params.get("message").expect("message");
        assert_eq!(
            message.get("method").and_then(Value::as_str),
            Some("codex/event_gap")
        );
        assert_eq!(
            message
                .get("params")
                .and_then(|params| params.get("skipped"))
                .and_then(Value::as_u64),
            Some(7)
        );
    }

    #[test]
    fn event_filter_matches_workspace_and_session_instance_ids() {
        let workspace_filter = DaemonEventFilter {
            workspace_ids: HashSet::from(["ws-1".to_string()]),
            session_ids: HashSet::new(),
            terminal_ids: HashSet::new(),
        };
        assert!(
            workspace_filter.matches(&DaemonEvent::AppServer(AppServerEvent {
                workspace_id: "ws-1".to_string(),
                message: json!({}),
            }))
        );
        assert!(
            !workspace_filter.matches(&DaemonEvent::AppServer(AppServerEvent {
                workspace_id: "ws-2".to_string(),
                message: json!({}),
            }))
        );

        let session_filter = DaemonEventFilter {
            workspace_ids: HashSet::new(),
            session_ids: HashSet::from(["session:ws-2:abc".to_string()]),
            terminal_ids: HashSet::new(),
        };
        assert!(session_filter.matches(&DaemonEvent::RestartSafeSession(
            RestartSafeSessionEvent {
                session_id: "workspace:ws-2".to_string(),
                session_instance_id: "session:ws-2:abc".to_string(),
                workspace_id: "ws-2".to_string(),
                thread_id: None,
                turn_id: None,
                event_seq: 1,
                timestamp_ms: 1,
                event_kind: "session/start".to_string(),
                payload: json!({}),
            },
        )));
    }
}
