/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tailscaleDaemonStatusMock = vi.hoisted(() => vi.fn());
const getRestartSafeSessionDebugStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/tauri", () => ({
  tailscaleDaemonStatus: tailscaleDaemonStatusMock,
  getRestartSafeSessionDebugStatus: getRestartSafeSessionDebugStatusMock,
}));

import { SidebarBottomRail } from "./SidebarBottomRail";

function renderRail() {
  return render(
    <SidebarBottomRail
      sessionPercent={null}
      weeklyRemainingPercent={null}
      sessionWindowLabel="Session"
      weeklyWindowLabel="Weekly"
      sessionResetLabel={null}
      weeklyResetLabel={null}
      creditsLabel={null}
      showWeekly={false}
      onOpenSettings={vi.fn()}
      onOpenDebug={vi.fn()}
      showDebugButton={false}
      showAccountSwitcher={false}
      accountLabel="Signed in"
      accountActionLabel="Switch"
      accountDisabled={false}
      accountSwitching={false}
      accountCancelDisabled={false}
      onSwitchAccount={vi.fn()}
      onCancelSwitchAccount={vi.fn()}
    />,
  );
}

describe("SidebarBottomRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
    tailscaleDaemonStatusMock.mockResolvedValue({
      state: "running",
      pid: 22144,
      startedAtMs: null,
      lastError: null,
      listenAddr: "127.0.0.1:4732",
    });
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    cleanup();
  });

  it("does not render undefined for older restart-safe daemon status payloads", async () => {
    getRestartSafeSessionDebugStatusMock.mockResolvedValue({
      protocolVersion: 1,
      sessionCount: 3,
      activeSessionCount: 0,
      journalEventCount: 12,
      pendingRequestCount: 0,
      attachedClientCount: 0,
      idleShutdownAllowed: false,
    });

    renderRail();

    await screen.findByText("Daemon 正常");
    expect(
      screen.getByText("会话 3 已保留 · 0 处理中 · 0 待处理"),
    ).toBeTruthy();
    expect(screen.getByText("事件 12 已缓存 · 将继续保留")).toBeTruthy();
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("undefined");
    });
  });
});
