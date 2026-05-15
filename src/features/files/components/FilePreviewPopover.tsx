import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import X from "lucide-react/dist/esm/icons/x";
import { highlightLine, languageFromPath } from "../../../utils/syntax";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import { PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";
import type { OpenAppTarget } from "../../../types";
import type { FilePreviewDiffInfo } from "../utils/filePreviewDiff";

type FilePreviewPopoverProps = {
  path: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
  previewKind?: "text" | "image";
  imageSrc?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  selection: { start: number; end: number } | null;
  onSelectLine: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseDown?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseEnter?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseUp?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onClearSelection: () => void;
  onAddSelection: () => void;
  canInsertText?: boolean;
  onClose: () => void;
  selectionHints?: string[];
  diffInfo?: FilePreviewDiffInfo | null;
  style?: CSSProperties;
  isLoading?: boolean;
  error?: string | null;
};

export function FilePreviewPopover({
  path,
  absolutePath,
  content,
  truncated,
  previewKind = "text",
  imageSrc = null,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  selection,
  onSelectLine,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseUp,
  onClearSelection,
  onAddSelection,
  canInsertText = true,
  onClose,
  selectionHints = [],
  diffInfo = null,
  style,
  isLoading = false,
  error = null,
}: FilePreviewPopoverProps) {
  const linesRef = useRef<HTMLDivElement | null>(null);
  const [pathCopied, setPathCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenStyle, setFullscreenStyle] = useState<CSSProperties | null>(null);
  const isImagePreview = previewKind === "image";
  const lines = useMemo(
    () => (isImagePreview ? [] : content.split("\n")),
    [content, isImagePreview],
  );
  const language = useMemo(() => languageFromPath(path), [path]);
  const selectionLabel = selection
    ? `Lines ${selection.start + 1}-${selection.end + 1}`
    : isImagePreview
      ? "Image preview"
      : "No selection";
  const highlightedLines = useMemo(
    () =>
      isImagePreview
        ? []
        : lines.map((line) => {
            const html = highlightLine(line, language);
            return html || "&nbsp;";
          }),
    [lines, language, isImagePreview],
  );
  const firstChangeTarget = useMemo(() => {
    if (!diffInfo) {
      return null;
    }

    const lineTargets = Array.from(diffInfo.lineMarkers.keys()).map((lineIndex) => ({
      kind: "line" as const,
      lineIndex,
    }));
    const deletionTargets = diffInfo.deletionMarkers.map((marker) => ({
      kind: "deletion" as const,
      lineIndex: marker.lineIndex,
    }));
    const [firstTarget] = [...lineTargets, ...deletionTargets].sort((a, b) => {
      if (a.lineIndex !== b.lineIndex) {
        return a.lineIndex - b.lineIndex;
      }
      return a.kind === "deletion" ? -1 : 1;
    });
    return firstTarget ?? null;
  }, [diffInfo]);

  useLayoutEffect(() => {
    if (isLoading || error || isImagePreview || !firstChangeTarget) {
      return;
    }

    const container = linesRef.current;
    const target = linesRef.current?.querySelector<HTMLElement>(
      "[data-file-preview-first-change]",
    );
    if (!container || !target) {
      return;
    }

    const targetTop = target.offsetTop - container.offsetTop;
    const targetLeft = target.offsetLeft - container.offsetLeft;
    container.scrollTop = Math.max(
      0,
      targetTop - (container.clientHeight - target.clientHeight) / 2,
    );
    container.scrollLeft = Math.max(
      0,
      targetLeft - (container.clientWidth - target.clientWidth) / 2,
    );
    target.scrollIntoView?.({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  }, [error, firstChangeTarget, isImagePreview, isLoading]);

  useLayoutEffect(() => {
    if (!isFullscreen) {
      setFullscreenStyle(null);
      return undefined;
    }

    const updateFullscreenStyle = () => {
      const contentTarget =
        document.querySelector<HTMLElement>(".content-layer.is-active") ??
        document.querySelector<HTMLElement>(".content") ??
        document.body;
      const rect = contentTarget.getBoundingClientRect();
      const fallbackWidth = window.innerWidth || 1024;
      const fallbackHeight = window.innerHeight || 768;
      const left = rect.width > 0 ? rect.left : 0;
      const top = rect.height > 0 ? rect.top : 0;
      const width = Math.max(360, rect.width > 0 ? rect.width : fallbackWidth);
      const height = Math.max(240, rect.height > 0 ? rect.height : fallbackHeight);

      setFullscreenStyle({
        position: "fixed",
        top,
        left,
        width,
        height,
        maxWidth: "none",
        minWidth: 0,
        maxHeight: "none",
        transform: "none",
        ["--file-preview-arrow-display" as string]: "none",
      });
    };

    updateFullscreenStyle();
    window.addEventListener("resize", updateFullscreenStyle);
    return () => {
      window.removeEventListener("resize", updateFullscreenStyle);
    };
  }, [isFullscreen]);

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(absolutePath || path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1200);
    } catch {
      setPathCopied(false);
    }
  };
  const surfaceStyle = isFullscreen ? { ...style, ...fullscreenStyle } : style;

  return (
    <PopoverSurface
      className={`file-preview-popover${isFullscreen ? " is-fullscreen" : ""}`}
      style={surfaceStyle}
    >
      <div className="file-preview-header">
        <div className="file-preview-heading">
          <div className="file-preview-title">
            <span className="file-preview-path">{path}</span>
            <button
              type="button"
              className="icon-button file-preview-copy-path"
              onClick={handleCopyPath}
              aria-label="Copy file path"
              title="Copy file path"
            >
              {pathCopied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            </button>
            {truncated && (
              <span className="file-preview-warning">Truncated</span>
            )}
          </div>
          {!isLoading && !error && (
            <div className="file-preview-selection-group">
              <span className="file-preview-selection">{selectionLabel}</span>
              {diffInfo ? (
                <span className="file-preview-diff-summary" aria-label="Current Git diff">
                  {diffInfo.additions > 0 ? (
                    <span className="file-preview-diff-stat file-preview-diff-stat--add">
                      +{diffInfo.additions}
                    </span>
                  ) : null}
                  {diffInfo.deletions > 0 ? (
                    <span className="file-preview-diff-stat file-preview-diff-stat--del">
                      -{diffInfo.deletions}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {!isImagePreview && selectionHints.length > 0 ? (
                <div className="file-preview-hints" aria-label="Selection hints">
                  {selectionHints.map((hint) => (
                    <span key={hint} className="file-preview-hint">
                      {hint}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="file-preview-actions" role="toolbar" aria-label="File preview actions">
          {!isLoading && !error && (
            <OpenAppMenu
              path={absolutePath}
              openTargets={openTargets}
              selectedOpenAppId={selectedOpenAppId}
              onSelectOpenAppId={onSelectOpenAppId}
              iconById={openAppIconById}
            />
          )}
          {!isLoading && !error && !isImagePreview && (
            <>
              <button
                type="button"
                className="ghost file-preview-action"
                onClick={onClearSelection}
                disabled={!selection}
              >
                Clear
              </button>
              {canInsertText ? (
                <button
                  type="button"
                  className="primary file-preview-action file-preview-action--add"
                  onClick={onAddSelection}
                  disabled={!selection}
                >
                  Add to chat
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            className="icon-button file-preview-fullscreen"
            onClick={() => setIsFullscreen((current) => !current)}
            aria-label={isFullscreen ? "Restore preview" : "Expand preview"}
            title={isFullscreen ? "Restore preview" : "Expand preview"}
          >
            {isFullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
          </button>
          <button
            type="button"
            className="icon-button file-preview-close"
            onClick={onClose}
            aria-label="Close preview"
            title="Close preview"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="file-preview-status">Loading file...</div>
      ) : error ? (
        <div className="file-preview-status file-preview-error">{error}</div>
      ) : isImagePreview ? (
        <div className="file-preview-body file-preview-body--image">
          {imageSrc ? (
            <div className="file-preview-image">
              <img src={imageSrc} alt={path} />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error">
              Image preview unavailable.
            </div>
          )}
        </div>
      ) : (
        <div className="file-preview-body">
          <div className="file-preview-lines" role="list" ref={linesRef}>
            {lines.map((_, index) => {
              const html = highlightedLines[index] ?? "&nbsp;";
              const diffLineKind = diffInfo?.lineMarkers.get(index) ?? null;
              const deletionMarker = diffInfo?.deletionMarkers.find(
                (marker) => marker.lineIndex === index,
              );
              const isSelected =
                selection &&
                index >= selection.start &&
                index <= selection.end;
              const isStart = isSelected && selection?.start === index;
              const isEnd = isSelected && selection?.end === index;
              return (
                <div className="file-preview-line-wrap" key={`line-${index}`}>
                  {deletionMarker ? (
                    <div
                      className="file-preview-deletion-marker"
                      data-file-preview-first-change={
                        firstChangeTarget?.kind === "deletion" &&
                        firstChangeTarget.lineIndex === index
                          ? "true"
                          : undefined
                      }
                    >
                      <span className="file-preview-line-number" aria-hidden />
                      <span className="file-preview-deletion-text">
                        -{deletionMarker.count} deleted line
                        {deletionMarker.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={`file-preview-line${
                      isSelected ? " is-selected" : ""
                    }${isStart ? " is-start" : ""}${isEnd ? " is-end" : ""}${
                      diffLineKind ? ` is-diff-${diffLineKind}` : ""
                    }`}
                    onClick={(event) => onSelectLine(index, event)}
                    onMouseDown={(event) => onLineMouseDown?.(index, event)}
                    onMouseEnter={(event) => onLineMouseEnter?.(index, event)}
                    onMouseUp={(event) => onLineMouseUp?.(index, event)}
                    data-file-preview-first-change={
                      firstChangeTarget?.kind === "line" &&
                      firstChangeTarget.lineIndex === index
                        ? "true"
                        : undefined
                    }
                  >
                    <span className="file-preview-line-number">{index + 1}</span>
                    <span
                      className="file-preview-line-text"
                      dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
                    />
                  </button>
                </div>
              );
            })}
            {diffInfo?.deletionMarkers
              .filter((marker) => marker.lineIndex >= lines.length)
              .map((marker) => (
                <div
                  className="file-preview-deletion-marker"
                  key={`deleted-after-${marker.lineIndex}`}
                  data-file-preview-first-change={
                    firstChangeTarget?.kind === "deletion" &&
                    firstChangeTarget.lineIndex === marker.lineIndex
                      ? "true"
                      : undefined
                  }
                >
                  <span className="file-preview-line-number" aria-hidden />
                  <span className="file-preview-deletion-text">
                    -{marker.count} deleted line{marker.count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </PopoverSurface>
  );
}
