// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteThreadLiveConnection } from "./useRemoteThreadLiveConnection";

const appServerListeners = new Set<(event: any) => void>();
const subscribeAppServerEventsMock = vi.fn((listener: (event: any) => void) => {
  appServerListeners.add(listener);
  return () => {
    appServerListeners.delete(listener);
  };
});

const threadUnsubscribeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@services/events", () => ({
  subscribeAppServerEvents: (listener: (event: any) => void) =>
    subscribeAppServerEventsMock(listener),
}));

vi.mock("@services/tauri", () => ({
  threadUnsubscribe: (...args: any[]) => threadUnsubscribeMock(...args),
}));

vi.mock("@utils/appServerEvents", () => ({
  getAppServerRawMethod: (event: any) => event.method ?? null,
  getAppServerParams: (event: any) => event.params ?? {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
}));

const workspace = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/ws-1",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useRemoteThreadLiveConnection", () => {
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => true,
    });
    appServerListeners.clear();
    subscribeAppServerEventsMock.mockClear();
    threadUnsubscribeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the active remote thread live without synthetic subscribe", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        refreshThread,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.connectionState).toBe("live");
    expect(refreshThread).not.toHaveBeenCalled();
    expect(threadUnsubscribeMock).not.toHaveBeenCalled();
  });

  it("switches active threads by unsubscribing the previous app-server owner", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) =>
        useRemoteThreadLiveConnection({
          backendMode: "remote",
          activeWorkspace: workspace,
          activeThreadId: threadId,
          refreshThread,
        }),
      {
        initialProps: { threadId: "thread-1" },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      rerender({ threadId: "thread-2" });
      await Promise.resolve();
    });

    expect(threadUnsubscribeMock).toHaveBeenCalledTimes(1);
    expect(threadUnsubscribeMock).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(refreshThread).not.toHaveBeenCalled();
  });

  it("unsubscribes the active thread when the window blurs", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        refreshThread,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });

    expect(threadUnsubscribeMock).toHaveBeenCalledWith("ws-1", "thread-1");
  });

  it("resumes the active thread on daemon event gap", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        refreshThread,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      for (const listener of appServerListeners) {
        listener({
          workspace_id: "__daemon__",
          method: "codex/event_gap",
          params: { skipped: 7 },
        });
      }
      await Promise.resolve();
    });

    expect(refreshThread).toHaveBeenCalledWith("ws-1", "thread-1", {
      bypassCooldown: true,
    });
  });

  it("resumes the active thread when focus returns", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        refreshThread,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(refreshThread).toHaveBeenCalledWith("ws-1", "thread-1");
  });

  it("coalesces same-key resume while refresh is in flight", async () => {
    let resolveRefresh: (() => void) | null = null;
    const firstRefresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshThread = vi.fn().mockImplementationOnce(() => firstRefresh);

    const { result } = renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: null,
        refreshThread,
      }),
    );

    let firstReconnectPromise: Promise<boolean> = Promise.resolve(false);
    let secondReconnectPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      firstReconnectPromise = result.current.reconnectLive("ws-1", "thread-1", {
        runResume: true,
      });
      await Promise.resolve();
    });

    await act(async () => {
      secondReconnectPromise = result.current.reconnectLive("ws-1", "thread-1", {
        runResume: true,
      });
      await Promise.resolve();
    });

    expect(refreshThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh?.();
      await firstReconnectPromise;
      await secondReconnectPromise;
    });
  });

  it("ignores stale in-flight reconnect when the active key changes", async () => {
    let resolveRefresh: (() => void) | null = null;
    const firstRefresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshThread = vi
      .fn()
      .mockImplementationOnce(() => firstRefresh)
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: null,
        refreshThread,
      }),
    );

    let firstReconnectPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      firstReconnectPromise = result.current.reconnectLive("ws-1", "thread-1", {
        runResume: true,
      });
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.reconnectLive("ws-1", "thread-2", { runResume: false });
    });

    await act(async () => {
      resolveRefresh?.();
      await expect(firstReconnectPromise).resolves.toBe(false);
    });
  });

  it("reports resume failures to the caller", async () => {
    const reconnectError = new Error("resume unavailable");
    const refreshThread = vi.fn().mockRejectedValueOnce(reconnectError);
    const onReconnectError = vi.fn();

    const { result } = renderHook(() =>
      useRemoteThreadLiveConnection({
        backendMode: "remote",
        activeWorkspace: workspace,
        activeThreadId: null,
        refreshThread,
        onReconnectError,
      }),
    );

    await act(async () => {
      await expect(
        result.current.reconnectLive("ws-1", "thread-1", {
          runResume: true,
          reason: "event-gap",
        }),
      ).resolves.toBe(false);
    });

    expect(onReconnectError).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "resume unavailable",
      "event-gap",
    );
  });
});
