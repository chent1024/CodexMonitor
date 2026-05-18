mod protocol;
mod tcp_transport;
mod transport;

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::shared::restart_safe_sessions_core::RESTART_SAFE_SESSION_PROTOCOL_VERSION;
use crate::shared::terminal_core::TERMINAL_RPC_VERSION;
use crate::state::AppState;
use crate::types::{BackendMode, DaemonHealthStatus};

use self::protocol::{build_request_line, DEFAULT_REMOTE_HOST, DISCONNECTED_MESSAGE};
use self::tcp_transport::TcpTransport;
use self::transport::{PendingMap, RemoteTransport, RemoteTransportConfig, RemoteTransportKind};

const REMOTE_DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const REMOTE_INTERACTIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const REMOTE_QUICK_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const REMOTE_SEND_TIMEOUT: Duration = Duration::from_secs(15);
const EXPECTED_DAEMON_NAME: &str = "codex-monitor-daemon";
const EXPECTED_DAEMON_MODE: &str = "tcp";
const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub(crate) fn normalize_path_for_remote(path: String) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return path;
    }

    if let Some(normalized) = normalize_wsl_unc_path(trimmed) {
        return normalized;
    }

    path
}

fn normalize_wsl_unc_path(path: &str) -> Option<String> {
    let lower = path.to_ascii_lowercase();
    let (prefix_len, raw) = if lower.starts_with("\\\\wsl$\\") {
        (7, path)
    } else if lower.starts_with("\\\\wsl.localhost\\") {
        (16, path)
    } else {
        return None;
    };

    let remainder = raw.get(prefix_len..)?;
    let mut segments = remainder.split('\\').filter(|segment| !segment.is_empty());
    segments.next()?;
    let joined = segments.collect::<Vec<_>>().join("/");
    Some(if joined.is_empty() {
        "/".to_string()
    } else {
        format!("/{joined}")
    })
}

#[derive(Clone)]
pub(crate) struct RemoteBackend {
    inner: Arc<RemoteBackendInner>,
}

struct RemoteBackendInner {
    out_tx: tokio::sync::mpsc::Sender<String>,
    pending: Arc<Mutex<PendingMap>>,
    next_id: AtomicU64,
    connected: Arc<std::sync::atomic::AtomicBool>,
    daemon_info: Mutex<Option<RemoteDaemonInfo>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteDaemonInfo {
    name: String,
    version: String,
    pid: Option<u32>,
    mode: String,
    binary_path: Option<String>,
    terminal_rpc_version: Option<u64>,
}

impl RemoteBackend {
    pub(crate) async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.inner.connected.load(Ordering::SeqCst) {
            return Err(DISCONNECTED_MESSAGE.to_string());
        }

        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.inner.pending.lock().await.insert(id, tx);

        let message = build_request_line(id, method, params)?;
        match timeout(REMOTE_SEND_TIMEOUT, self.inner.out_tx.send(message)).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => {
                self.inner.pending.lock().await.remove(&id);
                return Err(DISCONNECTED_MESSAGE.to_string());
            }
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                return Err(format!(
                    "remote backend request dispatch timed out after {} seconds",
                    REMOTE_SEND_TIMEOUT.as_secs()
                ));
            }
        }

        let request_timeout = request_timeout_for_method(method);
        match timeout(request_timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(DISCONNECTED_MESSAGE.to_string()),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err(format!(
                    "remote backend request timed out after {} seconds",
                    request_timeout.as_secs()
                ))
            }
        }
    }

    async fn daemon_info(&self, refresh: bool) -> Result<RemoteDaemonInfo, String> {
        if !refresh {
            if let Some(info) = self.inner.daemon_info.lock().await.clone() {
                return Ok(info);
            }
        }
        let value = self.call("daemon_info", json!({})).await?;
        let info = parse_remote_daemon_info(&value)?;
        *self.inner.daemon_info.lock().await = Some(info.clone());
        Ok(info)
    }
}

fn parse_remote_daemon_info(value: &Value) -> Result<RemoteDaemonInfo, String> {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "daemon_info missing `name`".to_string())?
        .to_string();
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "daemon_info missing `version`".to_string())?
        .to_string();
    let mode = value
        .get("mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "daemon_info missing `mode`".to_string())?
        .to_string();
    let pid = value
        .get("pid")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    let binary_path = value
        .get("binaryPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let terminal_rpc_version = value
        .get("capabilities")
        .and_then(|value| value.get("terminalRpcVersion"))
        .and_then(Value::as_u64);

    Ok(RemoteDaemonInfo {
        name,
        version,
        pid,
        mode,
        binary_path,
        terminal_rpc_version,
    })
}

fn request_timeout_for_method(method: &str) -> Duration {
    match method {
        "list_thread_turns"
        | "daemon_info"
        | "read_thread"
        | "thread_unsubscribe"
        | "list_threads"
        | "search_threads"
        | "get_thread_search_index_status"
        | "clear_thread_search_index"
        | "list_mcp_server_status"
        | "session/attach"
        | "session/debug_status"
        | "session/detach"
        | "session/list"
        | "session/pending_requests"
        | "session/replay_events"
        | "session/status"
        | "terminal/close"
        | "terminal/open"
        | "terminal/resize"
        | "terminal/write"
        | "local_usage_snapshot"
        | "account_read"
        | "account_rate_limits"
        | "model_list"
        | "skills_list"
        | "apps_list" => REMOTE_QUICK_REQUEST_TIMEOUT,
        "resume_thread" | "connect_workspace" => REMOTE_INTERACTIVE_REQUEST_TIMEOUT,
        _ => REMOTE_DEFAULT_REQUEST_TIMEOUT,
    }
}

pub(crate) async fn is_remote_mode(state: &AppState) -> bool {
    let settings = state.app_settings.lock().await;
    matches!(settings.backend_mode, BackendMode::Remote) || settings.restart_safe_sessions
}

pub(crate) async fn call_remote(
    state: &AppState,
    app: AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let client = ensure_remote_backend(state, app.clone()).await?;
    match client.call(method, params.clone()).await {
        Ok(value) => Ok(value),
        Err(err) if err == DISCONNECTED_MESSAGE => {
            *state.remote_backend.lock().await = None;
            if !can_retry_after_disconnect(method) {
                return Err(format_remote_backend_error(method, &err));
            }
            let retry_client = ensure_remote_backend(state, app).await?;
            match retry_client.call(method, params).await {
                Ok(value) => Ok(value),
                Err(retry_err) => {
                    *state.remote_backend.lock().await = None;
                    Err(format_remote_backend_error(method, &retry_err))
                }
            }
        }
        Err(err) => {
            *state.remote_backend.lock().await = None;
            Err(format_remote_backend_error(method, &err))
        }
    }
}

pub(crate) async fn terminal_rpc_supported(
    state: &AppState,
    app: AppHandle,
) -> Result<bool, String> {
    let client = ensure_remote_backend(state, app).await?;
    let info = client.daemon_info(false).await?;
    Ok(info
        .terminal_rpc_version
        .is_some_and(|version| version >= TERMINAL_RPC_VERSION))
}

fn format_remote_backend_error(method: &str, err: &str) -> String {
    if err == DISCONNECTED_MESSAGE {
        return format!(
            "Remote daemon connection was lost while running `{method}`. The app will reconnect automatically for safe read operations; if this repeats, restart the daemon and check the configured host/token."
        );
    }
    if err.contains("timed out") {
        return format!(
            "Remote daemon request `{method}` timed out: {err}. This usually means the daemon is overloaded, unreachable, or the network path is degraded."
        );
    }
    err.to_string()
}

fn can_retry_after_disconnect(method: &str) -> bool {
    matches!(
        method,
        "account_rate_limits"
            | "account_read"
            | "apps_list"
            | "collaboration_mode_list"
            | "connect_workspace"
            | "codex_doctor"
            | "daemon_info"
            | "experimental_feature_list"
            | "get_codex_config_path"
            | "get_codex_feature_flag"
            | "get_open_app_icon"
            | "get_local_memory_status"
            | "get_local_memory_debug_status"
            | "add_local_memory"
            | "search_local_memories"
            | "list_local_memories"
            | "get_local_memory"
            | "update_local_memory"
            | "delete_local_memory"
            | "delete_all_local_memories"
            | "list_local_memory_entities"
            | "delete_local_memory_entities"
            | "rebuild_local_memory_indexes"
            | "list_local_memory_events"
            | "get_local_memory_event_status"
            | "set_local_memory_enabled"
            | "set_local_memory_db_path"
            | "set_local_memory_embedding_model"
            | "check_local_memory_connection"
            | "import_local_memories"
            | "list_local_memory_review_queue"
            | "approve_local_memory"
            | "reject_local_memory"
            | "set_workspace_runtime_codex_args"
            | "file_read"
            | "get_agents_settings"
            | "get_config_model"
            | "get_git_commit_diff"
            | "get_git_diffs"
            | "get_git_log"
            | "get_git_remote"
            | "get_git_status"
            | "get_github_issues"
            | "get_github_pull_request_comments"
            | "get_github_pull_request_diff"
            | "get_github_pull_requests"
            | "is_workspace_path_dir"
            | "list_git_branches"
            | "list_git_roots"
            | "list_mcp_server_status"
            | "list_threads"
            | "list_thread_turns"
            | "local_usage_snapshot"
            | "list_workspace_files"
            | "list_workspaces"
            | "model_list"
            | "read_thread"
            | "read_agent_config_toml"
            | "read_workspace_file"
            | "resume_thread"
            | "session/attach"
            | "session/debug_status"
            | "session/detach"
            | "session/list"
            | "session/pending_requests"
            | "session/replay_events"
            | "session/status"
            | "thread_unsubscribe"
            | "thread_live_subscribe"
            | "thread_live_unsubscribe"
            | "skills_list"
            | "worktree_setup_status"
    )
}

async fn ensure_remote_backend(state: &AppState, app: AppHandle) -> Result<RemoteBackend, String> {
    {
        let guard = state.remote_backend.lock().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }
    }

    let transport_config = {
        let settings = state.app_settings.lock().await;
        resolve_transport_config(&settings)?
    };
    let transport_kind = transport_config.kind();
    let auth_token = transport_config.auth_token().map(|value| value.to_string());

    let transport: Box<dyn RemoteTransport> = match transport_config.kind() {
        RemoteTransportKind::Tcp => Box::new(TcpTransport),
    };
    let connection = transport.connect(app, transport_config).await?;

    let client = RemoteBackend {
        inner: Arc::new(RemoteBackendInner {
            out_tx: connection.out_tx,
            pending: connection.pending,
            next_id: AtomicU64::new(1),
            connected: connection.connected,
            daemon_info: Mutex::new(None),
        }),
    };

    if matches!(transport_kind, RemoteTransportKind::Tcp) {
        if let Some(token) = auth_token {
            client
                .call("auth", json!({ "token": token }))
                .await
                .map(|_| ())?;
        }
    }

    let daemon_info = client.daemon_info(true).await?;
    validate_daemon_identity(&daemon_info)?;

    {
        let settings = state.app_settings.lock().await;
        if settings.restart_safe_sessions {
            let status = client.call("session/debug_status", json!({})).await?;
            let protocol_version = status
                .get("protocolVersion")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    "restart-safe daemon did not report a session protocol version".to_string()
                })?;
            if protocol_version != u64::from(RESTART_SAFE_SESSION_PROTOCOL_VERSION) {
                return Err(format!(
                    "restart-safe daemon session protocol mismatch: app requires {}, daemon reported {}. Let active sessions finish, then restart the daemon.",
                    RESTART_SAFE_SESSION_PROTOCOL_VERSION,
                    protocol_version
                ));
            }
        }
    }

    {
        let mut guard = state.remote_backend.lock().await;
        *guard = Some(client.clone());
    }

    Ok(client)
}

fn validate_daemon_identity(info: &RemoteDaemonInfo) -> Result<(), String> {
    if info.name != EXPECTED_DAEMON_NAME {
        return Err(format!(
            "daemon identity mismatch: app expected `{EXPECTED_DAEMON_NAME}`, daemon reported `{}`",
            info.name
        ));
    }
    if info.version != CURRENT_APP_VERSION {
        return Err(format!(
            "daemon version mismatch: app requires {CURRENT_APP_VERSION}, daemon reported {}. Restart the daemon so app and daemon use the same build.",
            info.version
        ));
    }
    if info.mode != EXPECTED_DAEMON_MODE {
        return Err(format!(
            "daemon mode mismatch: app expected `{EXPECTED_DAEMON_MODE}`, daemon reported `{}`",
            info.mode
        ));
    }
    Ok(())
}

fn build_daemon_health_status(
    connected: bool,
    info: Option<RemoteDaemonInfo>,
    restart_safe_protocol_version: Option<u64>,
    last_error: Option<String>,
    round_trip_ms: u64,
) -> DaemonHealthStatus {
    let terminal_rpc_supported = info
        .as_ref()
        .and_then(|info| info.terminal_rpc_version)
        .is_some_and(|version| version >= TERMINAL_RPC_VERSION);
    let restart_safe_protocol_compatible = match restart_safe_protocol_version {
        Some(version) => version == u64::from(RESTART_SAFE_SESSION_PROTOCOL_VERSION),
        None => true,
    };
    let mut warnings = Vec::new();

    if let Some(info) = info.as_ref() {
        if info.name != EXPECTED_DAEMON_NAME {
            warnings.push(format!(
                "Identity mismatch: expected `{EXPECTED_DAEMON_NAME}`, got `{}`.",
                info.name
            ));
        }
        if info.version != CURRENT_APP_VERSION {
            warnings.push(format!(
                "Version mismatch: app {CURRENT_APP_VERSION}, daemon {}.",
                info.version
            ));
        }
        if info.mode != EXPECTED_DAEMON_MODE {
            warnings.push(format!(
                "Mode mismatch: expected `{EXPECTED_DAEMON_MODE}`, got `{}`.",
                info.mode
            ));
        }
        if !terminal_rpc_supported {
            warnings.push(format!(
                "Terminal RPC capability {:?} is below required {}.",
                info.terminal_rpc_version, TERMINAL_RPC_VERSION
            ));
        }
    }

    if !restart_safe_protocol_compatible {
        warnings.push(format!(
            "Restart-safe protocol mismatch: app requires {}, daemon reported {:?}.",
            RESTART_SAFE_SESSION_PROTOCOL_VERSION, restart_safe_protocol_version
        ));
    }

    DaemonHealthStatus {
        connected,
        name: info.as_ref().map(|info| info.name.clone()),
        version: info.as_ref().map(|info| info.version.clone()),
        app_version: CURRENT_APP_VERSION.to_string(),
        mode: info.as_ref().map(|info| info.mode.clone()),
        pid: info.as_ref().and_then(|info| info.pid),
        binary_path: info.as_ref().and_then(|info| info.binary_path.clone()),
        terminal_rpc_version: info.as_ref().and_then(|info| info.terminal_rpc_version),
        required_terminal_rpc_version: TERMINAL_RPC_VERSION,
        terminal_rpc_supported,
        restart_safe_protocol_version,
        required_restart_safe_protocol_version: u64::from(RESTART_SAFE_SESSION_PROTOCOL_VERSION),
        restart_safe_protocol_compatible,
        warnings,
        last_error,
        round_trip_ms,
    }
}

#[tauri::command]
pub(crate) async fn daemon_health_status(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<DaemonHealthStatus, String> {
    let started = Instant::now();
    let settings = state.app_settings.lock().await.clone();
    match ensure_remote_backend(state.inner(), app).await {
        Ok(client) => {
            let info = client.daemon_info(true).await?;
            let restart_safe_protocol_version = if settings.restart_safe_sessions {
                let status = client.call("session/debug_status", json!({})).await?;
                status.get("protocolVersion").and_then(Value::as_u64)
            } else {
                None
            };
            Ok(build_daemon_health_status(
                true,
                Some(info),
                restart_safe_protocol_version,
                None,
                started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            ))
        }
        Err(err) => Ok(build_daemon_health_status(
            false,
            None,
            None,
            Some(err),
            started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        )),
    }
}

fn resolve_transport_config(
    settings: &crate::types::AppSettings,
) -> Result<RemoteTransportConfig, String> {
    if settings.restart_safe_sessions && !matches!(settings.backend_mode, BackendMode::Remote) {
        return Ok(RemoteTransportConfig::Tcp {
            host: DEFAULT_REMOTE_HOST.to_string(),
            auth_token: settings.remote_backend_token.clone(),
        });
    }
    let host = if settings.remote_backend_host.trim().is_empty() {
        DEFAULT_REMOTE_HOST.to_string()
    } else {
        settings.remote_backend_host.clone()
    };
    Ok(RemoteTransportConfig::Tcp {
        host,
        auth_token: settings.remote_backend_token.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::{can_retry_after_disconnect, request_timeout_for_method, resolve_transport_config};
    use crate::remote_backend::transport::RemoteTransportConfig;
    use crate::types::AppSettings;
    use std::time::Duration;

    #[test]
    fn resolve_tcp_transport_uses_remote_host() {
        let mut settings = AppSettings::default();
        settings.restart_safe_sessions = false;
        settings.remote_backend_host = "tcp.example:4732".to_string();

        let config = resolve_transport_config(&settings).expect("transport config");
        let RemoteTransportConfig::Tcp { host, .. } = config;
        assert_eq!(host, "tcp.example:4732");
    }

    #[test]
    fn retries_only_retry_safe_methods_after_disconnect() {
        assert!(can_retry_after_disconnect("resume_thread"));
        assert!(can_retry_after_disconnect("list_threads"));
        assert!(can_retry_after_disconnect("list_thread_turns"));
        assert!(can_retry_after_disconnect("thread_unsubscribe"));
        assert!(can_retry_after_disconnect("local_usage_snapshot"));
        assert!(can_retry_after_disconnect("daemon_info"));
        assert!(!can_retry_after_disconnect("send_user_message"));
        assert!(!can_retry_after_disconnect("start_thread"));
        assert!(!can_retry_after_disconnect("remove_workspace"));
    }

    #[test]
    fn uses_shorter_timeouts_for_interactive_remote_requests() {
        assert_eq!(
            request_timeout_for_method("list_thread_turns"),
            Duration::from_secs(20)
        );
        assert_eq!(
            request_timeout_for_method("thread_unsubscribe"),
            Duration::from_secs(20)
        );
        assert_eq!(
            request_timeout_for_method("session/attach"),
            Duration::from_secs(20)
        );
        assert_eq!(
            request_timeout_for_method("daemon_info"),
            Duration::from_secs(20)
        );
        assert_eq!(
            request_timeout_for_method("resume_thread"),
            Duration::from_secs(60)
        );
        assert_eq!(
            request_timeout_for_method("send_user_message"),
            Duration::from_secs(300)
        );
    }
}
