import { useCallback, useEffect, useMemo, useRef } from "react";
import type { WorkspaceInfo } from "../../../types";

type ThreadDeepLink = {
  workspaceId: string;
  threadId: string;
  notifiedAt: number;
};

type NotificationActionPayload = {
  extra?: Record<string, unknown>;
};

type Params = {
  hasLoadedWorkspaces: boolean;
  workspacesById: Map<string, WorkspaceInfo>;
  refreshWorkspaces: () => Promise<WorkspaceInfo[] | undefined>;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  openThreadLink: (workspaceId: string, threadId: string) => void;
  maxAgeMs?: number;
};

type Result = {
  recordPendingThreadLink: (workspaceId: string, threadId: string) => void;
  openThreadLinkOrQueue: (workspaceId: string, threadId: string) => void;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getThreadLinkFromNotificationAction(notification: NotificationActionPayload) {
  const extra = notification.extra;
  if (!extra) {
    return null;
  }
  const workspaceId = asNonEmptyString(extra.workspaceId ?? extra.workspace_id);
  const threadId = asNonEmptyString(extra.threadId ?? extra.thread_id);
  if (!workspaceId || !threadId) {
    return null;
  }
  const kind = asNonEmptyString(extra.kind);
  if (kind !== "thread" && kind !== "response_required") {
    return null;
  }
  return { workspaceId, threadId };
}

export function useSystemNotificationThreadLinks({
  hasLoadedWorkspaces,
  workspacesById,
  refreshWorkspaces,
  connectWorkspace,
  openThreadLink,
  maxAgeMs = 120_000,
}: Params): Result {
  const pendingLinkRef = useRef<ThreadDeepLink | null>(null);
  const refreshInFlightRef = useRef(false);

  const queuePendingThreadLink = useCallback((workspaceId: string, threadId: string) => {
    pendingLinkRef.current = { workspaceId, threadId, notifiedAt: Date.now() };
  }, []);

  const tryNavigateToLink = useCallback(async () => {
    const link = pendingLinkRef.current;
    if (!link) {
      return;
    }
    if (Date.now() - link.notifiedAt > maxAgeMs) {
      pendingLinkRef.current = null;
      return;
    }

    let workspace = workspacesById.get(link.workspaceId) ?? null;
    if (!workspace && hasLoadedWorkspaces && !refreshInFlightRef.current) {
      refreshInFlightRef.current = true;
      try {
        const refreshed = await refreshWorkspaces();
        workspace =
          refreshed?.find((entry) => entry.id === link.workspaceId) ?? null;
      } finally {
        refreshInFlightRef.current = false;
      }
    }

    if (!workspace) {
      pendingLinkRef.current = null;
      return;
    }

    if (!workspace.connected) {
      try {
        await connectWorkspace(workspace);
      } catch {
        // Ignore connect failures; user can retry manually.
      }
    }

    openThreadLink(link.workspaceId, link.threadId);
    pendingLinkRef.current = null;
  }, [
    connectWorkspace,
    hasLoadedWorkspaces,
    maxAgeMs,
    openThreadLink,
    refreshWorkspaces,
    workspacesById,
  ]);

  const openThreadLinkOrQueue = useCallback(
    (workspaceId: string, threadId: string) => {
      queuePendingThreadLink(workspaceId, threadId);
      if (hasLoadedWorkspaces) {
        void tryNavigateToLink();
      }
    },
    [hasLoadedWorkspaces, queuePendingThreadLink, tryNavigateToLink],
  );

  useEffect(() => {
    let disposed = false;
    let listener: { unregister: () => Promise<void> } | null = null;

    void import("@tauri-apps/plugin-notification")
      .then(({ onAction }) =>
        onAction((notification: NotificationActionPayload) => {
          const link = getThreadLinkFromNotificationAction(notification);
          if (!link) {
            return;
          }
          openThreadLinkOrQueue(link.workspaceId, link.threadId);
        }),
      )
      .then((registeredListener) => {
        if (disposed) {
          void registeredListener.unregister().catch(() => {});
          return;
        }
        listener = registeredListener;
      })
      .catch(() => {
        // Notification action events are unavailable in browser tests and in
        // some development fallback paths. The focus-based pending link below
        // still handles the local debug fallback.
      });

    return () => {
      disposed = true;
      if (listener) {
        void listener.unregister().catch(() => {});
      }
    };
  }, [openThreadLinkOrQueue]);

  const focusHandler = useMemo(() => () => void tryNavigateToLink(), [tryNavigateToLink]);

  useEffect(() => {
    window.addEventListener("focus", focusHandler);
    return () => window.removeEventListener("focus", focusHandler);
  }, [focusHandler]);

  useEffect(() => {
    if (!pendingLinkRef.current) {
      return;
    }
    if (!hasLoadedWorkspaces) {
      return;
    }
    void tryNavigateToLink();
  }, [hasLoadedWorkspaces, tryNavigateToLink]);

  return {
    recordPendingThreadLink: queuePendingThreadLink,
    openThreadLinkOrQueue,
  };
}
