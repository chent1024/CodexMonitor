/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFileChangeGutterLineMap, PierreDiffBlock } from "./PierreDiffBlock";

const { parsePatchFilesMock } = vi.hoisted(() => ({
  parsePatchFilesMock: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: parsePatchFilesMock,
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
    <div data-testid="mock-file-diff">{fileDiff.name}</div>
  ),
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  parsePatchFilesMock.mockReset();
});

describe("PierreDiffBlock", () => {
  it("builds per-line gutter markers from parsed file diff hunks", () => {
    const lineMap = buildFileChangeGutterLineMap({
      name: "src/styles/messages.css",
      prevName: undefined,
      type: "change",
      splitLineCount: 0,
      unifiedLineCount: 0,
      hunks: [
        {
          collapsedBefore: 0,
          splitLineStart: 0,
          splitLineCount: 0,
          unifiedLineStart: 0,
          unifiedLineCount: 0,
          additionCount: 3,
          additionStart: 10,
          additionLines: 3,
          deletionCount: 2,
          deletionStart: 10,
          deletionLines: 2,
          hunkContext: undefined,
          hunkSpecs: undefined,
          hunkContent: [
            {
              type: "change",
              deletions: ["old-1", "old-2"],
              additions: ["new-1", "new-2"],
              noEOFCRAdditions: false,
              noEOFCRDeletions: false,
            },
            {
              type: "context",
              lines: ["context-line"],
              noEOFCR: false,
            },
            {
              type: "change",
              deletions: [],
              additions: ["new-3"],
              noEOFCRAdditions: false,
              noEOFCRDeletions: false,
            },
          ],
        },
      ],
    });

    expect(lineMap.get(10)?.[0]).toMatchObject({
      kind: "modification",
      lineNumber: 10,
      placement: "line",
    });
    expect(lineMap.get(11)?.[0]).toMatchObject({
      kind: "modification",
      lineNumber: 11,
      placement: "line",
    });
    expect(lineMap.get(13)?.[0]).toMatchObject({
      kind: "addition",
      lineNumber: 13,
      placement: "line",
    });
  });

  it("normalizes hunk-only diffs so they render through the file diff grid", () => {
    parsePatchFilesMock.mockImplementation((diff: string) => {
      if (!diff.startsWith("diff --git")) {
        return [{ files: [] }];
      }

      return [
        {
          files: [
            {
              name: "src/styles/messages.css",
              prevName: undefined,
              type: "change",
              hunks: [],
              splitLineCount: 0,
              unifiedLineCount: 0,
            },
          ],
        },
      ];
    });

    render(
      <PierreDiffBlock
        displayPath="src/styles/messages.css"
        diff={["@@ -10,2 +10,1 @@", "-removed", " kept"].join("\n")}
      />,
    );

    expect(screen.getByTestId("mock-file-diff").textContent).toContain(
      "src/styles/messages.css",
    );
    expect(parsePatchFilesMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "diff --git a/src/styles/messages.css b/src/styles/messages.css",
      ),
    );
  });

  it("normalizes raw added-file content so it renders through the file diff grid", () => {
    parsePatchFilesMock.mockImplementation((diff: string) => {
      if (!diff.includes("--- /dev/null")) {
        return [{ files: [] }];
      }

      return [
        {
          files: [
            {
              name: ".codex-run/cargo.cmd",
              prevName: undefined,
              type: "addition",
              hunks: [],
              splitLineCount: 0,
              unifiedLineCount: 0,
            },
          ],
        },
      ];
    });

    render(
      <PierreDiffBlock
        displayPath=".codex-run/cargo.cmd"
        changeKind="add"
        diff={[
          "@echo off",
          "\"%USERPROFILE%\\.cargo\\bin\\rustup.exe\" run stable cargo %*",
        ].join("\n")}
      />,
    );

    expect(screen.getByTestId("mock-file-diff").textContent).toContain(
      ".codex-run/cargo.cmd",
    );
    expect(parsePatchFilesMock).toHaveBeenCalledWith(
      expect.stringContaining("--- /dev/null"),
    );
    expect(parsePatchFilesMock).toHaveBeenCalledWith(
      expect.stringContaining("+++ b/.codex-run/cargo.cmd"),
    );
    expect(parsePatchFilesMock).toHaveBeenCalledWith(
      expect.stringContaining("+@echo off"),
    );
  });

  it("renders a bounded raw preview for very large diffs", () => {
    const largeDiff = Array.from(
      { length: 1_510 },
      (_, index) => `+added ${index + 1}`,
    ).join("\n");

    render(
      <PierreDiffBlock displayPath="src/large.ts" diff={largeDiff} />,
    );

    expect(parsePatchFilesMock).not.toHaveBeenCalled();
    expect(screen.getByText(/lines hidden for performance/)).toBeTruthy();
    const rawLines = Array.from(document.querySelectorAll(".diff-viewer-raw-line"));
    expect(rawLines).toHaveLength(1_500);
    expect(rawLines[1_499]?.textContent).toBe("added 1500");
    expect(document.body.textContent).not.toContain("added 1501");
  });
});
