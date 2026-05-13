import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as Sentry from "@sentry/react";
import { openWorkspaceIn } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { OpenAppTarget } from "../../../types";
import {
  type ParsedFileLocation,
  formatFileLocation,
  toFileUrl,
} from "../../../utils/fileLinks";
import {
  isAbsolutePath,
  joinWorkspacePath,
  revealInFileManagerLabel,
} from "../../../utils/platformPaths";
import { resolveMountedWorkspacePath } from "../utils/mountedWorkspacePaths";

type OpenTarget = {
  id: string;
  label: string;
  appName?: string | null;
  kind: OpenAppTarget["kind"];
  command?: string | null;
  args: string[];
};

type FileLinkMenuItem = {
  id: string;
  text: string;
  enabled?: boolean;
  action?: () => void | Promise<void>;
};

type FileLinkMenuState = {
  x: number;
  y: number;
  items: FileLinkMenuItem[];
};

const DEFAULT_OPEN_TARGET: OpenTarget = {
  id: "vscode",
  label: "VS Code",
  appName: "Visual Studio Code",
  kind: "app",
  command: null,
  args: [],
};

const resolveAppName = (target: OpenTarget) => (target.appName ?? "").trim();
const resolveCommand = (target: OpenTarget) => (target.command ?? "").trim();

const canOpenTarget = (target: OpenTarget) => {
  if (target.kind === "finder") {
    return true;
  }
  if (target.kind === "command") {
    return Boolean(resolveCommand(target));
  }
  return Boolean(resolveAppName(target));
};

function resolveOpenTarget(
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
): OpenTarget {
  return {
    ...DEFAULT_OPEN_TARGET,
    ...(openTargets.find((entry) => entry.id === selectedOpenAppId) ??
      openTargets[0]),
  };
}

function resolveFilePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  if (!workspacePath) {
    return trimmed;
  }
  const mountedWorkspacePath = resolveMountedWorkspacePath(trimmed, workspacePath);
  if (mountedWorkspacePath) {
    return mountedWorkspacePath;
  }
  if (isAbsolutePath(trimmed)) {
    return trimmed;
  }
  return joinWorkspacePath(workspacePath, trimmed);
}

function resolveFileLinkContext(
  fileLocation: ParsedFileLocation,
  workspacePath?: string | null,
) {
  return {
    fileLocation,
    rawPathLabel: formatFileLocation(
      fileLocation.path,
      fileLocation.line,
      fileLocation.column,
    ),
    resolvedPath: resolveFilePath(fileLocation.path, workspacePath),
  };
}

export function useFileLinkOpener(
  workspacePath: string | null,
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
) {
  const [fileLinkMenuState, setFileLinkMenuState] = useState<FileLinkMenuState | null>(null);

  const closeFileLinkMenu = useCallback(() => {
    setFileLinkMenuState(null);
  }, []);

  useEffect(() => {
    if (!fileLinkMenuState) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-file-link-context-menu]")) {
        return;
      }
      closeFileLinkMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFileLinkMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeFileLinkMenu);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeFileLinkMenu);
    };
  }, [closeFileLinkMenu, fileLinkMenuState]);

  const reportOpenError = useCallback(
    (error: unknown, context: Record<string, string | null>) => {
      const message = error instanceof Error ? error.message : String(error);
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          tags: {
            feature: "file-link-open",
          },
          extra: context,
        },
      );
      pushErrorToast({
        title: "Couldn’t open file",
        message,
      });
      console.warn("Failed to open file link", { message, ...context });
    },
    [],
  );

  const openFileLink = useCallback(
    async (targetLocation: ParsedFileLocation) => {
      const target = resolveOpenTarget(openTargets, selectedOpenAppId);
      const { fileLocation, rawPathLabel, resolvedPath } = resolveFileLinkContext(
        targetLocation,
        workspacePath,
      );
      const openLocation = {
        ...(fileLocation.line !== null ? { line: fileLocation.line } : {}),
        ...(fileLocation.column !== null ? { column: fileLocation.column } : {}),
      };

      try {
        if (!canOpenTarget(target)) {
          return;
        }
        if (target.kind === "finder") {
          await revealItemInDir(resolvedPath);
          return;
        }

        if (target.kind === "command") {
          const command = resolveCommand(target);
          if (!command) {
            return;
          }
          await openWorkspaceIn(resolvedPath, {
            command,
            args: target.args,
            ...openLocation,
          });
          return;
        }

        const appName = resolveAppName(target);
        if (!appName) {
          return;
        }
        await openWorkspaceIn(resolvedPath, {
          appName,
          args: target.args,
          ...openLocation,
        });
      } catch (error) {
        reportOpenError(error, {
          rawPath: rawPathLabel,
          resolvedPath,
          workspacePath,
          targetId: target.id,
          targetKind: target.kind,
          targetAppName: target.appName ?? null,
          targetCommand: target.command ?? null,
        });
      }
    },
    [openTargets, reportOpenError, selectedOpenAppId, workspacePath],
  );

  const showFileLinkMenu = useCallback(
    async (event: MouseEvent, targetLocation: ParsedFileLocation) => {
      event.preventDefault();
      event.stopPropagation();
      const target = resolveOpenTarget(openTargets, selectedOpenAppId);
      const { fileLocation, rawPathLabel, resolvedPath } = resolveFileLinkContext(
        targetLocation,
        workspacePath,
      );
      const appName = resolveAppName(target);
      const command = resolveCommand(target);
      const canOpen = canOpenTarget(target);
      const openLabel =
        target.kind === "finder"
          ? revealInFileManagerLabel()
          : target.kind === "command"
            ? command
              ? `Open in ${target.label}`
              : "Set command in Settings"
            : appName
              ? `Open in ${appName}`
              : "Set app name in Settings";
      const items: FileLinkMenuItem[] = [
        {
          id: "open",
          text: openLabel,
          enabled: canOpen,
          action: async () => {
            await openFileLink(fileLocation);
          },
        },
        ...(target.kind === "finder"
          ? []
          : [
              {
                id: "reveal",
                text: revealInFileManagerLabel(),
                action: async () => {
                  try {
                    await revealItemInDir(resolvedPath);
                  } catch (error) {
                    reportOpenError(error, {
                      rawPath: rawPathLabel,
                      resolvedPath,
                      workspacePath,
                      targetId: target.id,
                      targetKind: "finder",
                      targetAppName: null,
                      targetCommand: null,
                    });
                  }
                },
              },
            ]),
        {
          id: "download",
          text: "Download Linked File",
          enabled: false,
        },
        {
          id: "copy-link",
          text: "Copy Link",
          action: async () => {
            const link = toFileUrl(resolvedPath, fileLocation.line, fileLocation.column);
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        },
      ];

      const viewportWidth = typeof window !== "undefined" ? window.innerWidth : event.clientX;
      const viewportHeight = typeof window !== "undefined" ? window.innerHeight : event.clientY;
      const menuX = Math.max(8, Math.min(event.clientX, viewportWidth - 228));
      const menuY = Math.max(8, Math.min(event.clientY, viewportHeight - 132));

      setFileLinkMenuState({
        x: menuX,
        y: menuY,
        items,
      });
    },
    [openFileLink, openTargets, reportOpenError, selectedOpenAppId, workspacePath],
  );

  const fileLinkMenu = useMemo<ReactNode>(() => {
    if (!fileLinkMenuState || typeof document === "undefined") {
      return null;
    }

    const menu = (
      <div
        className="oai-file-link-context-menu ds-popover"
        data-file-link-context-menu
        role="menu"
        style={{ left: fileLinkMenuState.x, top: fileLinkMenuState.y }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {fileLinkMenuState.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="oai-file-link-context-menu-item"
            role="menuitem"
            disabled={item.enabled === false}
            onClick={async () => {
              closeFileLinkMenu();
              await item.action?.();
            }}
          >
            {item.text}
          </button>
        ))}
      </div>
    );

    return createPortal(menu, document.body);
  }, [closeFileLinkMenu, fileLinkMenuState]);

  return { openFileLink, showFileLinkMenu, fileLinkMenu };
}
