use serde_json::json;
use tauri::{AppHandle, State};

use crate::event_sink::TauriEventSink;
use crate::remote_backend;
use crate::shared::terminal_core;
pub(crate) use crate::shared::terminal_core::TerminalSessionInfo;
use crate::state::AppState;

fn is_unsupported_remote_terminal_method_error(method: &str, err: &str) -> bool {
    err.to_ascii_lowercase()
        .contains(&format!("unknown method: {}", method.to_ascii_lowercase()))
}

#[tauri::command]
pub(crate) async fn terminal_open(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
    let configured_shell = state.app_settings.lock().await.terminal_shell.clone();
    if remote_backend::is_remote_mode(&*state).await {
        if !remote_backend::terminal_rpc_supported(&*state, app.clone()).await? {
            return terminal_core::terminal_open_core(
                workspace_id,
                terminal_id,
                cols,
                rows,
                &state.workspaces,
                state.terminal_sessions.clone(),
                TauriEventSink::new(app),
                configured_shell,
            )
            .await;
        }
        match remote_backend::call_remote(
            &*state,
            app.clone(),
            "terminal_open",
            json!({
                "workspaceId": workspace_id,
                "terminalId": terminal_id,
                "cols": cols,
                "rows": rows,
                "terminalShell": configured_shell.clone()
            }),
        )
        .await
        {
            Ok(response) => return serde_json::from_value(response).map_err(|err| err.to_string()),
            Err(err) if !is_unsupported_remote_terminal_method_error("terminal_open", &err) => {
                return Err(err);
            }
            Err(_) => {}
        }
    }

    terminal_core::terminal_open_core(
        workspace_id,
        terminal_id,
        cols,
        rows,
        &state.workspaces,
        state.terminal_sessions.clone(),
        TauriEventSink::new(app),
        configured_shell,
    )
    .await
}

#[tauri::command]
pub(crate) async fn terminal_write(
    workspace_id: String,
    terminal_id: String,
    data: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        match remote_backend::call_remote(
            &*state,
            app,
            "terminal_write",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id, "data": data }),
        )
        .await
        {
            Ok(_) => return Ok(()),
            Err(err) if !is_unsupported_remote_terminal_method_error("terminal_write", &err) => {
                return Err(err);
            }
            Err(_) => {}
        }
    }

    terminal_core::terminal_write_core(
        workspace_id,
        terminal_id,
        data,
        state.terminal_sessions.clone(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn terminal_resize(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        match remote_backend::call_remote(
            &*state,
            app,
            "terminal_resize",
            json!({
                "workspaceId": workspace_id,
                "terminalId": terminal_id,
                "cols": cols,
                "rows": rows
            }),
        )
        .await
        {
            Ok(_) => return Ok(()),
            Err(err) if !is_unsupported_remote_terminal_method_error("terminal_resize", &err) => {
                return Err(err);
            }
            Err(_) => {}
        }
    }

    terminal_core::terminal_resize_core(
        workspace_id,
        terminal_id,
        cols,
        rows,
        state.terminal_sessions.clone(),
    )
    .await
}

#[tauri::command]
pub(crate) async fn terminal_close(
    workspace_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        match remote_backend::call_remote(
            &*state,
            app,
            "terminal_close",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id }),
        )
        .await
        {
            Ok(_) => return Ok(()),
            Err(err) if !is_unsupported_remote_terminal_method_error("terminal_close", &err) => {
                return Err(err);
            }
            Err(_) => {}
        }
    }

    terminal_core::terminal_close_core(workspace_id, terminal_id, state.terminal_sessions.clone())
        .await
}

#[cfg(test)]
mod tests {
    use super::is_unsupported_remote_terminal_method_error;

    #[test]
    fn detects_unsupported_remote_terminal_method_errors() {
        assert!(is_unsupported_remote_terminal_method_error(
            "terminal_open",
            "unknown method: terminal_open"
        ));
        assert!(is_unsupported_remote_terminal_method_error(
            "terminal_open",
            "Unknown method: TERMINAL_OPEN"
        ));
        assert!(!is_unsupported_remote_terminal_method_error(
            "terminal_open",
            "Failed to spawn shell: not found"
        ));
        assert!(!is_unsupported_remote_terminal_method_error(
            "terminal_write",
            "unknown method: terminal_open"
        ));
    }
}
