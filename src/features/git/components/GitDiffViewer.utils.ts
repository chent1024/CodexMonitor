import type { ParsedDiffLine } from "../../../utils/diff";
import type { DiffStats, GitDiffViewerItem } from "./GitDiffViewer.types";

const DIFF_METADATA_PREFIXES = [
  "+++",
  "---",
  "diff --git",
  "@@",
  "index ",
  "\\ No newline",
] as const;

export const MAX_RENDERED_DIFF_LINES = 1_500;
const HUNK_ONLY_DIFF_REGEX = /(^|\n)@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const PATCH_HEADER_REGEX = /^diff --git /m;
const PATCH_FILE_HEADER_REGEX = /^---\s+/m;

export type LimitedDiffPreview = {
  diff: string;
  totalLines: number;
  hiddenLines: number;
  isTruncated: boolean;
};

export function normalizePatchName(name: string) {
  if (!name) {
    return name;
  }
  return name.replace(/^(?:a|b)\//, "");
}

export function isRawAddedFileChange(changeKind?: string | null) {
  const normalized = (changeKind ?? "").trim().toLowerCase();
  return (
    normalized === "a" ||
    normalized === "??" ||
    normalized === "add" ||
    normalized === "added" ||
    normalized === "create" ||
    normalized === "created" ||
    normalized === "new" ||
    normalized === "untracked"
  );
}

export function hasParseablePatchHeader(diff: string) {
  return PATCH_HEADER_REGEX.test(diff) || PATCH_FILE_HEADER_REGEX.test(diff);
}

export function hasPatchHunkHeader(diff: string) {
  return HUNK_ONLY_DIFF_REGEX.test(diff);
}

export function countRawContentLines(diff: string) {
  const normalized = diff.endsWith("\n") ? diff.slice(0, -1) : diff;
  return normalized ? normalized.split(/\r?\n/).length : 0;
}

function splitRawFileContentLines(content: string) {
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!normalized) {
    return [];
  }
  return normalized.split(/\r?\n/);
}

function buildAddedFilePatch(diff: string, displayPath: string) {
  const normalizedPath = normalizePatchName(displayPath);
  const lines = splitRawFileContentLines(diff);
  const body = lines.map((line) => `+${line}`);

  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...body,
  ].join("\n");
}

function buildParseablePatch(diff: string, displayPath: string) {
  if (hasParseablePatchHeader(diff)) {
    return diff;
  }

  if (!hasPatchHunkHeader(diff)) {
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

export function buildRenderablePatch(
  diff: string,
  displayPath: string,
  changeKind?: string | null,
) {
  if (
    isRawAddedFileChange(changeKind) &&
    diff.trim() &&
    !hasParseablePatchHeader(diff) &&
    !hasPatchHunkHeader(diff)
  ) {
    return buildAddedFilePatch(diff, displayPath);
  }

  return buildParseablePatch(diff, displayPath);
}

export function limitRenderedDiff(
  diff: string,
  maxLines = MAX_RENDERED_DIFF_LINES,
): LimitedDiffPreview {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) {
    return {
      diff,
      totalLines: lines.length,
      hiddenLines: 0,
      isTruncated: false,
    };
  }

  return {
    diff: lines.slice(0, maxLines).join("\n"),
    totalLines: lines.length,
    hiddenLines: lines.length - maxLines,
    isTruncated: true,
  };
}

export function parseRawDiffLines(diff: string): ParsedDiffLine[] {
  return diff
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return {
          type: "add",
          oldLine: null,
          newLine: null,
          text: line.slice(1),
        } satisfies ParsedDiffLine;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return {
          type: "del",
          oldLine: null,
          newLine: null,
          text: line.slice(1),
        } satisfies ParsedDiffLine;
      }
      if (line.startsWith(" ")) {
        return {
          type: "context",
          oldLine: null,
          newLine: null,
          text: line.slice(1),
        } satisfies ParsedDiffLine;
      }
      return {
        type: "meta",
        oldLine: null,
        newLine: null,
        text: line,
      } satisfies ParsedDiffLine;
    });
}

export function isFallbackRawDiffLineHighlightable(
  type: ParsedDiffLine["type"],
) {
  return type === "add" || type === "del" || type === "context";
}

export function calculateDiffStats(diffs: GitDiffViewerItem[]): DiffStats {
  let additions = 0;
  let deletions = 0;

  for (const entry of diffs) {
    const lines = entry.diff.split("\n");
    for (const line of lines) {
      if (!line) {
        continue;
      }
      if (DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
        continue;
      }
      if (line.startsWith("+")) {
        additions += 1;
      } else if (line.startsWith("-")) {
        deletions += 1;
      }
    }
  }

  return { additions, deletions };
}
