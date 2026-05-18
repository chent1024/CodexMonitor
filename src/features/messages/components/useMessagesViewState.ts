import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import type { ConversationItem } from "../../../types";
import { COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT } from "../../layout/utils/composerOverlayEvents";
import { isPlanReadyTaggedMessage } from "../../../utils/internalPlanReadyMessages";
import {
  SCROLL_THRESHOLD_PX,
  buildMessageEntries,
  computePlanFollowupState,
  getLatestReasoningWorkingLabel,
  parseReasoning,
  scrollKeyForItems,
} from "../utils/messageRenderUtils";
import {
  getMaxScrollDistanceFromBottom,
  getScrollDistanceFromBottom,
  isNearScrollBottom,
  setScrollDistanceFromBottom,
} from "../utils/threadScroll";

function toMarkdownQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
    .concat("\n\n");
}

type UseMessagesViewStateArgs = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  activeUserInputRequestId: string | number | null;
  hasVisibleUserInputRequest: boolean;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onQuoteMessage?: (text: string) => void;
};

type ReasoningParseCacheEntry = {
  summary: string;
  content: string;
  parsed: ReturnType<typeof parseReasoning>;
};

type ScrollSnapshot = {
  anchor?: {
    offsetTopPx: number;
    turnKey: string;
  };
  distanceFromBottom: number;
  wasPinned: boolean;
};

export type ThreadScrollController = {
  adjustForMeasuredTurnHeightDelta: (input: {
    heightDeltaPx: number;
    turnBottomDistanceFromBottomPx: number;
    viewportDistanceFromBottomPx: number;
  }) => void;
  getLastScrollDistanceFromBottomPx: () => number;
  getScrollElement: () => HTMLDivElement | null;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToDistanceFromBottomPx: (
    distanceFromBottom: number,
    behavior?: ScrollBehavior,
  ) => void;
};

const MAX_THREAD_SCROLL_SNAPSHOTS = 200;
const SCROLL_RESTORE_TOLERANCE_PX = 2;
const threadScrollSnapshots = new Map<string, ScrollSnapshot>();

function getScrollAnchor(container: HTMLDivElement): ScrollSnapshot["anchor"] {
  const containerRect = container.getBoundingClientRect();
  const turnNodes = Array.from(
    container.querySelectorAll<HTMLElement>("[data-turn-key]"),
  );
  let best:
    | {
        distanceFromTopPx: number;
        offsetTopPx: number;
        turnKey: string;
      }
    | null = null;
  turnNodes.forEach((node) => {
    const turnKey = node.dataset.turnKey;
    if (!turnKey) {
      return;
    }
    const rect = node.getBoundingClientRect();
    if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) {
      return;
    }
    const offsetTopPx = rect.top - containerRect.top;
    const distanceFromTopPx = Math.abs(offsetTopPx);
    if (!best || distanceFromTopPx < best.distanceFromTopPx) {
      best = { distanceFromTopPx, offsetTopPx, turnKey };
    }
  });
  if (best == null) {
    return undefined;
  }
  const anchor = best as {
    distanceFromTopPx: number;
    offsetTopPx: number;
    turnKey: string;
  };
  return {
    offsetTopPx: anchor.offsetTopPx,
    turnKey: anchor.turnKey,
  };
}

function getScrollSnapshot(container: HTMLDivElement, wasPinned: boolean): ScrollSnapshot {
  return {
    anchor: wasPinned ? undefined : getScrollAnchor(container),
    distanceFromBottom: getScrollDistanceFromBottom(container),
    wasPinned,
  };
}

function getScrollDistanceSnapshot(
  container: HTMLDivElement,
  wasPinned: boolean,
): ScrollSnapshot {
  return {
    distanceFromBottom: getScrollDistanceFromBottom(container),
    wasPinned,
  };
}

function restoreScrollAnchor(container: HTMLDivElement, snapshot: ScrollSnapshot) {
  if (!snapshot.anchor || snapshot.wasPinned) {
    return;
  }
  const anchorNode = Array.from(
    container.querySelectorAll<HTMLElement>("[data-turn-key]"),
  ).find((node) => node.dataset.turnKey === snapshot.anchor?.turnKey);
  if (!anchorNode) {
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchorNode.getBoundingClientRect();
  const deltaPx =
    anchorRect.top - containerRect.top - snapshot.anchor.offsetTopPx;
  if (!Number.isFinite(deltaPx) || Math.abs(deltaPx) < 1) {
    return;
  }
  container.scrollTop += deltaPx;
}

function rememberThreadScrollSnapshot(key: string, snapshot: ScrollSnapshot) {
  if (threadScrollSnapshots.size >= MAX_THREAD_SCROLL_SNAPSHOTS) {
    const oldestKey = threadScrollSnapshots.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      threadScrollSnapshots.delete(oldestKey);
    }
  }
  threadScrollSnapshots.set(key, snapshot);
}

export function useMessagesViewState({
  items,
  threadId,
  workspaceId = null,
  isThinking,
  activeUserInputRequestId,
  hasVisibleUserInputRequest,
  onPlanAccept,
  onPlanSubmitChanges,
  onQuoteMessage,
}: UseMessagesViewStateArgs) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const pendingRestoreRef = useRef<ScrollSnapshot | null>(null);
  const isRestoringScrollRef = useRef(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const manuallyToggledExpandedRef = useRef<Set<string>>(new Set());
  const reasoningParseCacheRef = useRef<Map<string, ReasoningParseCacheEntry>>(
    new Map(),
  );

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Set<string>>(
    new Set(),
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dismissedPlanFollowupByThread, setDismissedPlanFollowupByThread] =
    useState<Record<string, string>>({});

  const scrollKey = `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;
  const scrollScopeKey = `${workspaceId ?? "no-workspace"}:${threadId ?? "draft"}`;
  const initialScrollSnapshot = threadScrollSnapshots.get(scrollScopeKey);
  const initialScrollDistanceFromBottom = initialScrollSnapshot?.wasPinned
    ? 0
    : (initialScrollSnapshot?.distanceFromBottom ?? 0);
  const lastScrollSnapshotRef = useRef<ScrollSnapshot>({
    distanceFromBottom: initialScrollDistanceFromBottom,
    wasPinned: initialScrollDistanceFromBottom <= SCROLL_THRESHOLD_PX,
  });
  const [showScrollToBottom, setShowScrollToBottom] = useState(
    initialScrollDistanceFromBottom > SCROLL_THRESHOLD_PX,
  );

  useEffect(() => {
    manuallyToggledExpandedRef.current.clear();
    setExpandedItems((current) => (current.size > 0 ? new Set() : current));
    setCollapsedToolGroups((current) => (current.size > 0 ? new Set() : current));
    setCopiedMessageId(null);
  }, [threadId, workspaceId]);

  const isNearBottom = useCallback(
    (node: HTMLDivElement) => isNearScrollBottom(node, SCROLL_THRESHOLD_PX),
    [],
  );

  const storeScrollSnapshot = useCallback(
    (snapshot: ScrollSnapshot) => {
      lastScrollSnapshotRef.current = snapshot;
      rememberThreadScrollSnapshot(scrollScopeKey, snapshot);
    },
    [scrollScopeKey],
  );

  const isScrollSnapshotRestored = useCallback(
    (node: HTMLDivElement, snapshot: ScrollSnapshot) => {
      if (snapshot.wasPinned) {
        return isNearBottom(node);
      }
      return (
        Math.abs(
          getScrollDistanceFromBottom(node) - snapshot.distanceFromBottom,
        ) <= SCROLL_RESTORE_TOLERANCE_PX
      );
    },
    [isNearBottom],
  );

  const updateAutoScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (isRestoringScrollRef.current) {
      return;
    }
    pendingRestoreRef.current = null;
    const wasPinned = isNearBottom(container);
    autoScrollRef.current = wasPinned;
    setShowScrollToBottom(!wasPinned);
    storeScrollSnapshot(getScrollDistanceSnapshot(container, wasPinned));
  }, [isNearBottom, storeScrollSnapshot]);

  const pauseAutoScrollForUser = useCallback(() => {
    const container = containerRef.current;
    if (!container || isRestoringScrollRef.current) {
      return;
    }
    if (getMaxScrollDistanceFromBottom(container) <= SCROLL_THRESHOLD_PX) {
      return;
    }
    pendingRestoreRef.current = null;
    autoScrollRef.current = false;
    setShowScrollToBottom(true);
    storeScrollSnapshot({
      distanceFromBottom: getScrollDistanceFromBottom(container),
      wasPinned: false,
    });
  }, [storeScrollSnapshot]);

  const handleWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.deltaY >= -1) {
        return;
      }
      pauseAutoScrollForUser();
    },
    [pauseAutoScrollForUser],
  );

  const scrollToPinnedBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = containerRef.current;
    if (!container) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior });
      return;
    }
    setScrollDistanceFromBottom(container, 0, behavior);
    autoScrollRef.current = true;
    setShowScrollToBottom(false);
    storeScrollSnapshot({
      distanceFromBottom: 0,
      wasPinned: true,
    });
  }, [storeScrollSnapshot]);

  const scrollToDistanceFromBottomPx = useCallback(
    (distanceFromBottom: number, behavior: ScrollBehavior = "auto") => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const nextDistance = Math.max(0, distanceFromBottom);
      setScrollDistanceFromBottom(container, nextDistance, behavior);
      const wasPinned = nextDistance <= SCROLL_THRESHOLD_PX;
      autoScrollRef.current = wasPinned;
      setShowScrollToBottom(!wasPinned);
      storeScrollSnapshot({
        distanceFromBottom: nextDistance,
        wasPinned,
      });
    },
    [storeScrollSnapshot],
  );

  const restoreScrollSnapshot = useCallback(
    (snapshot: ScrollSnapshot) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      if (snapshot.wasPinned) {
        scrollToPinnedBottom();
      } else {
        setScrollDistanceFromBottom(container, snapshot.distanceFromBottom);
        restoreScrollAnchor(container, snapshot);
        setShowScrollToBottom(snapshot.distanceFromBottom > SCROLL_THRESHOLD_PX);
        storeScrollSnapshot(snapshot);
      }
    },
    [scrollToPinnedBottom, storeScrollSnapshot],
  );

  const scheduleScrollSnapshotRestore = useCallback(
    (snapshot: ScrollSnapshot) => {
      pendingRestoreRef.current = snapshot;
      isRestoringScrollRef.current = true;
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreScrollSnapshot(snapshot);
        restoreFrameRef.current = window.requestAnimationFrame(() => {
          restoreFrameRef.current = null;
          const container = containerRef.current;
          if (!container) {
            pendingRestoreRef.current = null;
            isRestoringScrollRef.current = false;
            return;
          }
          if (pendingRestoreRef.current === snapshot) {
            restoreScrollSnapshot(snapshot);
            restoreScrollAnchor(container, snapshot);
            if (isScrollSnapshotRestored(container, snapshot)) {
              pendingRestoreRef.current = null;
            }
          }
          isRestoringScrollRef.current = false;
        });
      });
    },
    [isScrollSnapshotRestored, restoreScrollSnapshot],
  );

  const shouldKeepPinnedToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return autoScrollRef.current;
    }
    const isPinnedNow = isNearBottom(container);
    if (!isPinnedNow && !isRestoringScrollRef.current) {
      autoScrollRef.current = false;
    }
    return autoScrollRef.current && isPinnedNow;
  }, [isNearBottom]);

  const schedulePinnedScroll = useCallback(() => {
    if (!shouldKeepPinnedToBottom()) {
      return;
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (shouldKeepPinnedToBottom()) {
        scrollToPinnedBottom("smooth");
      }
    });
  }, [scrollToPinnedBottom, shouldKeepPinnedToBottom]);

  const requestAutoScroll = useCallback(() => {
    if (!shouldKeepPinnedToBottom()) {
      return;
    }
    scrollToPinnedBottom("smooth");
    schedulePinnedScroll();
  }, [schedulePinnedScroll, scrollToPinnedBottom, shouldKeepPinnedToBottom]);

  const adjustForMeasuredTurnHeightDelta = useCallback(
    ({
      heightDeltaPx,
      turnBottomDistanceFromBottomPx,
      viewportDistanceFromBottomPx,
    }: {
      heightDeltaPx: number;
      turnBottomDistanceFromBottomPx: number;
      viewportDistanceFromBottomPx: number;
    }) => {
      const container = containerRef.current;
      if (!container || heightDeltaPx === 0 || isRestoringScrollRef.current) {
        return;
      }
      if (viewportDistanceFromBottomPx <= SCROLL_THRESHOLD_PX) {
        scrollToPinnedBottom();
        return;
      }
      if (turnBottomDistanceFromBottomPx <= viewportDistanceFromBottomPx) {
        scrollToDistanceFromBottomPx(
          getScrollDistanceFromBottom(container) + heightDeltaPx,
        );
      }
    },
    [scrollToDistanceFromBottomPx, scrollToPinnedBottom],
  );

  const threadScrollController = useMemo<ThreadScrollController>(
    () => ({
      adjustForMeasuredTurnHeightDelta,
      getLastScrollDistanceFromBottomPx: () =>
        lastScrollSnapshotRef.current.distanceFromBottom,
      getScrollElement: () => containerRef.current,
      scrollToBottom: scrollToPinnedBottom,
      scrollToDistanceFromBottomPx,
    }),
    [
      adjustForMeasuredTurnHeightDelta,
      scrollToDistanceFromBottomPx,
      scrollToPinnedBottom,
    ],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      autoScrollRef.current = true;
      return undefined;
    }

    const snapshot = threadScrollSnapshots.get(scrollScopeKey);
    if (snapshot) {
      lastScrollSnapshotRef.current = snapshot;
      autoScrollRef.current = snapshot.wasPinned;
      restoreScrollSnapshot(snapshot);
      scheduleScrollSnapshotRestore(snapshot);
    } else {
      lastScrollSnapshotRef.current = {
        distanceFromBottom: 0,
        wasPinned: true,
      };
      autoScrollRef.current = true;
      scrollToPinnedBottom();
      schedulePinnedScroll();
    }

    return () => {
      const latestContainer = containerRef.current;
      if (latestContainer?.dataset.threadScrollScope === scrollScopeKey) {
        const wasPinned = isNearBottom(latestContainer);
        rememberThreadScrollSnapshot(
          scrollScopeKey,
          getScrollSnapshot(latestContainer, wasPinned),
        );
        return;
      }
      rememberThreadScrollSnapshot(scrollScopeKey, lastScrollSnapshotRef.current);
    };
  }, [
    isNearBottom,
    schedulePinnedScroll,
    scheduleScrollSnapshotRestore,
    scrollScopeKey,
    scrollToPinnedBottom,
    restoreScrollSnapshot,
  ]);

  useLayoutEffect(() => {
    if (pendingRestoreRef.current) {
      restoreScrollSnapshot(pendingRestoreRef.current);
      scheduleScrollSnapshotRestore(pendingRestoreRef.current);
      return;
    }
    if (!shouldKeepPinnedToBottom()) {
      return;
    }
    scrollToPinnedBottom();
    schedulePinnedScroll();
  }, [
    schedulePinnedScroll,
    scrollKey,
    scrollToPinnedBottom,
    shouldKeepPinnedToBottom,
    restoreScrollSnapshot,
    scheduleScrollSnapshotRestore,
    isThinking,
    threadId,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    const observed =
      container?.querySelector("[data-thread-find-target='conversation']") ??
      container?.firstElementChild;
    if (!container || !observed || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (pendingRestoreRef.current) {
        restoreScrollSnapshot(pendingRestoreRef.current);
        scheduleScrollSnapshotRestore(pendingRestoreRef.current);
        return;
      }
      schedulePinnedScroll();
    });
    observer.observe(observed);
    return () => observer.disconnect();
  }, [
    restoreScrollSnapshot,
    schedulePinnedScroll,
    scheduleScrollSnapshotRestore,
    scrollKey,
    threadId,
  ]);

  useEffect(() => {
    const handleComposerOverlayHeightChange = () => {
      schedulePinnedScroll();
    };
    window.addEventListener(
      COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT,
      handleComposerOverlayHeightChange,
    );
    return () => {
      window.removeEventListener(
        COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT,
        handleComposerOverlayHeightChange,
      );
    };
  }, [schedulePinnedScroll]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
      isRestoringScrollRef.current = false;
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollToPinnedBottom("smooth");
    schedulePinnedScroll();
  }, [schedulePinnedScroll, scrollToPinnedBottom]);

  const toggleExpanded = useCallback((id: string) => {
    manuallyToggledExpandedRef.current.add(id);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleToolGroup = useCallback((id: string) => {
    setCollapsedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyMessage = useCallback(
    async (item: Extract<ConversationItem, { kind: "message" }>) => {
      try {
        await navigator.clipboard.writeText(item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  const handleQuoteMessage = useCallback(
    (item: Extract<ConversationItem, { kind: "message" }>, selectedText?: string) => {
      if (!onQuoteMessage) {
        return;
      }
      const sourceText = selectedText?.trim().length ? selectedText : item.text;
      const quoteText = toMarkdownQuote(sourceText);
      if (!quoteText) {
        return;
      }
      onQuoteMessage(quoteText);
    },
    [onQuoteMessage],
  );

  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    const nextCache = new Map<string, ReasoningParseCacheEntry>();
    items.forEach((item) => {
      if (item.kind === "reasoning") {
        const summary = item.summary ?? "";
        const content = item.content ?? "";
        const cached = reasoningParseCacheRef.current.get(item.id);
        const parsed =
          cached?.summary === summary && cached.content === content
            ? cached.parsed
            : parseReasoning(item);
        meta.set(item.id, parsed);
        nextCache.set(item.id, { summary, content, parsed });
      }
    });
    reasoningParseCacheRef.current = nextCache;
    return meta;
  }, [items]);

  const latestReasoningLabel = useMemo(
    () => getLatestReasoningWorkingLabel(items),
    [items],
  );

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          item.kind === "message" &&
          item.role === "user" &&
          isPlanReadyTaggedMessage(item.text)
        ) {
          return false;
        }
        if (item.kind !== "reasoning") {
          return true;
        }
        return reasoningMetaById.get(item.id)?.hasBody ?? false;
      }),
    [items, reasoningMetaById],
  );

  useEffect(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (
        item.kind === "tool" &&
        item.toolType === "plan" &&
        (item.output ?? "").trim().length > 0
      ) {
        if (manuallyToggledExpandedRef.current.has(item.id)) {
          return;
        }
        setExpandedItems((prev) => {
          if (prev.has(item.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        return;
      }
    }
  }, [visibleItems]);

  const groupedItems = useMemo(() => buildMessageEntries(visibleItems), [visibleItems]);

  const planFollowup = useMemo(() => {
    if (!onPlanAccept || !onPlanSubmitChanges) {
      return { shouldShow: false, planItemId: null };
    }

    const candidate = computePlanFollowupState({
      threadId,
      items,
      isThinking,
      hasVisibleUserInputRequest,
    });

    if (threadId && candidate.planItemId) {
      if (dismissedPlanFollowupByThread[threadId] === candidate.planItemId) {
        return { ...candidate, shouldShow: false };
      }
    }

    return candidate;
  }, [
    dismissedPlanFollowupByThread,
    hasVisibleUserInputRequest,
    isThinking,
    items,
    onPlanAccept,
    onPlanSubmitChanges,
    threadId,
  ]);

  const dismissPlanFollowup = useCallback(() => {
    if (!threadId || !planFollowup.planItemId) {
      return;
    }
    setDismissedPlanFollowupByThread((prev) => ({
      ...prev,
      [threadId]: planFollowup.planItemId!,
    }));
  }, [planFollowup.planItemId, threadId]);

  return {
    bottomRef,
    containerRef,
    handleWheelCapture,
    updateAutoScroll,
    requestAutoScroll,
    scrollToBottom,
    showScrollToBottom,
    initialScrollDistanceFromBottom,
    threadScrollController,
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
  };
}
