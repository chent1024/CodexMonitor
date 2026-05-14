import { useLayoutEffect, useMemo, useRef } from "react";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { parseDiff } from "../../../utils/diff";
import { highlightLine, languageFromPath } from "../../../utils/syntax";
import { workerFactory } from "../../../utils/diffsWorker";
import {
  DIFF_VIEWER_HIGHLIGHTER_OPTIONS,
  DIFF_VIEWER_SCROLL_CSS,
} from "../../design-system/diff/diffViewerTheme";
import {
  isFallbackRawDiffLineHighlightable,
  limitRenderedDiff,
  normalizePatchName,
  parseRawDiffLines,
} from "./GitDiffViewer.utils";

type PierreDiffBlockProps = {
  diff: string;
  displayPath: string;
  oldLines?: string[];
  newLines?: string[];
  diffStyle?: "split" | "unified";
};

const HUNK_ONLY_DIFF_REGEX = /(^|\n)@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const FILE_CHANGE_GUTTER_CSS = `
[data-file-change-gutter] {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
}

[data-file][data-file-change-gutter-visible] [data-column-number] {
  position: relative;
}

[data-file-change-gutter-marker] {
  --codex-file-change-gutter-width: 4px;
  position: absolute;
  left: 0;
  width: var(--codex-file-change-gutter-width);
}

[data-file-change-placement="line"][data-file-change-run-start] {
  border-start-start-radius: 999px;
  border-start-end-radius: 999px;
}

[data-file-change-placement="line"][data-file-change-run-end] {
  border-end-start-radius: 999px;
  border-end-end-radius: 999px;
}

[data-file-change-kind="addition"],
[data-file-change-kind="modification"] {
  top: 0;
  bottom: 0;
}

[data-file-change-kind="addition"] {
  background: var(--diffs-addition-color-override);
}

[data-file-change-kind="modification"] {
  background: var(--color-token-git-decoration-modified-resource-foreground, var(--diffs-addition-color-override));
}

[data-file-change-kind="deletion"] {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 6px;
  border-color: transparent transparent transparent var(--diffs-deletion-color-override);
  border-radius: 0;
}

[data-file-change-kind="deletion"][data-file-change-placement="before"] {
  top: -5px;
}

[data-file-change-kind="deletion"][data-file-change-placement="after"] {
  bottom: -5px;
}
`;

type RenderedFileChangeGutterMarker = {
  kind: "addition" | "modification" | "deletion";
  lineNumber: number;
  placement: "line" | "before" | "after";
};

function buildParseablePatch(diff: string, displayPath: string) {
  if (/^diff --git /m.test(diff) || /^---\s+/m.test(diff)) {
    return diff;
  }

  if (!HUNK_ONLY_DIFF_REGEX.test(diff)) {
    return diff;
  }

  const normalizedPath = normalizePatchName(displayPath);
  const body = diff.endsWith("\n") ? diff : `${diff}\n`;
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    body,
  ].join("\n");
}

function buildDeletionMarker(
  hunk: FileDiffMetadata["hunks"][number],
  lineNumber: number,
): RenderedFileChangeGutterMarker {
  const lastAdditionLine = hunk.additionStart + hunk.additionCount - 1;
  if (lineNumber <= lastAdditionLine || lineNumber <= 1) {
    return {
      kind: "deletion",
      lineNumber: Math.max(lineNumber, 1),
      placement: "before",
    };
  }

  return {
    kind: "deletion",
    lineNumber: Math.max(lineNumber - 1, 1),
    placement: "after",
  };
}

export function buildFileChangeGutterLineMap(
  fileDiff: FileDiffMetadata | null,
): Map<number, RenderedFileChangeGutterMarker[]> {
  if (!fileDiff) {
    return new Map();
  }

  const markers = new Map<number, RenderedFileChangeGutterMarker[]>();
  const pushMarker = (marker: RenderedFileChangeGutterMarker) => {
    const existing = markers.get(marker.lineNumber);
    if (existing) {
      existing.push(marker);
      return;
    }
    markers.set(marker.lineNumber, [marker]);
  };

  for (const hunk of fileDiff.hunks) {
    let lineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        lineNumber += content.lines.length;
        continue;
      }

      if (content.additions.length > 0) {
        const kind =
          content.deletions.length > 0 ? "modification" : "addition";

        for (let index = 0; index < content.additions.length; index += 1) {
          pushMarker({
            kind,
            lineNumber: lineNumber + index,
            placement: "line",
          });
        }
      } else if (content.deletions.length > 0) {
        pushMarker(buildDeletionMarker(hunk, lineNumber));
      }

      lineNumber += content.additions.length;
    }
  }

  return markers;
}

function resolveRenderedLineNumber(element: HTMLElement): number | null {
  const lineNumber =
    element.dataset.columnNumber ??
    element.closest("[data-line]")?.getAttribute("data-line") ??
    element.querySelector("[data-line-number-content]")?.textContent ??
    null;
  if (!lineNumber) {
    return null;
  }

  const parsed = Number.parseInt(lineNumber, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getOrCreateFileChangeGutter(element: HTMLElement) {
  const existing = element.querySelector<HTMLElement>("[data-file-change-gutter]");
  if (existing) {
    return existing;
  }

  const gutter = document.createElement("span");
  gutter.dataset.fileChangeGutter = "";
  gutter.setAttribute("aria-hidden", "true");
  element.prepend(gutter);
  return gutter;
}

function clearFileChangeGutter(element: HTMLElement) {
  element.querySelector("[data-file-change-gutter]")?.remove();
}

function applyFileChangeGutters(
  shadowRoot: ShadowRoot,
  lineMarkers: Map<number, RenderedFileChangeGutterMarker[]>,
) {
  const fileRoot = shadowRoot.querySelector<HTMLElement>("[data-file]");
  if (!fileRoot) {
    return;
  }

  const columns = fileRoot.querySelectorAll<HTMLElement>("[data-column-number]");
  columns.forEach((column) => {
    const lineNumber = resolveRenderedLineNumber(column);
    const markers = lineNumber === null ? undefined : lineMarkers.get(lineNumber);
    if (!markers || markers.length === 0) {
      clearFileChangeGutter(column);
      return;
    }

    const gutter = getOrCreateFileChangeGutter(column);
    gutter.replaceChildren(
      ...markers.map((marker) => {
        const node = document.createElement("span");
        node.dataset.fileChangeGutterMarker = "";
        node.dataset.fileChangeKind = marker.kind;
        node.dataset.fileChangePlacement = marker.placement;

        if (marker.placement === "line" && lineNumber !== null) {
          const previousMarkers = lineMarkers.get(lineNumber - 1) ?? [];
          const nextMarkers = lineMarkers.get(lineNumber + 1) ?? [];
          const hasPreviousRun = previousMarkers.some(
            (candidate) =>
              candidate.placement === "line" && candidate.kind === marker.kind,
          );
          const hasNextRun = nextMarkers.some(
            (candidate) =>
              candidate.placement === "line" && candidate.kind === marker.kind,
          );

          if (!hasPreviousRun) {
            node.dataset.fileChangeRunStart = "";
          }
          if (!hasNextRun) {
            node.dataset.fileChangeRunEnd = "";
          }
        }

        node.setAttribute("aria-hidden", "true");
        return node;
      }),
    );
  });

  fileRoot.toggleAttribute("data-file-change-gutter-visible", lineMarkers.size > 0);
}

export function PierreDiffBlock({
  diff,
  displayPath,
  oldLines,
  newLines,
  diffStyle = "unified",
}: PierreDiffBlockProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const poolOptions = useMemo(() => ({ workerFactory }), []);
  const highlighterOptions = useMemo(
    () => DIFF_VIEWER_HIGHLIGHTER_OPTIONS,
    [],
  );
  const limitedDiff = useMemo(() => limitRenderedDiff(diff), [diff]);

  const fileDiff = useMemo(() => {
    if (!limitedDiff.diff.trim() || limitedDiff.isTruncated) {
      return null;
    }
    const patch = parsePatchFiles(buildParseablePatch(limitedDiff.diff, displayPath));
    const parsed = patch[0]?.files[0];
    if (!parsed) {
      return null;
    }
    const normalizedName = normalizePatchName(parsed.name || displayPath);
    const normalizedPrevName = parsed.prevName
      ? normalizePatchName(parsed.prevName)
      : undefined;

    return {
      ...parsed,
      name: normalizedName,
      prevName: normalizedPrevName,
      oldLines,
      newLines,
    } satisfies FileDiffMetadata;
  }, [displayPath, limitedDiff.diff, limitedDiff.isTruncated, newLines, oldLines]);

  const parsedLines = useMemo(() => {
    const parsed = parseDiff(limitedDiff.diff);
    if (parsed.length > 0) {
      return parsed;
    }
    return parseRawDiffLines(limitedDiff.diff);
  }, [limitedDiff.diff]);
  const fallbackLanguage = useMemo(
    () => languageFromPath(displayPath),
    [displayPath],
  );
  const fileChangeLineMarkers = useMemo(
    () => buildFileChangeGutterLineMap(fileDiff),
    [fileDiff],
  );

  const diffOptions = useMemo(
    () => ({
      diffStyle,
      hunkSeparators: "line-info" as const,
      overflow: "scroll" as const,
      unsafeCSS: `${DIFF_VIEWER_SCROLL_CSS}\n${FILE_CHANGE_GUTTER_CSS}`,
      disableFileHeader: true,
    }),
    [diffStyle],
  );

  useLayoutEffect(() => {
    if (!fileDiff || fileChangeLineMarkers.size === 0) {
      return;
    }

    let shadowObserver: MutationObserver | null = null;
    let hostObserver: MutationObserver | null = null;

    const mountGutters = () => {
      const host = wrapperRef.current?.querySelector("diffs-container") as
        | (HTMLElement & { shadowRoot: ShadowRoot | null })
        | null;
      const shadowRoot = host?.shadowRoot;
      if (!shadowRoot) {
        return false;
      }

      const apply = () => {
        applyFileChangeGutters(shadowRoot, fileChangeLineMarkers);
      };

      apply();
      shadowObserver?.disconnect();
      shadowObserver = new MutationObserver(() => {
        apply();
      });
      shadowObserver.observe(shadowRoot, {
        childList: true,
        subtree: true,
      });
      return true;
    };

    if (!mountGutters() && wrapperRef.current) {
      hostObserver = new MutationObserver(() => {
        if (mountGutters()) {
          hostObserver?.disconnect();
          hostObserver = null;
        }
      });
      hostObserver.observe(wrapperRef.current, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      shadowObserver?.disconnect();
      hostObserver?.disconnect();
    };
  }, [fileChangeLineMarkers, fileDiff]);

  if (!diff.trim()) {
    return <div className="diff-viewer-placeholder">Diff unavailable.</div>;
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {fileDiff ? (
        <div className="diff-viewer-output diff-viewer-output-flat" ref={wrapperRef}>
          <FileDiff
            fileDiff={fileDiff}
            options={diffOptions}
            style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
          />
        </div>
      ) : (
        <div className="diff-viewer-output diff-viewer-output-flat diff-viewer-output-raw">
          {limitedDiff.isTruncated ? (
            <div className="diff-viewer-placeholder">
              Showing first {parsedLines.length} of {limitedDiff.totalLines} diff lines.
              {` ${limitedDiff.hiddenLines} lines hidden for performance.`}
            </div>
          ) : null}
          {parsedLines.map((line, index) => {
            const highlighted = highlightLine(
              line.text,
              isFallbackRawDiffLineHighlightable(line.type)
                ? fallbackLanguage
                : null,
            );

            return (
              <div
                key={index}
                className={`diff-viewer-raw-line diff-viewer-raw-line-${line.type}`}
              >
                <span
                  className="diff-line-content"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </div>
            );
          })}
        </div>
      )}
    </WorkerPoolContextProvider>
  );
}
