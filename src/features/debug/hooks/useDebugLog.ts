import { useCallback, useRef, useState } from "react";
import type { DebugFilter } from "../components/DebugPanel";
import type { DebugEntry } from "../../../types";

const MAX_DEBUG_ENTRIES = 200;
const MAX_MERGED_STDERR_LINES = 80;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getCodexStderrPayloadInfo(payload: unknown): {
  workspaceId: string | null;
  message: string;
  mergedCount: number;
} | null {
  const root = asRecord(payload);
  const messageRoot = asRecord(root?.message);
  const params = asRecord(messageRoot?.params);
  const message = typeof params?.message === "string" ? params.message : "";
  if (!message) {
    return null;
  }
  return {
    workspaceId: typeof root?.workspace_id === "string" ? root.workspace_id : null,
    message,
    mergedCount:
      typeof params?.mergedCount === "number" && Number.isFinite(params.mergedCount)
        ? Math.max(1, params.mergedCount)
        : 1,
  };
}

function withMergedCodexStderrPayload(
  payload: unknown,
  message: string,
  mergedCount: number,
) {
  const root = asRecord(payload);
  const messageRoot = asRecord(root?.message);
  const params = asRecord(messageRoot?.params);
  if (!root || !messageRoot || !params) {
    return payload;
  }
  return {
    ...root,
    message: {
      ...messageRoot,
      params: {
        ...params,
        message,
        mergedCount,
        truncatedMergedLines: mergedCount > MAX_MERGED_STDERR_LINES,
      },
    },
  };
}

function mergeConsecutiveCodexStderr(
  previous: DebugEntry | undefined,
  next: DebugEntry,
): DebugEntry | null {
  if (
    !previous ||
    previous.source !== "stderr" ||
    next.source !== "stderr" ||
    previous.label !== "codex/stderr" ||
    next.label !== "codex/stderr"
  ) {
    return null;
  }
  const previousInfo = getCodexStderrPayloadInfo(previous.payload);
  const nextInfo = getCodexStderrPayloadInfo(next.payload);
  if (
    !previousInfo ||
    !nextInfo ||
    previousInfo.workspaceId !== nextInfo.workspaceId
  ) {
    return null;
  }

  const mergedCount = previousInfo.mergedCount + 1;
  const mergedLines = [...previousInfo.message.split("\n"), nextInfo.message].slice(
    -MAX_MERGED_STDERR_LINES,
  );
  return {
    ...next,
    id: previous.id,
    payload: withMergedCodexStderrPayload(
      next.payload,
      mergedLines.join("\n"),
      mergedCount,
    ),
  };
}

function summarizePayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return { _type: "array", count: payload.length, sample: payload.slice(0, 5) };
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const summarized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        summarized[key] = { _type: "array", count: (obj[key] as unknown[]).length };
      } else {
        summarized[key] = obj[key];
      }
    }
    return summarized;
  }
  return payload;
}

export function useDebugLog() {
  const [debugOpen, setDebugOpenState] = useState(false);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const [hasDebugAlerts, setHasDebugAlerts] = useState(false);
  const [debugResetVersion, setDebugResetVersion] = useState(0);
  const [debugFilter, setDebugFilter] = useState<DebugFilter>("all");
  const debugOpenRef = useRef(debugOpen);
  debugOpenRef.current = debugOpen;

  const isAlertEntry = useCallback((entry: DebugEntry) => {
    if (entry.source === "error" || entry.source === "stderr") {
      return true;
    }
    const label = entry.label.toLowerCase();
    if (label.includes("warn") || label.includes("warning")) {
      return true;
    }
    if (typeof entry.payload === "string") {
      const payload = entry.payload.toLowerCase();
      return payload.includes("warn") || payload.includes("warning");
    }
    return false;
  }, []);

  const addDebugEntry = useCallback(
    (entry: DebugEntry) => {
      const isAlert = isAlertEntry(entry);
      if (!debugOpenRef.current && !isAlert) {
        return;
      }
      if (isAlert) {
        setHasDebugAlerts(true);
      }
      const compactEntry = { ...entry, payload: summarizePayload(entry.payload) };
      setDebugEntries((prev) => {
        const merged = mergeConsecutiveCodexStderr(prev[prev.length - 1], compactEntry);
        if (merged) {
          return [...prev.slice(0, -1), merged].slice(-MAX_DEBUG_ENTRIES);
        }
        return [...prev, compactEntry].slice(-MAX_DEBUG_ENTRIES);
      });
    },
    [isAlertEntry],
  );

  const handleCopyDebug = useCallback(async () => {
    const text = debugEntries
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const payload =
          entry.payload !== undefined
            ? typeof entry.payload === "string"
              ? entry.payload
              : JSON.stringify(entry.payload, null, 2)
            : "";
        return [entry.source.toUpperCase(), timestamp, entry.label, payload]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    if (text) {
      await navigator.clipboard.writeText(text);
    }
  }, [debugEntries]);

  const clearDebugEntries = useCallback(() => {
    setDebugEntries([]);
    setHasDebugAlerts(false);
    setDebugFilter("all");
    setDebugResetVersion((version) => version + 1);
  }, []);

  const setDebugOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setDebugOpenState((prev) => {
        return typeof next === "function" ? next(prev) : next;
      });
    },
    [],
  );

  const showDebugButton = true;

  return {
    debugOpen,
    setDebugOpen,
    debugEntries,
    debugResetVersion,
    debugFilter,
    setDebugFilter,
    hasDebugAlerts,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
  };
}
