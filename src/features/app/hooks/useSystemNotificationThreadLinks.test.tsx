// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useSystemNotificationThreadLinks } from "./useSystemNotificationThreadLinks";

const notificationActionMock = vi.hoisted(() => ({
  callback: null as ((payload: { extra?: Record<string, unknown> }) => void) | null,
  unregister: vi.fn(async () => {}),
  onAction: vi.fn(
    async (callback: (payload: { extra?: Record<string, unknown> }) => void) => {
      notificationActionMock.callback = callback;
      return { unregister: notificationActionMock.unregister };
    },
  ),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  onAction: notificationActionMock.onAction,
}));

function makeWorkspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: "ws-1",
    name: "Workspace",
    path: "/tmp/workspace",
    connected: true,
    settings: { sidebarCollapsed: false },
    ...overrides,
  };
}

describe("useSystemNotificationThreadLinks", () => {
  beforeEach(() => {
    notificationActionMock.callback = null;
    notificationActionMock.unregister.mockClear();
    notificationActionMock.onAction.mockClear();
  });

  it("navigates to the thread when the app regains focus", async () => {
    const workspace = makeWorkspace({ connected: true });
    const workspacesById = new Map([[workspace.id, workspace]]);

    const refreshWorkspaces = vi.fn(async () => [workspace]);
    const connectWorkspace = vi.fn(async () => {});
    const openThreadLink = vi.fn();

    const { result } = renderHook(() =>
      useSystemNotificationThreadLinks({
        hasLoadedWorkspaces: true,
        workspacesById,
        refreshWorkspaces,
        connectWorkspace,
        openThreadLink,
      }),
    );

    act(() => {
      result.current.recordPendingThreadLink("ws-1", "t-1");
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(openThreadLink).toHaveBeenCalledWith("ws-1", "t-1");
    expect(connectWorkspace).not.toHaveBeenCalled();
    expect(refreshWorkspaces).not.toHaveBeenCalled();
  });

  it("connects the workspace before selecting the thread when needed", async () => {
    const workspace = makeWorkspace({ connected: false });
    const workspacesById = new Map([[workspace.id, workspace]]);

    const refreshWorkspaces = vi.fn(async () => [workspace]);
    const connectWorkspace = vi.fn(async () => {});
    const openThreadLink = vi.fn();

    const { result } = renderHook(() =>
      useSystemNotificationThreadLinks({
        hasLoadedWorkspaces: true,
        workspacesById,
        refreshWorkspaces,
        connectWorkspace,
        openThreadLink,
      }),
    );

    act(() => {
      result.current.recordPendingThreadLink("ws-1", "t-1");
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(1);
    expect(openThreadLink).toHaveBeenCalledWith("ws-1", "t-1");
  });

  it("navigates immediately when openThreadLinkOrQueue is used after load", async () => {
    const workspace = makeWorkspace({ connected: true });
    const workspacesById = new Map([[workspace.id, workspace]]);

    const refreshWorkspaces = vi.fn(async () => [workspace]);
    const connectWorkspace = vi.fn(async () => {});
    const openThreadLink = vi.fn();

    const { result } = renderHook(() =>
      useSystemNotificationThreadLinks({
        hasLoadedWorkspaces: true,
        workspacesById,
        refreshWorkspaces,
        connectWorkspace,
        openThreadLink,
      }),
    );

    await act(async () => {
      result.current.openThreadLinkOrQueue("ws-1", "t-2");
      await Promise.resolve();
    });

    expect(openThreadLink).toHaveBeenCalledWith("ws-1", "t-2");
  });

  it("navigates when a system notification action contains a thread link", async () => {
    const workspace = makeWorkspace({ connected: true });
    const workspacesById = new Map([[workspace.id, workspace]]);

    const refreshWorkspaces = vi.fn(async () => [workspace]);
    const connectWorkspace = vi.fn(async () => {});
    const openThreadLink = vi.fn();

    renderHook(() =>
      useSystemNotificationThreadLinks({
        hasLoadedWorkspaces: true,
        workspacesById,
        refreshWorkspaces,
        connectWorkspace,
        openThreadLink,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      notificationActionMock.callback?.({
        extra: {
          kind: "thread",
          workspaceId: "ws-1",
          threadId: "t-action",
        },
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(openThreadLink).toHaveBeenCalledWith("ws-1", "t-action");
  });
});
