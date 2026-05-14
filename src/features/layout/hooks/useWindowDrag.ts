import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toggleWindowZoomWithinCurrentDisplay } from "../utils/windowZoom";

const DRAG_START_THRESHOLD_PX = 4;

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

export function useWindowDrag(targetId: string) {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let dragCandidate: { x: number; y: number } | null = null;

    const dragZoneSelectors = [
      `#${targetId}`,
      ".main-topbar-left",
      ".workspace-header",
      ".sidebar-drag-strip",
      ".right-panel-drag-strip",
    ] as const;

    const handleMouseDown = (event: MouseEvent) => {
      if (isNeverDragTarget(event)) {
        dragCandidate = null;
        return;
      }
      if (!isInsideAnyDragZone(event.clientX, event.clientY, dragZoneSelectors)) {
        dragCandidate = null;
        return;
      }
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
      if (!isInsideAnyDragZone(event.clientX, event.clientY, dragZoneSelectors)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void toggleWindowZoomWithinCurrentDisplay().catch(() => {
        // Ignore platform-specific window manager failures.
      });
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
