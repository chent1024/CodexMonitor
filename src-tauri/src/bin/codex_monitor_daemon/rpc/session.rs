use super::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionIdParams {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionReplayParams {
    session_id: String,
    #[serde(default)]
    from_seq: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRespondParams {
    session_id: String,
    request_id: Value,
    result: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInterruptParams {
    session_id: String,
    thread_id: String,
    turn_id: String,
}

pub(super) async fn try_handle(
    state: &DaemonState,
    method: &str,
    params: &Value,
) -> Option<Result<Value, String>> {
    match method {
        "session/list" => Some(
            state
                .session_list()
                .await
                .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
        ),
        "session/status" => {
            let parsed = match parse_params::<SessionIdParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_status(parsed.session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/attach" => {
            let parsed = match parse_params::<SessionReplayParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_attach(parsed.session_id, parsed.from_seq.unwrap_or(0))
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/detach" => {
            let parsed = match parse_params::<SessionIdParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_detach(parsed.session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/replay_events" => {
            let parsed = match parse_params::<SessionReplayParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_replay_events(parsed.session_id, parsed.from_seq.unwrap_or(0))
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/pending_requests" => {
            let parsed = match parse_params::<SessionIdParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_pending_requests(parsed.session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/respond_request" => {
            let parsed = match parse_params::<SessionRespondParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            if !parsed.request_id.is_number() && !parsed.request_id.is_string() {
                return Some(Err("missing requestId".to_string()));
            }
            Some(
                state
                    .session_respond_request(parsed.session_id, parsed.request_id, parsed.result)
                    .await,
            )
        }
        "session/interrupt" => {
            let parsed = match parse_params::<SessionInterruptParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_interrupt(parsed.session_id, parsed.thread_id, parsed.turn_id)
                    .await,
            )
        }
        "session/stop" => {
            let parsed = match parse_params::<SessionIdParams>(params) {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(state.session_stop(parsed.session_id).await)
        }
        "session/debug_status" => Some(
            state
                .session_debug_status()
                .await
                .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
        ),
        _ => None,
    }
}
