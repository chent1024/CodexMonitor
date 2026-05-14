use super::*;
use serde::Serialize;

fn serialize_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| err.to_string())
}

pub(super) async fn try_handle(
    state: &DaemonState,
    method: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    match method {
        "terminal_open" => {
            let workspace_id = match parse_string(params, "workspaceId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let terminal_id = match parse_string(params, "terminalId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let cols = parse_optional_u32(params, "cols")
                .unwrap_or(80)
                .min(u16::MAX as u32) as u16;
            let rows = parse_optional_u32(params, "rows")
                .unwrap_or(24)
                .min(u16::MAX as u32) as u16;
            Some(
                state
                    .terminal_open(workspace_id, terminal_id, cols, rows)
                    .await
                    .and_then(serialize_value),
            )
        }
        "terminal_write" => {
            let workspace_id = match parse_string(params, "workspaceId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let terminal_id = match parse_string(params, "terminalId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let data = match parse_string(params, "data") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_write(workspace_id, terminal_id, data)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        "terminal_resize" => {
            let workspace_id = match parse_string(params, "workspaceId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let terminal_id = match parse_string(params, "terminalId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let cols = parse_optional_u32(params, "cols")
                .unwrap_or(80)
                .min(u16::MAX as u32) as u16;
            let rows = parse_optional_u32(params, "rows")
                .unwrap_or(24)
                .min(u16::MAX as u32) as u16;
            Some(
                state
                    .terminal_resize(workspace_id, terminal_id, cols, rows)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        "terminal_close" => {
            let workspace_id = match parse_string(params, "workspaceId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let terminal_id = match parse_string(params, "terminalId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .terminal_close(workspace_id, terminal_id)
                    .await
                    .map(|_| json!({ "ok": true })),
            )
        }
        _ => None,
    }
}
