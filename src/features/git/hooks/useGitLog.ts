import { useCallback, useEffect, useRef, useState } from "react";
import type { GitLogEntry, WorkspaceInfo } from "../../../types";
import { getGitLog } from "../../../services/tauri";

type GitLogState = {
  entries: GitLogEntry[];
  total: number;
  ahead: number;
  behind: number;
  aheadEntries: GitLogEntry[];
  behindEntries: GitLogEntry[];
  upstream: string | null;
  isLoading: boolean;
  error: string | null;
};

const emptyState: GitLogState = {
  entries: [],
  total: 0,
  ahead: 0,
  behind: 0,
  aheadEntries: [],
  behindEntries: [],
  upstream: null,
  isLoading: false,
  error: null,
};

export const GIT_LOG_REFRESH_INTERVAL_MS = 30_000;

function commitEntriesEqual(a: GitLogEntry[], b: GitLogEntry[]) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((entry, index) => {
    const other = b[index];
    return (
      other &&
      entry.sha === other.sha &&
      entry.summary === other.summary &&
      entry.author === other.author &&
      entry.timestamp === other.timestamp
    );
  });
}

function gitLogStateEqual(a: GitLogState, b: GitLogState) {
  return (
    a.total === b.total &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.upstream === b.upstream &&
    a.isLoading === b.isLoading &&
    a.error === b.error &&
    commitEntriesEqual(a.entries, b.entries) &&
    commitEntriesEqual(a.aheadEntries, b.aheadEntries) &&
    commitEntriesEqual(a.behindEntries, b.behindEntries)
  );
}

export function useGitLog(
  activeWorkspace: WorkspaceInfo | null,
  enabled: boolean,
) {
  const [state, setState] = useState<GitLogState>(emptyState);
  const requestIdRef = useRef(0);
  const workspaceIdRef = useRef<string | null>(activeWorkspace?.id ?? null);

  const refresh = useCallback(async () => {
    if (!activeWorkspace) {
      setState(emptyState);
      return;
    }
    const workspaceId = activeWorkspace.id;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await getGitLog(workspaceId);
      if (
        requestIdRef.current !== requestId ||
        workspaceIdRef.current !== workspaceId
      ) {
        return;
      }
      const nextState = {
        entries: response.entries,
        total: response.total,
        ahead: response.ahead,
        behind: response.behind,
        aheadEntries: response.aheadEntries,
        behindEntries: response.behindEntries,
        upstream: response.upstream,
        isLoading: false,
        error: null,
      };
      setState((previous) =>
        gitLogStateEqual(previous, nextState) ? previous : nextState,
      );
    } catch (error) {
      console.error("Failed to load git log", error);
      if (
        requestIdRef.current !== requestId ||
        workspaceIdRef.current !== workspaceId
      ) {
        return;
      }
      const nextState = {
        entries: [],
        total: 0,
        ahead: 0,
        behind: 0,
        aheadEntries: [],
        behindEntries: [],
        upstream: null,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      };
      setState((previous) =>
        gitLogStateEqual(previous, nextState) ? previous : nextState,
      );
    }
  }, [activeWorkspace]);

  useEffect(() => {
    const workspaceId = activeWorkspace?.id ?? null;
    if (workspaceIdRef.current !== workspaceId) {
      workspaceIdRef.current = workspaceId;
      requestIdRef.current += 1;
      setState(emptyState);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!enabled || !activeWorkspace) {
      return;
    }
    void refresh();
    const interval = window.setInterval(() => {
      refresh().catch(() => {});
    }, GIT_LOG_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeWorkspace, enabled, refresh]);

  return {
    entries: state.entries,
    total: state.total,
    ahead: state.ahead,
    behind: state.behind,
    aheadEntries: state.aheadEntries,
    behindEntries: state.behindEntries,
    upstream: state.upstream,
    isLoading: state.isLoading,
    error: state.error,
    refresh,
  };
}
