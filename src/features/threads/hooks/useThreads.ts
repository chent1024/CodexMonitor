import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import * as Sentry from "@sentry/react";
import type {
  CollabAgentRef,
  CustomPromptOption,
  DebugEntry,
  ServiceTier,
  ThreadListSortKey,
  WorkspaceInfo,
} from "@/types";
import { CHAT_SCROLLBACK_DEFAULT } from "@utils/chatScrollback";
import { useAppServerEvents } from "@app/hooks/useAppServerEvents";
import { initialState, threadReducer } from "./useThreadsReducer";
import { useThreadStorage } from "./useThreadStorage";
import { useThreadLinking } from "./useThreadLinking";
import { useThreadEventHandlers } from "./useThreadEventHandlers";
import { useThreadActions } from "./useThreadActions";
import { useThreadMessaging } from "./useThreadMessaging";
import { useThreadApprovals } from "./useThreadApprovals";
import { useThreadAccountInfo } from "./useThreadAccountInfo";
import { useThreadRateLimits } from "./useThreadRateLimits";
import { useThreadSelectors } from "./useThreadSelectors";
import { useThreadStatus } from "./useThreadStatus";
import { useThreadUserInput } from "./useThreadUserInput";
import { useThreadTitleAutogeneration } from "./useThreadTitleAutogeneration";
import { useDetachedReviewTracking } from "./useDetachedReviewTracking";
import {
  attachRestartSafeSession,
  archiveThread as archiveThreadService,
  detachRestartSafeSession,
  listRestartSafeSessions,
  readThread as readThreadService,
  setThreadName as setThreadNameService,
} from "@services/tauri";
import {
  dispatchReplayedAppServerEvent,
  subscribeRestartSafeSessionEvents,
} from "@services/events";
import {
  makeCustomNameKey,
  saveCustomName,
} from "@threads/utils/threadStorage";
import { getParentThreadIdFromThread } from "@threads/utils/threadRpc";
import {
  buildThreadSummaryFromThread,
  extractThreadFromResponse,
} from "@threads/utils/threadSummary";
import { getSubagentDescendantThreadIds } from "@threads/utils/subagentTree";

type UseThreadsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onWorkspaceConnected: (id: string) => void;
  onDebug?: (entry: DebugEntry) => void;
  ensureWorkspaceRuntimeCodexArgs?: (
    workspaceId: string,
    threadId: string | null,
  ) => Promise<void>;
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: "read-only" | "current" | "full-access";
  onSelectServiceTier?: (tier: ServiceTier | null | undefined) => void;
  reviewDeliveryMode?: "inline" | "detached";
  steerEnabled?: boolean;
  threadTitleAutogenerationEnabled?: boolean;
  chatHistoryScrollbackItems?: number | null;
  customPrompts?: CustomPromptOption[];
  onMessageActivity?: () => void;
  threadSortKey?: ThreadListSortKey;
  restartSafeSessions?: boolean;
  onThreadCodexMetadataDetected?: (
    workspaceId: string,
    threadId: string,
    metadata: { modelId: string | null; effort: string | null },
  ) => void;
};

function buildWorkspaceThreadKey(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

const CASCADE_ARCHIVE_SKIP_TTL_MS = 120_000;
const RESTART_SAFE_LAST_SEQ_STORAGE_KEY = "codex.restartSafeSessionLastSeq.v1";

function readRestartSafeLastSeq(sessionId: string): number {
  try {
    const raw = window.localStorage.getItem(RESTART_SAFE_LAST_SEQ_STORAGE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[sessionId];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  } catch {
    return 0;
  }
}

function writeRestartSafeLastSeq(sessionId: string, seq: number): void {
  try {
    const raw = window.localStorage.getItem(RESTART_SAFE_LAST_SEQ_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const current = parsed[sessionId];
    const currentSeq =
      typeof current === "number" && Number.isFinite(current) ? current : 0;
    if (seq <= currentSeq) {
      return;
    }
    window.localStorage.setItem(
      RESTART_SAFE_LAST_SEQ_STORAGE_KEY,
      JSON.stringify({ ...parsed, [sessionId]: seq }),
    );
  } catch {
    // Ignore storage failures; replay can still fall back to fromSeq=0.
  }
}

export function useThreads({
  activeWorkspace,
  onWorkspaceConnected,
  onDebug,
  ensureWorkspaceRuntimeCodexArgs,
  model,
  effort,
  serviceTier,
  collaborationMode,
  accessMode,
  onSelectServiceTier,
  reviewDeliveryMode = "inline",
  steerEnabled = false,
  threadTitleAutogenerationEnabled = false,
  chatHistoryScrollbackItems,
  customPrompts = [],
  onMessageActivity,
  threadSortKey = "updated_at",
  restartSafeSessions = false,
  onThreadCodexMetadataDetected,
}: UseThreadsOptions) {
  const maxItemsPerThread =
    chatHistoryScrollbackItems === undefined
      ? CHAT_SCROLLBACK_DEFAULT
      : chatHistoryScrollbackItems;

  const [state, dispatch] = useReducer(
    threadReducer,
    maxItemsPerThread,
    (initialMaxItemsPerThread) => ({
      ...initialState,
      maxItemsPerThread: initialMaxItemsPerThread,
    }),
  );
  useEffect(() => {
    dispatch({ type: "setMaxItemsPerThread", maxItemsPerThread });
  }, [dispatch, maxItemsPerThread]);
  const loadedThreadsRef = useRef<Record<string, boolean>>({});
  const loadedThreadUpdatedAtRef = useRef<Record<string, number>>({});
  const replaceOnResumeRef = useRef<Record<string, boolean>>({});
  const pendingInterruptsRef = useRef<Set<string>>(new Set());
  const planByThreadRef = useRef(state.planByThread);
  const itemsByThreadRef = useRef(state.itemsByThread);
  const threadsByWorkspaceRef = useRef(state.threadsByWorkspace);
  const activeThreadIdByWorkspaceRef = useRef(state.activeThreadIdByWorkspace);
  const threadStatusByIdRef = useRef(state.threadStatusById);
  const threadTurnsCursorByIdRef = useRef(state.threadTurnsCursorById);
  const threadTurnsPagingByIdRef = useRef(state.threadTurnsPagingById);
  const threadTurnsHasLoadedOldestByIdRef = useRef(
    state.threadTurnsHasLoadedOldestById,
  );
  const activeTurnIdByThreadRef = useRef(state.activeTurnIdByThread);
  const subagentThreadByWorkspaceThreadRef = useRef<Record<string, true>>({});
  const threadParentByIdRef = useRef(state.threadParentById);
  const cascadeArchiveSkipRef = useRef<Record<string, number>>({});
  const subagentHydrationInFlightRef = useRef<Record<string, true>>({});
  const hiddenThreadIdsByWorkspaceRef = useRef(state.hiddenThreadIdsByWorkspace);
  const selectionRefreshTimerByKeyRef = useRef<Record<string, number>>({});
  planByThreadRef.current = state.planByThread;
  itemsByThreadRef.current = state.itemsByThread;
  threadsByWorkspaceRef.current = state.threadsByWorkspace;
  activeThreadIdByWorkspaceRef.current = state.activeThreadIdByWorkspace;
  threadStatusByIdRef.current = state.threadStatusById;
  threadTurnsCursorByIdRef.current = state.threadTurnsCursorById;
  threadTurnsPagingByIdRef.current = state.threadTurnsPagingById;
  threadTurnsHasLoadedOldestByIdRef.current = state.threadTurnsHasLoadedOldestById;
  activeTurnIdByThreadRef.current = state.activeTurnIdByThread;
  threadParentByIdRef.current = state.threadParentById;
  hiddenThreadIdsByWorkspaceRef.current = state.hiddenThreadIdsByWorkspace;
  const rateLimitsByWorkspaceRef = useRef(state.rateLimitsByWorkspace);
  rateLimitsByWorkspaceRef.current = state.rateLimitsByWorkspace;
  useEffect(
    () => () => {
      Object.values(selectionRefreshTimerByKeyRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      selectionRefreshTimerByKeyRef.current = {};
    },
    [],
  );
  const { approvalAllowlistRef, handleApprovalDecision, handleApprovalRemember } =
    useThreadApprovals({ dispatch, onDebug });
  const { handleUserInputSubmit } = useThreadUserInput({ dispatch });
  const {
    customNamesRef,
    threadActivityRef,
    pinnedThreadsVersion,
    getCustomName,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
  } = useThreadStorage();

  const recordLoadedThreadActivity = useCallback(
    (workspaceId: string, threadId: string, timestamp?: number) => {
      const activityTimestamp = timestamp ?? Date.now();
      recordThreadActivity(workspaceId, threadId, activityTimestamp);
      loadedThreadUpdatedAtRef.current[threadId] = Math.max(
        loadedThreadUpdatedAtRef.current[threadId] ?? 0,
        activityTimestamp,
      );
    },
    [recordThreadActivity],
  );

  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const { activeThreadId, activeItems } = useThreadSelectors({
    activeWorkspaceId,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    itemsByThread: state.itemsByThread,
    threadsByWorkspace: state.threadsByWorkspace,
  });

  const getCurrentRateLimits = useCallback(
    (workspaceId: string) => rateLimitsByWorkspaceRef.current[workspaceId] ?? null,
    [],
  );

  const { refreshAccountRateLimits } = useThreadRateLimits({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    getCurrentRateLimits,
    dispatch,
    onDebug,
  });
  const { refreshAccountInfo } = useThreadAccountInfo({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    dispatch,
    onDebug,
  });

  const { markProcessing, markReviewing, setActiveTurnId } = useThreadStatus({
    dispatch,
  });

  const pushThreadErrorMessage = useCallback(
    (
      threadId: string,
      message: string,
      options?: {
        itemType?: "stream-error" | "system-error";
        title?: string;
        detail?: string;
        status?: string;
      },
    ) => {
      dispatch({
        type: "addErrorItem",
        threadId,
        itemType: options?.itemType,
        title: options?.title,
        detail: options?.detail,
        status: options?.status,
        text: message,
      });
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [activeThreadId, dispatch],
  );

  const safeMessageActivity = useCallback(() => {
    try {
      void onMessageActivity?.();
    } catch {
      // Ignore refresh errors to avoid breaking the UI.
    }
  }, [onMessageActivity]);

  const setThreadLoaded = useCallback((threadId: string, isLoaded: boolean) => {
    loadedThreadsRef.current[threadId] = isLoaded;
    if (isLoaded) {
      loadedThreadUpdatedAtRef.current[threadId] = Math.max(
        loadedThreadUpdatedAtRef.current[threadId] ?? 0,
        Date.now(),
      );
    }
  }, []);

  const renameThread = useCallback(
    (workspaceId: string, threadId: string, newName: string) => {
      saveCustomName(workspaceId, threadId, newName);
      const key = makeCustomNameKey(workspaceId, threadId);
      customNamesRef.current[key] = newName;
      dispatch({ type: "setThreadName", workspaceId, threadId, name: newName });
      void Promise.resolve(
        setThreadNameService(workspaceId, threadId, newName),
      ).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-client-thread-rename-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/name/set error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [customNamesRef, dispatch, onDebug],
  );

  const onSubagentThreadDetected = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!workspaceId || !threadId) {
        return;
      }
      subagentThreadByWorkspaceThreadRef.current[
        buildWorkspaceThreadKey(workspaceId, threadId)
      ] = true;
    },
    [],
  );

  const isSubagentThread = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(
        subagentThreadByWorkspaceThreadRef.current[
          buildWorkspaceThreadKey(workspaceId, threadId)
        ],
      ),
    [],
  );

  const { applyCollabThreadLinks, applyCollabThreadLinksFromThread, updateThreadParent } =
    useThreadLinking({
      dispatch,
      threadParentById: state.threadParentById,
      onSubagentThreadDetected,
    });

  const handleWorkspaceConnected = useCallback(
    (workspaceId: string) => {
      onWorkspaceConnected(workspaceId);
      void refreshAccountRateLimits(workspaceId);
      void refreshAccountInfo(workspaceId);
    },
    [onWorkspaceConnected, refreshAccountRateLimits, refreshAccountInfo],
  );

  const handleAccountUpdated = useCallback(
    (workspaceId: string) => {
      void refreshAccountRateLimits(workspaceId);
      void refreshAccountInfo(workspaceId);
    },
    [refreshAccountRateLimits, refreshAccountInfo],
  );

  const isThreadHidden = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(state.hiddenThreadIdsByWorkspace[workspaceId]?.[threadId]),
    [state.hiddenThreadIdsByWorkspace],
  );

  const getActiveTurnId = useCallback(
    (threadId: string) => activeTurnIdByThreadRef.current[threadId] ?? null,
    [],
  );

  const { registerDetachedReviewChild, handleReviewExited } =
    useDetachedReviewTracking({
      activeThreadId,
      dispatch,
      recordThreadActivity: recordLoadedThreadActivity,
      safeMessageActivity,
      threadsByWorkspace: state.threadsByWorkspace,
      threadParentById: state.threadParentById,
      updateThreadParent,
    });

  const hydrateSubagentThreads = useCallback(
    async (workspaceId: string, receivers: CollabAgentRef[]) => {
      if (!workspaceId || receivers.length === 0) {
        return;
      }
      const uniqueThreadIds = Array.from(
        new Set(
          receivers
            .map((receiver) => receiver.threadId.trim())
            .filter((threadId) => threadId.length > 0),
        ),
      );
      if (uniqueThreadIds.length === 0) {
        return;
      }

      await Promise.all(
        uniqueThreadIds.map(async (threadId) => {
          const key = buildWorkspaceThreadKey(workspaceId, threadId);
          if (subagentHydrationInFlightRef.current[key]) {
            return;
          }
          const existingThread = threadsByWorkspaceRef.current[workspaceId]?.find(
            (thread) => thread.id === threadId,
          );
          if (existingThread?.subagentNickname && existingThread.subagentRole) {
            return;
          }

          subagentHydrationInFlightRef.current[key] = true;
          try {
            const response = await readThreadService(workspaceId, threadId);
            const thread = extractThreadFromResponse(response);
            if (!thread) {
              return;
            }
            const fallbackIndex =
              threadsByWorkspaceRef.current[workspaceId]?.length ?? 0;
            const summary = buildThreadSummaryFromThread({
              workspaceId,
              thread,
              fallbackIndex,
              getCustomName,
            });
            if (!summary) {
              return;
            }

            dispatch({ type: "ensureThread", workspaceId, threadId: summary.id });
            const preview = String(thread.preview ?? "").trim();
            const customName = getCustomName(workspaceId, summary.id);
            if (preview || customName) {
              dispatch({
                type: "setThreadName",
                workspaceId,
                threadId: summary.id,
                name: summary.name,
              });
            }
            dispatch({
              type: "mergeThreadSummary",
              workspaceId,
              threadId: summary.id,
              patch: {
                ...(summary.isSubagent ? { isSubagent: true } : {}),
                ...(summary.subagentNickname
                  ? { subagentNickname: summary.subagentNickname }
                  : {}),
                ...(summary.subagentRole ? { subagentRole: summary.subagentRole } : {}),
                ...(summary.createdAt !== undefined ? { createdAt: summary.createdAt } : {}),
              },
            });
            if (summary.updatedAt > 0) {
              dispatch({
                type: "setThreadTimestamp",
                workspaceId,
                threadId: summary.id,
                timestamp: summary.updatedAt,
              });
            }
            const parentThreadId = getParentThreadIdFromThread(thread);
            if (parentThreadId) {
              updateThreadParent(parentThreadId, [summary.id]);
            }
            if (summary.isSubagent) {
              onSubagentThreadDetected(workspaceId, summary.id);
            }
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-client-thread-read-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/read error",
              payload: {
                workspaceId,
                threadId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          } finally {
            delete subagentHydrationInFlightRef.current[key];
          }
        }),
      );
    },
    [dispatch, getCustomName, onDebug, onSubagentThreadDetected, updateThreadParent],
  );

  const { onUserMessageCreated } = useThreadTitleAutogeneration({
    enabled: threadTitleAutogenerationEnabled,
    itemsByThreadRef,
    threadsByWorkspaceRef,
    getCustomName,
    renameThread,
    onDebug,
  });

  const threadHandlers = useThreadEventHandlers({
    activeThreadId,
    dispatch,
    getItemsForThread: (threadId) => itemsByThreadRef.current[threadId] ?? [],
    planByThreadRef,
    getCurrentRateLimits,
    getCustomName,
    isThreadHidden,
    setThreadLoaded,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    getActiveTurnId,
    safeMessageActivity,
    recordThreadActivity: recordLoadedThreadActivity,
    onUserMessageCreated,
    pushThreadErrorMessage,
    onDebug,
    onWorkspaceConnected: handleWorkspaceConnected,
    applyCollabThreadLinks,
    hydrateSubagentThreads,
    onReviewExited: handleReviewExited,
    approvalAllowlistRef,
    pendingInterruptsRef,
  });

  const handleAccountLoginCompleted = useCallback(
    (workspaceId: string) => {
      handleAccountUpdated(workspaceId);
    },
    [handleAccountUpdated],
  );

  const handleThreadStarted = useCallback(
    (workspaceId: string, thread: Record<string, unknown>) => {
      threadHandlers.onThreadStarted(workspaceId, thread);
      const threadId = String(thread.id ?? "").trim();
      if (!threadId) {
        return;
      }
      const parentThreadId = getParentThreadIdFromThread(thread);
      if (!parentThreadId) {
        return;
      }
      updateThreadParent(parentThreadId, [threadId]);
      onSubagentThreadDetected(workspaceId, threadId);
    },
    [onSubagentThreadDetected, threadHandlers, updateThreadParent],
  );

  const handleThreadArchived = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!workspaceId || !threadId) {
        return;
      }
      threadHandlers.onThreadArchived?.(workspaceId, threadId);
      unpinThread(workspaceId, threadId);

      const skipKey = buildWorkspaceThreadKey(workspaceId, threadId);
      const skipAt = cascadeArchiveSkipRef.current[skipKey] ?? null;
      if (skipAt !== null) {
        delete cascadeArchiveSkipRef.current[skipKey];
        if (
          skipAt > 0 &&
          Date.now() - skipAt >= 0 &&
          Date.now() - skipAt < CASCADE_ARCHIVE_SKIP_TTL_MS
        ) {
          return;
        }
      }

      const descendants = getSubagentDescendantThreadIds({
        rootThreadId: threadId,
        threadParentById: threadParentByIdRef.current,
        isSubagentThread: (candidateId) =>
          isSubagentThread(workspaceId, candidateId),
      });
      if (descendants.length === 0) {
        return;
      }

      onDebug?.({
        id: `${Date.now()}-client-thread-archive-cascade`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/archive cascade",
        payload: { workspaceId, rootThreadId: threadId, descendantCount: descendants.length },
      });

      const now = Date.now();
      Object.entries(cascadeArchiveSkipRef.current).forEach(([key, timestamp]) => {
        if (now - timestamp >= CASCADE_ARCHIVE_SKIP_TTL_MS) {
          delete cascadeArchiveSkipRef.current[key];
        }
      });

      void (async () => {
        for (const descendantId of descendants) {
          const descendantKey = buildWorkspaceThreadKey(workspaceId, descendantId);
          cascadeArchiveSkipRef.current[descendantKey] = Date.now();
          try {
            await archiveThreadService(workspaceId, descendantId);
          } catch (error) {
            delete cascadeArchiveSkipRef.current[descendantKey];
            onDebug?.({
              id: `${Date.now()}-client-thread-archive-cascade-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/archive cascade error",
              payload: {
                workspaceId,
                rootThreadId: threadId,
                threadId: descendantId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }
      })();
    },
    [isSubagentThread, onDebug, threadHandlers, unpinThread],
  );

  const handleThreadUnarchived = useCallback(
    (workspaceId: string, threadId: string) => {
      threadHandlers.onThreadUnarchived?.(workspaceId, threadId);
    },
    [threadHandlers],
  );

  const handlers = useMemo(
    () => ({
      ...threadHandlers,
      onThreadStarted: handleThreadStarted,
      onThreadArchived: handleThreadArchived,
      onThreadUnarchived: handleThreadUnarchived,
      onAccountUpdated: handleAccountUpdated,
      onAccountLoginCompleted: handleAccountLoginCompleted,
    }),
    [
      threadHandlers,
      handleThreadStarted,
      handleThreadArchived,
      handleThreadUnarchived,
      handleAccountUpdated,
      handleAccountLoginCompleted,
    ],
  );

  useAppServerEvents(handlers);

  const {
    startThreadForWorkspace: startThreadForWorkspaceInternal,
    forkThreadForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    loadOlderThreadTurns,
    hydrateInitialThreadTurnsPage,
    archiveThread,
  } = useThreadActions({
    dispatch,
    itemsByThread: state.itemsByThread,
    threadsByWorkspace: state.threadsByWorkspace,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    threadTurnsCursorById: state.threadTurnsCursorById,
    threadTurnsPagingById: state.threadTurnsPagingById,
    threadTurnsHasLoadedOldestById: state.threadTurnsHasLoadedOldestById,
    threadParentById: state.threadParentById,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    threadStatusById: state.threadStatusById,
    threadSortKey,
    onDebug,
    getCustomName,
    threadActivityRef,
    loadedThreadsRef,
    loadedThreadUpdatedAtRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread,
    updateThreadParent,
    onSubagentThreadDetected,
    onThreadCodexMetadataDetected,
  });

  useEffect(() => {
    if (!restartSafeSessions) {
      return;
    }
    return subscribeRestartSafeSessionEvents((event) => {
      writeRestartSafeLastSeq(event.sessionId, event.eventSeq);
      if (event.eventKind.startsWith("session/")) {
        onDebug?.({
          id: `${Date.now()}-restart-safe-session-event-${event.eventSeq}`,
          timestamp: Date.now(),
          source: "event",
          label: `restart-safe ${event.eventKind}`,
          payload: event,
        });
      }
    });
  }, [onDebug, restartSafeSessions]);

  useEffect(() => {
    if (!restartSafeSessions) {
      return;
    }
    let canceled = false;
    const attachedSessionIds = new Set<string>();
    void (async () => {
      try {
        const sessions = await listRestartSafeSessions();
        for (const session of sessions) {
          if (canceled || session.lifecycle === "stopped") {
            continue;
          }
          const shouldAttach =
            Boolean(session.activeTurnId) || session.pendingRequestCount > 0;
          if (!shouldAttach) {
            continue;
          }
          const fromSeq = readRestartSafeLastSeq(session.sessionId);
          const attached = await attachRestartSafeSession(session.sessionId, fromSeq);
          if (canceled) {
            void detachRestartSafeSession(session.sessionId);
            return;
          }
          attachedSessionIds.add(session.sessionId);
          if (attached.replay.latestSeq > fromSeq) {
            writeRestartSafeLastSeq(session.sessionId, attached.replay.latestSeq);
          }
          for (const event of attached.replay.events) {
            dispatchReplayedAppServerEvent({
              workspace_id: event.workspaceId,
              message: event.payload,
            });
          }
          for (const request of attached.pendingRequests) {
            dispatchReplayedAppServerEvent({
              workspace_id: request.workspaceId,
              message: request.payload,
            });
          }
          if (
            attached.replay.retentionGap &&
            activeWorkspace &&
            activeWorkspace.id === session.workspaceId
          ) {
            await listThreadsForWorkspace(activeWorkspace, {
              preserveState: true,
              maxPages: 1,
            });
          }
          onDebug?.({
            id: `${Date.now()}-restart-safe-session-attached`,
            timestamp: Date.now(),
            source: attached.replay.retentionGap ? "error" : "event",
            label: attached.replay.retentionGap
              ? "restart-safe replay retention gap"
              : "restart-safe attached",
            payload: {
              sessionId: session.sessionId,
              workspaceId: session.workspaceId,
              fromSeq,
              latestSeq: attached.replay.latestSeq,
              replayedEvents: attached.replay.events.length,
              pendingRequests: attached.pendingRequests.length,
              retentionGap: attached.replay.retentionGap,
            },
          });
        }
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-restart-safe-reconnect-error`,
          timestamp: Date.now(),
          source: "error",
          label: "restart-safe reconnect",
          payload: {
            message:
              error instanceof Error
                ? error.message
                : "Unable to reconnect restart-safe sessions.",
          },
        });
      }
    })();
    return () => {
      canceled = true;
      for (const sessionId of attachedSessionIds) {
        void detachRestartSafeSession(sessionId);
      }
    };
  }, [
    activeWorkspace,
    activeWorkspaceId,
    listThreadsForWorkspace,
    onDebug,
    restartSafeSessions,
  ]);

  const ensureWorkspaceRuntimeCodexArgsBestEffort = useCallback(
    async (workspaceId: string, threadId: string | null, phase: string) => {
      if (!ensureWorkspaceRuntimeCodexArgs) {
        return;
      }
      try {
        await ensureWorkspaceRuntimeCodexArgs(workspaceId, threadId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        onDebug?.({
          id: `${Date.now()}-client-thread-runtime-codex-args-sync-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/runtime-codex-args sync error",
          payload: `${phase}: ${detail}`,
        });
      }
    },
    [ensureWorkspaceRuntimeCodexArgs, onDebug],
  );

  const getWorkspaceThreadIds = useCallback(
    (workspaceId: string, includeThreadId?: string) => {
      const visibleThreadIds = (threadsByWorkspaceRef.current[workspaceId] ?? [])
        .map((thread) => String(thread.id ?? "").trim())
        .filter((threadId) => threadId.length > 0);
      const hiddenThreadIds = Object.keys(
        hiddenThreadIdsByWorkspaceRef.current[workspaceId] ?? {},
      );
      const activeThreadIdForWorkspace =
        activeThreadIdByWorkspaceRef.current[workspaceId] ?? null;
      const threadIds = new Set([...visibleThreadIds, ...hiddenThreadIds]);
      if (activeThreadIdForWorkspace) {
        threadIds.add(activeThreadIdForWorkspace);
      }
      if (includeThreadId) {
        threadIds.add(includeThreadId);
      }
      return Array.from(threadIds);
    },
    [],
  );

  const hasProcessingThreadInWorkspace = useCallback(
    (workspaceId: string, excludedThreadId?: string) =>
      getWorkspaceThreadIds(workspaceId, excludedThreadId).some(
        (candidateThreadId) =>
          candidateThreadId !== excludedThreadId &&
          Boolean(threadStatusByIdRef.current[candidateThreadId]?.isProcessing),
      ),
    [getWorkspaceThreadIds],
  );

  const shouldPreflightRuntimeCodexArgsForSend = useCallback(
    (workspaceId: string, threadId: string) =>
      !hasProcessingThreadInWorkspace(workspaceId, threadId),
    [hasProcessingThreadInWorkspace],
  );

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean }) => {
      await ensureWorkspaceRuntimeCodexArgsBestEffort(workspaceId, null, "start");
      return startThreadForWorkspaceInternal(workspaceId, options);
    },
    [ensureWorkspaceRuntimeCodexArgsBestEffort, startThreadForWorkspaceInternal],
  );

  const startThread = useCallback(async () => {
    if (!activeWorkspaceId) {
      return null;
    }
    return startThreadForWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, startThreadForWorkspace]);

  const ensureThreadForActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace) {
      return null;
    }
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = await startThreadForWorkspace(activeWorkspace.id);
      if (!threadId) {
        return null;
      }
    } else if (!loadedThreadsRef.current[threadId]) {
      await ensureWorkspaceRuntimeCodexArgsBestEffort(
        activeWorkspace.id,
        threadId,
        "resume",
      );
      await resumeThreadForWorkspace(activeWorkspace.id, threadId);
    }
    return threadId;
  }, [
    activeWorkspace,
    activeThreadId,
    ensureWorkspaceRuntimeCodexArgsBestEffort,
    resumeThreadForWorkspace,
    startThreadForWorkspace,
  ]);

  const ensureThreadForWorkspace = useCallback(
    async (workspaceId: string) => {
      const currentActiveThreadId =
        activeThreadIdByWorkspaceRef.current[workspaceId] ?? null;
      const shouldActivate = workspaceId === activeWorkspaceId;
      let threadId = currentActiveThreadId;
      if (!threadId) {
        threadId = await startThreadForWorkspace(workspaceId, {
          activate: shouldActivate,
        });
        if (!threadId) {
          return null;
        }
      } else if (!loadedThreadsRef.current[threadId]) {
        await ensureWorkspaceRuntimeCodexArgsBestEffort(workspaceId, threadId, "resume");
        await resumeThreadForWorkspace(workspaceId, threadId);
      }
      if (shouldActivate && currentActiveThreadId !== threadId) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      return threadId;
    },
    [
      activeWorkspaceId,
      dispatch,
      ensureWorkspaceRuntimeCodexArgsBestEffort,
      loadedThreadsRef,
      resumeThreadForWorkspace,
      startThreadForWorkspace,
    ],
  );

  const {
    interruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startUncommittedReview,
    startResume,
    startCompact,
    startApps,
    startMcp,
    startFast,
    startStatus,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useThreadMessaging({
    activeWorkspace,
    activeThreadId,
    accessMode,
    model,
    effort,
    serviceTier,
    collaborationMode,
    onSelectServiceTier,
    reviewDeliveryMode,
    steerEnabled,
    customPrompts,
    ensureWorkspaceRuntimeCodexArgs,
    shouldPreflightRuntimeCodexArgsForSend,
    threadStatusById: state.threadStatusById,
    activeTurnIdByThread: state.activeTurnIdByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    pendingInterruptsRef,
    dispatch,
    getCustomName,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    recordThreadActivity: recordLoadedThreadActivity,
    safeMessageActivity,
    onDebug,
    pushThreadErrorMessage,
    ensureThreadForActiveWorkspace,
    ensureThreadForWorkspace,
    refreshThread,
    forkThreadForWorkspace,
    updateThreadParent,
    registerDetachedReviewChild,
    renameThread,
  });

  const hasLocalThreadSnapshot = useCallback(
    (threadId: string | null) => {
      if (!threadId) {
        return false;
      }
      return (
        loadedThreadsRef.current[threadId] === true ||
        (Boolean(threadStatusByIdRef.current[threadId]?.isProcessing) &&
          (itemsByThreadRef.current[threadId]?.length ?? 0) > 0)
      );
    },
    [itemsByThreadRef, loadedThreadsRef, threadStatusByIdRef],
  );

  const setActiveThreadId = useCallback(
    (threadId: string | null, workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      const currentThreadId =
        activeThreadIdByWorkspaceRef.current[targetId] ?? null;
      dispatch({ type: "setActiveThreadId", workspaceId: targetId, threadId });
      if (threadId && currentThreadId !== threadId) {
        Sentry.metrics.count("thread_switched", 1, {
          attributes: {
            workspace_id: targetId,
            thread_id: threadId,
            reason: "select",
          },
        });
      }
      if (threadId) {
        void (async () => {
          const hasLocalSnapshot = hasLocalThreadSnapshot(threadId);
          if (hasLocalSnapshot) {
            void hydrateInitialThreadTurnsPage(targetId, threadId);
            const summaryUpdatedAt =
              threadsByWorkspaceRef.current[targetId]?.find((thread) => thread.id === threadId)
                ?.updatedAt ?? 0;
            const loadedUpdatedAt = loadedThreadUpdatedAtRef.current[threadId] ?? 0;
            const isProcessing =
              threadStatusByIdRef.current[threadId]?.isProcessing ?? false;
            if (summaryUpdatedAt > loadedUpdatedAt && !isProcessing) {
              loadedThreadsRef.current[threadId] = true;
              const key = `${targetId}:${threadId}`;
              const existingTimer = selectionRefreshTimerByKeyRef.current[key];
              if (existingTimer !== undefined) {
                window.clearTimeout(existingTimer);
              }
              selectionRefreshTimerByKeyRef.current[key] = window.setTimeout(() => {
                delete selectionRefreshTimerByKeyRef.current[key];
                if (
                  (activeThreadIdByWorkspaceRef.current[targetId] ?? null) !== threadId ||
                  threadStatusByIdRef.current[threadId]?.isProcessing
                ) {
                  return;
                }
                void refreshThread(targetId, threadId, { bypassCooldown: true });
              }, 0);
              return;
            }
            loadedThreadsRef.current[threadId] = true;
            return;
          }
          const hasActiveTurnInWorkspace = hasProcessingThreadInWorkspace(targetId);
          if (!hasActiveTurnInWorkspace) {
            await ensureWorkspaceRuntimeCodexArgsBestEffort(targetId, threadId, "resume");
          }
          await resumeThreadForWorkspace(targetId, threadId);
        })();
      }
    },
    [
      activeWorkspaceId,
      ensureWorkspaceRuntimeCodexArgsBestEffort,
      hasLocalThreadSnapshot,
      hasProcessingThreadInWorkspace,
      loadedThreadUpdatedAtRef,
      loadedThreadsRef,
      hydrateInitialThreadTurnsPage,
      refreshThread,
      resumeThreadForWorkspace,
    ],
  );

  useEffect(() => {
    if (!activeWorkspaceId || !activeThreadId || !hasLocalThreadSnapshot(activeThreadId)) {
      return;
    }
    void hydrateInitialThreadTurnsPage(activeWorkspaceId, activeThreadId);
  }, [
    activeThreadId,
    activeWorkspaceId,
    hasLocalThreadSnapshot,
    hydrateInitialThreadTurnsPage,
  ]);

  const removeThread = useCallback(
    (workspaceId: string, threadId: string) => {
      unpinThread(workspaceId, threadId);
      dispatch({ type: "removeThread", workspaceId, threadId });
      void archiveThread(workspaceId, threadId);
    },
    [archiveThread, unpinThread],
  );

  return {
    activeThreadId,
    setActiveThreadId,
    hasLocalThreadSnapshot,
    activeItems,
    approvals: state.approvals,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    threadParentById: state.threadParentById,
    isSubagentThread,
    threadStatusById: state.threadStatusById,
    threadResumeLoadingById: state.threadResumeLoadingById,
    threadTurnsPagingById: state.threadTurnsPagingById,
    threadTurnsCursorById: state.threadTurnsCursorById,
    threadTurnsHasLoadedOldestById: state.threadTurnsHasLoadedOldestById,
    threadListLoadingByWorkspace: state.threadListLoadingByWorkspace,
    threadListPagingByWorkspace: state.threadListPagingByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    turnDiffByThread: state.turnDiffByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    accountByWorkspace: state.accountByWorkspace,
    planByThread: state.planByThread,
    lastAgentMessageByThread: state.lastAgentMessageByThread,
    pinnedThreadsVersion,
    refreshAccountRateLimits,
    refreshAccountInfo,
    pushThreadErrorMessage,
    interruptTurn,
    removeThread,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    renameThread,
    startThread,
    startThreadForWorkspace,
    forkThreadForWorkspace,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    refreshThread,
    loadOlderThreadTurns,
    resetWorkspaceThreads,
    loadOlderThreadsForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startUncommittedReview,
    startResume,
    startCompact,
    startApps,
    startMcp,
    startFast,
    startStatus,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
  };
}
