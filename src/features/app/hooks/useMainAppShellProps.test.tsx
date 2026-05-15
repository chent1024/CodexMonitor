// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMainAppShellProps } from "./useMainAppShellProps";

afterEach(() => {
  cleanup();
});

function withNavigatorPlatform<T>(platform: string, callback: () => T): T {
  const activeNavigator = window.navigator;
  const ownDescriptor = Object.getOwnPropertyDescriptor(activeNavigator, "platform");
  Object.defineProperty(activeNavigator, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    return callback();
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(activeNavigator, "platform", ownDescriptor);
    } else {
      Reflect.deleteProperty(activeNavigator, "platform");
    }
  }
}

function buildShellProps(platform: string) {
  return withNavigatorPlatform(platform, () =>
    useMainAppShellProps({
      shell: {
        appClassName: platform.toLowerCase().includes("win")
          ? "app layout-desktop is-windows"
          : "app layout-desktop",
        isResizing: false,
        appStyle: {},
        appRef: { current: null },
        sidebarToggleProps: {
          isCompact: false,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          onCollapseSidebar: vi.fn(),
          onExpandSidebar: vi.fn(),
          onCollapseRightPanel: vi.fn(),
          onExpandRightPanel: vi.fn(),
        },
        shouldLoadGitHubPanelData: false,
        appModalsProps: {} as never,
        showMobileSetupWizard: false,
        mobileSetupWizardProps: {} as never,
      },
      gitHubPanelDataProps: {} as never,
      appLayout: {} as never,
      topbar: {
        isCompact: false,
        desktopTopbarLeftNode: <span data-testid="conversation-title">会话标题</span>,
        hasActiveWorkspace: false,
        backendMode: "local",
        remoteThreadConnectionState: "live",
      },
    }),
  );
}

describe("useMainAppShellProps", () => {
  it("places the Windows sidebar collapse button before the conversation title", () => {
    const props = buildShellProps("Win32");

    render(<div>{props.appLayoutProps.desktopTopbarLeftNode}</div>);

    const leading = screen.getByTestId("conversation-title").parentElement;
    const children = Array.from(leading?.children ?? []);
    expect(children[0]).toBe(screen.getByRole("button", { name: "隐藏线程侧栏" }));
    expect(children[1]).toBe(screen.getByTestId("conversation-title"));
  });

  it("keeps macOS conversation title without the inline Windows sidebar button", () => {
    const props = buildShellProps("MacIntel");

    render(<div>{props.appLayoutProps.desktopTopbarLeftNode}</div>);

    expect(screen.queryByRole("button", { name: "隐藏线程侧栏" })).toBeNull();
    expect(screen.getByTestId("conversation-title")).toBeTruthy();
  });
});
