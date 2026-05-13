/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauriMock = vi.hoisted(() => vi.fn());
const getCurrentWindowMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: getCurrentWindowMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

import { MainHeader } from "./MainHeader";

function buildProps() {
  return {
    workspace: {
      id: "ws-1",
      name: "coChat",
      path: "/Users/xihe0000/workspace/coChat",
      connected: true,
      settings: {
        sidebarCollapsed: false,
      },
    },
    openTargets: [],
    openAppIconById: {},
    selectedOpenAppId: "default",
    onSelectOpenAppId: vi.fn(),
    branchName: "main",
    branches: [],
    onCheckoutBranch: vi.fn(),
    onCreateBranch: vi.fn(),
    onToggleTerminal: vi.fn(),
    isTerminalOpen: false,
    disableBranchMenu: true,
  };
}

describe("MainHeader", () => {
  const toggleMaximize = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    getCurrentWindowMock.mockReturnValue({
      toggleMaximize,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("double-clicks the blank header region to toggle window maximize", () => {
    render(<MainHeader {...buildProps()} />);

    fireEvent.doubleClick(screen.getByTestId("main-header-blank-region"));

    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("does nothing when not running in Tauri", () => {
    isTauriMock.mockReturnValue(false);

    render(<MainHeader {...buildProps()} />);

    fireEvent.doubleClick(screen.getByTestId("main-header-blank-region"));

    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it("keeps the title line focused on the thread title by default", () => {
    render(
      <MainHeader
        {...buildProps()}
        threadTitle="评估VSCode插件兼容"
        branchName="feat/vscode-message-renderer-compat"
      />,
    );

    expect(screen.getByText("评估VSCode插件兼容")).toBeTruthy();
    expect(screen.queryByText("feat/vscode-message-renderer-compat")).toBeNull();
    expect(document.querySelector(".workspace-separator")).toBeNull();
  });
});
