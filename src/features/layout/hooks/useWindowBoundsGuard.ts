import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureWindowWithinCurrentDisplay } from "../utils/windowZoom";

function currentWindowSafe() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function useWindowBoundsGuard() {
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    const windowHandle = currentWindowSafe();
    if (!windowHandle) {
      return;
    }
    let mounted = true;
    let timeoutId: number | null = null;
    let startupTimeoutIds: number[] = [];
    let unlistenResized: (() => void) | null = null;
    let unlistenMoved: (() => void) | null = null;

    const ensureBounds = (repairLegacyUnscaledDefault = true) => {
      void ensureWindowWithinCurrentDisplay(
        windowHandle,
        {
          repairLegacyUnscaledDefault,
          repairOutOfBounds: repairLegacyUnscaledDefault,
        },
      ).catch(() => {
        // Window bounds are best-effort; startup should not fail on platform quirks.
      });
    };

    const scheduleEnsureBounds = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        ensureBounds(false);
      }, 80);
    };

    ensureBounds();
    startupTimeoutIds = [150, 600].map((delayMs) =>
      window.setTimeout(() => {
        ensureBounds();
      }, delayMs),
    );
    void windowHandle.onResized(scheduleEnsureBounds).then((unlisten) => {
      if (!mounted) {
        unlisten();
        return;
      }
      unlistenResized = unlisten;
    }).catch(() => {
      // Window bounds are best-effort; startup should not fail on platform quirks.
    });

    void windowHandle.onMoved(scheduleEnsureBounds).then((unlisten) => {
      if (!mounted) {
        unlisten();
        return;
      }
      unlistenMoved = unlisten;
    }).catch(() => {
      // Window bounds are best-effort; startup should not fail on platform quirks.
    });

    return () => {
      mounted = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      startupTimeoutIds.forEach((id) => window.clearTimeout(id));
      startupTimeoutIds = [];
      unlistenResized?.();
      unlistenMoved?.();
    };
  }, []);
}
