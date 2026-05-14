import { memo, useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../types";
import { PlanReadyFollowupMessage } from "../app/components/PlanReadyFollowupMessage";
import { RequestUserInputMessage } from "../app/components/RequestUserInputMessage";
import { useFileLinkOpener } from "../messages/hooks/useFileLinkOpener";
import {
  formatCount,
  type AssistantTurn,
  type AssistantTurnActivityBlock,
  type ToolGroupItem,
} from "../messages/utils/messageRenderUtils";
import {
  FileChangeSummaryCard,
  type FileChangeEntry,
  MessageRow,
  WorkingIndicator,
} from "../messages/components/MessageRows";
import { useMessagesViewState } from "../messages/components/useMessagesViewState";
import { ActivityItemRow } from "./ActivityRows";
import {
  AnimatedDisclosureBody,
  getAssistantTurnCollapseInput,
  getTurnCollapseState,
  getTurnCollapseSummary,
  splitAssistantTurnBlocksLikeOpenAI,
  splitTurnEntriesLikeOpenAI,
} from "./behavior";
import {
  VSCODE_CONVERSATION_DETAIL_LEVEL,
  VSCODE_MCP_SERVER_STATUSES,
  VSCODE_SHOULD_AUTO_EXPAND_MCP_APPS,
  activityBlockHasFileChange,
  buildVscodeViewModelFromEntries,
  formatAssistantTurnActivityStatus,
  getActivityBlockKind,
  getOpenAIActivityItemTypes,
  groupActivityItemsLikeOpenAI,
  isCodexStderrTranscriptItem,
  type VscodeRenderedEntry,
} from "./viewModel";

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

function isFileContentItem(item: ConversationItem) {
  return item.kind === "tool" && item.toolType === "fileChange";
}

function getDefaultExpandedState(isMarked: boolean, defaultExpanded: boolean) {
  return defaultExpanded ? !isMarked : isMarked;
}

function isLiveActivityItem(item: ConversationItem) {
  if (item.kind !== "tool") {
    return false;
  }
  const isRunOrEditActivity =
    item.toolType === "commandExecution" ||
    item.toolType === "fileChange" ||
    item.itemType === "exec" ||
    item.itemType === "patch";
  if (!isRunOrEditActivity) {
    return false;
  }
  const status = (item.status ?? "").toLowerCase();
  return /pending|running|processing|started|in[_\s-]*progress/.test(status);
}

function hasLiveActivityItems(items: ToolGroupItem[]) {
  return items.some(isLiveActivityItem);
}

function useWorkingElapsedMs(isWorking: boolean, startedAtMs?: number | null) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isWorking || typeof startedAtMs !== "number") {
      return undefined;
    }
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isWorking, startedAtMs]);

  if (!isWorking || typeof startedAtMs !== "number") {
    return null;
  }
  return Math.max(nowMs - startedAtMs, 0);
}

const TURN_VIRTUALIZATION_THRESHOLD = 80;
const TURN_VIRTUALIZATION_ESTIMATED_SIZE = 240;
const TURN_VIRTUALIZATION_GAP = 8;

type VscodeConversationTurn = ReturnType<
  typeof buildVscodeViewModelFromEntries
>["turns"][number];

type VirtualizedConversationTurnsProps = {
  turns: VscodeConversationTurn[];
  scrollElementRef: RefObject<HTMLDivElement | null>;
  renderTurn: (turn: VscodeConversationTurn, index: number) => ReactNode;
};

const VirtualizedConversationTurns = memo(function VirtualizedConversationTurns({
  turns,
  scrollElementRef,
  renderTurn,
}: VirtualizedConversationTurnsProps) {
  const turnVirtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => TURN_VIRTUALIZATION_ESTIMATED_SIZE,
    getItemKey: (index) => turns[index]?.id ?? index,
    gap: TURN_VIRTUALIZATION_GAP,
    initialRect: { width: 1, height: 800 },
    overscan: 8,
  });
  const virtualTurnRows = turnVirtualizer.getVirtualItems();

  return (
    <div
      className="oai-turn-virtualizer"
      data-turn-virtualizer
      style={{ height: `${turnVirtualizer.getTotalSize()}px` }}
    >
      {virtualTurnRows.map((virtualRow) => {
        const turn = turns[virtualRow.index];
        if (!turn) {
          return null;
        }
        return (
          <div
            key={turn.id}
            ref={turnVirtualizer.measureElement}
            className="oai-turn-virtualizer-item"
            data-index={virtualRow.index}
            data-turn-virtualizer-item
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderTurn(turn, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
});

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
  const { openFileLink, showFileLinkMenu, fileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
  );
  const workingElapsedMs = useWorkingElapsedMs(isThinking, processingStartedAt);
  const [selectedTurnById, setSelectedTurnById] = useState<Record<string, number>>({});
  const [collapsedTurns, setCollapsedTurns] = useState<Record<string, boolean | undefined>>({});
  const handleOpenThreadLink = useCallback(
    (threadId: string) => {
      onOpenThreadLink?.(threadId, workspaceId ?? null);
    },
    [onOpenThreadLink, workspaceId],
  );
  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const transcriptItems = useMemo(
    () => items.filter((item) => !isCodexStderrTranscriptItem(item)),
    [items],
  );
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
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  } = useMessagesViewState({
    items: transcriptItems,
    threadId,
    isThinking,
    activeUserInputRequestId,
    hasVisibleUserInputRequest,
    onPlanAccept,
    onPlanSubmitChanges,
    onQuoteMessage,
  });
  const vscodeViewModel = useMemo(
    () => buildVscodeViewModelFromEntries(groupedItems),
    [groupedItems],
  );

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
    const isExpanded = getDefaultExpandedState(expandedItems.has(activityId), true);
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
        data-conversation-detail-level={VSCODE_CONVERSATION_DETAIL_LEVEL}
        data-is-activity-slice-closed={!isExpanded ? "true" : "false"}
        data-should-auto-expand-mcp-apps={VSCODE_SHOULD_AUTO_EXPAND_MCP_APPS ? "true" : "false"}
        data-mcp-server-statuses={JSON.stringify(VSCODE_MCP_SERVER_STATUSES)}
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
      const defaultExpanded = hasLiveActivityItems(group.items);
      const isExpanded = getDefaultExpandedState(
        expandedItems.has(group.id),
        defaultExpanded,
      );
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
      if (activityKind === "context-compaction") {
        return (
          <div
            key={group.id}
            className="oai-context-compaction-slot"
            data-context-compaction-slot
            data-openai-activity-item-types={openAIItemTypes.join(" ")}
          >
            {group.items.map((item) => renderItem(item))}
          </div>
        );
      }
      return (
        <div
          key={group.id}
          className="group/inline group/tool-activity flex w-full min-w-0 flex-col gap-0 oai-inline-group oai-tool-activity-row"
          data-oai-inline-group
          data-collapsed-tool-activity-item
          data-collapsed-tool-activity-item-type={activityKind}
          data-oai-tool-activity-kind={activityKind}
          data-collapsed-tool-activity-item-expanded={isExpanded ? "true" : "false"}
          data-conversation-detail-level={VSCODE_CONVERSATION_DETAIL_LEVEL}
          data-is-activity-slice-closed={!turnActivityExpanded ? "true" : "false"}
          data-should-auto-expand-mcp-apps={VSCODE_SHOULD_AUTO_EXPAND_MCP_APPS ? "true" : "false"}
          data-mcp-server-statuses={JSON.stringify(VSCODE_MCP_SERVER_STATUSES)}
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
                <span className="oai-tool-activity-text">{group.summary}</span>
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
                  className={`oai-tool-activity-chevron${isExpanded ? " is-expanded" : ""}`}
                  data-oai-tool-activity-chevron
                  aria-hidden
                >
                  <ChevronRight size={12} />
                </span>
              </button>
              <AnimatedDisclosureBody
                isExpanded={isExpanded}
                className={`oai-tool-activity-body${activityKind === "pending-mcp-tool-calls" ? " pending-mcp-tool-calls-body" : ""}`}
                id={activityBodyId}
                aria-expanded={activityKind === "pending-mcp-tool-calls" ? isExpanded : undefined}
                data-pending-mcp-tool-calls-body={activityKind === "pending-mcp-tool-calls" ? "true" : undefined}
                data-pending-mcp-tool-calls-view-state={activityKind === "pending-mcp-tool-calls" ? (isExpanded ? "expanded" : "collapsed") : undefined}
                data-testid={activityKind === "pending-mcp-tool-calls" ? "pending-mcp-tool-calls-body" : undefined}
                data-collapsed-tool-activity-body
                data-oai-tool-activity-body
              >
                {isExpanded ? (
                  <div
                    className="oai-tool-activity-body-stack oai-tool-activity-stack"
                    data-oai-tool-activity-stack
                  >
                    {group.items.map((item) => renderItem(item, !isFileContentItem(item)))}
                    <div className="group/end-resource relative oai-end-resource" data-end-resource>
                      <button
                        type="button"
                        className="oai-end-resource-overlay"
                        aria-label="End resource"
                        tabIndex={-1}
                      />
                    </div>
                  </div>
                ) : null}
              </AnimatedDisclosureBody>
            </div>
          </div>
        </div>
      );
    });
  };

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
    isTurnCollapsed: boolean,
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
              return renderAssistantTurnActivityTimeline(
                block,
                !isTurnCollapsed && isActivityExpanded,
              );
            }
            const message = block.message;
            const isCopied = copiedMessageId === message.id;
            return (
              <MessageRow
                key={message.id}
                item={message}
                isCopied={isCopied}
                onCopy={handleCopyMessage}
                onQuote={undefined}
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

  const renderAssistantTurn = (turn: AssistantTurn, isMostRecentTurn: boolean) => {
    const assistantTurnSplit = splitAssistantTurnBlocksLikeOpenAI(turn);
    const visibleTurn = assistantTurnSplit.turn;
    const collapsedVisibleTurn = assistantTurnSplit.collapsedTurn;
    const workedForItem = assistantTurnSplit.workedForItem;
    const activityBlocks = visibleTurn.blocks.filter(
      (block): block is AssistantTurnActivityBlock => block.kind === "activity",
    );
    const messageBlocks = visibleTurn.blocks
      .filter((block) => block.kind === "message")
      .map((block) => block.message);
    const persistentMessageCount = messageBlocks.filter(
      (message) =>
        message.role === "user" &&
        message.itemType === "user-message" &&
        message.steeringStatus != null,
    ).length;
    const fileChanges = collectTurnFileChanges(visibleTurn);
    const activityId = `assistant-turn-activity-${turn.id}`;
    const isActivityExpanded = getDefaultExpandedState(expandedItems.has(activityId), true);
    const hasActivity = activityBlocks.length > 0;
    const turnActivityItems = activityBlocks.flatMap((block) => block.items);
    const turnOpenAIItemTypes = getOpenAIActivityItemTypes(turnActivityItems);
    const turnCollapseInput = getAssistantTurnCollapseInput(turn, isMostRecentTurn, isThinking);
    const turnCollapse = getTurnCollapseState({
      ...turnCollapseInput,
      persistedCollapsed: collapsedTurns[turn.id],
    });
    const isTurnCollapsed = turnCollapse.shouldAllowCollapse && turnCollapse.isCollapsed;
    const renderedTurn = isTurnCollapsed ? collapsedVisibleTurn : visibleTurn;
    const showTurnCollapseToggle =
      turnCollapse.shouldAllowCollapse && assistantTurnSplit.collapsibleBlocks.length > 0;
    const summaryDurationMs =
      isMostRecentTurn && workingElapsedMs != null ? workingElapsedMs : turn.durationMs;
    const collapseSummary = getTurnCollapseSummary({
      collapsedMessageCount: assistantTurnSplit.collapsedMessageCount,
      workedDurationMs: summaryDurationMs,
      workedForTitle: workedForItem?.kind === "tool" ? workedForItem.title : null,
    });

    return (
      <div
        key={turn.id}
        className="flex w-full min-w-0 flex-col gap-0 oai-assistant-turn"
        data-assistant-turn
        data-turn-collapse-allowed={turnCollapse.shouldAllowCollapse ? "true" : "false"}
        data-turn-collapsed={isTurnCollapsed ? "true" : "false"}
        data-turn-prevent-auto-collapse={turnCollapseInput.preventAutoCollapse ? "true" : "false"}
        data-turn-worked-for-item-id={workedForItem?.id}
        data-turn-persistent-entry-count={String(persistentMessageCount)}
      >
        {showTurnCollapseToggle ? (
          <div
            className="text-size-chat text-token-text-secondary oai-turn-collapse-summary-shell"
            data-turn-collapse-summary-shell
          >
            <button
              type="button"
              className="text-size-chat inline-flex items-center gap-1 rounded-md border border-transparent focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:outline-none oai-turn-collapse-summary"
              data-turn-collapse-summary
              data-collapsed-tool-activity-summary={isTurnCollapsed ? "true" : undefined}
              data-oai-inline-group={isTurnCollapsed ? "true" : undefined}
              data-oai-section-toggle={isTurnCollapsed ? "true" : undefined}
              aria-expanded={!isTurnCollapsed}
              onClick={() =>
                setCollapsedTurns((current) => ({
                  ...current,
                  [turn.id]: isTurnCollapsed ? false : true,
                }))
              }
            >
              <span>{collapseSummary}</span>
              <ChevronRight
                className={`oai-turn-collapse-chevron${isTurnCollapsed ? "" : " is-expanded"}`}
                size={12}
                aria-hidden
              />
              {turnOpenAIItemTypes.map((itemType) => (
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
        ) : null}
        {!isTurnCollapsed && hasActivity && !isActivityExpanded && renderAssistantTurnActivity(visibleTurn)}
        {!isTurnCollapsed && hasActivity && !isActivityExpanded && (
          <div
            aria-hidden
            className="w-full oai-conversation-tool-assistant-gap"
            data-conversation-tool-assistant-gap
            style={{ height: "var(--conversation-tool-assistant-gap, 8px)" }}
          />
        )}
        {renderAssistantTurnBody(renderedTurn, hasActivity, isActivityExpanded, isTurnCollapsed)}
        <div
          className="flex w-full min-w-0 flex-col gap-0 oai-assistant-turn-footer"
          data-assistant-turn-footer
        >
          {renderAssistantTurnSelector(turn, messageBlocks)}
          {fileChanges.length > 0 && (
            <FileChangeSummaryCard changes={fileChanges} workspacePath={workspacePath} />
          )}
        </div>
      </div>
    );
  };

  const renderEntry = (entry: (typeof groupedItems)[number]): ReactNode => {
    if (entry.kind === "assistantTurn") {
      return renderAssistantTurn(entry.turn, false);
    }
    if (entry.kind === "toolGroup") {
      const { group } = entry;
      const defaultExpanded = hasLiveActivityItems(group.items);
      const isCollapsed = !defaultExpanded && !collapsedToolGroups.has(group.id);
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
          <AnimatedDisclosureBody
            id={groupBodyId}
            isExpanded={!isCollapsed}
            className={`oai-tool-activity-stack${groupKind === "pending-mcp-tool-calls" ? " pending-mcp-tool-calls-body" : ""}`}
            aria-expanded={!isCollapsed}
            data-pending-mcp-tool-calls-body={groupKind === "pending-mcp-tool-calls" ? "true" : undefined}
            data-pending-mcp-tool-calls-view-state={
              groupKind === "pending-mcp-tool-calls"
                ? isCollapsed
                  ? "collapsed"
                  : "expanded"
                : undefined
            }
            data-testid={groupKind === "pending-mcp-tool-calls" ? "pending-mcp-tool-calls-body" : undefined}
            data-oai-tool-activity-stack
          >
            {!isCollapsed ? (
              <>
                {group.items.map((item) => renderItem(item, !isFileContentItem(item)))}
                <div className="group/end-resource relative oai-end-resource" data-end-resource>
                  <button
                    type="button"
                    className="oai-end-resource-overlay"
                    aria-label="End resource"
                    tabIndex={-1}
                  />
                </div>
              </>
            ) : null}
          </AnimatedDisclosureBody>
        </div>
      );
    }
    return renderItem(entry.item);
  };

  const renderConversationTurn = (
    turn: (typeof vscodeViewModel.turns)[number],
    index: number,
  ) => {
      const isMostRecentTurn = index === vscodeViewModel.turns.length - 1;
      const assistantTurnEntry = turn.renderedAgentEntries.find(
        (renderedEntry) => renderedEntry.entry.kind === "assistantTurn",
      );
      const agentTurnCollapse =
        assistantTurnEntry?.entry.kind === "assistantTurn"
          ? (() => {
              const collapseInput = getAssistantTurnCollapseInput(
                assistantTurnEntry.entry.turn,
                isMostRecentTurn,
                isThinking,
              );
              const collapse = getTurnCollapseState({
                ...collapseInput,
                persistedCollapsed: collapsedTurns[assistantTurnEntry.entry.turn.id],
              });
              return collapse.shouldAllowCollapse && collapse.isCollapsed;
            })()
          : false;
      const splitAgentEntries = splitTurnEntriesLikeOpenAI(
        turn.renderedAgentEntries.map((renderedEntry) => {
          const entry = renderedEntry.entry;
          const item =
            entry.kind === "item"
              ? entry.item
              : entry.kind === "assistantTurn"
                ? null
                : null;
          return {
            ...renderedEntry,
            kind: item?.kind,
            itemType:
              item?.kind === "message"
                ? item.itemType ?? (item.role === "user" ? "user-message" : "assistant-message")
                : item?.kind === "tool"
                  ? item.itemType
                  : undefined,
            steeringStatus: item?.kind === "message" ? item.steeringStatus : undefined,
          };
        }),
      );
      const shouldRenderAgentEntry = (renderedEntry: VscodeRenderedEntry) => {
        const entry = renderedEntry.entry;
        if (entry.kind === "assistantTurn") {
          return true;
        }
        if (entry.kind !== "item") {
          return !agentTurnCollapse;
        }
        const item = entry.item;
        if (item.kind === "tool" && item.itemType === "worked-for") {
          return false;
        }
        if (
          item.kind === "message" &&
          item.role === "user" &&
          item.itemType === "user-message" &&
          item.steeringStatus != null
        ) {
          return true;
        }
        return !agentTurnCollapse;
      };
      return (
        <div
          key={turn.id}
          data-turn-key={turn.id}
          data-content-search-turn-key={turn.id}
          data-content-search-assistant-turn-key={turn.assistantTurnSearchKey}
          data-content-search-turn-index={turn.turnIndex}
          data-scroll-to-key={turn.id}
          data-virtualizer-item-key={turn.id}
          data-turn-orphan={turn.orphan ? "true" : "false"}
          data-turn-collapsible-entry-count={String(splitAgentEntries.collapsibleEntries.length)}
          data-turn-persistent-entry-count={String(splitAgentEntries.persistentEntries.length)}
          data-turn-worked-for-entry={splitAgentEntries.workedForItem?.id}
        >
          {turn.userEntry && (
            <div
              className="flex w-full justify-end oai-user-turn-slot"
              data-turn-slot="user"
              data-content-search-unit-key={turn.userSearchUnitKey}
              data-content-search-unit-kind="user-message"
              data-scroll-to-key={turn.userSearchUnitKey}
            >
              {renderEntry(turn.userEntry)}
            </div>
          )}
          {turn.agentEntries.length > 0 && (
            <div
              className="flex w-full min-w-0 flex-col gap-2 oai-agent-turn-slot"
              data-turn-slot="agent"
            >
              {turn.renderedAgentEntries.filter(shouldRenderAgentEntry).map((renderedEntry) => {
                return (
                  <div
                    key={renderedEntry.id}
                    className="oai-content-search-unit"
                    data-content-search-unit-key={renderedEntry.searchUnitKey}
                    data-content-search-unit-kind={renderedEntry.searchUnitKind}
                    data-scroll-to-key={renderedEntry.scrollToKey}
                  >
                    {renderedEntry.entry.kind === "assistantTurn"
                      ? renderAssistantTurn(renderedEntry.entry.turn, isMostRecentTurn)
                      : renderEntry(renderedEntry.entry)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    };

  const renderConversationTurns = () => {
    if (vscodeViewModel.turns.length <= TURN_VIRTUALIZATION_THRESHOLD) {
      return vscodeViewModel.turns.map((turn, index) => renderConversationTurn(turn, index));
    }

    return (
      <VirtualizedConversationTurns
        turns={vscodeViewModel.turns}
        scrollElementRef={containerRef}
        renderTurn={renderConversationTurn}
      />
    );
  };

  const renderItem = (item: ConversationItem, defaultExpanded = false) => {
    if (item.kind === "message") {
      const isCopied = copiedMessageId === item.id;
      return (
        <MessageRow
          key={item.id}
          item={item}
          isCopied={isCopied}
          onCopy={handleCopyMessage}
          onQuote={item.role === "user" && onQuoteMessage ? handleQuoteMessage : undefined}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showActions={item.role === "user"}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    const isExpanded = getDefaultExpandedState(
      expandedItems.has(item.id),
      defaultExpanded || isLiveActivityItem(item),
    );
    return (
      <ActivityItemRow
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
          hasItems={transcriptItems.length > 0}
          reasoningLabel={latestReasoningLabel}
          showPollingFetchStatus={showPollingFetchStatus}
          pollingIntervalMs={pollingIntervalMs}
        />
        {!transcriptItems.length && !userInputNode && !isThinking && !isLoadingMessages && (
          <div className="empty messages-empty">
            {threadId ? "Send a prompt to the agent." : "Send a prompt to start a new agent."}
          </div>
        )}
        {!transcriptItems.length && !userInputNode && !isThinking && isLoadingMessages && (
          <div className="empty messages-empty">
            <div className="messages-loading-indicator" role="status" aria-live="polite">
              <span className="oai-thinking-shimmer__spinner" aria-hidden />
              <span className="messages-loading-label">Loading…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {fileLinkMenu}
    </div>
  );
});
