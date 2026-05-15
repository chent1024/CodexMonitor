export type FilePreviewDiffLineKind = "add" | "modify";

export type FilePreviewDeletionMarker = {
  lineIndex: number;
  count: number;
};

export type FilePreviewDiffInfo = {
  additions: number;
  deletions: number;
  lineMarkers: Map<number, FilePreviewDiffLineKind>;
  deletionMarkers: FilePreviewDeletionMarker[];
};

const HUNK_REGEX = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function pushDeletionMarker(
  markers: FilePreviewDeletionMarker[],
  lineIndex: number,
  count: number,
) {
  if (count <= 0) {
    return;
  }
  const normalizedLineIndex = Math.max(0, lineIndex);
  const existing = markers.find((marker) => marker.lineIndex === normalizedLineIndex);
  if (existing) {
    existing.count += count;
    return;
  }
  markers.push({ lineIndex: normalizedLineIndex, count });
}

export function buildFilePreviewDiffInfo(diff: string): FilePreviewDiffInfo | null {
  if (!diff.trim()) {
    return null;
  }

  const lineMarkers = new Map<number, FilePreviewDiffLineKind>();
  const deletionMarkers: FilePreviewDeletionMarker[] = [];
  let additions = 0;
  let deletions = 0;
  let newLine = 0;
  let pendingDeletionCount = 0;
  let inReplacement = false;
  let inHunk = false;

  const flushDeletions = () => {
    if (pendingDeletionCount > 0) {
      pushDeletionMarker(deletionMarkers, newLine - 1, pendingDeletionCount);
      pendingDeletionCount = 0;
    }
    inReplacement = false;
  };

  for (const line of diff.split(/\r?\n/)) {
    const hunkMatch = HUNK_REGEX.exec(line);
    if (hunkMatch) {
      flushDeletions();
      newLine = Number(hunkMatch[1]);
      pendingDeletionCount = 0;
      inReplacement = false;
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
      const lineIndex = Math.max(0, newLine - 1);
      if (pendingDeletionCount > 0 || inReplacement) {
        lineMarkers.set(lineIndex, "modify");
        pendingDeletionCount = Math.max(0, pendingDeletionCount - 1);
        inReplacement = true;
      } else {
        lineMarkers.set(lineIndex, "add");
      }
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
      pendingDeletionCount += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      flushDeletions();
      newLine += 1;
      continue;
    }

    if (line.startsWith("\\")) {
      continue;
    }

    flushDeletions();
    inHunk = false;
  }

  flushDeletions();

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return {
    additions,
    deletions,
    lineMarkers,
    deletionMarkers,
  };
}
