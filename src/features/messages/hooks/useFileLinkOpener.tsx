import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as Sentry from "@sentry/react";
import { getGitDiffs, openWorkspaceIn, readWorkspaceFile } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { GitFileDiff } from "../../../types";
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
import { FilePreviewPopover } from "../../files/components/FilePreviewPopover";
import {
  buildFilePreviewDiffInfo,
  type FilePreviewDiffInfo,
} from "../../files/utils/filePreviewDiff";
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

type FileLinkPreviewState = {
  relativePath: string;
  absolutePath: string;
  top: number;
  arrowTop: number;
  height: number;
  width: number;
};

type UseFileLinkOpenerOptions = {
  workspaceId?: string | null;
  previewOnOpen?: boolean;
  openAppIconById?: Record<string, string>;
  onSelectOpenAppId?: (id: string) => void;
};

type OpenFileLinkOptions = {
  forceExternal?: boolean;
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

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

function isImagePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.has(ext);
}

function normalizePathForCompare(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function relativePathFromWorkspace(absolutePath: string, workspacePath: string | null) {
  if (!workspacePath) {
    return null;
  }
  const normalizedAbsolute = normalizePathForCompare(absolutePath);
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  if (!normalizedWorkspace || normalizedAbsolute === normalizedWorkspace) {
    return null;
  }
  const prefix = `${normalizedWorkspace}/`;
  if (!normalizedAbsolute.startsWith(prefix)) {
    return null;
  }
  return normalizedAbsolute.slice(prefix.length);
}

function relativeFileLinkPath(
  fileLocation: ParsedFileLocation,
  workspacePath: string | null,
) {
  const rawPath = fileLocation.path.trim();
  if (!rawPath) {
    return null;
  }
  const mountedPath = resolveMountedWorkspacePath(rawPath, workspacePath);
  if (mountedPath) {
    const relativePath = relativePathFromWorkspace(mountedPath, workspacePath);
    return relativePath ? { relativePath, absolutePath: mountedPath } : null;
  }
  if (workspacePath && isAbsolutePath(rawPath)) {
    const relativePath = relativePathFromWorkspace(rawPath, workspacePath);
    return relativePath ? { relativePath, absolutePath: rawPath } : null;
  }
  if (!isAbsolutePath(rawPath) && !rawPath.startsWith("/")) {
    const relativePath = rawPath.replace(/^\.\//, "");
    return {
      relativePath,
      absolutePath: resolveFilePath(relativePath, workspacePath),
    };
  }
  return null;
}

function findMatchingGitDiff(diffs: GitFileDiff[], relativePath: string) {
  const normalizedRelativePath = normalizePathForCompare(relativePath);
  return diffs.find((diff) => normalizePathForCompare(diff.path) === normalizedRelativePath) ?? null;
}

function buildPreviewAnchor(event?: MouseEvent | null) {
  const padding = 16;
  const preferredWidth = 980;
  const estimatedWidth = Math.min(
    preferredWidth,
    Math.max(360, window.innerWidth - padding * 2),
  );
  const estimatedHeight = 520;
  const maxHeight = Math.min(
    estimatedHeight,
    Math.max(240, window.innerHeight - padding * 2),
  );
  const target = event?.currentTarget instanceof Element ? event.currentTarget : null;
  const rect = target?.getBoundingClientRect();
  const anchorY = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.38;
  const top = Math.min(
    Math.max(padding, anchorY - maxHeight * 0.35),
    Math.max(padding, window.innerHeight - maxHeight - padding),
  );
  const arrowTop = Math.min(
    Math.max(16, anchorY - top),
    Math.max(16, maxHeight - 16),
  );
  return { top, arrowTop, height: maxHeight, width: estimatedWidth };
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
  options: UseFileLinkOpenerOptions = {},
) {
  const [fileLinkMenuState, setFileLinkMenuState] = useState<FileLinkMenuState | null>(null);
  const [filePreviewState, setFilePreviewState] = useState<FileLinkPreviewState | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDiffInfo, setPreviewDiffInfo] = useState<FilePreviewDiffInfo | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{ start: number; end: number } | null>(
    null,
  );
  const workspaceId = options.workspaceId ?? null;
  const previewOnOpen = Boolean(options.previewOnOpen);
  const openAppIconById = options.openAppIconById ?? {};
  const onSelectOpenAppId = options.onSelectOpenAppId ?? (() => {});

  const closeFileLinkMenu = useCallback(() => {
    setFileLinkMenuState(null);
  }, []);
  const closeFilePreview = useCallback(() => {
    setFilePreviewState(null);
    setPreviewContent("");
    setPreviewTruncated(false);
    setPreviewLoading(false);
    setPreviewError(null);
    setPreviewDiffInfo(null);
    setPreviewSelection(null);
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
        closeFilePreview();
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
  }, [closeFileLinkMenu, closeFilePreview, fileLinkMenuState]);

  useEffect(() => {
    if (!filePreviewState || !workspaceId) {
      return undefined;
    }
    let cancelled = false;
    const isImagePreview = isImagePath(filePreviewState.relativePath);
    if (isImagePreview) {
      setPreviewContent("");
      setPreviewTruncated(false);
      setPreviewLoading(false);
      setPreviewError(null);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDiffInfo(null);
    readWorkspaceFile(workspaceId, filePreviewState.relativePath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPreviewContent(response.content ?? "");
        setPreviewTruncated(Boolean(response.truncated));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePreviewState, workspaceId]);

  useEffect(() => {
    if (!filePreviewState || !workspaceId) {
      return undefined;
    }
    let cancelled = false;
    getGitDiffs(workspaceId)
      .then((diffs) => {
        if (cancelled) {
          return;
        }
        const matchingDiff = findMatchingGitDiff(diffs, filePreviewState.relativePath);
        setPreviewDiffInfo(
          matchingDiff ? buildFilePreviewDiffInfo(matchingDiff.diff) : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewDiffInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePreviewState, workspaceId]);

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
    async (
      targetLocation: ParsedFileLocation,
      event?: MouseEvent,
      openOptions: OpenFileLinkOptions = {},
    ) => {
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
        if (previewOnOpen && workspaceId && !openOptions.forceExternal) {
          const previewPath = relativeFileLinkPath(fileLocation, workspacePath);
          if (previewPath) {
            const anchor = buildPreviewAnchor(event);
            const initialLine =
              fileLocation.line && fileLocation.line > 0 ? fileLocation.line - 1 : null;
            setFilePreviewState({
              relativePath: previewPath.relativePath,
              absolutePath: previewPath.absolutePath,
              ...anchor,
            });
            setPreviewSelection(
              initialLine === null ? null : { start: initialLine, end: initialLine },
            );
            closeFileLinkMenu();
            return;
          }
        }
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
    [
      closeFileLinkMenu,
      openTargets,
      previewOnOpen,
      reportOpenError,
      selectedOpenAppId,
      workspaceId,
      workspacePath,
    ],
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
            await openFileLink(fileLocation, undefined, { forceExternal: true });
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

  const fileLinkPreview = useMemo<ReactNode>(() => {
    if (!filePreviewState || typeof document === "undefined") {
      return null;
    }
    const isImagePreview = isImagePath(filePreviewState.relativePath);
    const imageSrc = isImagePreview ? convertFileSrc(filePreviewState.absolutePath) : null;
    const selectionHints = isImagePreview
      ? []
      : ["Shift + click", "for multi-line selection"];
    return createPortal(
      <FilePreviewPopover
        path={filePreviewState.relativePath}
        absolutePath={filePreviewState.absolutePath}
        content={previewContent}
        truncated={previewTruncated}
        previewKind={isImagePreview ? "image" : "text"}
        imageSrc={imageSrc}
        openTargets={openTargets}
        openAppIconById={openAppIconById}
        selectedOpenAppId={selectedOpenAppId}
        onSelectOpenAppId={onSelectOpenAppId}
        selection={previewSelection}
        onSelectLine={(index, event) => {
          if (event.shiftKey && previewSelection) {
            const start = Math.min(previewSelection.start, index);
            const end = Math.max(previewSelection.start, index);
            setPreviewSelection({ start, end });
            return;
          }
          setPreviewSelection({ start: index, end: index });
        }}
        onClearSelection={() => setPreviewSelection(null)}
        onAddSelection={() => {}}
        canInsertText={false}
        onClose={closeFilePreview}
        selectionHints={selectionHints}
        diffInfo={previewDiffInfo}
        style={{
          position: "fixed",
          top: filePreviewState.top,
          left: "50%",
          transform: "translateX(-50%)",
          width: filePreviewState.width,
          maxHeight: filePreviewState.height,
          ["--file-preview-arrow-top" as string]: `${filePreviewState.arrowTop}px`,
          ["--file-preview-arrow-display" as string]: "none",
        }}
        isLoading={previewLoading}
        error={previewError}
      />,
      document.body,
    );
  }, [
    closeFilePreview,
    filePreviewState,
    onSelectOpenAppId,
    openAppIconById,
    openTargets,
    previewContent,
    previewError,
    previewDiffInfo,
    previewLoading,
    previewSelection,
    previewTruncated,
    selectedOpenAppId,
  ]);

  return { openFileLink, showFileLinkMenu, fileLinkMenu, fileLinkPreview };
}
