// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDebugLog } from "./useDebugLog";

function stderrEvent(message: string, workspaceId = "workspace-1") {
  return {
    workspace_id: workspaceId,
    message: {
      method: "codex/stderr",
      params: { message },
    },
  };
}

function missingBrowserUsePluginWarning() {
  return JSON.stringify({
    timestamp: "2026-05-15T11:30:26.435004Z",
    level: "WARN",
    fields: {
      message: "failed to load plugin: plugin is not installed",
      plugin: "browser-use@openai-bundled",
      path: "/Users/xihe0000/.codex/plugins/cache/openai-bundled/browser-use",
    },
    target: "codex_core_plugins::loader",
  });
}

describe("useDebugLog", () => {
  it("hides the debug button before alerts when debug logging is disabled", () => {
    const { result } = renderHook(() => useDebugLog());

    expect(result.current.showDebugButton).toBe(false);
  });

  it("keeps the debug button available when debug logging is enabled", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    expect(result.current.showDebugButton).toBe(true);
  });

  it("drops non-alert entries while disabled", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.addDebugEntry({
        id: "event-1",
        timestamp: 1000,
        source: "event",
        label: "normal event",
        payload: { ok: true },
      });
    });

    expect(result.current.debugEntries).toHaveLength(0);
  });

  it("still records alert entries while disabled", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.addDebugEntry({
        id: "error-1",
        timestamp: 1000,
        source: "error",
        label: "client warning",
        payload: "boom",
      });
    });

    expect(result.current.showDebugButton).toBe(true);
    expect(result.current.debugEntries).toHaveLength(1);
  });

  it("does not surface known missing browser-use plugin warnings while disabled", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.addDebugEntry({
        id: "stderr-benign-plugin",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent(
          `${missingBrowserUsePluginWarning()}\n${missingBrowserUsePluginWarning()}`,
        ),
      });
    });

    expect(result.current.showDebugButton).toBe(false);
    expect(result.current.hasDebugAlerts).toBe(false);
    expect(result.current.debugEntries).toHaveLength(0);
  });

  it("still records known missing browser-use plugin warnings when debug is open", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    act(() => {
      result.current.setDebugOpen(true);
    });

    act(() => {
      result.current.addDebugEntry({
        id: "stderr-benign-plugin",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent(missingBrowserUsePluginWarning()),
      });
    });

    expect(result.current.showDebugButton).toBe(true);
    expect(result.current.hasDebugAlerts).toBe(false);
    expect(result.current.debugEntries).toHaveLength(1);
  });

  it("merges consecutive Codex stderr events from the same workspace", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    act(() => {
      result.current.addDebugEntry({
        id: "stderr-1",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("first line"),
      });
      result.current.addDebugEntry({
        id: "stderr-2",
        timestamp: 2000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("second line"),
      });
    });

    expect(result.current.debugEntries).toHaveLength(1);
    const payload = result.current.debugEntries[0]?.payload as {
      message?: { params?: { message?: string; mergedCount?: number } };
    };
    expect(payload.message?.params?.message).toBe("first line\nsecond line");
    expect(payload.message?.params?.mergedCount).toBe(2);
  });

  it("keeps stderr events separate across workspaces", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    act(() => {
      result.current.addDebugEntry({
        id: "stderr-1",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("first line", "workspace-1"),
      });
      result.current.addDebugEntry({
        id: "stderr-2",
        timestamp: 2000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("second line", "workspace-2"),
      });
    });

    expect(result.current.debugEntries).toHaveLength(2);
  });

  it("bumps reset version when debug entries are cleared", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    act(() => {
      result.current.addDebugEntry({
        id: "stderr-1",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("line"),
      });
    });

    const previousResetVersion = result.current.debugResetVersion;

    act(() => {
      result.current.clearDebugEntries();
    });

    expect(result.current.debugEntries).toHaveLength(0);
    expect(result.current.debugResetVersion).toBe(previousResetVersion + 1);
  });

  it("closes and hides alert-only debug logs when cleared while logging is disabled", () => {
    const { result } = renderHook(() => useDebugLog());

    act(() => {
      result.current.addDebugEntry({
        id: "error-1",
        timestamp: 1000,
        source: "error",
        label: "client error",
        payload: "boom",
      });
    });

    act(() => {
      result.current.setDebugOpen(true);
    });

    expect(result.current.debugOpen).toBe(true);
    expect(result.current.showDebugButton).toBe(true);

    act(() => {
      result.current.clearDebugEntries();
    });

    expect(result.current.debugOpen).toBe(false);
    expect(result.current.showDebugButton).toBe(false);
    expect(result.current.hasDebugAlerts).toBe(false);
    expect(result.current.debugEntries).toHaveLength(0);
  });

  it("keeps the debug panel open after clear when debug logging is enabled", () => {
    const { result } = renderHook(() => useDebugLog({ enabled: true }));

    act(() => {
      result.current.setDebugOpen(true);
      result.current.addDebugEntry({
        id: "stderr-1",
        timestamp: 1000,
        source: "stderr",
        label: "codex/stderr",
        payload: stderrEvent("line"),
      });
    });

    act(() => {
      result.current.clearDebugEntries();
    });

    expect(result.current.debugOpen).toBe(true);
    expect(result.current.showDebugButton).toBe(true);
    expect(result.current.debugEntries).toHaveLength(0);
  });
});
