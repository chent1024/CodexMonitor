import type { ConversationItem, ThreadSummary } from "@/types";
import { enrichConversationItemsWithThreads } from "@utils/threadItems";

export function getActiveThreadIdForWorkspace(
  activeWorkspaceId: string | null,
  activeThreadIdByWorkspace: Record<string, string | null | undefined>,
) {
  if (!activeWorkspaceId) {
    return null;
  }
  return activeThreadIdByWorkspace[activeWorkspaceId] ?? null;
}

export function getActiveItemsForThread({
  activeThreadId,
  items,
  threads,
}: {
  activeThreadId: string | null;
  items: ConversationItem[] | undefined;
  threads: ThreadSummary[] | undefined;
}) {
  if (!activeThreadId) {
    return [];
  }
  return enrichConversationItemsWithThreads(items ?? [], threads ?? []);
}
