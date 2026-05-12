import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Quote from "lucide-react/dist/esm/icons/quote";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import { PlanReadyFollowupMessage } from "../../app/components/PlanReadyFollowupMessage";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import {
  formatCount,
  formatActivitySummary,
  parseReasoning,
  type AssistantTurn,
  type AssistantTurnBlock,
  type AssistantTurnActivityBlock,
  type MessageListEntry,
} from "../utils/messageRenderUtils";
import {
  DiffRow,
  ExploreRow,
  FileChangeSummaryCard,
  type FileChangeEntry,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  ToolRow,
  UserInputRow,
  WorkingIndicator,
} from "./MessageRows";
import { useMessagesViewState } from "./useMessagesViewState";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isLoadingMessages?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onOpenThreadLink?: (threadId: string, workspaceId?: string | null) => void;
  onQuoteMessage?: (text: string) => void;
};

function formatActivityDurationLabel(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatAssistantTurnActivityStatus(turn: AssistantTurn) {
  if (typeof turn.durationMs === "number") {
    return `已处理 ${formatActivityDurationLabel(turn.durationMs)}`;
  }
  if (turn.toolCount > 0) {
    return `已处理 ${turn.toolCount} 个操作`;
  }
  return "已处理";
}

function activityBlockHasFileChange(block: AssistantTurnActivityBlock) {
  return block.items.some((item) => item.kind === "tool" && item.toolType === "fileChange");
}

function getToolActivityKind(item: ConversationItem) {
  if (item.kind === "explore") {
    const hasSearch = item.entries.some((entry) => entry.kind === "search");
    return hasSearch ? "web-search-group" : "exploration";
  }
  if (item.kind === "reasoning") {
    return "reasoning";
  }
  if (item.kind === "userInput") {
    return "pending-mcp-tool-calls";
  }
  if (item.kind !== "tool") {
    return item.kind;
  }
  if (item.toolType === "collabToolCall") {
    return "multi-agent-group";
  }
  if (item.toolType === "webSearch") {
    return "web-search-group";
  }
  if (item.toolType === "fileChange") {
    return "patch";
  }
  if (item.toolType.toLowerCase().includes("mcp")) {
    return "pending-mcp-tool-calls";
  }
  return item.toolType;
}

function getOpenAIActivityItemType(item: ConversationItem) {
  if (item.kind === "message") {
    return item.itemType ?? (item.role === "assistant" ? "assistant-message" : "user-message");
  }
  if (item.kind === "reasoning") {
    return "reasoning";
  }
  if (item.kind === "userInput") {
    return "userInput";
  }
  if (item.kind === "explore") {
    return item.entries.some((entry) => entry.kind === "search") ? "web-search" : "exec";
  }
  if (item.kind === "tool") {
    return item.itemType ?? getToolActivityKind(item);
  }
  return item.kind;
}

function getOpenAIActivityItemTypes(items: ConversationItem[]) {
  return Array.from(new Set(items.map(getOpenAIActivityItemType).filter(Boolean)));
}

function getActivityBlockKind(block: AssistantTurnActivityBlock) {
  const kinds = new Set(block.items.map(getToolActivityKind));
  if (kinds.has("patch")) {
    return "patch";
  }
  if (kinds.has("multi-agent-group")) {
    return "multi-agent-group";
  }
  if (kinds.has("web-search-group")) {
    return "web-search-group";
  }
  if (kinds.has("pending-mcp-tool-calls")) {
    return "pending-mcp-tool-calls";
  }
  return kinds.values().next().value ?? "tool";
}

type OpenAIActivityGroup = {
  id: string;
  kind: string;
  items: AssistantTurnActivityBlock["items"];
  summary: string;
  toolCount: number;
  messageCount: number;
  durationMs: number | null;
};

const conversationDetailLevel = "STEPS_PROSE";
const shouldAutoExpandMcpApps = false;
const mcpServerStatuses: Record<string, string> = {};

function groupActivityItemsLikeOpenAI({
  block,
  isActivitySliceClosed,
}: {
  block: AssistantTurnActivityBlock;
  isActivitySliceClosed: boolean;
}): OpenAIActivityGroup[] {
  if (isActivitySliceClosed) {
    return [
      {
        id: block.id,
        kind: getActivityBlockKind(block),
        items: block.items,
        summary: block.summary,
        toolCount: block.toolCount,
        messageCount: block.messageCount,
        durationMs: block.durationMs,
      },
    ];
  }
  const groups: OpenAIActivityGroup[] = [];
  let current: OpenAIActivityGroup | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    groups.push(current);
    current = null;
  };

  block.items.forEach((item) => {
    const kind = getToolActivityKind(item);
    const canGroup =
      kind === "pending-mcp-tool-calls" ||
      kind === "multi-agent-group" ||
      kind === "web-search-group";
    if (!canGroup) {
      flush();
      groups.push({
        id: `${block.id}:${item.id}`,
        kind,
        items: [item],
        summary: formatActivitySummary([item]),
        toolCount: item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0,
        messageCount: item.kind === "tool" || item.kind === "explore" ? 0 : 1,
        durationMs: item.kind === "tool" ? item.durationMs ?? null : null,
      });
      return;
    }
    if (!current || current.kind !== kind) {
      flush();
      current = {
        id: `${block.id}:${kind}:${item.id}`,
        kind,
        items: [],
        summary: "",
        toolCount: 0,
        messageCount: 0,
        durationMs: null,
      };
    }
    current.items.push(item);
    current.summary = formatActivitySummary(current.items);
    current.toolCount += item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0;
    current.messageCount += item.kind === "tool" || item.kind === "explore" ? 0 : 1;
    if (item.kind === "tool" && typeof item.durationMs === "number") {
      current.durationMs = (current.durationMs ?? 0) + item.durationMs;
    }
  });
  flush();
  return groups;
}

function activityBlocksFromTurn(turn: AssistantTurn) {
  return turn.blocks.flatMap((block) =>
    block.kind === "activity" ? block.items : [],
  );
}

function collectTurnFileChanges(turn: AssistantTurn): FileChangeEntry[] {
  return turn.blocks.flatMap((block) => {
    if (block.kind !== "activity") {
      return [];
    }
    return block.items.flatMap((item) => {
      if (item.kind !== "tool" || item.toolType !== "fileChange") {
        return [];
      }
      return item.changes ?? [];
    });
  });
}

function summarizeAssistantBlocks(blocks: AssistantTurnBlock[]) {
  const activityBlocks = blocks.filter(
    (block): block is AssistantTurnActivityBlock => block.kind === "activity",
  );
  const toolCount = activityBlocks.reduce((total, block) => total + block.toolCount, 0);
  const messageCount = activityBlocks.reduce((total, block) => total + block.messageCount, 0);
  const durationValues = activityBlocks
    .map((block) => block.durationMs)
    .filter((duration): duration is number => duration !== null);
  const durationMs =
    durationValues.length > 0
      ? durationValues.reduce((total, duration) => total + duration, 0)
      : null;
  return { toolCount, messageCount, durationMs };
}

function mergeAssistantAgentEntries(entries: MessageListEntry[]): MessageListEntry[] {
  const merged: MessageListEntry[] = [];
  let assistantBuffer: AssistantTurn | null = null;

  const flushAssistantBuffer = () => {
    if (!assistantBuffer) {
      return;
    }
    const summary = summarizeAssistantBlocks(assistantBuffer.blocks);
    merged.push({
      kind: "assistantTurn",
      turn: {
        ...assistantBuffer,
        ...summary,
      },
    });
    assistantBuffer = null;
  };

  const appendAssistantBlocks = (id: string, blocks: AssistantTurnBlock[]) => {
    if (!assistantBuffer) {
      assistantBuffer = {
        id,
        blocks: [],
        toolCount: 0,
        messageCount: 0,
        durationMs: null,
      };
    } else {
      assistantBuffer.id = `${assistantBuffer.id}-${id}`;
    }
    assistantBuffer.blocks.push(...blocks);
  };

  entries.forEach((entry) => {
    if (entry.kind === "assistantTurn") {
      appendAssistantBlocks(entry.turn.id, entry.turn.blocks);
      return;
    }
    if (
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "assistant"
    ) {
      appendAssistantBlocks(`assistant-turn-${entry.item.id}`, [
        { kind: "message", message: entry.item },
      ]);
      return;
    }
    flushAssistantBuffer();
    merged.push(entry);
  });

  flushAssistantBuffer();
  return merged;
}

export const Messages = memo(function Messages({
  items,
  threadId,
  workspaceId = null,
  isThinking,
  isLoadingMessages = false,
  processingStartedAt = null,
  lastDurationMs = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
  workspacePath = null,
  openTargets,
  selectedOpenAppId,
  codeBlockCopyUseModifier = false,
  showMessageFilePath = true,
  userInputRequests = [],
  onUserInputSubmit,
  onPlanAccept,
  onPlanSubmitChanges,
  onOpenThreadLink,
  onQuoteMessage,
}: MessagesProps) {
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
  );
  const assistantSelectionSnapshotRef = useRef<string | null>(null);
  const [selectedTurnById, setSelectedTurnById] = useState<Record<string, number>>({});
  const handleOpenThreadLink = useCallback(
    (threadId: string) => {
      onOpenThreadLink?.(threadId, workspaceId ?? null);
    },
    [onOpenThreadLink, workspaceId],
  );
  const getSelectedAssistantText = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const selectedText = selection.toString().trim();
    return selectedText || null;
  }, []);

  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const userInputNode =
    hasActiveUserInputRequest && onUserInputSubmit ? (
      <RequestUserInputMessage
        requests={userInputRequests}
        activeThreadId={threadId}
        activeWorkspaceId={workspaceId}
        onSubmit={onUserInputSubmit}
      />
    ) : null;
  const {
    bottomRef,
    containerRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    copiedMessageId,
    handleCopyMessage,
    handleQuoteMessage,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  } = useMessagesViewState({
    items,
    threadId,
    isThinking,
    activeUserInputRequestId,
    hasVisibleUserInputRequest,
    onPlanAccept,
    onPlanSubmitChanges,
    onQuoteMessage,
  });

  const planFollowupNode =
    planFollowup.shouldShow && onPlanAccept && onPlanSubmitChanges ? (
      <PlanReadyFollowupMessage
        onAccept={() => {
          dismissPlanFollowup();
          onPlanAccept();
        }}
        onSubmitChanges={(changes) => {
          dismissPlanFollowup();
          onPlanSubmitChanges(changes);
        }}
      />
    ) : null;

  const renderAssistantTurnActivity = (
    turn: AssistantTurn,
  ) => {
    const activityId = `assistant-turn-activity-${turn.id}`;
    const isExpanded = expandedItems.has(activityId);
    const activityItems = activityBlocksFromTurn(turn);
    const activityKind = getActivityBlockKind({
      kind: "activity",
      id: activityId,
      summary: formatAssistantTurnActivityStatus(turn),
      items: activityItems,
      toolCount: turn.toolCount,
      messageCount: turn.messageCount,
      durationMs: turn.durationMs,
    });
    const openAIItemTypes = getOpenAIActivityItemTypes(activityItems);
    return (
      <div
        key={activityId}
        className="group/inline group/collapsed-tool-activity flex w-full flex-col gap-0 oai-inline-group oai-collapsed-tool-activity"
        data-oai-inline-group
        data-collapsed-tool-activity
        data-collapsed-tool-activity-type={activityKind}
        data-collapsed-tool-activity-expanded={isExpanded ? "true" : "false"}
        data-conversation-detail-level={conversationDetailLevel}
        data-is-activity-slice-closed={!isExpanded ? "true" : "false"}
        data-should-auto-expand-mcp-apps={shouldAutoExpandMcpApps ? "true" : "false"}
        data-mcp-server-statuses={JSON.stringify(mcpServerStatuses)}
        data-openai-activity-item-types={openAIItemTypes.join(" ")}
      >
        <div
          className="w-full min-w-0 oai-collapsed-tool-activity-offset"
          data-collapsed-tool-activity-offset
        >
          <div className="flex w-full min-w-0 flex-col oai-collapsed-tool-activity-stack">
            <button
              type="button"
              className="group/section-toggle group/summary text-size-chat hover:bg-token-bg-subtle inline-flex w-fit max-w-full cursor-interaction items-center gap-1 self-start rounded-md border border-transparent text-left focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:outline-none oai-section-toggle oai-collapsed-tool-activity-summary"
              onClick={() => toggleExpanded(activityId)}
              aria-expanded={isExpanded}
              data-oai-section-toggle
              data-collapsed-tool-activity-summary
            >
              <span className="shrink overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_0.25rem),transparent)] [mask-repeat:no-repeat] pr-1 group-hover/collapsed-tool-activity:text-token-foreground oai-collapsed-tool-activity-text">
                {formatAssistantTurnActivityStatus(turn)}
              </span>
              {openAIItemTypes.map((itemType) => (
                <span
                  key={itemType}
                  hidden
                  aria-hidden="true"
                  data-openai-activity-item
                  data-openai-activity-item-type={itemType}
                />
              ))}
              <span
                className={`inline-chevron icon-2xs flex-shrink-0 text-token-input-placeholder-foreground opacity-0 transition-transform duration-200 group-hover/summary:opacity-100 oai-collapsed-tool-activity-chevron ${
                  isExpanded ? "is-expanded rotate-90 opacity-100" : "rotate-0"
                }`}
                aria-hidden
              >
                <ChevronRight className="icon-2xs text-current transition-transform duration-300" size={10} />
              </span>
            </button>
            <div
              className="text-size-chat pt-1 text-token-text-secondary oai-collapsed-tool-activity-divider-shell"
              aria-hidden
            >
              <div className="w-full border-t border-token-border-light oai-collapsed-tool-activity-divider" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAssistantTurnActivityTimeline = (
    block: AssistantTurnActivityBlock,
    turnActivityExpanded: boolean,
  ) => {
    if (!turnActivityExpanded) {
      return null;
    }
    const groups = groupActivityItemsLikeOpenAI({
      block,
      isActivitySliceClosed: !turnActivityExpanded,
    });
    return groups.map((group) => {
    const isExpanded = expandedItems.has(group.id);
    const activityBodyId = `assistant-turn-activity-body-${group.id}`;
    const groupBlock: AssistantTurnActivityBlock = {
      kind: "activity",
      id: group.id,
      summary: group.summary,
      items: group.items,
      toolCount: group.toolCount,
      messageCount: group.messageCount,
      durationMs: group.durationMs,
    };
    const ActivityIcon = activityBlockHasFileChange(groupBlock) ? Pencil : SquareTerminal;
    const activityKind = group.kind;
    const openAIItemTypes = getOpenAIActivityItemTypes(group.items);
    return (
      <div
        key={group.id}
        className="group/inline group/tool-activity flex w-full min-w-0 flex-col gap-0 oai-inline-group oai-tool-activity-row"
        data-oai-inline-group
        data-collapsed-tool-activity-item
        data-collapsed-tool-activity-item-type={activityKind}
        data-oai-tool-activity-kind={activityKind}
        data-collapsed-tool-activity-item-expanded={isExpanded ? "true" : "false"}
        data-conversation-detail-level={conversationDetailLevel}
        data-is-activity-slice-closed={!turnActivityExpanded ? "true" : "false"}
        data-should-auto-expand-mcp-apps={shouldAutoExpandMcpApps ? "true" : "false"}
        data-mcp-server-statuses={JSON.stringify(mcpServerStatuses)}
        data-openai-activity-item-types={openAIItemTypes.join(" ")}
      >
        <div className="w-full min-w-0 oai-tool-activity-offset" data-oai-tool-activity-offset>
          <div className="flex w-full min-w-0 flex-col oai-tool-activity-stack-shell">
            <button
              type="button"
              className="group/section-toggle inline-flex w-fit max-w-full items-center self-start text-left oai-section-toggle oai-tool-activity-summary"
              onClick={() => toggleExpanded(group.id)}
              aria-expanded={isExpanded}
              aria-controls={activityBodyId}
              data-oai-section-toggle
              data-oai-tool-activity-summary
            >
              <ActivityIcon className="oai-tool-activity-icon" size={13} aria-hidden />
              <span className="oai-tool-activity-text">
                {group.summary}
              </span>
              {openAIItemTypes.map((itemType) => (
                <span
                  key={itemType}
                  hidden
                  aria-hidden="true"
                  data-openai-activity-item
                  data-openai-activity-item-type={itemType}
                />
              ))}
            </button>
            {isExpanded && (
              <div
                className={`oai-tool-activity-body${activityKind === "pending-mcp-tool-calls" ? " pending-mcp-tool-calls-body" : ""}`}
                id={activityBodyId}
                data-pending-mcp-tool-calls-body={activityKind === "pending-mcp-tool-calls" ? "true" : undefined}
                data-collapsed-tool-activity-body
                data-oai-tool-activity-body
              >
                <div
                  className="oai-tool-activity-body-stack oai-tool-activity-stack"
                  data-oai-tool-activity-stack
                >
                  {group.items.map(renderItem)}
                  <div className="group/end-resource relative oai-end-resource" data-end-resource>
                    <button
                      type="button"
                      className="oai-end-resource-overlay"
                      aria-label="End resource"
                      tabIndex={-1}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
    });
  };

  const renderMessageActions = (
    message: Extract<ConversationItem, { kind: "message" }>,
    isCopied: boolean,
  ) => (
    <div
      className="oai-assistant-actions flex flex-row-reverse items-center gap-1"
      data-message-part="actions"
      data-assistant-copy-text={message.text ? "assistantCopyText" : undefined}
      data-on-fork-turn={message.forkTurnId ? "onForkTurn" : undefined}
    >
      <div
        className="mr-1 ms-1 flex items-center gap-2"
        data-message-actions-row
      >
        <span
          className="oai-message-action-metadata"
          data-message-action-metadata
          aria-hidden
        />
        <div className="flex items-center gap-1" data-message-actions-controls>
          {onQuoteMessage && (
            <button
              type="button"
              className="ghost oai-message-action-button oai-message-quote-button"
              data-utility-button
              data-message-action="quote"
              onMouseDown={() => {
                assistantSelectionSnapshotRef.current = getSelectedAssistantText();
              }}
              onTouchStart={() => {
                assistantSelectionSnapshotRef.current = getSelectedAssistantText();
              }}
              onClick={() => {
                const selectedText = assistantSelectionSnapshotRef.current ?? undefined;
                assistantSelectionSnapshotRef.current = null;
                handleQuoteMessage(message, selectedText);
              }}
              aria-label="Quote message"
              title="Quote message"
            >
              <Quote size={14} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={`ghost oai-message-action-button oai-message-copy-button${isCopied ? " is-copied" : ""}`}
            data-utility-button
            data-message-action="copy"
            onClick={() => handleCopyMessage(message)}
            aria-label="Copy message"
            title="Copy message"
          >
            <span className="oai-message-copy-icon" aria-hidden>
              <Copy className="oai-message-copy-icon-copy" size={14} />
              <Check className="oai-message-copy-icon-check" size={14} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  const renderAssistantTurnSelector = (
    turn: AssistantTurn,
    messages: Extract<ConversationItem, { kind: "message" }>[],
  ) => {
    const latest = messages[messages.length - 1];
    const siblingTurnCount = latest?.siblingTurnCount ?? null;
    if (!siblingTurnCount || siblingTurnCount <= 1) {
      return null;
    }
    const selectedTurnId = latest?.selectedTurnId ?? latest?.id ?? turn.id;
    const selectedTurnIndex =
      selectedTurnById[selectedTurnId] ?? latest?.selectedTurnIndex ?? siblingTurnCount - 1;
    const onForkTurn = () => {
      setSelectedTurnById((current) => ({
        ...current,
        [selectedTurnId]: selectedTurnIndex,
      }));
    };
    return (
      <div
        className="oai-assistant-turn-selector"
        data-assistant-turn-selector
        data-selected-turn={String(selectedTurnIndex)}
        data-selected-turn-id={selectedTurnId}
        data-has-applied-code-locally={latest?.hasAppliedCodeLocally ? "true" : "false"}
        data-sibling-turn-count={String(siblingTurnCount)}
        data-on-fork-turn={latest?.forkTurnId ?? turn.id}
      >
        <button
          type="button"
          className="oai-assistant-turn-selector-button"
          data-assistant-turn-selector-prev
          aria-label="Previous assistant response"
          disabled={selectedTurnIndex <= 0}
          onClick={() =>
            setSelectedTurnById((current) => ({
              ...current,
              [selectedTurnId]: Math.max(0, selectedTurnIndex - 1),
            }))
          }
        >
          <ChevronRight size={12} aria-hidden />
        </button>
        <span className="oai-assistant-turn-selector-label">
          {selectedTurnIndex + 1} / {siblingTurnCount}
        </span>
        <button
          type="button"
          className="oai-assistant-turn-selector-button"
          data-assistant-turn-selector-next
          aria-label="Next assistant response"
          disabled={selectedTurnIndex >= siblingTurnCount - 1}
          onClick={() =>
            setSelectedTurnById((current) => ({
              ...current,
              [selectedTurnId]: Math.min(siblingTurnCount - 1, selectedTurnIndex + 1),
            }))
          }
        >
          <ChevronRight size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="oai-assistant-turn-selector-button"
          data-assistant-turn-selector-fork
          aria-label="Fork assistant response"
          onClick={onForkTurn}
        >
          <Pencil size={12} aria-hidden />
        </button>
      </div>
    );
  };

  const renderAssistantTurnBody = (
    turn: AssistantTurn,
    hasActivity: boolean,
    isActivityExpanded: boolean,
  ) => (
    <div
      className={`flex w-full min-w-0 flex-col gap-0 oai-assistant-turn-body${
        isActivityExpanded ? " is-expanded" : ""
      }`}
      data-assistant-turn-body
      data-assistant-turn-body-has-activity={hasActivity ? "true" : "false"}
      data-assistant-turn-body-expanded={isActivityExpanded ? "true" : "false"}
    >
      <div
        className="oai-assistant-turn-body-motion"
        data-assistant-turn-body-motion
        data-motion-state={isActivityExpanded ? "expanded" : "collapsed"}
      >
        <div
          className="flex w-full min-w-0 flex-col gap-0 oai-assistant-turn-body-stack"
          data-assistant-turn-body-stack
        >
          {turn.blocks.map((block) => {
            if (block.kind === "activity") {
              return renderAssistantTurnActivityTimeline(block, isActivityExpanded);
            }
            const message = block.message;
            const isCopied = copiedMessageId === message.id;
            return (
              <MessageRow
                key={message.id}
                item={message}
                isCopied={isCopied}
                onCopy={handleCopyMessage}
                onQuote={onQuoteMessage ? handleQuoteMessage : undefined}
                codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                showMessageFilePath={showMessageFilePath}
                workspacePath={workspacePath}
                onOpenFileLink={openFileLink}
                onOpenFileLinkMenu={showFileLinkMenu}
                onOpenThreadLink={handleOpenThreadLink}
                showActions={false}
              />
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderAssistantTurn = (turn: AssistantTurn) => {
    const activityBlocks = turn.blocks.filter(
      (block): block is AssistantTurnActivityBlock => block.kind === "activity",
    );
    const messageBlocks = turn.blocks
      .filter((block) => block.kind === "message")
      .map((block) => block.message);
    const latestMessage = messageBlocks[messageBlocks.length - 1];
    const isCopied = latestMessage ? copiedMessageId === latestMessage.id : false;
    const fileChanges = collectTurnFileChanges(turn);
    const activityId = `assistant-turn-activity-${turn.id}`;
    const isActivityExpanded = expandedItems.has(activityId);
    const hasActivity = activityBlocks.length > 0;

    return (
      <div
        key={turn.id}
        className="flex w-full min-w-0 flex-col gap-0 oai-assistant-turn"
        data-assistant-turn
      >
        {hasActivity && renderAssistantTurnActivity(turn)}
        {hasActivity && (
          <div
            aria-hidden
            className="w-full oai-conversation-tool-assistant-gap"
            data-conversation-tool-assistant-gap
            style={{ height: "var(--conversation-tool-assistant-gap, 8px)" }}
          />
        )}
        {renderAssistantTurnBody(turn, hasActivity, isActivityExpanded)}
        <div
          className="flex w-full min-w-0 flex-col gap-0 oai-assistant-turn-footer"
          data-assistant-turn-footer
        >
          {renderAssistantTurnSelector(turn, messageBlocks)}
          {latestMessage && renderMessageActions(latestMessage, isCopied)}
          {fileChanges.length > 0 && (
            <FileChangeSummaryCard changes={fileChanges} workspacePath={workspacePath} />
          )}
        </div>
      </div>
    );
  };

  const renderEntry = (entry: (typeof groupedItems)[number]): ReactNode => {
    if (entry.kind === "assistantTurn") {
      return renderAssistantTurn(entry.turn);
    }
    if (entry.kind === "toolGroup") {
      const { group } = entry;
      const isCollapsed = collapsedToolGroups.has(group.id);
      const groupKind = getActivityBlockKind({
        kind: "activity",
        id: group.id,
        summary: "",
        items: group.items,
        toolCount: group.toolCount,
        messageCount: group.messageCount,
        durationMs: null,
      });
      const summaryParts = [
        formatCount(group.toolCount, "tool call", "tool calls"),
      ];
      if (group.messageCount > 0) {
        summaryParts.push(formatCount(group.messageCount, "message", "messages"));
      }
      const summaryText = summaryParts.join(", ");
      const groupBodyId = `tool-group-${group.id}`;
      const ChevronIcon = isCollapsed ? ChevronDown : ChevronUp;
      const openAIItemTypes = getOpenAIActivityItemTypes(group.items);
      return (
        <div
          key={`tool-group-${group.id}`}
          className={`group/inline oai-inline-group oai-tool-group ${isCollapsed ? "oai-tool-group-collapsed" : ""}`}
          data-oai-inline-group
          data-oai-tool-group
          data-oai-tool-group-kind={groupKind}
          data-oai-tool-group-collapsed={isCollapsed ? "true" : "false"}
          data-openai-activity-item-types={openAIItemTypes.join(" ")}
        >
          <div className="oai-tool-group-header" data-oai-tool-group-header>
            <button
              type="button"
              className="group/section-toggle oai-section-toggle oai-tool-group-toggle"
              onClick={() => toggleToolGroup(group.id)}
              aria-expanded={!isCollapsed}
              aria-controls={groupBodyId}
              aria-label={isCollapsed ? "Expand tool calls" : "Collapse tool calls"}
              data-oai-section-toggle
            >
              <span className="oai-tool-group-chevron" aria-hidden>
                <ChevronIcon size={14} />
              </span>
              <span className="oai-tool-group-summary">{summaryText}</span>
              {openAIItemTypes.map((itemType) => (
                <span
                  key={itemType}
                  hidden
                  aria-hidden="true"
                  data-openai-activity-item
                  data-openai-activity-item-type={itemType}
                />
              ))}
            </button>
          </div>
          {!isCollapsed && (
            <div
              className={`oai-tool-activity-stack${groupKind === "pending-mcp-tool-calls" ? " pending-mcp-tool-calls-body" : ""}`}
              id={groupBodyId}
              data-pending-mcp-tool-calls-body={groupKind === "pending-mcp-tool-calls" ? "true" : undefined}
              data-oai-tool-activity-stack
            >
              {group.items.map(renderItem)}
              <div className="group/end-resource relative oai-end-resource" data-end-resource>
                <button
                  type="button"
                  className="oai-end-resource-overlay"
                  aria-label="End resource"
                  tabIndex={-1}
                />
              </div>
            </div>
          )}
        </div>
      );
    }
    return renderItem(entry.item);
  };

	const renderConversationTurns = () => {
	  type RenderedTurn = {
	    id: string;
	    userNode: ReactNode | null;
	    agentEntries: MessageListEntry[];
	    orphan: boolean;
	  };

    const turns: RenderedTurn[] = [];
    let activeTurn: RenderedTurn | null = null;

    const flushTurn = () => {
      if (!activeTurn) {
        return;
      }
      turns.push(activeTurn);
      activeTurn = null;
    };

	    const ensureAgentTurn = (id: string) => {
	      if (!activeTurn) {
	        activeTurn = {
	          id: `assistant:${id}`,
	          userNode: null,
	          agentEntries: [],
	          orphan: true,
	        };
      }
      return activeTurn;
    };

    groupedItems.forEach((entry) => {
      if (entry.kind === "item" && entry.item.kind === "message" && entry.item.role === "user") {
	        flushTurn();
	        activeTurn = {
	          id: `user:${entry.item.id}`,
	          userNode: renderEntry(entry),
	          agentEntries: [],
	          orphan: false,
	        };
        return;
      }

      const entryId =
        entry.kind === "assistantTurn"
          ? entry.turn.id
          : entry.kind === "toolGroup"
            ? entry.group.id
            : entry.item.id;
      ensureAgentTurn(entryId).agentEntries.push(entry);
    });

    flushTurn();

    const getEntrySearchUnitKey = (
      turnId: string,
      entry: MessageListEntry,
      index: number,
    ) => {
      if (entry.kind === "assistantTurn") {
        return `${turnId}:${entry.turn.id}:assistant`;
      }
      if (entry.kind === "toolGroup") {
        return `${turnId}:${entry.group.id}:tools`;
      }
      return `${turnId}:${entry.item.id}:${entry.item.kind}-${index}`;
    };

    const getEntrySearchUnitKind = (entry: MessageListEntry) => {
      if (entry.kind === "assistantTurn") {
        return "assistant-turn";
      }
      if (entry.kind === "toolGroup") {
        return getActivityBlockKind({
          kind: "activity",
          id: entry.group.id,
          summary: "",
          items: entry.group.items,
          toolCount: entry.group.toolCount,
          messageCount: entry.group.messageCount,
          durationMs: null,
        });
      }
	      return entry.item.kind;
	    };

    const getAssistantTurnSearchKey = (entries: MessageListEntry[]) => {
      const firstAssistantTurn = entries.find(
        (entry): entry is Extract<MessageListEntry, { kind: "assistantTurn" }> =>
          entry.kind === "assistantTurn",
      );
      if (firstAssistantTurn) {
        return `assistant:${firstAssistantTurn.turn.id}`;
      }
      const firstAssistantMessage = entries.find(
        (entry): entry is Extract<MessageListEntry, { kind: "item" }> =>
          entry.kind === "item" &&
          entry.item.kind === "message" &&
          entry.item.role === "assistant",
      );
      if (firstAssistantMessage) {
        return `assistant:${firstAssistantMessage.item.id}`;
      }
      return undefined;
    };

	    return turns.map((turn, turnIndex) => (
      (() => {
        const assistantTurnKey = getAssistantTurnSearchKey(turn.agentEntries);
        return (
	      <div
	        key={turn.id}
	        data-turn-key={turn.id}
	        data-content-search-turn-key={turn.id}
          data-content-search-assistant-turn-key={assistantTurnKey}
	        data-content-search-turn-index={turnIndex}
	        data-scroll-to-key={turn.id}
	        data-virtualizer-item-key={turn.id}
        data-turn-orphan={turn.orphan ? "true" : "false"}
      >
        {turn.userNode && (
          <div
	            className="flex w-full justify-end oai-user-turn-slot"
	            data-turn-slot="user"
	            data-content-search-unit-key={`${turn.id}:message`}
	            data-content-search-unit-kind="user-message"
	            data-scroll-to-key={`${turn.id}:message`}
	          >
	            {turn.userNode}
	          </div>
        )}
	        {turn.agentEntries.length > 0 && (
	          <div className="flex w-full min-w-0 flex-col gap-2 oai-agent-turn-slot" data-turn-slot="agent">
            {mergeAssistantAgentEntries(turn.agentEntries).map((entry, index) => (
              <div
                key={getEntrySearchUnitKey(turn.id, entry, index)}
                className="oai-content-search-unit"
                data-content-search-unit-key={getEntrySearchUnitKey(turn.id, entry, index)}
                data-content-search-unit-kind={getEntrySearchUnitKind(entry)}
                data-scroll-to-key={getEntrySearchUnitKey(turn.id, entry, index)}
              >
                {renderEntry(entry)}
              </div>
            ))}
	          </div>
	        )}
	      </div>
        );
      })()
	    ));
	  };

  const renderItem = (item: ConversationItem) => {
    if (item.kind === "message") {
      const isCopied = copiedMessageId === item.id;
      return (
        <MessageRow
          key={item.id}
          item={item}
          isCopied={isCopied}
          onCopy={handleCopyMessage}
          onQuote={onQuoteMessage ? handleQuoteMessage : undefined}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "reasoning") {
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      return (
        <ReasoningRow
          key={item.id}
          item={item}
          parsed={parsed}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={item.id}
          item={item}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "userInput") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <UserInputRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={item.id} item={item} />;
    }
    if (item.kind === "tool") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <ToolRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (item.kind === "explore") {
      return <ExploreRow key={item.id} item={item} />;
    }
    return null;
  };

  return (
    <div
      className="messages messages-full"
      ref={containerRef}
      onScroll={updateAutoScroll}
    >
      <div
	        className="messages-inner oai-conversation-thread relative flex flex-col gap-2 electron:[--color-token-description-foreground:color-mix(in_srgb,var(--color-token-foreground)_70%,transparent)]"
        data-thread-find-target="conversation"
      >
        {renderConversationTurns()}
        <div
          className="flex flex-col gap-2 oai-thread-find-composer"
          data-thread-find-composer="true"
        >
          {planFollowupNode}
          {userInputNode}
        </div>
        <WorkingIndicator
          isThinking={isThinking}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          hasItems={items.length > 0}
          reasoningLabel={latestReasoningLabel}
          showPollingFetchStatus={showPollingFetchStatus}
          pollingIntervalMs={pollingIntervalMs}
        />
        {!items.length && !userInputNode && !isThinking && !isLoadingMessages && (
          <div className="empty messages-empty">
            {threadId ? "Send a prompt to the agent." : "Send a prompt to start a new agent."}
          </div>
        )}
        {!items.length && !userInputNode && !isThinking && isLoadingMessages && (
          <div className="empty messages-empty">
            <div className="messages-loading-indicator" role="status" aria-live="polite">
              <span className="oai-thinking-shimmer__spinner" aria-hidden />
              <span className="messages-loading-label">Loading…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
