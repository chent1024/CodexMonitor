import { useCallback, useEffect, useRef } from "react";
import type { Dispatch } from "react";
import { buildConversationItem } from "@utils/threadItems";
import type { CollabAgentRef } from "@/types";
import {
  buildItemForDisplay,
  handleConvertedItemEffects,
} from "./threadItemEventHelpers";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  hydrateSubagentThreads?: (
    workspaceId: string,
    receivers: CollabAgentRef[],
  ) => void | Promise<void>;
  onUserMessageCreated?: (
    workspaceId: string,
    threadId: string,
    text: string,
  ) => void | Promise<void>;
  onReviewExited?: (workspaceId: string, threadId: string) => void;
};

type ScheduledStreamFlush =
  | { kind: "animationFrame"; id: number }
  | { kind: "timeout"; id: ReturnType<typeof setTimeout> };

type PendingStreamDelta =
  | {
      kind: "agent";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      hasCustomName: boolean;
    }
  | {
      kind: "toolOutput";
      threadId: string;
      itemId: string;
      delta: string;
    }
  | {
      kind: "reasoningSummary";
      threadId: string;
      itemId: string;
      delta: string;
    }
  | {
      kind: "reasoningContent";
      threadId: string;
      itemId: string;
      delta: string;
    }
  | {
      kind: "plan";
      threadId: string;
      itemId: string;
      delta: string;
    };

const scheduleStreamFlush = (callback: () => void): ScheduledStreamFlush => {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return {
      kind: "animationFrame",
      id: window.requestAnimationFrame(callback),
    };
  }

  return { kind: "timeout", id: setTimeout(callback, 16) };
};

const cancelStreamFlush = (scheduled: ScheduledStreamFlush) => {
  if (scheduled.kind === "animationFrame") {
    window.cancelAnimationFrame(scheduled.id);
    return;
  }
  clearTimeout(scheduled.id);
};

const getPendingDeltaKey = (delta: PendingStreamDelta) =>
  `${delta.kind}:${"workspaceId" in delta ? delta.workspaceId : ""}:${
    delta.threadId
  }:${delta.itemId}`;

const getItemEventId = (item: Record<string, unknown>) => {
  const id = item.id ?? item.item_id ?? item.itemId;
  return typeof id === "string" ? id : null;
};

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  getCustomName,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  hydrateSubagentThreads,
  onUserMessageCreated,
  onReviewExited,
}: UseThreadItemEventsOptions) {
  const pendingStreamDeltasRef = useRef<Map<string, PendingStreamDelta>>(
    new Map(),
  );
  const scheduledStreamFlushRef = useRef<ScheduledStreamFlush | null>(null);

  const flushPendingStreamDeltas = useCallback(
    (shouldFlush?: (delta: PendingStreamDelta) => boolean) => {
      if (!shouldFlush && scheduledStreamFlushRef.current) {
        cancelStreamFlush(scheduledStreamFlushRef.current);
        scheduledStreamFlushRef.current = null;
      }

      const pendingEntries = Array.from(pendingStreamDeltasRef.current.entries());
      for (const [key, pending] of pendingEntries) {
        if (shouldFlush && !shouldFlush(pending)) {
          continue;
        }

        pendingStreamDeltasRef.current.delete(key);
        switch (pending.kind) {
          case "agent":
            dispatch({
              type: "ensureThread",
              workspaceId: pending.workspaceId,
              threadId: pending.threadId,
            });
            markProcessing(pending.threadId, true);
            dispatch({
              type: "appendAgentDelta",
              workspaceId: pending.workspaceId,
              threadId: pending.threadId,
              itemId: pending.itemId,
              delta: pending.delta,
              hasCustomName: pending.hasCustomName,
            });
            break;
          case "toolOutput":
            markProcessing(pending.threadId, true);
            dispatch({
              type: "appendToolOutput",
              threadId: pending.threadId,
              itemId: pending.itemId,
              delta: pending.delta,
            });
            safeMessageActivity();
            break;
          case "reasoningSummary":
            dispatch({
              type: "appendReasoningSummary",
              threadId: pending.threadId,
              itemId: pending.itemId,
              delta: pending.delta,
            });
            break;
          case "reasoningContent":
            dispatch({
              type: "appendReasoningContent",
              threadId: pending.threadId,
              itemId: pending.itemId,
              delta: pending.delta,
            });
            break;
          case "plan":
            dispatch({
              type: "appendPlanDelta",
              threadId: pending.threadId,
              itemId: pending.itemId,
              delta: pending.delta,
            });
            break;
        }
      }

      if (
        pendingStreamDeltasRef.current.size === 0 &&
        scheduledStreamFlushRef.current
      ) {
        cancelStreamFlush(scheduledStreamFlushRef.current);
        scheduledStreamFlushRef.current = null;
      }
    },
    [dispatch, markProcessing, safeMessageActivity],
  );

  const schedulePendingStreamFlush = useCallback(() => {
    if (scheduledStreamFlushRef.current) {
      return;
    }

    scheduledStreamFlushRef.current = scheduleStreamFlush(() => {
      scheduledStreamFlushRef.current = null;
      flushPendingStreamDeltas();
    });
  }, [flushPendingStreamDeltas]);

  const enqueueStreamDelta = useCallback(
    (pending: PendingStreamDelta) => {
      const key = getPendingDeltaKey(pending);
      const existing = pendingStreamDeltasRef.current.get(key);
      if (existing && existing.kind === pending.kind) {
        pendingStreamDeltasRef.current.set(key, {
          ...pending,
          delta: existing.delta + pending.delta,
        } as PendingStreamDelta);
      } else {
        pendingStreamDeltasRef.current.set(key, pending);
      }
      schedulePendingStreamFlush();
    },
    [schedulePendingStreamFlush],
  );

  useEffect(
    () => () => {
      if (scheduledStreamFlushRef.current) {
        cancelStreamFlush(scheduledStreamFlushRef.current);
        scheduledStreamFlushRef.current = null;
      }
      pendingStreamDeltasRef.current.clear();
    },
    [],
  );

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      if (shouldMarkProcessing) {
        markProcessing(threadId, true);
      }
      applyCollabThreadLinks(workspaceId, threadId, item);
      const itemType = String(item?.type ?? "");
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
        if (!shouldMarkProcessing) {
          onReviewExited?.(workspaceId, threadId);
        }
      }
      const itemForDisplay = buildItemForDisplay(item, shouldMarkProcessing);
      const converted = buildConversationItem(itemForDisplay);
      handleConvertedItemEffects({
        converted,
        workspaceId,
        threadId,
        hydrateSubagentThreads,
        onUserMessageCreated,
      });
      if (converted) {
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: converted,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
      }
      safeMessageActivity();
    },
    [
      applyCollabThreadLinks,
      dispatch,
      getCustomName,
      markProcessing,
      markReviewing,
      onReviewExited,
      onUserMessageCreated,
      hydrateSubagentThreads,
      safeMessageActivity,
    ],
  );

  const handleToolOutputDelta = useCallback(
    (threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ kind: "toolOutput", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const handleTerminalInteraction = useCallback(
    (threadId: string, itemId: string, stdin: string) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(threadId, itemId, `\n[stdin]\n${normalized}${suffix}`);
    },
    [handleToolOutputDelta],
  );

  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    }) => {
      enqueueStreamDelta({
        kind: "agent",
        workspaceId,
        threadId,
        itemId,
        delta,
        hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
      });
    },
    [enqueueStreamDelta, getCustomName],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
    }) => {
      const timestamp = Date.now();
      flushPendingStreamDeltas(
        (pending) =>
          pending.kind === "agent" &&
          pending.threadId === threadId &&
          pending.itemId === itemId,
      );
      dispatch({ type: "ensureThread", workspaceId, threadId });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId,
        text,
        hasCustomName,
      });
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      dispatch({
        type: "setLastAgentMessage",
        threadId,
        text,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [
      activeThreadId,
      dispatch,
      getCustomName,
      flushPendingStreamDeltas,
      recordThreadActivity,
      safeMessageActivity,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemId = getItemEventId(item);
      flushPendingStreamDeltas((pending) => {
        if (pending.threadId !== threadId) {
          return false;
        }
        return itemId ? pending.itemId === itemId : true;
      });
      handleItemUpdate(workspaceId, threadId, item, false);
    },
    [flushPendingStreamDeltas, handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ kind: "reasoningSummary", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onReasoningSummaryBoundary = useCallback(
    (_workspaceId: string, threadId: string, itemId: string) => {
      flushPendingStreamDeltas(
        (pending) =>
          pending.kind === "reasoningSummary" &&
          pending.threadId === threadId &&
          pending.itemId === itemId,
      );
      dispatch({ type: "appendReasoningSummaryBoundary", threadId, itemId });
    },
    [dispatch, flushPendingStreamDeltas],
  );

  const onReasoningTextDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ kind: "reasoningContent", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onPlanDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      enqueueStreamDelta({ kind: "plan", threadId, itemId, delta });
    },
    [enqueueStreamDelta],
  );

  const onCommandOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, stdin: string) => {
      handleTerminalInteraction(threadId, itemId, stdin);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (_workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemCompleted,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onPlanDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
  };
}
