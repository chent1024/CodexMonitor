# VSCode Message Renderer Compatibility

This document is the execution contract for aligning the CodexMonitor message output area with the OpenAI ChatGPT VS Code extension.

## Target

The target visual and DOM baseline is:

- Extension: `openai.chatgpt`
- Version: `26.506.31421`
- Local reference path: `/Users/xihe0000/.vscode/extensions/openai.chatgpt-26.506.31421-darwin-arm64`
- Primary reference assets:
  - `webview/assets/app-main-D--lSS3c.js`
  - `webview/assets/app-main-DT9r06ux.css`
  - `webview/assets/local-conversation-thread-B0Q1hXFe.js`
  - `webview/assets/command-messages-C-XkcS49.js`
  - `webview/assets/virtualized-turns-B9cUFdOx.js`

The goal is comprehensive alignment of the message output area structure and styling with this version: turn layout, message rows, assistant activity grouping, tool rows, reasoning rows, patch/file-change surfaces, action rows, class names, data attributes, CSS tokens, spacing, collapse behavior, and empty/loading states.

Current target inventory and gap analysis live in:

- `docs/vscode-message-renderer-compat-inventory.md`

## Scope

In scope:

- Frontend message rendering only.
- `ConversationItem` to VS Code-compatible view model adapters.
- DOM structure and data attributes needed to mirror the target extension.
- CSS tokens and component styles needed by the target message output surface.
- Screenshot and DOM regression tests for representative conversation states.
- Protocol or reducer extensions when, and only when, the target `openai.chatgpt 26.506.31421` message output requires state that cannot be derived from existing `ConversationItem` data.

Out of scope:

- Backend app-server protocol changes made only for visual convenience.
- Thread reducer semantic changes made before proving the adapter cannot represent the target state.
- Tauri command, daemon RPC, or storage changes that are not required by the message-output compatibility contract.
- Directly embedding the VS Code extension bundle as the runtime renderer.
- Replacing CodexMonitor file opening, copy, quote, image, diff, or Tauri integration behavior with VS Code APIs.

## Architecture

`src/features/messages/components/Messages.tsx` must remain a thin compatibility entrypoint.

The implementation belongs under:

- `src/features/messages-vscode-compat/VscodeMessages.tsx`
- `src/features/messages-vscode-compat/conversationTurns.ts`
- Future files in `src/features/messages-vscode-compat/*`

The renderer may reuse stable local primitives from `src/features/messages/components/*` while the compatibility layer is being built, but new structure and style work should move into `src/features/messages-vscode-compat/*` instead of expanding the legacy message component.

The intended data flow is:

1. app-server and Tauri events update existing thread state.
2. Existing thread state produces `ConversationItem[]`.
3. The compatibility adapter converts `ConversationItem[]` into VS Code-compatible turn/view models.
4. The compatibility renderer emits the target DOM structure and classes.
5. Local CodexMonitor callbacks provide file opening, quote, copy, image preview, plan follow-up, and user-input submission.

## Scroll and Pagination Contract

The message pane follows the VS Code-style bottom-anchored scroll model instead of a normal top-anchored list.

- `src/features/messages-vscode-compat/VscodeMessages.tsx` owns the scroll container and sets `data-thread-reverse-scroll="true"`.
- `src/features/messages/utils/threadScroll.ts` is the only helper surface for translating between DOM `scrollTop` and logical distance from the bottom.
- Message scroll writes must route through the `ThreadScrollController` exposed by `useMessagesViewState`; virtual row measurement, footer height changes, pagination restore, and explicit bottom pinning must not write `scrollTop` directly.
- In reverse scroll mode, the visual bottom is `scrollTop === 0`; scrolling upward is represented by a negative `scrollTop`.
- Per-thread restoration stores logical distance from the bottom, scoped by `workspaceId:threadId`.
- A thread that was left pinned to bottom must return pinned to bottom after switching away and back.
- A thread that was left scrolled upward must return to the same logical distance from bottom.
- Loading older history must preserve the current logical distance from bottom before the browser paints the prepended content.
- Composer/footer height changes must keep pinned threads pinned and must preserve non-pinned logical distance.
- The composer is rendered as the message footer through `ChatPane` cloning `footerNode`; message content and composer width must come from the same scroll container width.
- Virtualized turns use VS Code-style bottom-offset layout math with binary range lookup. Each rendered virtual item must expose `data-turn-key` so turn-key anchoring/search can target stable turn identities.
- If a thread returns before enough content has rendered to satisfy its saved distance, the restore remains pending and is retried on content resize instead of being replaced by the temporary clipped scroll position.

Historical pagination is already wired through the thread action layer:

1. `useMainAppLayoutSurfaces` passes `hasOlderTurns`, `isLoadingOlderTurns`, and `onLoadOlderTurns` to `Messages`.
2. `Messages` calls `onLoadOlderTurns` when the reverse scroll container is near the oldest edge.
3. `useThreadActions.loadOlderThreadTurns` calls `list_thread_turns` with the stored cursor and the VS Code page size.
4. The reducer merges older items with `preserveHistory: true` and updates `threadTurnsCursorById` / `threadTurnsHasLoadedOldestById`.

Do not reintroduce height-delta `scrollTop += delta` restoration in the message renderer. Prepend restoration must be distance-from-bottom based so it works with normal, reverse, and virtualized layouts.

## Backend and Reducer Escalation

Default to frontend adaptation. Backend protocol or reducer changes are allowed only after a short written gap analysis proves that the target extension exposes message-output state that CodexMonitor does not currently preserve.

Allowed escalation examples:

- A target activity group needs a stable item subtype or lifecycle state that is dropped by current app-server event normalization.
- A target expanded/collapsed state needs a durable item identity that cannot be reconstructed from existing IDs.
- A target tool/result row needs structured fields that are currently flattened into text and cannot be reliably parsed.
- A target turn selector or alternate-response surface needs sibling-turn metadata missing from thread state.

Not valid escalation reasons:

- Matching spacing, typography, colors, icons, hover states, or DOM wrappers.
- Avoiding adapter work.
- Recreating VS Code extension internal state wholesale.
- Moving renderer-owned UI state into reducers for convenience.

When escalation is required, follow the repo routing contract:

1. Document the missing target state and the target selector/component that needs it.
2. Add or adjust the app-server event/type normalization layer: `src/utils/appServerEvents.ts`, `src/features/app/hooks/useAppServerEvents.ts`, and related tests.
3. Update thread item conversion and reducer state only at the narrow ownership point: `src/utils/threadItems.*`, `src/features/threads/hooks/useThreadsReducer.ts`, and `src/features/threads/hooks/threadReducer/*`.
4. Update `src/types.ts` so the renderer receives typed data, not ad hoc parsed blobs.
5. If a backend command or remote daemon surface must change, follow app/daemon parity:
   - Shared core first when behavior is cross-runtime.
   - App adapter and Tauri command surface.
   - Frontend IPC wrapper.
   - Daemon RPC surface.
   - Contract tests for both app and daemon paths.
6. Keep the compatibility renderer consuming typed view models. Do not let it parse raw app-server payloads directly.

### Current Adapter Gap

The app and daemon `thread/resume` surfaces forward app-server thread data without backend reshaping. Historical Codex sessions may expose raw Responses-style items inside thread turns, including:

- `message` with `content[]` entries such as `input_text` and `output_text`.
- `reasoning` with optional visible summary/content and encrypted content.
- `function_call` / `function_call_output` for shell and local tools.
- `custom_tool_call` / `custom_tool_call_output` for `apply_patch`.
- `web_search_call` for web search, page open, and find-in-page activity.

These are message-output state that can be normalized into existing `ConversationItem` fields. No backend, Tauri, daemon, or reducer contract change is required for this gap. The normalization owner is `src/utils/threadItems.conversion.ts`; the compatibility renderer continues to consume typed `ConversationItem[]`.

Current raw-item adapter coverage:

- `message` user/assistant -> `ConversationItem` message with stable synthetic IDs when history lacks item IDs.
- `function_call exec_command` + matching `function_call_output` -> `commandExecution` tool, including command, working directory, output, duration, and status.
- `function_call write_stdin` / `wait` outputs -> merged back into the active command by terminal session ID, rather than displayed as separate polling tools.
- `custom_tool_call apply_patch` + output -> `fileChange`/`patch` tool.
- `function_call update_plan` -> `plan` tool.
- `function_call view_image` -> `imageView` tool with local image preview data.
- `function_call request_user_input` -> `requestUserInput` tool preserving questions and options for history display.
- `web_search_call` -> `webSearch` tool.
- `image_generation_call` -> `generatedImage` tool with `generated-image` item type.
- Unknown function calls -> `dynamicToolCall`, preserving name, arguments, status, and output where available.

Current normalized app-server item adapter coverage:

- OpenAI item aliases normalize camelCase, kebab-case, and known snake_case forms before rendering.
- `autoApprovalReview` / `automaticApprovalReview` -> `automatic-approval-review`.
- `imageGeneration` / `image_generation` / `imageGenerationCall` -> `generated-image`.
- `contextCompaction` / `context_compaction` / `compaction` -> `context-compaction`.
- `modelChanged` / `model_change` and `modelRerouted` / `model_reroute` -> their OpenAI item types.
- App-server `error`, `thread/realtime/error`, and live reconnect failures are surfaced as `stream-error` or `system-error` tool activity items rather than plain assistant prose. `codex/stderr` is treated as debug/log output and is not rendered in the conversation transcript.

Protocol gaps that still require app-server/thread-event work rather than renderer-only adaptation:

- `rawResponseItem/completed`: not routed live yet. Historical/resume paths are covered by the raw adapter, but live raw response events need reducer-level call/output pairing so `function_call_output` cannot replace the originating tool row.
- `item/mcpToolCall/progress` is routed into the existing MCP tool row by item id and updates status/output without replacing richer history fields.
- `item/autoApprovalReview/started` and `item/autoApprovalReview/completed` are routed into the normal item lifecycle as `automatic-approval-review`.
- `mcpServer/elicitation/request`, `item/tool/call`, and `serverRequest/resolved` are routed into existing user-input/request cleanup and dynamic tool-call paths. The remaining non-1:1 part is request-specific protocol detail beyond the fields currently exposed in `ConversationItem`.
- Non-message-output notifications such as `model/rerouted`, `configWarning`, `deprecationNotice`, MCP server startup/OAuth, skills changed, realtime audio/transcript events, and Windows sandbox warnings remain protocol parity gaps tracked in `docs/app-server-events.md`.

## Reference Extraction Rules

Use the `26.506.31421` extension assets as a reference, not as a runtime dependency.

Allowed:

- Inspect bundle strings, CSS selectors, class names, data attributes, and component layout patterns.
- Port CSS tokens/selectors that are necessary for message output alignment.
- Recreate component structure in typed React source.
- Add small compatibility shims for view-model shape, theme tokens, and local callback wiring.

Not allowed:

- Import or execute the extension bundle inside CodexMonitor.
- Depend on `acquireVsCodeApi`, VS Code webview globals, VS Code command routing, or extension storage.
- Patch files inside `/Users/xihe0000/.vscode/extensions/...` as part of this repo implementation.
- Move app-server event parsing, Tauri IPC, or thread reducer ownership into the renderer.
- Continue broad visual fixes directly in `src/features/messages/components/Messages.tsx`.

## Execution Order

Follow this order. Do not start with broad CSS tweaks.

1. Inventory target structures from `openai.chatgpt 26.506.31421`.
   - Capture the message output DOM landmarks, `data-*` attributes, activity group names, action row structure, and major CSS selectors.
   - Record the inventory in this document or a child doc before changing behavior.

2. Complete the adapter boundary.
   - Keep `ConversationItem` as the input contract.
   - Build typed view models for user turns, assistant turns, activity groups, tool items, reasoning items, patch/file changes, and message actions.
   - Unit test turn grouping and representative item mapping.

3. Escalate data contracts only if required.
   - Write the gap analysis first.
   - Update protocol, normalization, reducer, and types through the narrowest path.
   - Add tests that prove the new state reaches the compatibility view model.

4. Rebuild renderer structure in `messages-vscode-compat`.
   - Match target DOM hierarchy first.
   - Keep existing local callbacks wired through props.
   - Prefer small components with explicit view-model props.

5. Port message-output CSS.
   - Move compatibility CSS into a clearly named compatibility section or file.
   - Prefer target token names when they describe target behavior.
   - Keep CodexMonitor shell/design-system styling outside the message renderer.

6. Add regression coverage.
   - Unit tests for adapter mapping.
   - DOM tests for required target landmarks.
   - Screenshot tests for key states before declaring structural/style parity.

7. Remove obsolete legacy message structure only after parity tests cover the replaced behavior.

## Acceptance Matrix

The renderer is not considered aligned until these states match the target extension at the structure and style level:

- Empty thread and loading thread.
- Single user message.
- User message with image attachment.
- Assistant markdown message with code block, table, and file links.
- Reasoning item collapsed and expanded.
- Command execution item collapsed and expanded.
- File-change/patch item with per-file summary and diff body.
- Web search activity group.
- MCP/user-input request activity.
- Multi-agent/collaboration tool activity.
- Failed tool or stream error state.
- Assistant message action row: copy, quote when available, and turn selector when alternates exist.
- Long output with scroll/fold behavior.
- Mixed conversation with multiple user turns and orphan assistant entries.

## Validation

Run these after each meaningful step:

```bash
npm run typecheck
npm run test -- src/features/messages-vscode-compat src/features/messages/components/Messages.test.tsx src/features/messages/utils/threadScroll.test.ts
```

Run the full frontend suite before handoff:

```bash
npm run test
```

For structure/style parity milestones, add and run screenshot coverage against representative message fixtures. Do not rely on a passing unit suite as visual parity proof.

For scroll milestones, verify these runtime states in the WebView or browser:

- A streaming response stays pinned above the composer.
- A user-scrolled thread does not snap to bottom while new output arrives.
- Switching away from a bottom-pinned thread and back keeps it pinned.
- Switching away from a scrolled-up thread and back restores the same visual position.
- Scrolling to the oldest edge loads older turns and does not jump after the page prepends.
- Mobile/touch scroll still moves vertically with the composer safe-area padding applied.

If protocol, reducer, app-server, or backend surfaces change, also run the targeted tests for those files and the relevant app/daemon parity checks. Backend changes require:

```bash
cd src-tauri && cargo check
```

## Current Baseline

The compatibility branch starts from `209a59f feat(frontend): 对齐聊天消息区与 diff 渲染`.

Current source boundaries:

- `src/features/messages/components/Messages.tsx` is a thin export.
- `src/features/messages-vscode-compat/VscodeMessages.tsx` owns the compatibility renderer.
- `src/features/messages-vscode-compat/conversationTurns.ts` owns turn grouping and search metadata helpers.

Preserve this boundary as the implementation evolves.
