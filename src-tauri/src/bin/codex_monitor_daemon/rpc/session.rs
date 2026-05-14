use super::*;

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
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_status(session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/attach" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let from_seq = parse_optional_u64(params, "fromSeq").unwrap_or(0);
            Some(
                state
                    .session_attach(session_id, from_seq)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/detach" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_detach(session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/replay_events" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let from_seq = parse_optional_u64(params, "fromSeq").unwrap_or(0);
            Some(
                state
                    .session_replay_events(session_id, from_seq)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/pending_requests" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_pending_requests(session_id)
                    .await
                    .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string())),
            )
        }
        "session/respond_request" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let map = match params.as_object().ok_or("missing requestId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err.to_string())),
            };
            let request_id = match map
                .get("requestId")
                .cloned()
                .filter(|value| value.is_number() || value.is_string())
                .ok_or("missing requestId")
            {
                Ok(value) => value,
                Err(err) => return Some(Err(err.to_string())),
            };
            let result = match map.get("result").cloned().ok_or("missing `result`") {
                Ok(value) => value,
                Err(err) => return Some(Err(err.to_string())),
            };
            Some(
                state
                    .session_respond_request(session_id, request_id, result)
                    .await,
            )
        }
        "session/interrupt" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let thread_id = match parse_string(params, "threadId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            let turn_id = match parse_string(params, "turnId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(
                state
                    .session_interrupt(session_id, thread_id, turn_id)
                    .await,
            )
        }
        "session/stop" => {
            let session_id = match parse_string(params, "sessionId") {
                Ok(value) => value,
                Err(err) => return Some(Err(err)),
            };
            Some(state.session_stop(session_id).await)
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
