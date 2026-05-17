// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppShellOrchestration } from "./useLayoutOrchestration";

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

function renderShellOrchestration(platform: string, sidebarCollapsed: boolean) {
  return withNavigatorPlatform(platform, () =>
    renderHook(() =>
      useAppShellOrchestration({
        isCompact: false,
        isPhone: false,
        isTablet: false,
        sidebarCollapsed,
        rightPanelCollapsed: false,
        isWorkspaceDropActive: false,
        centerMode: "chat",
        selectedDiffPath: null,
        showComposer: true,
        activeThreadId: "thread-1",
        sidebarWidth: 320,
        rightPanelWidth: 360,
        chatDiffSplitPositionPercent: 50,
        planPanelHeight: 240,
        terminalPanelHeight: 220,
        debugPanelHeight: 220,
        appSettings: {
          uiFontFamily: "system-ui",
          uiFontSize: 13,
          codeFontFamily: "monospace",
          codeFontSize: 13,
          fontSmoothingEnabled: false,
        },
      }),
    ),
  );
}

describe("useAppShellOrchestration", () => {
  it("anchors the collapsed Windows sidebar toggle at the far left", () => {
    const { result } = renderShellOrchestration("Win32", true);
    const style = result.current.appStyle as Record<string, string>;

    expect(result.current.appClassName).toContain("is-windows");
    expect(result.current.appClassName).toContain("sidebar-collapsed");
    expect(style["--titlebar-sidebar-toggle-left"]).toBe("0px");
    expect(style["--titlebar-sidebar-toggle-top"]).toBe(
      "calc(var(--main-topbar-height, 42px) / 2)",
    );
    expect(style["--font-smoothing-webkit"]).toBe("auto");
    expect(style["--font-smoothing-moz"]).toBe("auto");
    expect(style["--font-text-rendering"]).toBe("auto");
    expect(style["--sidebar-width"]).toBe("0px");
  });

  it("keeps macOS titlebar toggle positioning on the platform default path", () => {
    const { result } = renderShellOrchestration("MacIntel", true);
    const style = result.current.appStyle as Record<string, string>;

    expect(result.current.appClassName).not.toContain("is-windows");
    expect(result.current.appClassName).toContain("sidebar-collapsed");
    expect(style["--titlebar-sidebar-toggle-left"]).toBeUndefined();
    expect(style["--titlebar-sidebar-toggle-top"]).toBeUndefined();
    expect(style["--sidebar-width"]).toBe("0px");
  });

  it("places Linux window controls before the sidebar toggle", () => {
    const { result } = renderShellOrchestration("Linux x86_64", false);
    const style = result.current.appStyle as Record<string, string>;

    expect(result.current.appClassName).toContain("is-linux");
    expect(style["--window-caption-width"]).toBe("114px");
    expect(style["--sidebar-top-padding"]).toBe(
      "calc(var(--main-topbar-height, 44px) + 6px)",
    );
    expect(style["--right-panel-top-padding"]).toBe("12px");
    expect(style["--titlebar-sidebar-toggle-left"]).toBe(
      "calc(var(--window-caption-width, 114px) + var(--window-caption-gap, 5px))",
    );
  });

  it("does not use app chrome positioning on macOS", () => {
    const { result } = renderShellOrchestration("MacIntel", false);
    const style = result.current.appStyle as Record<string, string>;

    expect(result.current.appClassName).not.toContain("is-linux");
    expect(result.current.appClassName).not.toContain("is-windows");
    expect(style["--window-caption-width"]).toBe("0px");
  });

  it("enables font smoothing css variables when requested", () => {
    const { result } = withNavigatorPlatform("Win32", () =>
      renderHook(() =>
        useAppShellOrchestration({
          isCompact: false,
          isPhone: false,
          isTablet: false,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          isWorkspaceDropActive: false,
          centerMode: "chat",
          selectedDiffPath: null,
          showComposer: true,
          activeThreadId: "thread-1",
          sidebarWidth: 320,
          rightPanelWidth: 360,
          chatDiffSplitPositionPercent: 50,
          planPanelHeight: 240,
          terminalPanelHeight: 220,
          debugPanelHeight: 220,
          appSettings: {
            uiFontFamily: "system-ui",
            uiFontSize: 13,
            codeFontFamily: "monospace",
            codeFontSize: 13,
            fontSmoothingEnabled: true,
          },
        }),
      ),
    );
    const style = result.current.appStyle as Record<string, string>;

    expect(style["--font-smoothing-webkit"]).toBe("antialiased");
    expect(style["--font-smoothing-moz"]).toBe("grayscale");
    expect(style["--font-text-rendering"]).toBe("optimizeLegibility");
  });
});
