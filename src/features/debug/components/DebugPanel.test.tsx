// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DebugEntry } from "../../../types";
import { DebugPanel, type DebugFilter } from "./DebugPanel";

const debugEntries: DebugEntry[] = [
  {
    id: "client-1",
    timestamp: 1,
    source: "client",
    label: "client entry",
    payload: "client payload",
  },
  {
    id: "error-1",
    timestamp: 2,
    source: "error",
    label: "error entry",
    payload: "error payload",
  },
  {
    id: "event-1",
    timestamp: 3,
    source: "event",
    label: "event entry",
    payload: "event payload",
  },
  {
    id: "memory-1",
    timestamp: 4,
    source: "client",
    label: "local memory debug status",
    payload: {
      config: { enabled: true, serverName: "local_memory" },
      database: {
        memoryCount: 2,
        vectorCount: 2,
        ftsCount: 2,
        vectorAvailable: true,
        recentAccesses: [
          {
            id: "access-1",
            event: "search",
            query: "daemon restart",
            resultCount: 2,
            score: 0.82,
            createdAt: 1_800_000_000,
          },
        ],
      },
    },
  },
  {
    id: "mcp-1",
    timestamp: 5,
    source: "server",
    label: "mcp server status",
    payload: { method: "mcpServerStatus/list" },
  },
  {
    id: "normal-message-1",
    timestamp: 6,
    source: "client",
    label: "user message",
    payload: { message: "memory and mcp are mentioned in normal message content" },
  },
];

describe("DebugPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("wires the local memory refresh action", () => {
    const onRefreshLocalMemoryDebug = vi.fn();

    render(
      <DebugPanel
        entries={[]}
        isOpen
        onClear={vi.fn()}
        onCopy={vi.fn()}
        onRefreshLocalMemoryDebug={onRefreshLocalMemoryDebug}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh Memory" }));

    expect(onRefreshLocalMemoryDebug).toHaveBeenCalledTimes(1);
  });

  it("disables the local memory refresh action while loading", () => {
    render(
      <DebugPanel
        entries={[]}
        isOpen
        onClear={vi.fn()}
        onCopy={vi.fn()}
        onRefreshLocalMemoryDebug={vi.fn()}
        localMemoryDebugLoading
      />,
    );

    expect(
      screen.getByRole("button", { name: "Refreshing Memory..." }),
    ).toHaveProperty("disabled", true);
  });

  it("shows structured local memory debug status", () => {
    render(
      <DebugPanel
        entries={debugEntries}
        isOpen
        onClear={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Local memory summary")).toBeTruthy();
    expect(screen.getByText("Local Memory")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Memories 2")).toBeTruthy();
    expect(screen.getByText("Vector ready")).toBeTruthy();
    expect(screen.getByText(/search · 2 result · score 0\.82/)).toBeTruthy();
    expect(screen.getByText("daemon restart")).toBeTruthy();
  });

  it("filters debug entries by source", () => {
    const { container } = render(
      <DebugPanel
        entries={debugEntries}
        isOpen
        onClear={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByText("client entry")).toBeTruthy();
    expect(screen.getByText("error entry")).toBeTruthy();
    expect(screen.getByText("event entry")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Error 1" }));

    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-active-debug-filter",
    )).toBe("error");
    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-visible-debug-count",
    )).toBe("1");
    expect(container.querySelectorAll(".debug-row")).toHaveLength(1);
    expect(screen.queryByText("client entry")).toBeNull();
    expect(screen.getByText("error entry")).toBeTruthy();
    expect(screen.queryByText("event entry")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All 6" }));

    expect(screen.getByText("client entry")).toBeTruthy();
    expect(screen.getByText("error entry")).toBeTruthy();
    expect(screen.getByText("event entry")).toBeTruthy();
  });

  it("filters debug entries by memory and mcp content", () => {
    const { container } = render(
      <DebugPanel
        entries={debugEntries}
        isOpen
        onClear={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Memory 1" }));

    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-active-debug-filter",
    )).toBe("memory");
    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-visible-debug-count",
    )).toBe("1");
    expect(container.querySelectorAll(".debug-row")).toHaveLength(1);
    expect(screen.getByText("local memory debug status")).toBeTruthy();
    expect(screen.queryByText("mcp server status")).toBeNull();
    expect(screen.queryByText("client entry")).toBeNull();
    expect(screen.queryByText("user message")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "MCP 1" }));

    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-active-debug-filter",
    )).toBe("mcp");
    expect(container.querySelector(".debug-list")?.getAttribute(
      "data-visible-debug-count",
    )).toBe("1");
    expect(container.querySelectorAll(".debug-row")).toHaveLength(1);
    expect(screen.queryByText("local memory debug status")).toBeNull();
    expect(screen.getByText("mcp server status")).toBeTruthy();
    expect(screen.queryByText("client entry")).toBeNull();
    expect(screen.queryByText("user message")).toBeNull();
  });

  it("keeps dock and full debug filters synchronized", () => {
    const entries: DebugEntry[] = [
      {
        id: "event-started",
        timestamp: 1,
        source: "event",
        label: "item/started",
        payload: { type: "item_started" },
      },
    ];

    function SharedFilterHarness() {
      const [filter, setFilter] = useState<DebugFilter>("all");
      return (
        <>
          <DebugPanel
            entries={entries}
            isOpen
            debugFilter={filter}
            onDebugFilterChange={setFilter}
            onClear={vi.fn()}
            onCopy={vi.fn()}
          />
          <DebugPanel
            entries={entries}
            isOpen
            variant="full"
            debugFilter={filter}
            onDebugFilterChange={setFilter}
            onClear={vi.fn()}
            onCopy={vi.fn()}
          />
        </>
      );
    }

    const { container } = render(<SharedFilterHarness />);

    expect(container.querySelectorAll(".debug-row")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Memory 0" })[0]);

    const lists = container.querySelectorAll(".debug-list");
    expect(lists).toHaveLength(2);
    lists.forEach((list) => {
      expect(list.getAttribute("data-active-debug-filter")).toBe("memory");
      expect(list.getAttribute("data-visible-debug-count")).toBe("0");
    });
    expect(container.querySelectorAll(".debug-row")).toHaveLength(0);
    expect(screen.getAllByText("No memory debug events.")).toHaveLength(2);
    expect(screen.queryByText("item/started")).toBeNull();
  });
});
