import { useMemo } from "react";
import type { ConversationItem } from "@/types";
import type { ThreadState } from "./useThreadsReducer";
import {
  getActiveItemsForThread,
  getActiveThreadIdForWorkspace,
} from "./threadSelectorsHelpers";

type UseThreadSelectorsOptions = {
  activeWorkspaceId: string | null;
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  itemsByThread: ThreadState["itemsByThread"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
};

export function useThreadSelectors({
  activeWorkspaceId,
  activeThreadIdByWorkspace,
  itemsByThread,
  threadsByWorkspace,
}: UseThreadSelectorsOptions) {
  const activeThreadId = useMemo(
    () => getActiveThreadIdForWorkspace(activeWorkspaceId, activeThreadIdByWorkspace),
    [activeThreadIdByWorkspace, activeWorkspaceId],
  );

  const activeWorkspaceThreads = activeWorkspaceId
    ? threadsByWorkspace[activeWorkspaceId]
    : undefined;
  const activeThreadItems = activeThreadId ? itemsByThread[activeThreadId] : undefined;

  const activeItems = useMemo<ConversationItem[]>(
    () =>
      getActiveItemsForThread({
        activeThreadId,
        items: activeThreadItems,
        threads: activeWorkspaceThreads,
      }),
    [activeThreadId, activeThreadItems, activeWorkspaceThreads],
  );

  return { activeThreadId, activeItems };
}
