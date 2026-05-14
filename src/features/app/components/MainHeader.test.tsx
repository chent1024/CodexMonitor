/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauriMock = vi.hoisted(() => vi.fn());
const toggleWindowZoomWithinCurrentDisplayMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("../../layout/utils/windowZoom", () => ({
  toggleWindowZoomWithinCurrentDisplay: toggleWindowZoomWithinCurrentDisplayMock,
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
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    toggleWindowZoomWithinCurrentDisplayMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("double-clicks the blank header region to toggle window maximize", () => {
    render(<MainHeader {...buildProps()} />);

    fireEvent.doubleClick(screen.getByTestId("main-header-blank-region"));

    expect(toggleWindowZoomWithinCurrentDisplayMock).toHaveBeenCalledTimes(1);
  });

  it("double-clicks the header title region to toggle window maximize", () => {
    render(<MainHeader {...buildProps()} />);

    fireEvent.doubleClick(screen.getByText("coChat"));

    expect(toggleWindowZoomWithinCurrentDisplayMock).toHaveBeenCalledTimes(1);
  });

  it("does not toggle window maximize from interactive header controls", () => {
    render(
      <MainHeader
        {...buildProps()}
        showBranchContext
        branchName="main"
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: "main" }));

    expect(toggleWindowZoomWithinCurrentDisplayMock).not.toHaveBeenCalled();
  });

  it("does nothing when not running in Tauri", () => {
    isTauriMock.mockReturnValue(false);

    render(<MainHeader {...buildProps()} />);

    fireEvent.doubleClick(screen.getByTestId("main-header-blank-region"));

    expect(toggleWindowZoomWithinCurrentDisplayMock).not.toHaveBeenCalled();
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
