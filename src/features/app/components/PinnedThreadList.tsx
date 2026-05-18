import { memo, useCallback, useMemo, useState, type MouseEvent } from "react";

import type { ThreadSummary } from "../../../types";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { ThreadRow } from "./ThreadRow";
import { buildThreadRowVisibility } from "./threadRowVisibility";

type PinnedThreadRow = {
  thread: ThreadSummary;
  depth: number;
  workspaceId: string;
};

type PinnedThreadListProps = {
  rows: PinnedThreadRow[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  pendingUserInputKeys?: Set<string>;
  getWorkspaceLabel?: (workspaceId: string) => string | null;
  showWorkspaceLabels?: boolean;
  getThreadTime: (thread: ThreadSummary) => string | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onToggleThreadPin: (workspaceId: string, threadId: string, isPinned: boolean) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
};

function PinnedThreadList({
  rows,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  pendingUserInputKeys,
  getWorkspaceLabel,
  showWorkspaceLabels = false,
  getThreadTime,
  getThreadArgsBadge,
  isThreadPinned,
  onSelectThread,
  onToggleThreadPin,
  onShowThreadMenu,
}: PinnedThreadListProps) {
  const [collapsedThreadKeys, setCollapsedThreadKeys] = useState<Set<string>>(new Set());
  const visibility = useMemo(
    () =>
      buildThreadRowVisibility(
        rows,
        (row) => collapsedThreadKeys.has(`${row.workspaceId}:${row.thread.id}`),
      ),
    [collapsedThreadKeys, rows],
  );

  const toggleThreadSubagents = useCallback((workspaceId: string, threadId: string) => {
    const threadKey = `${workspaceId}:${threadId}`;
    setCollapsedThreadKeys((prev) => {
      const next = new Set(prev);
      if (next.has(threadKey)) {
        next.delete(threadKey);
      } else {
        next.add(threadKey);
      }
      return next;
    });
  }, []);

  return (
    <div className="thread-list pinned-thread-list">
      {visibility.visibleRows.map((row) => {
        const { thread, depth, workspaceId } = row;
        const threadKey = `${workspaceId}:${thread.id}`;
        return (
          <ThreadRow
            key={`${workspaceId}:${thread.id}`}
            thread={thread}
            depth={depth}
            workspaceId={workspaceId}
            indentUnit={14}
            isActive={workspaceId === activeWorkspaceId && thread.id === activeThreadId}
            threadStatus={threadStatusById[thread.id]}
            hasPendingUserInput={pendingUserInputKeys?.has(threadKey)}
            workspaceLabel={
              showWorkspaceLabels ? (getWorkspaceLabel?.(workspaceId) ?? null) : null
            }
            getThreadTime={getThreadTime}
            getThreadArgsBadge={getThreadArgsBadge}
            isThreadPinned={isThreadPinned}
            onSelectThread={onSelectThread}
            onToggleThreadPin={onToggleThreadPin}
            onShowThreadMenu={onShowThreadMenu}
            hasSubagentChildren={visibility.rowsWithChildren.has(row)}
            subagentsExpanded={!collapsedThreadKeys.has(threadKey)}
            onToggleSubagents={toggleThreadSubagents}
            showPinnedLabel={false}
          />
        );
      })}
    </div>
  );
}

function arePinnedRowsEqual(prevRows: PinnedThreadRow[], nextRows: PinnedThreadRow[]) {
  if (prevRows.length !== nextRows.length) {
    return false;
  }
  return prevRows.every(
    (row, index) =>
      row.workspaceId === nextRows[index].workspaceId &&
      row.thread.id === nextRows[index].thread.id &&
      row.depth === nextRows[index].depth &&
      row.thread.searchSnippet === nextRows[index].thread.searchSnippet &&
      row.thread.searchMatchKind === nextRows[index].thread.searchMatchKind,
  );
}

function hasPinnedStatusChanged(
  prev: PinnedThreadListProps,
  next: PinnedThreadListProps,
): boolean {
  if (!arePinnedRowsEqual(prev.rows, next.rows)) {
    return true;
  }
  for (let index = 0; index < prev.rows.length; index += 1) {
    const threadId = prev.rows[index].thread.id;
    const prevStatus = prev.threadStatusById[threadId];
    const nextStatus = next.threadStatusById[threadId];
    if (
      prevStatus?.hasUnread !== nextStatus?.hasUnread ||
      prevStatus?.isProcessing !== nextStatus?.isProcessing ||
      prevStatus?.isReviewing !== nextStatus?.isReviewing ||
      prevStatus?.processingStartedAt !== nextStatus?.processingStartedAt ||
      prevStatus?.lastDurationMs !== nextStatus?.lastDurationMs
    ) {
      return true;
    }
  }
  return false;
}

function hasPendingInputChanged(
  prev: PinnedThreadListProps,
  next: PinnedThreadListProps,
): boolean {
  if (prev.pendingUserInputKeys === next.pendingUserInputKeys) {
    return false;
  }
  if (prev.pendingUserInputKeys === undefined || next.pendingUserInputKeys === undefined) {
    return true;
  }
  if (prev.pendingUserInputKeys.size !== next.pendingUserInputKeys.size) {
    return true;
  }
  for (const key of prev.pendingUserInputKeys) {
    if (!next.pendingUserInputKeys.has(key)) {
      return true;
    }
  }
  return false;
}

const PinnedThreadListMemo = memo(
  PinnedThreadList,
  (prev, next) =>
    prev.activeWorkspaceId === next.activeWorkspaceId &&
    prev.activeThreadId === next.activeThreadId &&
    prev.getWorkspaceLabel === next.getWorkspaceLabel &&
    prev.showWorkspaceLabels === next.showWorkspaceLabels &&
    prev.getThreadTime === next.getThreadTime &&
    prev.getThreadArgsBadge === next.getThreadArgsBadge &&
    prev.isThreadPinned === next.isThreadPinned &&
    prev.onSelectThread === next.onSelectThread &&
    prev.onToggleThreadPin === next.onToggleThreadPin &&
    prev.onShowThreadMenu === next.onShowThreadMenu &&
    prev.rows === next.rows &&
    !hasPinnedStatusChanged(prev, next) &&
    !hasPendingInputChanged(prev, next),
);

export { PinnedThreadListMemo as PinnedThreadList };
