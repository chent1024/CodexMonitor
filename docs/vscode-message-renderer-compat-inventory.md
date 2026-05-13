# VSCode Message Renderer Target Inventory

Canonical target:

- Extension: `openai.chatgpt`
- Version: `26.506.31421`
- Local reference root: `/Users/xihe0000/.vscode/extensions/openai.chatgpt-26.506.31421-darwin-arm64`
- Primary assets inspected:
  - `webview/assets/app-main-D--lSS3c.js`
  - `webview/assets/app-main-DT9r06ux.css`
  - `webview/assets/local-conversation-thread-B0Q1hXFe.js`
  - `webview/assets/command-messages-C-XkcS49.js`
  - `webview/assets/virtualized-turns-B9cUFdOx.js`
  - `webview/assets/user-message-attachments-BmNhah_B.js`
  - `webview/assets/thinking-shimmer-CbumgP6t.js`

This inventory is the live implementation target for `src/features/messages-vscode-compat/*`.

## DOM Landmarks

The target local conversation surface renders a conversation-scoped find target:

- Thread container: `data-thread-find-target="conversation"`.
- Composer/footer area: `data-thread-find-composer="true"`.
- Turn containers from virtualized rows: `data-turn-key="<turn-key>"`.
- Search turn key: `data-content-search-turn-key="<user-or-assistant-turn-key>"`.
- Assistant search key: `data-content-search-assistant-turn-key="assistant:<assistant-turn-id>"`.
- Unit search key: `data-content-search-unit-key="<turn-key>:<unit-id>"`.
- Unit kinds include `user-message`, `assistant-turn`, `reasoning`, `patch`, `web-search-group`, `multi-agent-group`, `pending-mcp-tool-calls`, and command/tool kinds.

CodexMonitor mirrors these with `data-turn-key`, `data-virtualizer-item-key`, `data-content-search-turn-key`, `data-content-search-assistant-turn-key`, `data-content-search-unit-key`, `data-content-search-unit-kind`, and `data-scroll-to-key`.

## Turn Layout

Target turn grouping is user-turn first, then the selected assistant turn:

- User turn key: `user:<user-turn-id>`.
- Assistant turn key: `assistant:<assistant-turn-id>`.
- User message search unit key: `<turn-key>:message`.
- Assistant message/search unit key: `<turn-key>:<assistant-id>:assistant`.
- Orphan assistant output is valid when a local history has no preceding visible user message.

CodexMonitor uses `buildVscodeMessagesViewModel` to adapt `ConversationItem[]` into these turn slots while preserving local orphan assistant entries.

## Message Rows

User message target structure:

- End-aligned wrapper.
- Optional attachment block above the text bubble.
- Metadata slot before the text bubble.
- Content bubble with max width near `77%`.
- Action row after the bubble with copy and local quote/edit affordances when available.

Assistant message target structure:

- Full-width assistant turn wrapper.
- Optional collapsed tool activity summary before the assistant prose.
- Assistant body motion wrapper and body stack.
- Footer with turn selector, assistant action row, and file-change summary where applicable.

CodexMonitor keeps local capabilities in these rows: Tauri file opening, file-link menu, copy, quote, image preview, diff output, plan follow-up, and user input.

## Activity Grouping

Target activity grouping is derived from output item types rather than visual-only CSS:

- `exec`: command execution and command-like exploration.
- `patch`: file changes and turn diffs.
- `web-search-group`: web search output and search exploration.
- `pending-mcp-tool-calls`: MCP tool calls, MCP elicitation, and user-input/request rows.
- `multi-agent-group`: collaboration/sub-agent actions.
- `reasoning`: reasoning rows.

Collapsed activity summary uses a `group/collapsed-tool-activity group/summary inline-flex ...` class pattern, `aria-expanded`, and a chevron. Expanded activity creates grouped rows and marks MCP bodies with `pending-mcp-tool-calls-body` / `data-pending-mcp-tool-calls-body`.

CodexMonitor centralizes this in `src/features/messages-vscode-compat/viewModel.ts` with `getActivityBlockKind`, `getOpenAIActivityItemTypes`, and `groupActivityItemsLikeOpenAI`.

## Action Rows

Target action surfaces:

- User message action row: copy plus edit when available.
- Assistant action row: copy, quote/local action where available, and turn selector when sibling turns exist.
- Assistant turn selector state includes selected turn index, sibling count, applied-code-local state, and fork callback identity.

CodexMonitor preserves local copy/quote behavior and exposes selector metadata with `data-assistant-turn-selector`, `data-selected-turn`, `data-selected-turn-id`, `data-sibling-turn-count`, `data-has-applied-code-locally`, and `data-on-fork-turn`.

## CSS Tokens

Target tokens and utility classes used by the message output area:

- Type and spacing: `text-size-chat`, `--codex-chat-font-size`, `--conversation-block-gap`, `--conversation-tool-assistant-gap`.
- Main surfaces: `--color-token-main-surface-primary`, `--color-token-bg-primary`, `--color-token-bg-subtle`.
- Foreground tokens: `--color-token-foreground`, `--color-token-text-secondary`, `--color-token-description-foreground`, `--color-token-input-placeholder-foreground`.
- Borders/focus: `--color-token-border`, `--color-token-border-light`, `--color-token-focus-border`.
- Diff surface: `--color-token-diff-surface`.

CodexMonitor maps these to its local design tokens in `src/styles/messages.css` and scopes the compatibility styles under `.messages`.

## Collapse Behavior

Target collapse states:

- Older/previous turns can collapse behind a summary.
- Tool activity starts collapsed when it is a closed activity slice.
- Activity rows expose `aria-expanded`.
- MCP app frames have explicit expanded/fullscreen state; inline body surfaces use `data-mcp-app-expanded="true"` when present.
- Reasoning has preview/expanded/collapsed states and uses a chevron.

CodexMonitor keeps collapse state local to the renderer unless durable protocol state is required. Current data is sufficient for message output parity; no backend or reducer escalation is required.

### Behavior Gap Detail

Target source: `openai.chatgpt-26.506.31421-darwin-arm64`.

Turn-level collapse uses target `qE`: collapse is allowed only after final assistant output starts, when the turn is not cancelled, and when renderable agent items exist. Default state is `persistedCollapsed ?? !preventAutoCollapse`. Target `JE` splits agent entries into `collapsibleEntries`, `expandedEntries`, `persistentEntries`, and `workedForItem`; `worked-for` is removed from the entry list, while steering user messages remain persistent when the turn is collapsed. Prior coChat behavior only hid the activity body under the summary and did not model this turn-level split.

Collapsed tool activity uses target `z_`: first expansion mounts the body, waits one `requestAnimationFrame`, then animates height and opacity. Collapse leaves the body mounted until the close animation completes. Summary is a button with `aria-expanded`, a hover chevron, and target-style grouped rows. Expanded grouping follows `T_`/`v_`: `exec`, `patch`, `reasoning`, `web-search-group`, `pending-mcp-tool-calls`, and `multi-agent-group`; pending MCP grouping stops for `computer-use`, `node_repl` `js/js_reset`, and auto-expanded MCP app calls. Prior coChat behavior did simple conditional rendering.

Reasoning target text is `Thinking`, `Thought`, or `Thought for {elapsed}`. It strips a leading bold heading from the body, and title-only reasoning only feeds the working indicator instead of rendering a body row. The bundle also exposes compact body heights `preview: 7rem`, `expanded: 20rem`, and `collapsed: 0px`; coChat previously used a boolean expanded/clamped row.

Command execution target keeps command text in a two-line clamped command header, supports expanding to full command, copying the command, a shell/output section capped around `140px` with scroll fade, copy output, and `No output` for empty output. The embedded row does not expose a separate output collapse/expand toolbar. Prior coChat used a terminal line window and lacked separate command/output controls.

User message target default `collapsedLineCount` is `20`. It measures rendered content through ResizeObserver, computes line height from CSS or a `13px` fallback with a `1.5` ratio, and treats content as uncollapsible when `scrollHeight <= collapsedHeight + 1px`. Collapsed style is `display: -webkit-box`, `overflow: hidden`, `WebkitBoxOrient: vertical`, `WebkitLineClamp: 20`, and `maxHeight: 20lh`; the toggle sits below the message with `Show more` / `Show less`, `aria-expanded`, and a rotating chevron. Prior coChat used the same default count but relied on a text-length heuristic.

Pending MCP target bodies use `data-testid="pending-mcp-tool-calls-body"`, `aria-expanded`, and internal `collapsed` / `expanded` view state. MCP apps have inline expanded and fullscreen state with `data-mcp-app-expanded="true"` and portal-target markers. User input and MCP elicitation are request rows, not generic tool rows. The target MCP app frame path is gated by an actual resource/app descriptor (`renderMcpApps` plus resource URI / descriptor metadata); plain `mcp-tool-call`, `mcp-server-elicitation`, `computer-use`, and `node_repl js/js_reset` items do not become app frames only because their item type or server name is MCP-like.

## 1:1 Difference Audit

| Item | Target behavior / structure | Current coChat implementation | 1:1 | Impact | Fix recommendation | Files |
| --- | --- | --- | --- | --- | --- | --- |
| Turn layout | `data-thread-find-target="conversation"`, virtualized `data-turn-key`, turn slots keyed by user and assistant search keys; orphan assistant turns are valid. | Mirrors conversation/turn/search keys through `buildVscodeConversationTurns` and `VscodeMessages`; local virtualizer is not the extension implementation. | Partial | DOM landmarks align, but virtualizer internals and exact scroll measurement are local. | Do not replace; keep local implementation unless a concrete scroll/search bug appears. | `src/features/messages-vscode-compat/VscodeMessages.tsx`, `conversationTurns.ts` |
| Collapsed turn | Target `qE` allows collapse only when final assistant output started, turn is not cancelled, and renderable agent items exist; `JE` removes `worked-for`, keeps steering user messages persistent, and uses `persistedCollapsed ?? !preventAutoCollapse`. | `getTurnCollapseState`, `splitTurnEntriesLikeOpenAI`, and `splitAssistantTurnBlocksLikeOpenAI` mirror those state rules and expose diagnostic `data-turn-*` attributes. | Yes for state model | Remaining differences are component instance, animation library, and telemetry callbacks. | No further renderer-only fix found. | `src/features/messages-vscode-compat/behavior.tsx`, `VscodeMessages.tsx` |
| Collapsed tool activity | Target `z_` summary is a button with `aria-expanded`, chevron, staged mount/close animation, activity item grouping by `exec`, `patch`, `reasoning`, `web-search-group`, `pending-mcp-tool-calls`, and `multi-agent-group`; elapsed summaries use `Worked for {time}`. | Uses target summary DOM, staged mount, grouped activity rows, `data-openai-activity-item-type`, pending MCP body markers, and `Worked for...` / previous-message labels. | Yes for renderer behavior | Component identity, telemetry, and animation library remain local instead of imported extension components. | No further renderer-only fix found outside runtime/component-instance boundaries. | `src/features/messages-vscode-compat/VscodeMessages.tsx`, `viewModel.ts`, `src/features/messages/utils/messageRenderUtils.ts` |
| Reasoning row | Target title is `Thinking`, `Thought`, or `Thought for {elapsed}`; body strips leading bold heading and cycles preview/expanded/collapsed with `7rem`, `20rem`, `0px`. | `VscodeReasoningRow` implements the same titles, body parsing, and height states. | Yes for visible renderer | Component internals are local React, not imported extension components. | No fix. | `src/features/messages-vscode-compat/ActivityRows.tsx`, `behavior.tsx` |
| Command execution row | Target embedded shell row has a 2-line command clamp, command click-to-expand, hover-only copy-command and copy-output utility buttons, `No output`, scroll fade, and output max height around `140px`. | `VscodeCommandOutput` now mirrors the embedded shell hierarchy and states: command `role=button`, `line-clamp-2`, hover copy buttons, no output toolbar, `No output`, scroll fade, and `140px` output max height. | Yes for embedded renderer behavior | The default/background terminal tab and xterm-style terminal runtime remain outside this message renderer row. | Fixed. Do not add a local output-collapse toolbar because the pinned target embedded row does not expose one. | `src/features/messages-vscode-compat/ActivityRows.tsx`, `src/styles/messages.css` |
| Pending MCP / user input request | Target rows are grouped under `pending-mcp-tool-calls`, use `data-testid="pending-mcp-tool-calls-body"`, `aria-expanded`, and request-specific rows for elicitation/user input. | User-input rows and MCP groups expose the same pending body markers and collapsed/expanded state. Some request-specific protocol detail is not represented in `ConversationItem`. | Partial | Known loss is request-specific payload detail beyond current typed item fields. | Do not fake detail in renderer; extend protocol/types only when a real target field is needed. | `src/features/messages-vscode-compat/ActivityRows.tsx`, `src/utils/threadItems.conversion.ts`, `src/types.ts` |
| Generic MCP tool call | Target groups plain MCP tool calls as pending MCP activity unless excluded by server/tool rules or converted to an MCP app by explicit descriptor. | `getPendingMcpGroupingKey` excludes `computer-use`, `node_repl js/js_reset`, and expanded MCP app descriptors; plain MCP rows stay generic. | Yes for grouping rule | Exact result block rendering is local markdown/tool summary. | No renderer-only fix. | `src/features/messages-vscode-compat/viewModel.ts`, `ActivityRows.tsx` |
| MCP app frame | Target requires resource/template metadata such as `openai/outputTemplate`, `ui.resourceUri`, `text/html;profile=mcp-app`, CSP/widget metadata, and renders an iframe/sandbox runtime. | coChat renders an inline frame placeholder from explicit local `mcpApp` descriptors with expanded/fullscreen markers and portal-target data; it does not import or execute the VS Code MCP app sandbox. | No | Iframe lifecycle, CSP, widget bridge, sandbox origin, and bundled app runtime are not 1:1. | Do not fix in renderer-only pass; this is an architecture/runtime boundary. | `src/features/messages-vscode-compat/ActivityRows.tsx`, `src/types.ts` |
| File diff / patch summary | Target patch rows group file-change activity, show file summary/stats, and use diff surfaces with `data-diffs*` landmarks. | coChat emits `data-diffs*` file cards, turn diff rows, file summary, stats, and local `PierreDiffBlock`. | Yes for renderer landmarks | Exact extension diff virtualizer internals and review callbacks are local runtime boundaries. | No further renderer-only fix found. | `src/features/messages-vscode-compat/ActivityRows.tsx`, `src/features/messages/components/MessageRows.tsx` |
| Assistant/user action rows | Target user actions are copy/edit when available; assistant actions are copy, quote/local action, and turn selector when siblings exist. | coChat keeps copy/quote, edit form for user rows, hover action opacity, and assistant turn selector metadata. | Yes for visible action rows | Callback implementations stay local because CodexMonitor owns Tauri/file/quote behavior. | No renderer-only fix; do not remove local callbacks for visual parity. | `src/features/messages/components/MessageRows.tsx`, `src/features/messages-vscode-compat/VscodeMessages.tsx` |
| Spacing, font, line-height | Target CSS has `text-size-chat`, `--codex-chat-font-size`, `--conversation-block-gap: 12px`, `--conversation-tool-assistant-gap: 16px`, and component fallback `var(--conversation-tool-assistant-gap, 8px)`. | coChat maps token names locally, sets the root gap to `16px`, and uses the same component fallback. | Yes for mapped renderer tokens | Token names resolve through coChat's local design system rather than Tailwind's generated runtime. | Fixed. | `src/styles/messages.css`, `src/features/messages-vscode-compat/VscodeMessages.tsx` |
| Hover and icon states | Target uses hover-only utility buttons for command/output, action-row opacity on hover, chevrons for disclosures, and focus-visible rings. | coChat implements hover opacity for command/output buttons and action rows, target chevrons for turn/user disclosure, and focus-visible states. | Yes for renderer behavior | Exact tooltip component identity remains local. | Fixed. | `src/features/messages/components/MessageRows.tsx`, `src/features/messages-vscode-compat/ActivityRows.tsx`, `src/styles/messages.css` |
| Empty/loading states | Target uses loading page / thinking shimmer for resume/loading and composer find target for footer. | coChat has local empty copy and loading indicator plus the thread composer marker. | Partial | Empty/loading page components are not message-row operations; no concrete mismatch was proven for the requested renderer states. | Leave as local app shell behavior unless a target screenshot or missing selector proves a defect. | `src/features/messages-vscode-compat/VscodeMessages.tsx`, `src/features/messages/components/MessageRows.tsx` |
| Raw Responses live routing | Target app-server stream pairs raw response items and function call outputs into stable activity rows. | Historical/resume raw adapter is covered; live `rawResponseItem/completed` pairing remains a reducer/app-server gap. | No | Live raw output can still replace or fail to pair with the originating tool row. | Do not fake in renderer; fix at protocol/reducer layer when scoped. | `src/utils/appServerEvents.ts`, `src/features/threads/hooks/*`, `src/utils/threadItems.*` |

## Gap Analysis

No backend/app-server/thread-reducer changes are required for the current pass, but the adapter must normalize raw Responses-style history items before the renderer can display tool activity.

Existing `ConversationItem` carries the target output state after normalization:

- `itemType` maps protocol output kinds such as `exec`, `patch`, `web-search`, `mcp-tool-call`, `multi-agent-action`, `reasoning`, `turn-diff`, and stream errors.
- Message metadata fields cover attachments, images, parent/fork context, user edit affordances, sibling turn selector state, artifacts, and code-block rendering flags.
- Tool fields cover command output, generated images, MCP app descriptors, multi-agent rows, turn diff rows, file changes, duration/status, web search, local image view, and collab sender/receiver metadata.
- User input and reasoning have stable IDs and enough local state for collapse/expand.

Renderer-only differences such as CSS tokens, hover states, row wrappers, and `data-*` landmarks remain frontend compatibility work and must not be escalated into app-server normalization.

Raw history normalization owned by `src/utils/threadItems.conversion.ts`:

- `response_item.payload` wrappers are unwrapped when present.
- `message` content arrays are converted to user/assistant messages.
- Empty encrypted-only `reasoning` items are omitted because there is no visible text to render.
- `function_call exec_command` and subsequent `function_call_output` become one `commandExecution` item.
- `write_stdin` and `wait` outputs are merged into the active command by session ID.
- `custom_tool_call apply_patch` becomes a `patch` item.
- `update_plan`, `view_image`, `request_user_input`, `web_search_call`, `image_generation_call`, and unknown function calls are preserved as typed tools rather than dropped.
- Normalized app-server item aliases cover `autoApprovalReview`, `imageGeneration`, `context_compaction`, `model_change`, and `model_reroute` variants before they enter the VS Code-compatible view model.
- User `steeringStatus` is now preserved on `ConversationItem` so target `JE` persistent steering-message behavior is not approximated through `messageStatus`.
- Error-like app-server signals now enter the same activity model: `error` and `thread/realtime/error` become `stream-error`, `codex/stderr` becomes `system-error`, and live reconnect failures become `stream-error`.

Remaining app-server protocol gaps are outside renderer-only adaptation:

- Live `rawResponseItem/completed` routing needs reducer-level call/output pairing. The history adapter already displays raw Responses sessions, but blindly upserting live raw output can replace the originating tool row.
- `item/mcpToolCall/progress` is applied to MCP tool rows through the normal item upsert path.
- `item/autoApprovalReview/started` / `completed` are routed as `automatic-approval-review` items.
- `mcpServer/elicitation/request`, `item/tool/call`, and `serverRequest/resolved` use the existing user-input, dynamic tool-call, and queue cleanup paths. Remaining risk is payload-specific detail that has no dedicated `ConversationItem` field yet.

Final renderer acceptance remaining risk:

- MCP app rows intentionally render local frame state and portal markers from explicit `mcpApp` descriptors only. CodexMonitor does not import or execute the VS Code extension bundle's MCP sandbox/portal runtime, so iframe process behavior is not expected to be 1:1 in the renderer-only compatibility pass.
- Command output and collapsed activity rows now follow the target DOM landmarks, disclosure states, labels, line clamps, copy affordances, and max-height behavior. They still should not be described as imported VS Code component instances because the extension bundle remains reference-only.
- Live `rawResponseItem/completed` routing is still a protocol/reducer gap. The renderer can show normalized history, but live raw item pairing must be solved before claiming live-stream 1:1 behavior.
