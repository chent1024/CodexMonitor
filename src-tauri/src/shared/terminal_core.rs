use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;
use tokio::sync::Mutex;

use crate::backend::events::{EventSink, TerminalExit, TerminalOutput};
use crate::types::WorkspaceEntry;

const TERMINAL_OUTPUT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const TERMINAL_OUTPUT_MAX_BATCH_BYTES: usize = 64 * 1024;
const TERMINAL_OUTPUT_QUEUE_CAPACITY: usize = 256;
pub(crate) const TERMINAL_RPC_VERSION: u64 = 1;

pub(crate) type TerminalSessionStore = Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>;

pub(crate) struct TerminalSession {
    pub(crate) id: String,
    pub(crate) master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    pub(crate) writer: Mutex<Box<dyn Write + Send>>,
    pub(crate) child: Mutex<Box<dyn portable_pty::Child + Send>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct TerminalSessionInfo {
    id: String,
}

pub(crate) fn new_terminal_session_store() -> TerminalSessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}

fn terminal_key(workspace_id: &str, terminal_id: &str) -> String {
    format!("{workspace_id}:{terminal_id}")
}

fn is_terminal_closed_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("broken pipe")
        || lower.contains("input/output error")
        || lower.contains("os error 5")
        || lower.contains("eio")
        || lower.contains("io error")
        || lower.contains("not connected")
        || lower.contains("closed")
}

async fn get_terminal_session(
    sessions: &TerminalSessionStore,
    key: &str,
) -> Result<Arc<TerminalSession>, String> {
    let sessions = sessions.lock().await;
    sessions
        .get(key)
        .cloned()
        .ok_or_else(|| "Terminal session not found".to_string())
}

#[cfg(target_os = "windows")]
fn default_shell_path() -> String {
    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
}

#[cfg(not(target_os = "windows"))]
fn default_shell_path() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

fn shell_path(configured_shell: Option<&str>) -> String {
    configured_shell
        .map(str::trim)
        .filter(|shell| !shell.is_empty())
        .map(str::to_string)
        .unwrap_or_else(default_shell_path)
}

#[cfg(any(target_os = "windows", test))]
fn windows_shell_args(shell: &str) -> Vec<&'static str> {
    let shell = shell.to_ascii_lowercase();
    if shell.contains("powershell") || shell.ends_with("pwsh.exe") || shell.ends_with("\\pwsh") {
        vec!["-NoLogo", "-NoExit"]
    } else if shell.ends_with("cmd.exe") || shell.ends_with("\\cmd") {
        vec!["/K"]
    } else {
        Vec::new()
    }
}

fn unix_shell_args() -> Vec<&'static str> {
    vec!["-i"]
}

#[cfg(target_os = "windows")]
fn configure_shell_args(cmd: &mut CommandBuilder, shell: &str) {
    for arg in windows_shell_args(shell) {
        cmd.arg(arg);
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_shell_args(cmd: &mut CommandBuilder, _shell: &str) {
    for arg in unix_shell_args() {
        cmd.arg(arg);
    }
}

fn resolve_locale() -> String {
    let candidate = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "en_US.UTF-8".to_string());
    let lower = candidate.to_lowercase();
    if lower.contains("utf-8") || lower.contains("utf8") {
        return candidate;
    }
    "en_US.UTF-8".to_string()
}

fn emit_terminal_output(
    event_sink: &impl EventSink,
    workspace_id: &str,
    terminal_id: &str,
    data: String,
) {
    if data.is_empty() {
        return;
    }
    event_sink.emit_terminal_output(TerminalOutput {
        workspace_id: workspace_id.to_string(),
        terminal_id: terminal_id.to_string(),
        data,
    });
}

fn flush_terminal_output_buffer(
    event_sink: &impl EventSink,
    workspace_id: &str,
    terminal_id: &str,
    pending: &mut String,
) {
    if pending.is_empty() {
        return;
    }
    emit_terminal_output(
        event_sink,
        workspace_id,
        terminal_id,
        std::mem::take(pending),
    );
}

fn spawn_terminal_output_batcher(
    event_sink: impl EventSink,
    workspace_id: String,
    terminal_id: String,
) -> (mpsc::SyncSender<String>, std::thread::JoinHandle<()>) {
    let (tx, rx) = mpsc::sync_channel::<String>(TERMINAL_OUTPUT_QUEUE_CAPACITY);
    let handle = std::thread::spawn(move || {
        let mut pending = String::new();
        let mut last_flush = Instant::now();
        loop {
            match rx.recv_timeout(TERMINAL_OUTPUT_FLUSH_INTERVAL) {
                Ok(chunk) => {
                    pending.push_str(&chunk);
                    if pending.len() >= TERMINAL_OUTPUT_MAX_BATCH_BYTES
                        || last_flush.elapsed() >= TERMINAL_OUTPUT_FLUSH_INTERVAL
                    {
                        flush_terminal_output_buffer(
                            &event_sink,
                            &workspace_id,
                            &terminal_id,
                            &mut pending,
                        );
                        last_flush = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    flush_terminal_output_buffer(
                        &event_sink,
                        &workspace_id,
                        &terminal_id,
                        &mut pending,
                    );
                    last_flush = Instant::now();
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    flush_terminal_output_buffer(
                        &event_sink,
                        &workspace_id,
                        &terminal_id,
                        &mut pending,
                    );
                    break;
                }
            }
        }
    });
    (tx, handle)
}

fn spawn_terminal_reader(
    event_sink: impl EventSink,
    runtime_handle: Handle,
    sessions: TerminalSessionStore,
    session: Arc<TerminalSession>,
    workspace_id: String,
    terminal_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let (output_tx, output_handle) = spawn_terminal_output_batcher(
            event_sink.clone(),
            workspace_id.clone(),
            terminal_id.clone(),
        );
        let mut buffer = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        'reader: loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    pending.extend_from_slice(&buffer[..count]);
                    loop {
                        match std::str::from_utf8(&pending) {
                            Ok(decoded) => {
                                if !decoded.is_empty()
                                    && output_tx.send(decoded.to_string()).is_err()
                                {
                                    break 'reader;
                                }
                                pending.clear();
                                break;
                            }
                            Err(error) => {
                                let valid_up_to = error.valid_up_to();
                                if valid_up_to == 0 {
                                    if error.error_len().is_none() {
                                        break;
                                    }
                                    let invalid_len = error.error_len().unwrap_or(1);
                                    pending.drain(..invalid_len.min(pending.len()));
                                    continue;
                                }
                                let chunk =
                                    String::from_utf8_lossy(&pending[..valid_up_to]).to_string();
                                if !chunk.is_empty() && output_tx.send(chunk).is_err() {
                                    break 'reader;
                                }
                                pending.drain(..valid_up_to);
                                if error.error_len().is_none() {
                                    break;
                                }
                                let invalid_len = error.error_len().unwrap_or(1);
                                pending.drain(..invalid_len.min(pending.len()));
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
        drop(output_tx);
        let _ = output_handle.join();
        let cleanup_workspace_id = workspace_id.clone();
        let cleanup_terminal_id = terminal_id.clone();
        let cleanup_session = Arc::clone(&session);
        event_sink.emit_terminal_exit(TerminalExit {
            workspace_id,
            terminal_id,
        });
        let _cleanup_task = runtime_handle.spawn(async move {
            let mut sessions = sessions.lock().await;
            let key = terminal_key(&cleanup_workspace_id, &cleanup_terminal_id);
            let should_remove = sessions
                .get(&key)
                .is_some_and(|current| Arc::ptr_eq(current, &cleanup_session));
            if should_remove {
                sessions.remove(&key);
            }
        });
    });
}

async fn get_workspace_path(
    workspace_id: &str,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "Unknown workspace".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

pub(crate) async fn terminal_open_core(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: TerminalSessionStore,
    event_sink: impl EventSink,
    configured_shell: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    if terminal_id.is_empty() {
        return Err("Terminal id is required".to_string());
    }
    let key = terminal_key(&workspace_id, &terminal_id);
    {
        let sessions_guard = sessions.lock().await;
        if let Some(existing) = sessions_guard.get(&key) {
            return Ok(TerminalSessionInfo {
                id: existing.id.clone(),
            });
        }
    }

    let cwd = get_workspace_path(&workspace_id, workspaces).await?;
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open pty: {e}"))?;

    let shell = shell_path(configured_shell.as_deref());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(cwd);
    configure_shell_args(&mut cmd, &shell);
    cmd.env("TERM", "xterm-256color");
    let locale = resolve_locale();
    cmd.env("LANG", &locale);
    cmd.env("LC_ALL", &locale);
    cmd.env("LC_CTYPE", &locale);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to open pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to open pty writer: {e}"))?;

    let session = Arc::new(TerminalSession {
        id: terminal_id.clone(),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    let session_id = session.id.clone();

    {
        let mut sessions_guard = sessions.lock().await;
        if let Some(existing) = sessions_guard.get(&key) {
            let id = existing.id.clone();
            drop(sessions_guard);
            let _ = tokio::task::spawn_blocking(move || {
                let mut child = session.child.blocking_lock();
                let _ = child.kill();
            })
            .await;
            return Ok(TerminalSessionInfo { id });
        }
        sessions_guard.insert(key, Arc::clone(&session));
    }

    spawn_terminal_reader(
        event_sink,
        Handle::current(),
        Arc::clone(&sessions),
        Arc::clone(&session),
        workspace_id,
        terminal_id,
        reader,
    );

    Ok(TerminalSessionInfo { id: session_id })
}

pub(crate) async fn terminal_write_core(
    workspace_id: String,
    terminal_id: String,
    data: String,
    sessions: TerminalSessionStore,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
    let session = get_terminal_session(&sessions, &key).await?;
    let write_result = tokio::task::spawn_blocking(move || {
        let mut writer = session.writer.blocking_lock();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to pty: {e}"))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush pty: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Terminal write task failed: {e}"))?;

    if let Err(err) = write_result {
        if is_terminal_closed_error(&err) {
            let mut sessions = sessions.lock().await;
            sessions.remove(&key);
        }
        return Err(err);
    }
    Ok(())
}

pub(crate) async fn terminal_resize_core(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    sessions: TerminalSessionStore,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
    let session = get_terminal_session(&sessions, &key).await?;
    let size = PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    };
    let resize_result = tokio::task::spawn_blocking(move || {
        let master = session.master.blocking_lock();
        master
            .resize(size)
            .map_err(|e| format!("Failed to resize pty: {e}"))
    })
    .await
    .map_err(|e| format!("Terminal resize task failed: {e}"))?;
    if let Err(err) = resize_result {
        if is_terminal_closed_error(&err) {
            let mut sessions = sessions.lock().await;
            sessions.remove(&key);
        }
        return Err(err);
    }
    Ok(())
}

pub(crate) async fn terminal_close_core(
    workspace_id: String,
    terminal_id: String,
    sessions: TerminalSessionStore,
) -> Result<(), String> {
    let key = terminal_key(&workspace_id, &terminal_id);
    let mut sessions_guard = sessions.lock().await;
    let session = sessions_guard
        .remove(&key)
        .ok_or_else(|| "Terminal session not found".to_string())?;
    drop(sessions_guard);
    let _ = tokio::task::spawn_blocking(move || {
        let mut child = session.child.blocking_lock();
        let _ = child.kill();
    })
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex as StdMutex};

    use crate::backend::events::{AppServerEvent, EventSink, TerminalExit, TerminalOutput};

    use super::{shell_path, spawn_terminal_output_batcher, unix_shell_args, windows_shell_args};

    #[derive(Clone, Default)]
    struct TestEventSink {
        terminal_outputs: Arc<StdMutex<Vec<TerminalOutput>>>,
    }

    impl EventSink for TestEventSink {
        fn emit_app_server_event(&self, _event: AppServerEvent) {}

        fn emit_terminal_output(&self, event: TerminalOutput) {
            self.terminal_outputs
                .lock()
                .expect("terminal outputs lock")
                .push(event);
        }

        fn emit_terminal_exit(&self, _event: TerminalExit) {}
    }

    #[test]
    fn windows_shell_args_match_powershell_variants() {
        assert_eq!(
            windows_shell_args(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
            vec!["-NoLogo", "-NoExit"]
        );
        assert_eq!(
            windows_shell_args(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            vec!["-NoLogo", "-NoExit"]
        );
        assert_eq!(
            windows_shell_args(r"C:\Program Files\PowerShell\7\PwSh"),
            vec!["-NoLogo", "-NoExit"]
        );
    }

    #[test]
    fn windows_shell_args_match_cmd_variants() {
        assert_eq!(
            windows_shell_args(r"C:\Windows\System32\cmd.exe"),
            vec!["/K"]
        );
        assert_eq!(windows_shell_args(r"C:\Windows\System32\CMD"), vec!["/K"]);
    }

    #[test]
    fn windows_shell_args_are_empty_for_other_shells() {
        assert!(windows_shell_args("nu.exe").is_empty());
    }

    #[test]
    fn unix_shell_args_stay_interactive() {
        assert_eq!(unix_shell_args(), vec!["-i"]);
    }

    #[test]
    fn shell_path_prefers_non_empty_configured_shell() {
        assert_eq!(
            shell_path(Some("  C:\\Program Files\\PowerShell\\7\\pwsh.exe  ")),
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        );
    }

    #[test]
    fn terminal_output_batcher_flushes_pending_output_on_disconnect() {
        let sink = TestEventSink::default();
        let outputs = Arc::clone(&sink.terminal_outputs);
        let (tx, handle) =
            spawn_terminal_output_batcher(sink, "ws-1".to_string(), "term-1".to_string());

        tx.send("hello ".to_string()).expect("send hello");
        tx.send("world".to_string()).expect("send world");
        drop(tx);
        handle.join().expect("join output batcher");

        let events = outputs.lock().expect("terminal outputs lock");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].workspace_id, "ws-1");
        assert_eq!(events[0].terminal_id, "term-1");
        assert_eq!(events[0].data, "hello world");
    }
}
