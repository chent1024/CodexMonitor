import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { performNativeWindowZoom } from "@services/tauri";
import { isLinuxPlatform, isMacPlatform } from "@utils/platformPaths";
import { toggleWindowZoomWithinCurrentDisplay } from "../utils/windowZoom";

const DRAG_START_THRESHOLD_PX = 4;
const DOUBLE_CLICK_MAX_INTERVAL_MS = 500;
const DOUBLE_CLICK_MAX_DISTANCE_PX = 6;
const FALLBACK_TOP_CHROME_HEIGHT_PX = 44;

const NEVER_DRAG_TARGET_SELECTOR = [
  "button",
  "a",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[data-tauri-drag-region="false"]',
  "input",
  "textarea",
  "select",
  "option",
  '[contenteditable="true"]',
  ".thread-row",
  ".workspace-row",
  ".worktree-row",
  ".sidebar-resizer",
  ".right-panel-resizer",
  ".content-split-resizer",
  ".right-panel-divider",
  ".actions",
  ".main-header-actions",
  ".titlebar-controls",
].join(",");

function startDraggingSafe() {
  try {
    void getCurrentWindow().startDragging();
  } catch {
    // Ignore non-Tauri runtimes (tests/browser).
  }
}

function isNeverDragTarget(event: MouseEvent) {
  if (event.button !== 0) {
    return true;
  }
  const targetNode = event.target;
  const target =
    targetNode instanceof Element
      ? targetNode
      : targetNode instanceof Node
        ? targetNode.parentElement
        : null;
  if (!target) {
    return true;
  }
  return Boolean(target.closest(NEVER_DRAG_TARGET_SELECTOR));
}

function isInsideRect(clientX: number, clientY: number, rect: DOMRect) {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function isInsideAnyDragZone(
  clientX: number,
  clientY: number,
  dragZoneSelectors: readonly string[],
) {
  for (const selector of dragZoneSelectors) {
    const zoneElements = document.querySelectorAll<HTMLElement>(selector);
    for (const zone of zoneElements) {
      const rect = zone.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      if (isInsideRect(clientX, clientY, rect)) {
        return true;
      }
    }
  }
  return false;
}

function parsePixelValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function topChromeBandHeight() {
  const app = document.querySelector<HTMLElement>(".app");
  if (!app) {
    return FALLBACK_TOP_CHROME_HEIGHT_PX;
  }
  const styles = window.getComputedStyle(app);
  return (
    parsePixelValue(styles.getPropertyValue("--window-drag-hit-height")) ??
    parsePixelValue(styles.getPropertyValue("--main-topbar-height")) ??
    FALLBACK_TOP_CHROME_HEIGHT_PX
  );
}

function isInsideTopChromeBand(clientX: number, clientY: number) {
  const width = document.documentElement.clientWidth || window.innerWidth;
  return (
    clientX >= 0 &&
    clientX <= width &&
    clientY >= 0 &&
    clientY <= topChromeBandHeight()
  );
}

function isInsideWindowDragSurface(
  clientX: number,
  clientY: number,
  dragZoneSelectors: readonly string[],
) {
  return (
    isInsideAnyDragZone(clientX, clientY, dragZoneSelectors) ||
    isInsideTopChromeBand(clientX, clientY)
  );
}

function isNearPreviousClick(
  previous: { x: number; y: number; time: number },
  event: MouseEvent,
) {
  return (
    event.timeStamp - previous.time <= DOUBLE_CLICK_MAX_INTERVAL_MS &&
    Math.abs(event.clientX - previous.x) <= DOUBLE_CLICK_MAX_DISTANCE_PX &&
    Math.abs(event.clientY - previous.y) <= DOUBLE_CLICK_MAX_DISTANCE_PX
  );
}

export function useWindowDrag(targetId: string) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let dragCandidate: { x: number; y: number } | null = null;
    let lastClick: { x: number; y: number; time: number } | null = null;
    let suppressNextDoubleClick = false;

    const dragZoneSelectors = [
      `#${targetId}`,
      ".main-topbar-left",
      ".workspace-header",
      ".sidebar-drag-strip",
      ".right-panel-drag-strip",
    ] as const;

    const toggleWindowZoomSafe = () => {
      if (isLinuxPlatform()) {
        return;
      }
      const toggleWithinDisplay = () =>
        toggleWindowZoomWithinCurrentDisplay().catch(() => {
          // Ignore platform-specific window manager failures.
        });
      if (!isMacPlatform()) {
        void toggleWithinDisplay();
        return;
      }
      void performNativeWindowZoom()
        .then((handled) => {
          if (!handled) {
            return toggleWithinDisplay();
          }
          return undefined;
        })
        .catch(() => toggleWithinDisplay());
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (isNeverDragTarget(event)) {
        dragCandidate = null;
        lastClick = null;
        return;
      }
      if (!isInsideWindowDragSurface(event.clientX, event.clientY, dragZoneSelectors)) {
        dragCandidate = null;
        lastClick = null;
        return;
      }

      const isRepeatedClick = event.detail >= 2 || (lastClick && isNearPreviousClick(lastClick, event));
      if (isRepeatedClick && isLinuxPlatform()) {
        dragCandidate = null;
        lastClick = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (isRepeatedClick) {
        dragCandidate = null;
        lastClick = null;
        event.preventDefault();
        event.stopPropagation();
        if (isMacPlatform()) {
          suppressNextDoubleClick = false;
          return;
        }
        suppressNextDoubleClick = true;
        toggleWindowZoomSafe();
        return;
      }

      lastClick = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      dragCandidate = { x: event.clientX, y: event.clientY };
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragCandidate) {
        return;
      }
      if ((event.buttons & 1) !== 1) {
        dragCandidate = null;
        return;
      }
      const deltaX = Math.abs(event.clientX - dragCandidate.x);
      const deltaY = Math.abs(event.clientY - dragCandidate.y);
      if (
        deltaX < DRAG_START_THRESHOLD_PX &&
        deltaY < DRAG_START_THRESHOLD_PX
      ) {
        return;
      }
      dragCandidate = null;
      event.preventDefault();
      startDraggingSafe();
    };

    const handleMouseUp = () => {
      dragCandidate = null;
    };

    const handleDoubleClick = (event: MouseEvent) => {
      dragCandidate = null;
      if (isNeverDragTarget(event)) {
        return;
      }
      if (!isInsideWindowDragSurface(event.clientX, event.clientY, dragZoneSelectors)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (suppressNextDoubleClick) {
        suppressNextDoubleClick = false;
        return;
      }
      if (isLinuxPlatform()) {
        return;
      }
      toggleWindowZoomSafe();
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("dblclick", handleDoubleClick, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("dblclick", handleDoubleClick, true);
    };
  }, [targetId]);
}
