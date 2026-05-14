import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { DebugEntry } from "../../../types";

type DebugPanelProps = {
  entries: DebugEntry[];
  isOpen: boolean;
  onClear: () => void;
  onCopy: () => void;
  onRefreshLocalMemoryDebug?: () => void;
  localMemoryDebugLoading?: boolean;
  resetVersion?: number;
  onResizeStart?: (event: ReactMouseEvent) => void;
  variant?: "dock" | "full";
};

type SearchableDebugEntry = DebugEntry & {
  payloadText?: string;
};

type DebugSemanticFilter = "memory" | "mcp";
type DebugSourceFilter = DebugEntry["source"];
type DebugFilter = DebugSemanticFilter | DebugSourceFilter | "all";

const DEBUG_FILTERS: Array<{ value: DebugFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "memory", label: "Memory" },
  { value: "mcp", label: "MCP" },
  { value: "client", label: "Client" },
  { value: "server", label: "Server" },
  { value: "event", label: "Event" },
  { value: "stderr", label: "Stderr" },
  { value: "error", label: "Error" },
];

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
    if (CATEGORY_VALUE_KEYS.has(key) || key.includes("memory") || key.includes("mcp")) {
      terms.push(String(value));
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = canonicalKey(key);
    const isCategoryKey =
      CATEGORY_VALUE_KEYS.has(normalizedKey) ||
      normalizedKey.includes("memory") ||
      normalizedKey.includes("mcp");

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
  return categoryText.includes("mcp");
}

export function DebugPanel({
  entries,
  isOpen,
  onClear,
  onCopy,
  onRefreshLocalMemoryDebug,
  localMemoryDebugLoading = false,
  resetVersion = 0,
  onResizeStart,
  variant = "dock",
}: DebugPanelProps) {
  const isVisible = variant === "full" || isOpen;
  const [debugFilter, setDebugFilter] = useState<DebugFilter>("all");

  const formattedEntries = useMemo(() => {
    return entries.map((entry) => ({
      ...entry,
      timeLabel: new Date(entry.timestamp).toLocaleTimeString(),
      payloadText:
        entry.payload !== undefined ? formatPayload(entry.payload) : undefined,
    }));
  }, [entries]);

  const filterCounts = useMemo(() => {
    const counts: Record<DebugFilter, number> = {
      all: entries.length,
      memory: 0,
      mcp: 0,
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
    }
    return counts;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    return formattedEntries.filter((entry) => entryMatchesFilter(entry, debugFilter));
  }, [formattedEntries, debugFilter]);

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
                  className={`debug-filter-button${debugFilter === filter.value ? " active" : ""}`}
                  data-debug-filter={filter.value}
                  aria-label={`${filter.label} ${count}`}
                  aria-pressed={debugFilter === filter.value}
                  onClick={() => setDebugFilter(filter.value)}
                >
                  <span>{filter.label}</span>
                  <span className="debug-filter-count">({count})</span>
                </button>
              );
            })}
          </div>
          <div
            className="debug-list"
            data-active-debug-filter={debugFilter}
            data-debug-reset-version={resetVersion}
            data-visible-debug-count={visibleEntries.length}
          >
            {visibleEntries.length === 0 ? (
              <div className="debug-empty">
                {debugFilter === "all"
                  ? "No debug events yet."
                  : `No ${debugFilter} debug events.`}
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
