import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";
import { performNativeWindowZoom } from "@services/tauri";
import { isMacPlatform } from "@utils/platformPaths";

type WindowHandle = ReturnType<typeof getCurrentWindow>;

const EDGE_TOLERANCE_PX = 8;
const DEFAULT_RESTORE_WIDTH = 1200;
const DEFAULT_RESTORE_HEIGHT = 700;

type WindowBounds = {
  position: PhysicalPosition;
  innerSize: PhysicalSize;
  outerSize: PhysicalSize;
};

let restoreBounds: Pick<WindowBounds, "position" | "innerSize"> | null = null;
let customZoomed = false;

export function resetWindowZoomStateForTests() {
  restoreBounds = null;
  customZoomed = false;
}

function currentWindowSafe() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function workAreaFor(monitor: Monitor | null) {
  return monitor?.workArea ?? null;
}

async function readWindowBounds(windowHandle: WindowHandle): Promise<WindowBounds> {
  const [position, outerSize, innerSize] = await Promise.all([
    windowHandle.outerPosition(),
    windowHandle.outerSize(),
    windowHandle.innerSize().catch(() => windowHandle.outerSize()),
  ]);
  return { position, outerSize, innerSize };
}

function exceedsWorkArea(bounds: WindowBounds, workArea: NonNullable<Monitor["workArea"]>) {
  const right = bounds.position.x + bounds.outerSize.width;
  const bottom = bounds.position.y + bounds.outerSize.height;
  const workRight = workArea.position.x + workArea.size.width;
  const workBottom = workArea.position.y + workArea.size.height;
  return (
    bounds.position.x < workArea.position.x - EDGE_TOLERANCE_PX ||
    bounds.position.y < workArea.position.y - EDGE_TOLERANCE_PX ||
    right > workRight + EDGE_TOLERANCE_PX ||
    bottom > workBottom + EDGE_TOLERANCE_PX
  );
}

function isNearWorkArea(bounds: WindowBounds, workArea: NonNullable<Monitor["workArea"]>) {
  return (
    Math.abs(bounds.position.x - workArea.position.x) <= EDGE_TOLERANCE_PX &&
    Math.abs(bounds.position.y - workArea.position.y) <= EDGE_TOLERANCE_PX &&
    Math.abs(bounds.outerSize.width - workArea.size.width) <= EDGE_TOLERANCE_PX &&
    Math.abs(bounds.outerSize.height - workArea.size.height) <= EDGE_TOLERANCE_PX
  );
}

function frameDelta(bounds: WindowBounds) {
  return {
    width: Math.max(0, bounds.outerSize.width - bounds.innerSize.width),
    height: Math.max(0, bounds.outerSize.height - bounds.innerSize.height),
  };
}

function targetInnerSize(
  bounds: WindowBounds,
  workArea: NonNullable<Monitor["workArea"]>,
) {
  const frame = frameDelta(bounds);
  return new PhysicalSize(
    Math.max(360, workArea.size.width - frame.width),
    Math.max(600, workArea.size.height - frame.height),
  );
}

function centeredRestoreBounds(
  bounds: WindowBounds,
  workArea: NonNullable<Monitor["workArea"]>,
) {
  const frame = frameDelta(bounds);
  const width = Math.min(DEFAULT_RESTORE_WIDTH, workArea.size.width - frame.width);
  const height = Math.min(DEFAULT_RESTORE_HEIGHT, workArea.size.height - frame.height);
  return {
    position: new PhysicalPosition(
      Math.round(workArea.position.x + (workArea.size.width - width - frame.width) / 2),
      Math.round(workArea.position.y + (workArea.size.height - height - frame.height) / 2),
    ),
    innerSize: new PhysicalSize(Math.max(360, width), Math.max(600, height)),
  };
}

async function performNativeZoomIfAvailable() {
  if (!isMacPlatform()) {
    return false;
  }
  try {
    return await performNativeWindowZoom();
  } catch {
    return false;
  }
}

export async function ensureWindowWithinCurrentDisplay(
  windowHandle: WindowHandle | null = currentWindowSafe(),
) {
  if (!windowHandle) {
    return;
  }
  const workArea = workAreaFor(await currentMonitor());
  if (!workArea) {
    return;
  }
  const bounds = await readWindowBounds(windowHandle);
  if (!exceedsWorkArea(bounds, workArea)) {
    return;
  }
  const safeBounds = centeredRestoreBounds(bounds, workArea);
  await windowHandle.setPosition(safeBounds.position);
  await windowHandle.setSize(safeBounds.innerSize);
}

export async function toggleWindowZoomWithinCurrentDisplay(
  windowHandle: WindowHandle | null = currentWindowSafe(),
) {
  if (!windowHandle) {
    return;
  }
  const workArea = workAreaFor(await currentMonitor());
  if (!workArea) {
    if (await performNativeZoomIfAvailable()) {
      restoreBounds = null;
      customZoomed = false;
      return;
    }
    await windowHandle.toggleMaximize();
    return;
  }

  const bounds = await readWindowBounds(windowHandle);
  const nearWorkArea = isNearWorkArea(bounds, workArea);
  const outsideWorkArea = exceedsWorkArea(bounds, workArea);
  if (!nearWorkArea && !outsideWorkArea && await performNativeZoomIfAvailable()) {
    restoreBounds = null;
    customZoomed = false;
    return;
  }
  const nativeMaximized = await windowHandle.isMaximized().catch(() => false);
  const shouldRestore = nativeMaximized || customZoomed || nearWorkArea;

  if (shouldRestore) {
    await windowHandle.unmaximize().catch(() => undefined);
    const nextRestoreBounds = restoreBounds;
    restoreBounds = null;
    customZoomed = false;
    if (nextRestoreBounds) {
      await windowHandle.setPosition(nextRestoreBounds.position);
      await windowHandle.setSize(nextRestoreBounds.innerSize);
      return;
    }
    await ensureWindowWithinCurrentDisplay(windowHandle);
    return;
  }

  restoreBounds = outsideWorkArea
    ? centeredRestoreBounds(bounds, workArea)
    : { position: bounds.position, innerSize: bounds.innerSize };
  customZoomed = true;

  await windowHandle.unmaximize().catch(() => undefined);
  await windowHandle.setPosition(
    new PhysicalPosition(workArea.position.x, workArea.position.y),
  );
  await windowHandle.setSize(targetInnerSize(bounds, workArea));
}
