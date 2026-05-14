import { useCallback, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { DebugEntry } from "../../../types";

type DebugPanelProps = {
  entries: DebugEntry[];
  isOpen: boolean;
  onClear: () => void;
  onCopy: () => void;
  debugFilter?: DebugFilter;
  onDebugFilterChange?: (filter: DebugFilter) => void;
  onRefreshLocalMemoryDebug?: () => void;
  localMemoryDebugLoading?: boolean;
  resetVersion?: number;
  onResizeStart?: (event: ReactMouseEvent) => void;
  variant?: "dock" | "full";
};

type SearchableDebugEntry = DebugEntry & {
  payloadText?: string;
};

type MemoryDebugSnapshot = {
  config?: {
    enabled?: boolean;
    serverName?: string;
    commandPath?: string;
    dbPath?: string;
  };
  database?: {
    memoryCount?: number;
    vectorCount?: number;
    ftsCount?: number;
    vectorAvailable?: boolean;
    recentAccesses?: MemoryAccessEntry[];
  } | null;
  error?: string | null;
};

type MemoryAccessEntry = {
  id?: string;
  memoryId?: string | null;
  query?: string | null;
  event?: string;
  resultCount?: number | null;
  score?: number | null;
  threadId?: string | null;
  runId?: string | null;
  error?: string | null;
  createdAt?: number;
};

type DebugSemanticFilter = "memory" | "mcp" | "session" | "daemon";
type DebugSourceFilter = DebugEntry["source"];
export type DebugFilter = DebugSemanticFilter | DebugSourceFilter | "all";

const DEBUG_FILTERS: Array<{ value: DebugFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "memory", label: "Memory" },
  { value: "mcp", label: "MCP" },
  { value: "session", label: "Session" },
  { value: "daemon", label: "Daemon" },
  { value: "client", label: "Client" },
  { value: "server", label: "Server" },
  { value: "event", label: "Event" },
  { value: "stderr", label: "Stderr" },
  { value: "error", label: "Error" },
];
const DEBUG_VISIBLE_ENTRY_LIMIT = 80;

function formatPayload(payload: unknown) {
  if (payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getMemoryDebugSnapshot(entry: DebugEntry): MemoryDebugSnapshot | null {
  if (!isRecord(entry.payload)) {
    return null;
  }
  const payload = entry.payload as MemoryDebugSnapshot;
  const serverName = payload.config?.serverName;
  const hasMemoryDatabase = isRecord(payload.database);
  if (
    serverName === "local_memory" ||
    entry.label.toLowerCase().includes("local memory") ||
    hasMemoryDatabase
  ) {
    return payload;
  }
  return null;
}

function formatMemoryAccessTime(timestamp?: number) {
  if (!timestamp) {
    return "--";
  }
  return new Date(timestamp * 1000).toLocaleTimeString();
}

function formatMemoryAccessSummary(entry: MemoryAccessEntry) {
  const event = entry.event ?? "event";
  const count =
    typeof entry.resultCount === "number" ? ` · ${entry.resultCount} result` : "";
  const score =
    typeof entry.score === "number" ? ` · score ${entry.score.toFixed(2)}` : "";
  return `${event}${count}${score}`;
}

const CATEGORY_VALUE_KEYS = new Set([
  "command",
  "config",
  "configkey",
  "database",
  "event",
  "feature",
  "kind",
  "method",
  "name",
  "server",
  "servername",
  "scope",
  "status",
  "tool",
  "toolname",
  "type",
  "vectoravailable",
]);

const CATEGORY_CONTENT_KEYS = new Set([
  "content",
  "developerinstructions",
  "input",
  "message",
  "messages",
  "output",
  "prompt",
  "text",
]);

function canonicalKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLowerCase();
}

function appendCategoryTerms(
  value: unknown,
  terms: string[],
  parentKey = "",
  depth = 0,
) {
  if (value === null || value === undefined || depth > 5) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendCategoryTerms(item, terms, parentKey, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    const key = canonicalKey(parentKey);
    if (
      CATEGORY_VALUE_KEYS.has(key) ||
      key.includes("memory") ||
      key.includes("mcp") ||
      key.includes("session") ||
      key.includes("daemon")
    ) {
      terms.push(String(value));
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = canonicalKey(key);
    const isCategoryKey =
      CATEGORY_VALUE_KEYS.has(normalizedKey) ||
      normalizedKey.includes("memory") ||
      normalizedKey.includes("mcp") ||
      normalizedKey.includes("session") ||
      normalizedKey.includes("daemon");

    if (isCategoryKey) {
      terms.push(key);
    }

    if (CATEGORY_CONTENT_KEYS.has(normalizedKey)) {
      continue;
    }

    appendCategoryTerms(child, terms, key, depth + 1);
  }
}

function entryCategoryText(entry: SearchableDebugEntry): string {
  const terms = [entry.id, entry.label, entry.source];
  appendCategoryTerms(entry.payload, terms);
  return terms.join("\n").toLowerCase();
}

function entryMatchesFilter(entry: SearchableDebugEntry, filter: DebugFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (
    filter === "client" ||
    filter === "server" ||
    filter === "event" ||
    filter === "stderr" ||
    filter === "error"
  ) {
    return entry.source === filter;
  }
  const categoryText = entryCategoryText(entry);
  if (filter === "memory") {
    return (
      categoryText.includes("memory") ||
      categoryText.includes("local_memory") ||
      categoryText.includes("local memory")
    );
  }
  if (filter === "mcp") {
    return categoryText.includes("mcp");
  }
  if (filter === "daemon") {
    return categoryText.includes("daemon");
  }
  return (
    categoryText.includes("session") ||
    categoryText.includes("restart-safe") ||
    categoryText.includes("restart_safe")
  );
}

export function DebugPanel({
  entries,
  isOpen,
  onClear,
  onCopy,
  debugFilter,
  onDebugFilterChange,
  onRefreshLocalMemoryDebug,
  localMemoryDebugLoading = false,
  resetVersion = 0,
  onResizeStart,
  variant = "dock",
}: DebugPanelProps) {
  const isVisible = variant === "full" || isOpen;
  const [internalDebugFilter, setInternalDebugFilter] =
    useState<DebugFilter>("all");
  const activeDebugFilter = debugFilter ?? internalDebugFilter;
  const setActiveDebugFilter = useCallback(
    (filter: DebugFilter) => {
      if (onDebugFilterChange) {
        onDebugFilterChange(filter);
        return;
      }
      setInternalDebugFilter(filter);
    },
    [onDebugFilterChange],
  );

  const visibleEntries = useMemo(() => {
    if (!isOpen) {
      return [];
    }
    return entries
      .filter((entry) => entryMatchesFilter(entry, activeDebugFilter))
      .slice(-DEBUG_VISIBLE_ENTRY_LIMIT)
      .map((entry) => ({
        ...entry,
        timeLabel: new Date(entry.timestamp).toLocaleTimeString(),
        payloadText:
          entry.payload !== undefined ? formatPayload(entry.payload) : undefined,
      }));
  }, [entries, activeDebugFilter, isOpen]);

  const filterCounts = useMemo(() => {
    const counts: Record<DebugFilter, number> = {
      all: entries.length,
      memory: 0,
      mcp: 0,
      session: 0,
      daemon: 0,
      client: 0,
      server: 0,
      event: 0,
      stderr: 0,
      error: 0,
    };
    for (const entry of entries) {
      counts[entry.source] += 1;
      if (entryMatchesFilter(entry, "memory")) {
        counts.memory += 1;
      }
      if (entryMatchesFilter(entry, "mcp")) {
        counts.mcp += 1;
      }
      if (entryMatchesFilter(entry, "session")) {
        counts.session += 1;
      }
      if (entryMatchesFilter(entry, "daemon")) {
        counts.daemon += 1;
      }
    }
    return counts;
  }, [entries]);

  const memorySnapshot = useMemo(() => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const snapshot = getMemoryDebugSnapshot(entries[index]);
      if (snapshot) {
        return snapshot;
      }
    }
    return null;
  }, [entries]);

  const showMemorySummary =
    activeDebugFilter === "all" || activeDebugFilter === "memory";

  if (!isVisible) {
    return null;
  }

  return (
    <section
      className={`debug-panel ${variant === "full" ? "full" : isOpen ? "open" : ""}`}
    >
      {variant !== "full" && isOpen && onResizeStart ? (
        <div
          className="debug-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize debug panel"
          onMouseDown={onResizeStart}
        />
      ) : null}
      <div className="debug-header">
        <div className="debug-title">Debug</div>
        <div className="debug-actions">
          {onRefreshLocalMemoryDebug ? (
            <button
              className="ghost"
              onClick={onRefreshLocalMemoryDebug}
              disabled={localMemoryDebugLoading}
            >
              {localMemoryDebugLoading ? "Refreshing Memory..." : "Refresh Memory"}
            </button>
          ) : null}
          <button className="ghost" onClick={onCopy}>
            Copy
          </button>
          <button className="ghost" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
      {isOpen ? (
        <>
          <div className="debug-filters" role="group" aria-label="Filter debug events">
            {DEBUG_FILTERS.map((filter) => {
              const count = filterCounts[filter.value];
              return (
                <button
                  key={filter.value}
                  type="button"
                  className={`debug-filter-button${activeDebugFilter === filter.value ? " active" : ""}`}
                  data-debug-filter={filter.value}
                  aria-label={`${filter.label} ${count}`}
                  aria-pressed={activeDebugFilter === filter.value}
                  onClick={() => setActiveDebugFilter(filter.value)}
                >
                  <span>{filter.label}</span>
                  <span className="debug-filter-count">({count})</span>
                </button>
              );
            })}
          </div>
          <div
            className="debug-list"
            data-active-debug-filter={activeDebugFilter}
            data-debug-reset-version={resetVersion}
            data-visible-debug-count={visibleEntries.length}
          >
            {showMemorySummary && memorySnapshot ? (
              <MemoryDebugSummary snapshot={memorySnapshot} />
            ) : null}
            {visibleEntries.length === 0 ? (
              <div className="debug-empty">
                {activeDebugFilter === "all"
                  ? "No debug events yet."
                  : `No ${activeDebugFilter} debug events.`}
              </div>
            ) : null}
            {visibleEntries.map((entry) => (
              <div key={entry.id} className="debug-row">
                <div className="debug-meta">
                  <span className={`debug-source ${entry.source}`}>
                    {entry.source}
                  </span>
                  <span className="debug-time">{entry.timeLabel}</span>
                  <span className="debug-label">{entry.label}</span>
                </div>
                {entry.payloadText !== undefined ? (
                  <pre className="debug-payload">{entry.payloadText}</pre>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function MemoryDebugSummary({ snapshot }: { snapshot: MemoryDebugSnapshot }) {
  const database = snapshot.database ?? null;
  const recentAccesses = database?.recentAccesses ?? [];
  const enabled = snapshot.config?.enabled ?? false;
  return (
    <section className="debug-memory-summary" aria-label="Local memory summary">
      <div className="debug-memory-summary-header">
        <div>
          <div className="debug-memory-title">Local Memory</div>
          <div className="debug-memory-subtitle">
            {snapshot.config?.serverName ?? "local_memory"}
          </div>
        </div>
        <span className={`debug-memory-status ${enabled ? "enabled" : "disabled"}`}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div className="debug-memory-metrics">
        <span>Memories {database?.memoryCount ?? "--"}</span>
        <span>Vector {database?.vectorCount ?? "--"}</span>
        <span>FTS {database?.ftsCount ?? "--"}</span>
        <span>{database?.vectorAvailable ? "Vector ready" : "Vector unavailable"}</span>
      </div>
      {snapshot.error ? (
        <div className="debug-memory-error">{snapshot.error}</div>
      ) : null}
      {recentAccesses.length > 0 ? (
        <div className="debug-memory-accesses">
          <div className="debug-memory-access-title">Recent access</div>
          {recentAccesses.slice(0, 6).map((entry, index) => (
            <div className="debug-memory-access-row" key={entry.id ?? index}>
              <span className="debug-memory-access-time">
                {formatMemoryAccessTime(entry.createdAt)}
              </span>
              <span className="debug-memory-access-event">
                {formatMemoryAccessSummary(entry)}
              </span>
              <span className="debug-memory-access-query">
                {entry.query || entry.memoryId || entry.error || "no query"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="debug-memory-empty">No memory access recorded yet.</div>
      )}
    </section>
  );
}
