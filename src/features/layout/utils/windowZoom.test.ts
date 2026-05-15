import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import capabilities from "../../../../src-tauri/capabilities/default.json";

const currentMonitorMock = vi.hoisted(() => vi.fn());
const getCurrentWindowMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: currentMonitorMock,
  getCurrentWindow: getCurrentWindowMock,
}));

import {
  ensureWindowWithinCurrentDisplay,
  resetWindowZoomStateForTests,
  toggleWindowZoomWithinCurrentDisplay,
} from "./windowZoom";

function monitor(width = 1440, height = 900, scaleFactor = 1) {
  return {
    name: "Built-in",
    position: new PhysicalPosition(0, 0),
    size: new PhysicalSize(width, height),
    workArea: {
      position: new PhysicalPosition(0, 25),
      size: new PhysicalSize(width, height - 25),
    },
    scaleFactor,
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
  });

  it("falls back to native maximize when the current monitor is unavailable", async () => {
    const handle = windowHandle();
    currentMonitorMock.mockResolvedValue(null);

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
    expect(handle.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("restores when already filling the work area", async () => {
    const handle = windowHandle({
      position: new PhysicalPosition(0, 25),
      outerSize: new PhysicalSize(1440, 875),
      innerSize: new PhysicalSize(1440, 875),
    });

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(120, 113));
    expect(handle.setSize).toHaveBeenCalledWith(new LogicalSize(1200, 700));
  });

  it("zooms to the current display work area without exceeding it", async () => {
    const handle = windowHandle();

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(0, 25));
    expect(handle.setSize).toHaveBeenCalledWith(new PhysicalSize(1440, 875));
  });

  it("subtracts the current frame delta when zooming to the work area", async () => {
    const handle = windowHandle({
      outerSize: new PhysicalSize(900, 650),
      innerSize: new PhysicalSize(872, 611),
    });

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(0, 25));
    expect(handle.setSize).toHaveBeenCalledWith(new PhysicalSize(1412, 836));
  });

  it("does not get repaired by the bounds guard after custom zoom with a frame delta", async () => {
    const zoomedOuterSize = new PhysicalSize(1440, 875);
    const zoomedInnerSize = new PhysicalSize(1412, 836);
    const handle = windowHandle({
      outerSize: new PhysicalSize(900, 650),
      innerSize: new PhysicalSize(872, 611),
    });

    await toggleWindowZoomWithinCurrentDisplay(handle as never);

    handle.outerPosition.mockResolvedValue(new PhysicalPosition(0, 25));
    handle.outerSize.mockResolvedValue(zoomedOuterSize);
    handle.innerSize.mockResolvedValue(zoomedInnerSize);
    vi.clearAllMocks();

    await ensureWindowWithinCurrentDisplay(handle as never, {
      repairLegacyUnscaledDefault: false,
    });

    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
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
    expect(handle.setSize).toHaveBeenCalledWith(new LogicalSize(1200, 700));
  });

  it("does not resize user-driven oversized windows after runtime resize events", async () => {
    const handle = windowHandle({
      position: new PhysicalPosition(0, 25),
      outerSize: new PhysicalSize(1480, 900),
      innerSize: new PhysicalSize(1480, 900),
    });

    await ensureWindowWithinCurrentDisplay(handle as never, {
      repairLegacyUnscaledDefault: false,
      repairOutOfBounds: false,
    });

    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
  });

  it("keeps in-bounds default restore size unchanged on scale 1 displays", async () => {
    const handle = windowHandle({
      position: new PhysicalPosition(100, 120),
      outerSize: new PhysicalSize(1200, 700),
      innerSize: new PhysicalSize(1200, 700),
    });

    await ensureWindowWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
  });

  it("rescales legacy unscaled restore bounds on high-DPI displays", async () => {
    currentMonitorMock.mockResolvedValue(monitor(3456, 2234, 2));
    const handle = windowHandle({
      position: new PhysicalPosition(100, 120),
      outerSize: new PhysicalSize(1200, 700),
      innerSize: new PhysicalSize(1200, 700),
    });

    await ensureWindowWithinCurrentDisplay(handle as never);

    expect(handle.setPosition).toHaveBeenCalledWith(new PhysicalPosition(528, 430));
    expect(handle.setSize).toHaveBeenCalledWith(new LogicalSize(1200, 700));
  });

  it("can skip high-DPI legacy restore repair after user-driven resize events", async () => {
    currentMonitorMock.mockResolvedValue(monitor(3456, 2234, 2));
    const handle = windowHandle({
      position: new PhysicalPosition(100, 120),
      outerSize: new PhysicalSize(1200, 700),
      innerSize: new PhysicalSize(1200, 700),
    });

    await ensureWindowWithinCurrentDisplay(handle as never, {
      repairLegacyUnscaledDefault: false,
    });

    expect(handle.setPosition).not.toHaveBeenCalled();
    expect(handle.setSize).not.toHaveBeenCalled();
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
