import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import capabilities from "../../../../src-tauri/capabilities/default.json";

const currentMonitorMock = vi.hoisted(() => vi.fn());
const getCurrentWindowMock = vi.hoisted(() => vi.fn());
const performNativeWindowZoomMock = vi.hoisted(() => vi.fn());
const isMacPlatformMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: currentMonitorMock,
  getCurrentWindow: getCurrentWindowMock,
}));

vi.mock("@services/tauri", () => ({
  performNativeWindowZoom: performNativeWindowZoomMock,
}));

vi.mock("@utils/platformPaths", () => ({
  isMacPlatform: isMacPlatformMock,
}));

import {
  ensureWindowWithinCurrentDisplay,
  resetWindowZoomStateForTests,
  toggleWindowZoomWithinCurrentDisplay,
} from "./windowZoom";

function monitor(width = 1440, height = 900) {
  return {
    name: "Built-in",
    position: new PhysicalPosition(0, 0),
    size: new PhysicalSize(width, height),
    workArea: {
      position: new PhysicalPosition(0, 25),
      size: new PhysicalSize(width, height - 25),
    },
    scaleFactor: 1,
  };
}

function windowHandle({
  position = new PhysicalPosition(100, 120),
  outerSize = new PhysicalSize(900, 650),
  innerSize = new PhysicalSize(900, 650),
  maximized = false,
} = {}) {
  return {
    outerPosition: vi.fn().mockResolvedValue(position),
    outerSize: vi.fn().mockResolvedValue(outerSize),
    innerSize: vi.fn().mockResolvedValue(innerSize),
    isMaximized: vi.fn().mockResolvedValue(maximized),
    unmaximize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
  };
}

describe("windowZoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWindowZoomStateForTests();
    currentMonitorMock.mockResolvedValue(monitor());
    isMacPlatformMock.mockReturnValue(false);
    performNativeWindowZoomMock.mockResolvedValue(false);
  });

  it("uses native macOS zoom when available", async () => {
    const handle = windowHandle();
    isMacPlatformMock.mockReturnValue(true);
    performNativeWindowZoomMock.mockResolvedValue(true);

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(performNativeWindowZoomMock).toHaveBeenCalledTimes(1);
    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
  });

  it("does not use native macOS zoom when already filling the work area", async () => {
    const handle = windowHandle({
      position: new PhysicalPosition(0, 25),
      outerSize: new PhysicalSize(1440, 875),
      innerSize: new PhysicalSize(1440, 875),
    });
    isMacPlatformMock.mockReturnValue(true);
    performNativeWindowZoomMock.mockResolvedValue(true);

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(performNativeWindowZoomMock).not.toHaveBeenCalled();
    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
  });

  it("zooms to the current display work area without exceeding it", async () => {
    const handle = windowHandle();

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(0, 25));
    expect(handle.setSize).toHaveBeenCalledWith(new PhysicalSize(1440, 875));
  });

  it("does not subtract the current frame delta when zooming to the work area", async () => {
    const handle = windowHandle({
      outerSize: new PhysicalSize(900, 650),
      innerSize: new PhysicalSize(872, 611),
    });

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(0, 25));
    expect(handle.setSize).toHaveBeenCalledWith(new PhysicalSize(1440, 875));
  });

  it("restores the previous bounds after a custom zoom", async () => {
    const handle = windowHandle();

    await toggleWindowZoomWithinCurrentDisplay(handle as never);
    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenLastCalledWith(new PhysicalPosition(100, 120));
    expect(handle.setSize).toHaveBeenLastCalledWith(new PhysicalSize(900, 650));
  });

  it("clamps oversized restored windows back inside the current display", async () => {
    const handle = windowHandle({
      position: new PhysicalPosition(0, 25),
      outerSize: new PhysicalSize(6268, 2058),
      innerSize: new PhysicalSize(6268, 2058),
    });

    await ensureWindowWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(120, 113));
    expect(handle.setSize).toHaveBeenCalledWith(new PhysicalSize(1200, 700));
  });

  it("keeps Tauri desktop permissions in sync with window zoom APIs", () => {
    const desktopCapability = capabilities.capabilities.find(
      (capability) => capability.identifier === "desktop-default",
    );
    expect(desktopCapability).toBeTruthy();
    const permissions = desktopCapability?.permissions ?? [];

    expect(permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-current-monitor",
        "core:window:allow-inner-size",
        "core:window:allow-is-maximized",
        "core:window:allow-outer-position",
        "core:window:allow-outer-size",
        "core:window:allow-set-position",
        "core:window:allow-set-size",
        "core:window:allow-toggle-maximize",
        "core:window:allow-unmaximize",
      ]),
    );
  });
});
