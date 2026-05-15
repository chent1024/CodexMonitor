use super::*;
use serde::Deserialize;
use serde::Serialize;

fn serialize_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| err.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenParams {
    workspace_id: String,
    terminal_id: String,
    #[serde(default)]
    cols: Option<u32>,
    #[serde(default)]
    rows: Option<u32>,
    #[serde(default)]
    terminal_shell: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteParams {
    workspace_id: String,
    terminal_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionParams {
    workspace_id: String,
    terminal_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizeParams {
    workspace_id: String,
    terminal_id: String,
    #[serde(default)]
    cols: Option<u32>,
    #[serde(default)]
    rows: Option<u32>,
}

fn terminal_dimension(value: Option<u32>, fallback: u32) -> u16 {
    value.unwrap_or(fallback).min(u16::MAX as u32) as u16
}

pub(super) async fn try_handle(
    state: &DaemonState,
    method: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    match method {
        "terminal_open" => {
            let parsed = match parse_params::<TerminalOpenParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_open(
                        parsed.workspace_id,
                        parsed.terminal_id,
                        terminal_dimension(parsed.cols, 80),
                        terminal_dimension(parsed.rows, 24),
                        parsed.terminal_shell,
                    )
                    .await
                    .and_then(serialize_value),
            )
        }
        "terminal_write" => {
            let parsed = match parse_params::<TerminalWriteParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_write(parsed.workspace_id, parsed.terminal_id, parsed.data)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        "terminal_resize" => {
            let parsed = match parse_params::<TerminalResizeParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_resize(
                        parsed.workspace_id,
                        parsed.terminal_id,
                        terminal_dimension(parsed.cols, 80),
                        terminal_dimension(parsed.rows, 24),
                    )
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        "terminal_close" => {
            let parsed = match parse_params::<TerminalSessionParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_close(parsed.workspace_id, parsed.terminal_id)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        _ => None,
    }
}
