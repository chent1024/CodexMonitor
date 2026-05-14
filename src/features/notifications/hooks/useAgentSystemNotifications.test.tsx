// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "../../../services/tauri";
import { useAgentSystemNotifications } from "./useAgentSystemNotifications";

const useAppServerEventsMock = vi.fn();

vi.mock("../../../services/tauri", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (handlers: unknown) => useAppServerEventsMock(handlers),
}));

describe("useAgentSystemNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendNotification).mockResolvedValue();
  });

  it("mutes notifications for subagent threads when disabled", async () => {
    renderHook(() =>
      useAgentSystemNotifications({
        enabled: true,
        isWindowFocused: false,
        minDurationMs: 0,
        subagentNotificationsEnabled: false,
        isSubagentThread: (_workspaceId, threadId) => threadId === "child-thread",
      }),
    );

    const handlers = useAppServerEventsMock.mock.calls[
      useAppServerEventsMock.mock.calls.length - 1
    ]?.[0] as {
      onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
      onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
    };

    act(() => {
      handlers.onTurnStarted?.("ws-1", "child-thread", "turn-1");
      handlers.onTurnCompleted?.("ws-1", "child-thread", "turn-1");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("still notifies for non-subagent threads while muted", async () => {
    renderHook(() =>
      useAgentSystemNotifications({
        enabled: true,
        isWindowFocused: false,
        minDurationMs: 0,
        subagentNotificationsEnabled: false,
        isSubagentThread: (_workspaceId, threadId) => threadId === "child-thread",
      }),
    );

    const handlers = useAppServerEventsMock.mock.calls[
      useAppServerEventsMock.mock.calls.length - 1
    ]?.[0] as {
      onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
      onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
    };

    act(() => {
      handlers.onTurnStarted?.("ws-1", "parent-thread", "turn-1");
      handlers.onTurnCompleted?.("ws-1", "parent-thread", "turn-1");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendNotification).mock.calls[0]?.[2]).toMatchObject({
      extra: {
        workspaceId: "ws-1",
        threadId: "parent-thread",
      },
    });
  });

  it("waits until turn completion before sending the final message notification", async () => {
    renderHook(() =>
      useAgentSystemNotifications({
        enabled: true,
        isWindowFocused: false,
        minDurationMs: 0,
        getWorkspaceName: () => "Workspace One",
      }),
    );

    const handlers = useAppServerEventsMock.mock.calls[
      useAppServerEventsMock.mock.calls.length - 1
    ]?.[0] as {
      onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
      onAgentMessageCompleted?: (event: {
        workspaceId: string;
        threadId: string;
        text: string;
      }) => void;
      onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
    };

    act(() => {
      handlers.onTurnStarted?.("ws-1", "thread-1", "turn-1");
      handlers.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-1",
        text: "Final assistant text",
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendNotification).not.toHaveBeenCalled();

    act(() => {
      handlers.onTurnCompleted?.("ws-1", "thread-1", "turn-1");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      "Workspace One",
      "Final assistant text",
      expect.objectContaining({
        extra: expect.objectContaining({
          workspaceId: "ws-1",
          threadId: "thread-1",
        }),
      }),
    );
  });

  it("formats notification text for native notification cards", async () => {
    renderHook(() =>
      useAgentSystemNotifications({
        enabled: true,
        isWindowFocused: false,
        minDurationMs: 0,
        getWorkspaceName: () =>
          "分析字幕一键校验可行性以及很长很长的任务标题需要被截断并且继续描述很多很多细节和附加背景",
      }),
    );

    const handlers = useAppServerEventsMock.mock.calls[
      useAppServerEventsMock.mock.calls.length - 1
    ]?.[0] as {
      onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
      onAgentMessageCompleted?: (event: {
        workspaceId: string;
        threadId: string;
        text: string;
      }) => void;
      onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
    };

    act(() => {
      handlers.onTurnStarted?.("ws-1", "thread-1", "turn-1");
      handlers.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-1",
        text: "**结论**\n- 自动检测 `字幕` 最合适的节点是内容审核队列前。\n```txt\nhidden debug\n```",
      });
      handlers.onTurnCompleted?.("ws-1", "thread-1", "turn-1");
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendNotification).toHaveBeenCalledWith(
      "分析字幕一键校验可行性以及很长很长的任务标题需要被截断并且继续描述很多很多细节…",
      "结论 自动检测 字幕 最合适的节点是内容审核队列前。",
      expect.objectContaining({
        group: "ws-1:thread-1",
        extra: expect.objectContaining({
          workspaceId: "ws-1",
          threadId: "thread-1",
        }),
      }),
    );
  });
});
