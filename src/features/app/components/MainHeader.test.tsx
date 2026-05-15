/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  afterEach(() => {
    cleanup();
  });

  it("leaves header double-click zoom to the global window drag hook", () => {
    render(
      <MainHeader
        {...buildProps()}
        showBranchContext
        branchName="main"
      />,
    );

    fireEvent.doubleClick(screen.getByTestId("main-header-blank-region"));
    fireEvent.doubleClick(screen.getByText("coChat"));
    fireEvent.doubleClick(screen.getByRole("button", { name: "main" }));

    expect(screen.getByText("coChat")).toBeTruthy();
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
