/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isTauriMock = vi.hoisted(() => vi.fn());
const getCurrentWindowMock = vi.hoisted(() => vi.fn());
const isWindowsPlatformMock = vi.hoisted(() => vi.fn());
const isLinuxPlatformMock = vi.hoisted(() => vi.fn());
const toggleNativeWindowMaximizeMock = vi.hoisted(() => vi.fn());
const toggleWindowZoomWithinCurrentDisplayMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: getCurrentWindowMock,
}));

vi.mock("@utils/platformPaths", () => ({
  isWindowsPlatform: isWindowsPlatformMock,
  isLinuxPlatform: isLinuxPlatformMock,
}));

vi.mock("../utils/windowZoom", () => ({
  toggleNativeWindowMaximize: toggleNativeWindowMaximizeMock,
  toggleWindowZoomWithinCurrentDisplay: toggleWindowZoomWithinCurrentDisplayMock,
}));

import { WindowCaptionControls } from "./WindowCaptionControls";

describe("WindowCaptionControls", () => {
  const minimize = vi.fn();
  const close = vi.fn();
  const windowHandle = {
    minimize,
    close,
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isWindowsPlatformMock.mockReturnValue(true);
    isLinuxPlatformMock.mockReturnValue(false);
    isTauriMock.mockReturnValue(true);
    windowHandle.isMaximized.mockResolvedValue(false);
    windowHandle.onResized.mockResolvedValue(() => undefined);
    getCurrentWindowMock.mockReturnValue(windowHandle);
    toggleNativeWindowMaximizeMock.mockResolvedValue(undefined);
    toggleWindowZoomWithinCurrentDisplayMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders controls on Windows in Tauri and wires actions", () => {
    render(<WindowCaptionControls />);

    expect(screen.getByRole("group", { name: "Window controls" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));

    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleWindowZoomWithinCurrentDisplayMock).toHaveBeenCalledWith(windowHandle);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not render when not on an app chrome desktop platform", () => {
    isWindowsPlatformMock.mockReturnValue(false);
    isLinuxPlatformMock.mockReturnValue(false);

    render(<WindowCaptionControls />);

    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  });

  it("renders controls on Linux in Tauri", () => {
    isWindowsPlatformMock.mockReturnValue(false);
    isLinuxPlatformMock.mockReturnValue(true);

    render(<WindowCaptionControls />);

    expect(screen.getByRole("group", { name: "Window controls" })).not.toBeNull();
  });

  it("uses native maximize on Linux so the window manager keeps system panels visible", () => {
    isWindowsPlatformMock.mockReturnValue(false);
    isLinuxPlatformMock.mockReturnValue(true);

    render(<WindowCaptionControls />);

    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));

    expect(toggleNativeWindowMaximizeMock).toHaveBeenCalledWith(windowHandle);
    expect(toggleWindowZoomWithinCurrentDisplayMock).not.toHaveBeenCalled();
  });

  it("does not render when not running in Tauri", () => {
    isTauriMock.mockReturnValue(false);

    render(<WindowCaptionControls />);

    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  });
});
