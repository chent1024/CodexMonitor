// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useComposerController } from "./useComposerController";

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "CodexMonitor",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

function makeOptions(
  overrides: Partial<Parameters<typeof useComposerController>[0]> = {},
) {
  return {
    activeThreadId: "thread-1",
    activeTurnId: "turn-1",
    activeWorkspaceId: "workspace-1",
    activeWorkspace: workspace,
    isProcessing: true,
    isReviewing: false,
    queueFlushPaused: false,
    steerEnabled: true,
    followUpMessageBehavior: "queue" as const,
    appsEnabled: true,
    connectWorkspace: vi.fn().mockResolvedValue(undefined),
    startThreadForWorkspace: vi.fn().mockResolvedValue("thread-1"),
    sendUserMessage: vi.fn().mockResolvedValue({ status: "sent" }),
    sendUserMessageToThread: vi.fn().mockResolvedValue(undefined),
    startFork: vi.fn().mockResolvedValue(undefined),
    startReview: vi.fn().mockResolvedValue(undefined),
    startResume: vi.fn().mockResolvedValue(undefined),
    startCompact: vi.fn().mockResolvedValue(undefined),
    startApps: vi.fn().mockResolvedValue(undefined),
    startMcp: vi.fn().mockResolvedValue(undefined),
    startFast: vi.fn().mockResolvedValue(undefined),
    startStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("useComposerController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers guided queued sends so the click can update the queue first", async () => {
    vi.useFakeTimers();
    const options = makeOptions();
    const { result } = renderHook((props) => useComposerController(props), {
      initialProps: options,
    });

    await act(async () => {
      await result.current.queueMessage("Guide now");
    });

    expect(result.current.activeQueue).toHaveLength(1);
    const queuedItem = result.current.activeQueue[0]!;

    act(() => {
      result.current.handleGuideQueued(queuedItem);
    });

    expect(result.current.activeQueue).toHaveLength(0);
    expect(options.sendUserMessage).not.toHaveBeenCalled();

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(options.sendUserMessage).toHaveBeenCalledWith(
      "Guide now",
      [],
      undefined,
      { sendIntent: "steer" },
    );
  });
});
