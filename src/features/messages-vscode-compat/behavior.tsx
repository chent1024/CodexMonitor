import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import type { ConversationItem } from "../../types";
import type {
  AssistantTurn,
  AssistantTurnActivityBlock,
  ToolGroupItem,
} from "../messages/utils/messageRenderUtils";

export const VSCODE_USER_MESSAGE_COLLAPSED_LINE_COUNT = 20;
export const VSCODE_USER_MESSAGE_FALLBACK_FONT_SIZE_PX = 13;
export const VSCODE_USER_MESSAGE_LINE_HEIGHT_RATIO = 1.5;
export const VSCODE_USER_MESSAGE_COLLAPSE_EPSILON_PX = 1;

export const VSCODE_REASONING_HEIGHT_BY_STATE = {
  preview: "7rem",
  expanded: "20rem",
  collapsed: "0px",
} as const;

export const VSCODE_COMMAND_OUTPUT_MAX_HEIGHT_PX = 140;

export type VscodeDisclosureState = "collapsed" | "preview" | "expanded";

export function nextReasoningState(state: VscodeDisclosureState): VscodeDisclosureState {
  if (state === "preview") {
    return "expanded";
  }
  if (state === "expanded") {
    return "collapsed";
  }
  return "preview";
}

export function getTurnCollapseState({
  hasFinalAssistantStarted,
  isTurnCancelled,
  hasRenderableAgentItems,
  preventAutoCollapse,
  persistedCollapsed,
}: {
  hasFinalAssistantStarted: boolean;
  isTurnCancelled: boolean;
  hasRenderableAgentItems: boolean;
  preventAutoCollapse: boolean;
  persistedCollapsed?: boolean;
}) {
  if (!hasFinalAssistantStarted || isTurnCancelled || !hasRenderableAgentItems) {
    return { shouldAllowCollapse: false, isCollapsed: false };
  }
  return {
    shouldAllowCollapse: true,
    isCollapsed: persistedCollapsed ?? !preventAutoCollapse,
  };
}

export function splitTurnEntriesLikeOpenAI<T extends { kind?: string; itemType?: string; steeringStatus?: unknown }>(
  entries: T[],
) {
  const collapsibleEntries: T[] = [];
  const expandedEntries: T[] = [];
  const persistentEntries: T[] = [];
  let workedForItem: T | null = null;

  for (const entry of entries) {
    if (entry.itemType === "worked-for") {
      workedForItem = entry;
      continue;
    }
    expandedEntries.push(entry);
    if (
      entry.kind === "message" &&
      entry.itemType === "user-message" &&
      entry.steeringStatus != null
    ) {
      persistentEntries.push(entry);
      continue;
    }
    collapsibleEntries.push(entry);
  }

  return { collapsibleEntries, expandedEntries, persistentEntries, workedForItem };
}

export function splitActivityItemsLikeOpenAI(items: ToolGroupItem[]) {
  return splitTurnEntriesLikeOpenAI(
    items.map((item) => ({
      ...item,
      itemType:
        item.kind === "reasoning"
          ? "reasoning"
          : item.kind === "userInput"
            ? "userInput"
            : item.kind === "explore"
              ? undefined
              : item.itemType,
    })),
  );
}

export function splitAssistantTurnBlocksLikeOpenAI(turn: AssistantTurn) {
  let workedForItem: ToolGroupItem | null = null;
  const blocks: AssistantTurn["blocks"] = [];

  for (const block of turn.blocks) {
    if (block.kind !== "activity") {
      blocks.push(block);
      continue;
    }
    const split = splitActivityItemsLikeOpenAI(block.items);
    workedForItem = workedForItem ?? split.workedForItem;
    if (split.collapsibleEntries.length === 0) {
      continue;
    }
    blocks.push({
      ...block,
      items: split.collapsibleEntries,
      toolCount: countToolCalls(split.collapsibleEntries),
      messageCount: countNonToolMessages(split.collapsibleEntries),
      durationMs: sumDuration(split.collapsibleEntries),
    } satisfies AssistantTurnActivityBlock);
  }

  return {
    turn: {
      ...turn,
      blocks,
      toolCount: blocks.reduce(
        (total, block) => total + (block.kind === "activity" ? block.toolCount : 0),
        0,
      ),
      messageCount: blocks.reduce(
        (total, block) => total + (block.kind === "activity" ? block.messageCount : 0),
        0,
      ),
      durationMs: sumDurationFromBlocks(blocks),
    },
    workedForItem,
  };
}

function countToolCalls(items: ToolGroupItem[]) {
  return items.reduce((total, item) => {
    if (item.kind === "tool") {
      return total + 1;
    }
    if (item.kind === "explore") {
      return total + item.entries.length;
    }
    return total;
  }, 0);
}

function countNonToolMessages(items: ToolGroupItem[]) {
  return items.filter((item) => item.kind !== "tool" && item.kind !== "explore").length;
}

function sumDuration(items: ToolGroupItem[]) {
  let total = 0;
  let hasDuration = false;
  for (const item of items) {
    if (item.kind === "tool" && typeof item.durationMs === "number") {
      total += item.durationMs;
      hasDuration = true;
    }
  }
  return hasDuration ? total : null;
}

function sumDurationFromBlocks(blocks: AssistantTurn["blocks"]) {
  const durations = blocks
    .filter((block): block is AssistantTurnActivityBlock => block.kind === "activity")
    .map((block) => block.durationMs)
    .filter((duration): duration is number => typeof duration === "number");
  return durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) : null;
}

export function getTurnCollapseSummary({
  collapsedMessageCount,
  workedDurationMs,
  workedForTitle,
}: {
  collapsedMessageCount: number;
  workedDurationMs?: number | null;
  workedForTitle?: string | null;
}) {
  if (workedDurationMs && workedDurationMs > 0) {
    return `处理了 ${formatCompactDuration(workedDurationMs)}`;
  }
  if (workedForTitle?.trim()) {
    return workedForTitle.trim();
  }
  return `${collapsedMessageCount} 条前序内容`;
}

function formatCompactDuration(durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`;
}

export function getAssistantTurnCollapseInput(turn: AssistantTurn, _isMostRecentTurn: boolean) {
  const activityItems = turn.blocks.flatMap((block) =>
    block.kind === "activity" ? block.items : [],
  );
  const hasFinalAssistantStarted = turn.blocks.some(
    (block) =>
      block.kind === "message" &&
      block.message.text.trim().length > 0,
  );
  const isTurnCancelled = activityItems.some((item) => {
    if (item.kind !== "tool") {
      return false;
    }
    const status = (item.status ?? "").toLowerCase();
    return status.includes("cancel") || status.includes("interrupt");
  });
  const preventAutoCollapse = true;

  return {
    hasFinalAssistantStarted,
    isTurnCancelled,
    hasRenderableAgentItems: activityItems.length > 0,
    preventAutoCollapse,
  };
}

export function useStagedMount(isExpanded: boolean, onEntered?: () => void) {
  const [isMounted, setIsMounted] = useState(isExpanded);
  const [isVisiblyExpanded, setIsVisiblyExpanded] = useState(isExpanded);
  const timeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (isExpanded) {
      setIsMounted(true);
      frameRef.current = window.requestAnimationFrame(() => {
        setIsVisiblyExpanded(true);
        onEntered?.();
      });
      return;
    }

    setIsVisiblyExpanded(false);
    timeoutRef.current = window.setTimeout(() => {
      setIsMounted(false);
    }, 220);
  }, [isExpanded, onEntered]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return { isMounted, isVisiblyExpanded };
}

export function AnimatedDisclosureBody({
  id,
  isExpanded,
  className,
  children,
  onEntered,
  ...dataAttributes
}: {
  id?: string;
  isExpanded: boolean;
  className: string;
  children: ReactNode;
  onEntered?: () => void;
} & HTMLAttributes<HTMLDivElement>) {
  const { isMounted, isVisiblyExpanded } = useStagedMount(isExpanded, onEntered);
  if (!isMounted) {
    return null;
  }
  return (
    <div
      id={id}
      className={className}
      data-disclosure-body-mounted="true"
      data-disclosure-body-expanded={isVisiblyExpanded ? "true" : "false"}
      style={{
        opacity: isVisiblyExpanded ? 1 : 0,
        maxHeight: isVisiblyExpanded ? "var(--oai-disclosure-expanded-height, 999px)" : "0px",
        overflow: "hidden",
        pointerEvents: isVisiblyExpanded ? "auto" : "none",
      }}
      {...dataAttributes}
    >
      {children}
    </div>
  );
}

export function getCommandText(item: Extract<ConversationItem, { kind: "tool" }>) {
  return item.title.replace(/^Command:\s*/i, "").trim();
}
