import { memo, useCallback, useMemo, useState, type MouseEvent } from "react";

import type { ThreadSummary } from "../../../types";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { ThreadRow } from "./ThreadRow";
import { buildThreadRowVisibility } from "./threadRowVisibility";

type ThreadListRow = {
  thread: ThreadSummary;
  depth: number;
};

type ThreadListProps = {
  workspaceId: string;
  pinnedRows: ThreadListRow[];
  unpinnedRows: ThreadListRow[];
  totalThreadRoots: number;
  isExpanded: boolean;
  showExpandToggle?: boolean;
  nextCursor: string | null;
  isPaging: boolean;
  nested?: boolean;
  showLoadOlder?: boolean;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  pendingUserInputKeys?: Set<string>;
  getThreadTime: (thread: ThreadSummary) => string | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onToggleExpanded: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
};

function ThreadListInner({
  workspaceId,
  pinnedRows,
  unpinnedRows,
  totalThreadRoots,
  isExpanded,
  showExpandToggle = true,
  nextCursor,
  isPaging,
  nested,
  showLoadOlder = true,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  pendingUserInputKeys,
  getThreadTime,
  getThreadArgsBadge,
  isThreadPinned,
  onToggleExpanded,
  onLoadOlderThreads,
  onSelectThread,
  onShowThreadMenu,
}: ThreadListProps) {
  const indentUnit = nested ? 10 : 14;
  const [collapsedThreadKeys, setCollapsedThreadKeys] = useState<Set<string>>(new Set());

  const toggleThreadSubagents = useCallback((_workspaceId: string, threadId: string) => {
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
  }, [workspaceId]);

  const pinnedVisibility = useMemo(
    () =>
      buildThreadRowVisibility(
        pinnedRows,
        (row) => collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`),
      ),
    [collapsedThreadKeys, pinnedRows, workspaceId],
  );
  const unpinnedVisibility = useMemo(
    () =>
      buildThreadRowVisibility(
        unpinnedRows,
        (row) => collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`),
      ),
    [collapsedThreadKeys, unpinnedRows, workspaceId],
  );

  return (
    <div className={`thread-list${nested ? " thread-list-nested" : ""}`}>
      {pinnedVisibility.visibleRows.map((row) => (
        <ThreadRow
          key={row.thread.id}
          thread={row.thread}
          depth={row.depth}
          workspaceId={workspaceId}
          indentUnit={indentUnit}
          isActive={workspaceId === activeWorkspaceId && row.thread.id === activeThreadId}
          threadStatus={threadStatusById[row.thread.id]}
          hasPendingUserInput={pendingUserInputKeys?.has(`${workspaceId}:${row.thread.id}`)}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          hasSubagentChildren={pinnedVisibility.rowsWithChildren.has(row)}
          subagentsExpanded={!collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`)}
          onToggleSubagents={toggleThreadSubagents}
        />
      ))}
      {pinnedVisibility.visibleRows.length > 0 && unpinnedVisibility.visibleRows.length > 0 && (
        <div className="thread-list-separator" aria-hidden="true" />
      )}
      {unpinnedVisibility.visibleRows.map((row) => (
        <ThreadRow
          key={row.thread.id}
          thread={row.thread}
          depth={row.depth}
          workspaceId={workspaceId}
          indentUnit={indentUnit}
          isActive={workspaceId === activeWorkspaceId && row.thread.id === activeThreadId}
          threadStatus={threadStatusById[row.thread.id]}
          hasPendingUserInput={pendingUserInputKeys?.has(`${workspaceId}:${row.thread.id}`)}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          hasSubagentChildren={unpinnedVisibility.rowsWithChildren.has(row)}
          subagentsExpanded={!collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`)}
          onToggleSubagents={toggleThreadSubagents}
        />
      ))}
      {showExpandToggle && totalThreadRoots > 3 && (
        <button
          className="thread-more"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(workspaceId);
          }}
        >
          {isExpanded ? "Show less" : "More..."}
        </button>
      )}
      {showLoadOlder && nextCursor && (isExpanded || totalThreadRoots <= 3) && (
        <button
          className="thread-more"
          onClick={(event) => {
            event.stopPropagation();
            onLoadOlderThreads(workspaceId);
          }}
          disabled={isPaging}
        >
          {isPaging
            ? "Loading..."
            : totalThreadRoots === 0
              ? "Search older..."
              : "Load older..."}
        </button>
      )}
    </div>
  );
}

function areThreadListRowsEqual(prevRows: ThreadListRow[], nextRows: ThreadListRow[]) {
  if (prevRows.length !== nextRows.length) {
    return false;
  }
  return prevRows.every(
    (row, index) =>
      row.thread.id === nextRows[index].thread.id &&
      row.depth === nextRows[index].depth,
  );
}

function hasVisibleStatusChanged(
  prev: ThreadListProps,
  next: ThreadListProps,
): boolean {
  const rows = [...prev.pinnedRows, ...prev.unpinnedRows];
  const nextRows = [...next.pinnedRows, ...next.unpinnedRows];

  if (!areThreadListRowsEqual(rows, nextRows)) {
    return true;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const prevThreadId = rows[index].thread.id;
    const nextThreadId = nextRows[index].thread.id;
    if (prevThreadId !== nextThreadId) {
      return true;
    }
    const prevStatus = prev.threadStatusById[prevThreadId];
    const nextStatus = next.threadStatusById[nextThreadId];
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
  prev: ThreadListProps,
  next: ThreadListProps,
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

function getVisibleActiveThreadIdForList(props: ThreadListProps) {
  if (props.activeWorkspaceId !== props.workspaceId || !props.activeThreadId) {
    return null;
  }
  const rows = [...props.pinnedRows, ...props.unpinnedRows];
  return rows.some((row) => row.thread.id === props.activeThreadId)
    ? props.activeThreadId
    : null;
}

function hasActiveRowChanged(prev: ThreadListProps, next: ThreadListProps) {
  return (
    getVisibleActiveThreadIdForList(prev) !==
    getVisibleActiveThreadIdForList(next)
  );
}

const ThreadList = memo(
  ThreadListInner,
  (prev, next) =>
    prev.workspaceId === next.workspaceId &&
    prev.totalThreadRoots === next.totalThreadRoots &&
    prev.isExpanded === next.isExpanded &&
    prev.showExpandToggle === next.showExpandToggle &&
    prev.nextCursor === next.nextCursor &&
    prev.isPaging === next.isPaging &&
    prev.nested === next.nested &&
    prev.showLoadOlder === next.showLoadOlder &&
    prev.onToggleExpanded === next.onToggleExpanded &&
    prev.onLoadOlderThreads === next.onLoadOlderThreads &&
    prev.onSelectThread === next.onSelectThread &&
    prev.onShowThreadMenu === next.onShowThreadMenu &&
    prev.getThreadTime === next.getThreadTime &&
    prev.getThreadArgsBadge === next.getThreadArgsBadge &&
    prev.isThreadPinned === next.isThreadPinned &&
    prev.pinnedRows === next.pinnedRows &&
    prev.unpinnedRows === next.unpinnedRows &&
    !hasActiveRowChanged(prev, next) &&
    !hasVisibleStatusChanged(prev, next) &&
    !hasPendingInputChanged(prev, next),
);

export { ThreadList };
