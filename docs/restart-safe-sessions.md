# Restart-Safe Sessions

Canonical implementation contract for keeping active Codex sessions alive when the Tauri UI restarts.

## Goal

An active Codex turn must continue running when the desktop app process exits or restarts. The restarted UI must reconnect to the same live session, replay missed events, show current status, and keep approval/user-input prompts actionable.

## Target Invariants

- The daemon is the authoritative owner of long-lived Codex app-server sessions when restart-safe sessions are enabled.
- The Tauri app is a client of the daemon for session start, attach, event stream, interrupt, stop, and status operations.
- Closing or restarting the Tauri app must not kill active daemon-owned Codex child processes.
- Explicit user stop/interrupt commands keep their current semantics and must still reach the live session.
- Session identity is stable across UI restarts: `workspace_id`, `thread_id`, `turn_id`, and a daemon-side `session_id` remain queryable.
- Backend behavior shared by app and daemon lives in `src-tauri/src/shared/*`; app and daemon adapters stay thin.
- Frontend IPC stays centralized in `src/services/tauri.ts`; frontend event fanout stays centralized in `src/services/events.ts`.

## Non-Goals

- Do not persist OS process handles. The daemon owns live child processes in memory.
- Do not make every UI selection or panel state durable.
- Do not implement multi-host session migration.
- Do not require Codex app-server protocol changes unless attach/replay cannot be implemented from existing events.
- Do not silently kill active daemon sessions during app upgrade, app close, or daemon version mismatch.

## Current Architecture Anchors

- Codex app-server process/session logic: `src-tauri/src/backend/app_server.rs`
- App-side Codex adapter and event emission: `src-tauri/src/codex/mod.rs`
- App command registry and daemon lifecycle setting: `src-tauri/src/lib.rs`
- Daemon entrypoint and in-memory session map: `src-tauri/src/bin/codex_monitor_daemon.rs`
- Daemon JSON-RPC router: `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`
- Daemon Codex RPC handlers: `src-tauri/src/bin/codex_monitor_daemon/rpc/codex.rs`
- Frontend IPC wrapper: `src/services/tauri.ts`
- Frontend app-server event hub/routing: `src/services/events.ts`, `src/features/app/hooks/useAppServerEvents.ts`
- Thread reducer and live state: `src/features/threads/hooks/useThreadsReducer.ts`, `src/features/threads/hooks/threadReducer/*`

## Ownership Model

### Default Mode

The existing app-owned session path may remain available as a compatibility fallback until daemon mode is stable.

### Restart-Safe Mode

When enabled:

1. The app starts or connects to the daemon before creating a Codex session.
2. The daemon starts the Codex app-server child and stores the `WorkspaceSession`.
3. The app subscribes to daemon events and renders them through the same frontend event path.
4. On app close, daemon-owned sessions remain alive.
5. On app restart, the app lists daemon sessions, attaches to selected live sessions, replays missed events, and resumes live streaming.

## Shared Core Extraction

Extract only cross-runtime logic into shared modules:

- Session metadata, status, and lifecycle state types.
- Event journal data structures and replay filtering.
- Pending request tracking and idempotent response validation.
- Process helper reuse through `src-tauri/src/shared/process_core.rs` where applicable.

Keep runtime-specific responsibilities in adapters:

- Tauri event emission stays in the app adapter.
- JSON-RPC request/response transport stays in the daemon adapter.
- Child process ownership stays in the runtime that owns the session for that mode.

## Settings

Add a user-visible setting:

- Name: Restart-safe sessions
- Default: on.
- Effect: new sessions are daemon-owned when enabled.
- Scope: changing the setting does not migrate already running sessions.
- UI requirement: explain through concise setting label/help text only; no debug-only wording in normal settings UI.

Persist the setting through:

- Frontend settings model: `src/types.ts`
- Settings UI/state: `src/features/settings/components/SettingsView.tsx`, `src/features/settings/hooks/useAppSettings.ts`
- Backend settings types/storage: `src-tauri/src/types.rs`, `src-tauri/src/storage.rs` or current settings core path
- IPC wrapper: `src/services/tauri.ts`

## Daemon RPC Contract

Prefer additive method changes. Keep existing method names stable unless a contract migration is intentional.

Required capabilities:

| Capability | Purpose |
| --- | --- |
| `session/list` | Return daemon-owned live and recently completed sessions. |
| `session/status` | Return lifecycle status, active turn, pending request count, and last event sequence. |
| `session/attach` | Register a UI client for live events. Supports replay from a sequence. |
| `session/detach` | Remove a UI client subscription without stopping the Codex process. |
| `session/replay_events` | Return journaled events after `from_seq`, bounded by retention. |
| `session/pending_requests` | Return currently actionable approval/user-input requests. |
| `session/respond_request` | Resolve a pending request idempotently. |
| `session/interrupt` | Interrupt an active turn. |
| `session/stop` | Explicitly terminate a session and its child process tree. |

Every session event delivered over daemon RPC must include:

- `session_id`
- `workspace_id`
- `thread_id` when known
- `turn_id` when known
- `event_seq`
- `timestamp_ms`
- `event_kind`
- original app-server payload

## Event Journal

The daemon keeps an event journal for every daemon-owned session.

Minimum implementation:

- In-memory ring buffer per session.
- Monotonic `event_seq` per session.
- Bounded retention by count and age.
- Replay API that returns events after `from_seq`.
- Clear status when requested `from_seq` is older than retention.

Future durable implementation:

- SQLite-backed event journal if crash diagnostics or long retention become required.
- Store normalized metadata columns plus JSON payload.
- Keep retention cleanup explicit and test-covered.

The journal must capture:

- App-server output events needed to reconstruct thread UI state.
- Turn lifecycle events.
- Approval and user-input request events.
- Terminal/error events relevant to session status.
- Session start, attach, detach, interrupt, stop, and exit status events.

## Pending Requests

Approval and user-input prompts must survive UI restart while the daemon is alive.

Requirements:

- Store each pending request by stable request id.
- Include `session_id`, `workspace_id`, `thread_id`, `turn_id`, request kind, payload, and creation time.
- `respond_request` is idempotent: duplicate responses return the already resolved state.
- Requests are removed or marked resolved only after Codex app-server accepts the response or the session exits.
- On UI reconnect, pending requests are listed before live event subscription is considered complete.

## Reconnect Flow

On app startup in restart-safe mode:

1. Ensure the daemon is running.
2. Verify daemon protocol compatibility.
3. Call `session/list`.
4. Attach to live sessions for the active workspace and any processing threads shown in the UI.
5. Replay events after the last known `event_seq` when available.
6. Query `session/pending_requests`.
7. Refresh thread summaries from the existing thread list/read APIs.
8. Mark sessions as live, completed, failed, or detached in thread state.

If replay is incomplete because retention expired:

- Refresh thread state from source-of-truth thread APIs.
- Show the current daemon session status.
- Continue live subscription from the latest sequence.

## Lifecycle Policy

### App Close

- App close detaches UI subscriptions.
- App close does not stop daemon-owned active sessions.
- Explicit Quit All or Stop Session actions may terminate sessions.

### Daemon Idle

- The daemon may shut down automatically only when there are no active sessions and retention windows have expired.
- Idle shutdown must be disabled while any session is running, awaiting approval/user input, or interrupting.

### Version Mismatch

- If the app and daemon protocol versions are incompatible, the app must not kill active sessions automatically.
- The app should surface a status that a daemon restart is required after active sessions finish.
- Starting new sessions may be blocked until compatibility is restored.

### Daemon Crash

Phase 1 does not guarantee survival if the daemon process itself crashes. Since the daemon owns the Codex child process, a daemon crash may terminate active sessions. Full daemon-crash survival requires a separate supervisor or an upstream attachable Codex app-server protocol and is outside the first implementation.

## Frontend State Integration

Frontend changes must keep existing event routing shape:

- `src/services/tauri.ts` exposes typed daemon-backed session calls.
- `src/services/events.ts` fans daemon session events into the same app-server event stream.
- `src/features/app/hooks/useAppServerEvents.ts` routes replayed and live events through existing thread handlers.
- Thread reducers treat replayed events as idempotent.
- UI can show session status and reconnect gaps without creating a second event model.

Debug requirements:

- Debug panel must include daemon session lifecycle events.
- Debug filters must support session/daemon/memory-related events where applicable.
- A status/debug command should expose daemon session counts, event journal counts, pending request counts, and attached client counts.

## Implementation Phases

### Phase 0: Contracts and Tests

- Add shared types for session status, journal events, pending requests, and reconnect responses.
- Add unit tests for event sequencing, replay bounds, retention, and idempotent pending request resolution.
- Add protocol version constants for daemon session RPC.

### Phase 1: Daemon-Owned New Sessions

- Route new sessions through daemon when the setting is enabled.
- Keep app-owned sessions as fallback when the setting is disabled.
- Ensure app close only detaches subscriptions.
- Ensure explicit stop kills the daemon-owned Codex child process tree.

### Phase 2: Event Journal and Replay

- Add per-session event journal in daemon.
- Attach frontend subscriptions with `from_seq`.
- Replay missed events on reconnect before live streaming is marked ready.
- Add tests for replay order and duplicate event handling.

### Phase 3: Pending Request Recovery

- Persist pending approvals/user-input requests in daemon memory.
- Rehydrate pending UI prompts after app restart.
- Make request responses idempotent.
- Add tests for reconnect while a request is pending.

### Phase 4: Lifecycle and Debuggability

- Add daemon idle policy that respects active sessions.
- Add debug/status visibility for live sessions, journals, pending requests, and subscribers.
- Add version mismatch behavior that does not kill active sessions.

### Phase 5: Cleanup

- Remove or narrow app-owned compatibility paths only after restart-safe daemon mode is fully covered by tests and manual validation.
- Update README/runbooks if daemon-owned sessions become the default.

## File Checklist

Backend shared/domain:

- `src-tauri/src/shared/*`
- `src-tauri/src/shared/process_core.rs`
- `src-tauri/src/types.rs`

Backend app adapter:

- `src-tauri/src/backend/app_server.rs`
- `src-tauri/src/codex/mod.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/storage.rs`

Backend daemon:

- `src-tauri/src/bin/codex_monitor_daemon.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/codex.rs`
- `src-tauri/src/bin/codex_monitor_daemon/transport.rs`
- `src-tauri/src/bin/codex_monitor_daemonctl.rs`

Frontend:

- `src/types.ts`
- `src/services/tauri.ts`
- `src/services/events.ts`
- `src/features/app/hooks/useAppServerEvents.ts`
- `src/features/settings/components/SettingsView.tsx`
- `src/features/settings/hooks/useAppSettings.ts`
- `src/features/threads/hooks/useThreadsReducer.ts`
- `src/features/threads/hooks/threadReducer/*`
- Debug panel and debug log hooks under `src/features/debug/*`

Docs:

- `docs/codebase-map.md`
- `README.md` if startup or default behavior changes.

## Validation Matrix

Run after implementation phases that touch code:

- TypeScript typecheck: `npm run typecheck`
- Frontend tests: `npm run test`
- Rust backend check: `cd src-tauri && cargo check`
- Focused tests for new shared session/journal/pending-request modules.

Manual Windows validation:

1. Enable restart-safe sessions.
2. Start a long-running Codex turn.
3. Close or restart only the Tauri UI process.
4. Confirm the daemon process and Codex child remain alive.
5. Reopen the app.
6. Confirm the same session is listed as live.
7. Confirm missed output replays in order.
8. Confirm new output streams live after reconnect.
9. Confirm pending approval/user-input prompts remain actionable.
10. Stop the session explicitly and confirm the child process tree exits.

## Acceptance Criteria

- Restarting the desktop app during an active turn does not interrupt the turn.
- Reconnected UI shows the correct live/completed/failed status.
- Missed events are replayed in order or the UI clearly falls back to refreshed thread state when replay retention is exceeded.
- Pending approval/user-input requests remain visible and answerable after UI restart.
- Explicit stop still terminates the correct session.
- Debug/status surfaces show enough daemon session state to diagnose reconnect behavior.
- App-owned fallback remains available until daemon-owned mode is validated and intentionally made default.
