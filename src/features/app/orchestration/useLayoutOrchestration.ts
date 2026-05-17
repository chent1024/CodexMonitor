import { useMemo, type CSSProperties } from "react";
import type { AppSettings } from "@/types";
import { isLinuxPlatform, isWindowsPlatform } from "@utils/platformPaths";

type UseAppShellOrchestrationOptions = {
  isCompact: boolean;
  isPhone: boolean;
  isTablet: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  isWorkspaceDropActive: boolean;
  centerMode: "chat" | "diff";
  selectedDiffPath: string | null;
  showComposer: boolean;
  activeThreadId: string | null;
  sidebarWidth: number;
  rightPanelWidth: number;
  chatDiffSplitPositionPercent: number;
  planPanelHeight: number;
  terminalPanelHeight: number;
  debugPanelHeight: number;
  appSettings: Pick<
    AppSettings,
    | "uiFontFamily"
    | "uiFontSize"
    | "codeFontFamily"
    | "codeFontSize"
    | "fontSmoothingEnabled"
  >;
};

export function useAppShellOrchestration({
  isCompact,
  isPhone,
  isTablet,
  sidebarCollapsed,
  rightPanelCollapsed,
  isWorkspaceDropActive,
  centerMode,
  selectedDiffPath,
  showComposer,
  activeThreadId,
  sidebarWidth,
  rightPanelWidth,
  chatDiffSplitPositionPercent,
  planPanelHeight,
  terminalPanelHeight,
  debugPanelHeight,
  appSettings,
}: UseAppShellOrchestrationOptions) {
  const isWindows = isWindowsPlatform();
  const isLinux = isLinuxPlatform();
  const usesAppWindowChrome = isWindows || isLinux;
  const showGitDetail = Boolean(selectedDiffPath) && isPhone && centerMode === "diff";
  const isThreadOpen = Boolean(activeThreadId && showComposer);

  const appClassName = `app ${isCompact ? "layout-compact" : "layout-desktop"}${
    isPhone ? " layout-phone" : ""
  }${isTablet ? " layout-tablet" : ""}${
    !isCompact && sidebarCollapsed ? " sidebar-collapsed" : ""}${
    !isCompact && rightPanelCollapsed ? " right-panel-collapsed" : ""
  }${isWindows ? " is-windows" : ""}${isLinux ? " is-linux" : ""}`;

  const appStyle = useMemo<CSSProperties>(
    () => ({
      "--sidebar-width": `${isCompact ? sidebarWidth : sidebarCollapsed ? 0 : sidebarWidth}px`,
      "--right-panel-width": `${
        isCompact ? rightPanelWidth : rightPanelCollapsed ? 0 : rightPanelWidth
      }px`,
      "--chat-diff-split-position-percent": `${chatDiffSplitPositionPercent}%`,
      "--plan-panel-height": `${planPanelHeight}px`,
      "--terminal-panel-height": `${terminalPanelHeight}px`,
      "--debug-panel-height": `${debugPanelHeight}px`,
      "--ui-font-family": appSettings.uiFontFamily,
      "--ui-font-size": `${appSettings.uiFontSize}px`,
      "--code-font-family": appSettings.codeFontFamily,
      "--code-font-size": `${appSettings.codeFontSize}px`,
      "--font-smoothing-webkit": appSettings.fontSmoothingEnabled
        ? "antialiased"
        : "auto",
      "--font-smoothing-moz": appSettings.fontSmoothingEnabled ? "grayscale" : "auto",
      "--font-text-rendering": appSettings.fontSmoothingEnabled
        ? "optimizeLegibility"
        : "auto",
      "--sidebar-top-padding": isLinux
        ? "calc(var(--main-topbar-height, 44px) + 6px)"
        : isWindows
          ? "10px"
          : "36px",
      "--right-panel-top-padding": isWindows
        ? "calc(var(--main-topbar-height, 44px) + 6px)"
        : "12px",
      "--home-scroll-offset": usesAppWindowChrome ? "var(--main-topbar-height, 44px)" : "0px",
      "--window-caption-width": usesAppWindowChrome ? "114px" : "0px",
      "--window-caption-gap": usesAppWindowChrome ? "5px" : "0px",
      ...(usesAppWindowChrome
        ? {
            "--titlebar-height": "8px",
            "--titlebar-drag-strip-z-index": "5",
            "--side-panel-drag-strip-height": "56px",
            "--window-drag-hit-height": "44px",
            "--window-drag-strip-pointer-events": "none",
            "--titlebar-inset-left": "0px",
            "--titlebar-collapsed-left-extra": "0px",
            "--titlebar-toggle-size": "32px",
            "--titlebar-toggle-side-gap": "7px",
            "--titlebar-sidebar-toggle-left": isLinux
              ? "calc(var(--window-caption-width, 114px) + var(--window-caption-gap, 5px))"
              : "0px",
            "--titlebar-sidebar-toggle-top": "calc(var(--main-topbar-height, 42px) / 2)",
            "--titlebar-toggle-title-offset": "0px",
            "--titlebar-toggle-offset": "0px",
          }
        : {}),
    } as CSSProperties),
    [
      appSettings.codeFontFamily,
      appSettings.codeFontSize,
      appSettings.fontSmoothingEnabled,
      appSettings.uiFontFamily,
      appSettings.uiFontSize,
      chatDiffSplitPositionPercent,
      debugPanelHeight,
      isWindows,
      isLinux,
      usesAppWindowChrome,
      isCompact,
      planPanelHeight,
      rightPanelCollapsed,
      rightPanelWidth,
      sidebarCollapsed,
      sidebarWidth,
      terminalPanelHeight,
    ],
  );

  return {
    showGitDetail,
    isThreadOpen,
    dropOverlayActive: isWorkspaceDropActive,
    dropOverlayText: "拖放项目到这里",
    appClassName,
    appStyle,
  };
}
