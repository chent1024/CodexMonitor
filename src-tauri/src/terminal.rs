use serde_json::json;
use tauri::{AppHandle, State};

use crate::event_sink::TauriEventSink;
use crate::remote_backend;
use crate::shared::terminal_core;
pub(crate) use crate::shared::terminal_core::TerminalSessionInfo;
use crate::state::AppState;

#[tauri::command]
pub(crate) async fn terminal_open(
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
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

    terminal_core::terminal_open_core(
        workspace_id,
        terminal_id,
        cols,
        rows,
        &state.workspaces,
        state.terminal_sessions.clone(),
        TauriEventSink::new(app),
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
        remote_backend::call_remote(
            &*state,
            app,
            "terminal_write",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id, "data": data }),
        )
        .await?;
        return Ok(());
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
        remote_backend::call_remote(
            &*state,
            app,
            "terminal_close",
            json!({ "workspaceId": workspace_id, "terminalId": terminal_id }),
        )
        .await?;
        return Ok(());
    }

    terminal_core::terminal_close_core(workspace_id, terminal_id, state.terminal_sessions.clone())
        .await
}
