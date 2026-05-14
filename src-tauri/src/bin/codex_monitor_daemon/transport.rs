use super::rpc::{
    build_error_response, build_result_response, forward_events, parse_auth_token, send_outbound,
    spawn_rpc_response_task, RpcConnectionState,
};
use super::*;

const DAEMON_CLIENT_OUTBOUND_QUEUE_CAPACITY: usize = 4096;
const DAEMON_RPC_QUEUE_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) async fn handle_client(
    socket: TcpStream,
    config: Arc<DaemonConfig>,
    state: Arc<DaemonState>,
    events: broadcast::Sender<DaemonEvent>,
) {
    let (reader, mut writer) = socket.into_split();
    let mut lines = BufReader::new(reader).lines();

    let (out_tx, mut out_rx) = mpsc::channel::<String>(DAEMON_CLIENT_OUTBOUND_QUEUE_CAPACITY);
    let write_task = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            if writer.write_all(message.as_bytes()).await.is_err() {
                break;
            }
            if writer.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });

    let mut authenticated = config.token.is_none();
    let mut events_task: Option<tokio::task::JoinHandle<()>> = None;
    let request_limiter = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RPC_PER_CONNECTION));
    let connection_state = Arc::new(RpcConnectionState::new());
    let client_version = format!("daemon-{}", env!("CARGO_PKG_VERSION"));

    if authenticated {
        let rx = events.subscribe();
        let out_tx_events = out_tx.clone();
        events_task = Some(tokio::spawn(forward_events(rx, out_tx_events)));
    }

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let message: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let id = message.get("id").and_then(|value| value.as_u64());
        let method = message
            .get("method")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        if !authenticated {
            if method != "auth" {
                if let Some(response) = build_error_response(id, "unauthorized") {
                    if send_outbound(&out_tx, response).await.is_err() {
                        break;
                    }
                }
                continue;
            }

            let expected = config.token.clone().unwrap_or_default();
            let provided = parse_auth_token(&params).unwrap_or_default();
            if expected != provided {
                if let Some(response) = build_error_response(id, "invalid token") {
                    if send_outbound(&out_tx, response).await.is_err() {
                        break;
                    }
                }
                continue;
            }

            authenticated = true;
            if let Some(response) = build_result_response(id, json!({ "ok": true })) {
                if send_outbound(&out_tx, response).await.is_err() {
                    break;
                }
            }

            let rx = events.subscribe();
            let out_tx_events = out_tx.clone();
            events_task = Some(tokio::spawn(forward_events(rx, out_tx_events)));

            continue;
        }

        let permit = match tokio::time::timeout(
            DAEMON_RPC_QUEUE_TIMEOUT,
            Arc::clone(&request_limiter).acquire_owned(),
        )
        .await
        {
            Ok(Ok(permit)) => permit,
            Ok(Err(_)) => break,
            Err(_) => {
                if let Some(response) =
                    build_error_response(id, "daemon RPC queue is full; retry later")
                {
                    if send_outbound(&out_tx, response).await.is_err() {
                        break;
                    }
                }
                continue;
            }
        };

        spawn_rpc_response_task(
            Arc::clone(&state),
            out_tx.clone(),
            id,
            method,
            params,
            client_version.clone(),
            permit,
            Arc::clone(&connection_state),
        );
    }

    drop(out_tx);
    if let Some(task) = events_task {
        task.abort();
    }
    connection_state.close_and_detach(&state).await;
    write_task.abort();
}
