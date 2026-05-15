import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";

type WindowHandle = ReturnType<typeof getCurrentWindow>;

const EDGE_TOLERANCE_PX = 8;
const DEFAULT_RESTORE_LOGICAL_WIDTH = 1200;
const DEFAULT_RESTORE_LOGICAL_HEIGHT = 700;

type WindowBounds = {
  position: PhysicalPosition;
  innerSize: PhysicalSize;
  outerSize: PhysicalSize;
};

type RestoreBounds = {
  position: PhysicalPosition;
  innerSize: LogicalSize | PhysicalSize;
};

type EnsureWindowBoundsOptions = {
  repairLegacyUnscaledDefault?: boolean;
};

let restoreBounds: RestoreBounds | null = null;
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

function scaleFactorFor(monitor: Monitor | null) {
  return Math.max(1, monitor?.scaleFactor ?? 1);
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
  workArea: NonNullable<Monitor["workArea"]>,
) {
  return new PhysicalSize(
    Math.max(360, workArea.size.width),
    Math.max(600, workArea.size.height),
  );
}

function centeredRestoreBounds(
  bounds: WindowBounds,
  workArea: NonNullable<Monitor["workArea"]>,
  scaleFactor = 1,
): RestoreBounds {
  const frame = frameDelta(bounds);
  const width = Math.min(
    DEFAULT_RESTORE_LOGICAL_WIDTH,
    Math.floor((workArea.size.width - frame.width) / scaleFactor),
  );
  const height = Math.min(
    DEFAULT_RESTORE_LOGICAL_HEIGHT,
    Math.floor((workArea.size.height - frame.height) / scaleFactor),
  );
  const physicalWidth = width * scaleFactor;
  const physicalHeight = height * scaleFactor;
  return {
    position: new PhysicalPosition(
      Math.round(workArea.position.x + (workArea.size.width - physicalWidth - frame.width) / 2),
      Math.round(workArea.position.y + (workArea.size.height - physicalHeight - frame.height) / 2),
    ),
    innerSize: new LogicalSize(Math.max(360, width), Math.max(600, height)),
  };
}

function isLegacyUnscaledDefaultSize(bounds: WindowBounds, scaleFactor: number) {
  if (scaleFactor <= 1) {
    return false;
  }
  return (
    (
      Math.abs(bounds.innerSize.width - DEFAULT_RESTORE_LOGICAL_WIDTH) <= EDGE_TOLERANCE_PX &&
      Math.abs(bounds.innerSize.height - DEFAULT_RESTORE_LOGICAL_HEIGHT) <= EDGE_TOLERANCE_PX
    ) ||
    (
      Math.abs(window.innerWidth * scaleFactor - DEFAULT_RESTORE_LOGICAL_WIDTH) <=
        EDGE_TOLERANCE_PX * scaleFactor &&
      Math.abs(window.innerHeight * scaleFactor - DEFAULT_RESTORE_LOGICAL_HEIGHT) <=
        EDGE_TOLERANCE_PX * scaleFactor
    )
  );
}

export async function ensureWindowWithinCurrentDisplay(
  windowHandle: WindowHandle | null = currentWindowSafe(),
  options: EnsureWindowBoundsOptions = {},
) {
  if (!windowHandle) {
    return;
  }
  const monitor = await currentMonitor();
  const workArea = workAreaFor(monitor);
  if (!workArea) {
    return;
  }
  const bounds = await readWindowBounds(windowHandle);
  const scaleFactor = scaleFactorFor(monitor);
  const shouldRepairLegacySize = options.repairLegacyUnscaledDefault !== false &&
    isLegacyUnscaledDefaultSize(bounds, scaleFactor);
  if (!exceedsWorkArea(bounds, workArea) && !shouldRepairLegacySize) {
    return;
  }
  const safeBounds = centeredRestoreBounds(bounds, workArea, scaleFactor);
  await windowHandle.setPosition(safeBounds.position);
  await windowHandle.setSize(safeBounds.innerSize);
}

export async function toggleWindowZoomWithinCurrentDisplay(
  windowHandle: WindowHandle | null = currentWindowSafe(),
) {
  if (!windowHandle) {
    return;
  }
  const monitor = await currentMonitor();
  const workArea = workAreaFor(monitor);
  if (!workArea) {
    await windowHandle.toggleMaximize();
    return;
  }

  const bounds = await readWindowBounds(windowHandle);
  const scaleFactor = scaleFactorFor(monitor);
  const nearWorkArea = isNearWorkArea(bounds, workArea);
  const outsideWorkArea = exceedsWorkArea(bounds, workArea);
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
    const fallbackRestoreBounds = centeredRestoreBounds(bounds, workArea, scaleFactor);
    await windowHandle.setPosition(fallbackRestoreBounds.position);
    await windowHandle.setSize(fallbackRestoreBounds.innerSize);
    return;
  }

  restoreBounds = outsideWorkArea
    ? centeredRestoreBounds(bounds, workArea, scaleFactor)
    : { position: bounds.position, innerSize: bounds.innerSize };
  customZoomed = true;

  await windowHandle.unmaximize().catch(() => undefined);
  await windowHandle.setPosition(
    new PhysicalPosition(workArea.position.x, workArea.position.y),
  );
  await windowHandle.setSize(targetInnerSize(workArea));
}
