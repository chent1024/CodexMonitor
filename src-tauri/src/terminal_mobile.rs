use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, State};

use crate::remote_backend;
use crate::state::AppState;

const UNSUPPORTED_MESSAGE: &str = "Terminal is not available on mobile builds.";

pub(crate) struct TerminalSession {
    pub(crate) id: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TerminalSessionInfo {
    id: String,
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
    if terminal_id.trim().is_empty() {
        return Err("Terminal id is required".to_string());
    }
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "terminal_open",
            json!({
                "workspaceId": workspace_id,
                "terminalId": terminal_id,
                "cols": cols,
                "rows": rows
            }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }
    Err(UNSUPPORTED_MESSAGE.to_string())
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
        remote_backend::call_remote(
            &*state,
            app,
            "terminal_write",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id, "data": data }),
        )
        .await?;
        return Ok(());
    }
    Err(UNSUPPORTED_MESSAGE.to_string())
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
        remote_backend::call_remote(
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
        .await?;
        return Ok(());
    }
    Err(UNSUPPORTED_MESSAGE.to_string())
}

#[tauri::command]
pub(crate) async fn terminal_close(
    workspace_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "terminal_close",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id }),
        )
        .await?;
        return Ok(());
    }
    Err(UNSUPPORTED_MESSAGE.to_string())
}
