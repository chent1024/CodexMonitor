export const THREAD_SCROLL_BOTTOM_THRESHOLD_PX = 24;
export const THREAD_SCROLL_TOP_LOAD_THRESHOLD_PX = 80;
export const THREAD_SCROLL_RESTORE_TOLERANCE_PX = 2;

export type ThreadScrollSnapshot = {
  distanceFromBottom: number;
  wasPinned: boolean;
};

export type VirtualScrollLayout = {
  heights: number[];
  topOffsets: number[];
  bottomOffsets: number[];
  totalHeight: number;
};

export type VirtualScrollRange = {
  startIndex: number;
  endIndex: number;
};

function usesReverseScroll(node: HTMLElement) {
  return node.dataset.threadReverseScroll === "true";
}

export function getMaxScrollDistanceFromBottom(node: HTMLElement) {
  return Math.max(0, node.scrollHeight - node.clientHeight);
}

export function getScrollDistanceFromBottom(node: HTMLElement) {
  if (usesReverseScroll(node)) {
    return Math.max(0, -node.scrollTop);
  }
  return Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight);
}

export function setScrollDistanceFromBottom(
  node: HTMLElement,
  distanceFromBottom: number,
  behavior: ScrollBehavior = "auto",
) {
  const nextDistance = Math.max(0, distanceFromBottom);
  if (usesReverseScroll(node)) {
    const top = nextDistance === 0 ? 0 : -nextDistance;
    if (behavior === "auto" || typeof node.scrollTo !== "function") {
      node.scrollTop = top;
    } else {
      node.scrollTo({ top, behavior });
    }
    return;
  }
  const top = Math.max(0, node.scrollHeight - node.clientHeight - nextDistance);
  if (behavior === "auto" || typeof node.scrollTo !== "function") {
    node.scrollTop = top;
  } else {
    node.scrollTo({ top, behavior });
  }
}

export function isNearScrollBottom(
  node: HTMLElement,
  thresholdPx = THREAD_SCROLL_BOTTOM_THRESHOLD_PX,
) {
  return getScrollDistanceFromBottom(node) <= thresholdPx;
}

export function isNearScrollTop(
  node: HTMLElement,
  thresholdPx = THREAD_SCROLL_TOP_LOAD_THRESHOLD_PX,
) {
  return (
    getMaxScrollDistanceFromBottom(node) - getScrollDistanceFromBottom(node) <=
    thresholdPx
  );
}

export function isScrollSnapshotRestored(
  node: HTMLElement,
  snapshot: ThreadScrollSnapshot,
  thresholdPx = THREAD_SCROLL_RESTORE_TOLERANCE_PX,
) {
  if (snapshot.wasPinned) {
    return isNearScrollBottom(node);
  }
  return (
    Math.abs(getScrollDistanceFromBottom(node) - snapshot.distanceFromBottom) <=
    thresholdPx
  );
}

export function buildVirtualScrollLayout(
  heights: number[],
  gapPx: number,
): VirtualScrollLayout {
  const topOffsets: number[] = [];
  let totalHeight = 0;
  for (let index = 0; index < heights.length; index += 1) {
    topOffsets.push(totalHeight);
    totalHeight += heights[index] ?? 0;
    if (index < heights.length - 1) {
      totalHeight += gapPx;
    }
  }
  return {
    heights,
    topOffsets,
    bottomOffsets: topOffsets.map(
      (topOffset, index) => totalHeight - topOffset - (heights[index] ?? 0),
    ),
    totalHeight,
  };
}

function firstBottomOffsetBelow(bottomOffsets: number[], targetPx: number) {
  let low = 0;
  let high = bottomOffsets.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((bottomOffsets[mid] ?? 0) < targetPx) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function firstItemTopAtOrBelow({
  bottomOffsets,
  heights,
  targetPx,
}: {
  bottomOffsets: number[];
  heights: number[];
  targetPx: number;
}) {
  let low = 0;
  let high = bottomOffsets.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((bottomOffsets[mid] ?? 0) + (heights[mid] ?? 0) <= targetPx) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

export function getBottomVirtualRange({
  layout,
  viewportTopDistanceFromBottom,
  viewportBottomDistanceFromBottom,
  overscanCount,
}: {
  layout: VirtualScrollLayout;
  viewportTopDistanceFromBottom: number;
  viewportBottomDistanceFromBottom: number;
  overscanCount: number;
}): VirtualScrollRange {
  const itemCount = layout.heights.length;
  if (itemCount === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const start = firstBottomOffsetBelow(
    layout.bottomOffsets,
    Math.max(0, viewportTopDistanceFromBottom),
  );
  const visibleStart = firstItemTopAtOrBelow({
    bottomOffsets: layout.bottomOffsets,
    heights: layout.heights,
    targetPx: Math.max(0, viewportBottomDistanceFromBottom),
  });
  if (start >= itemCount) {
    return { startIndex: Math.max(0, itemCount - 1), endIndex: itemCount };
  }
  const end = Math.max(visibleStart, start + 1);
  return {
    startIndex: Math.max(0, start - overscanCount),
    endIndex: Math.min(itemCount, end + overscanCount),
  };
}

export function getMirroredVirtualRange({
  entriesLength,
  firstVisibleTurnIndex,
  visibleTurnEndIndex,
  visibleTurnStartIndex,
}: {
  entriesLength: number;
  firstVisibleTurnIndex: number | null;
  visibleTurnEndIndex: number;
  visibleTurnStartIndex: number;
}): VirtualScrollRange | null {
  if (firstVisibleTurnIndex == null) {
    return null;
  }
  const offset = firstVisibleTurnIndex - visibleTurnStartIndex;
  if (offset <= 0) {
    return null;
  }
  return {
    startIndex: firstVisibleTurnIndex,
    endIndex: Math.min(entriesLength, visibleTurnEndIndex + offset),
  };
}
