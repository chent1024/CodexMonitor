/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GitDiffViewer } from "./GitDiffViewer";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 260,
      })),
    getTotalSize: () => count * 260,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: (diff: string) =>
    diff.includes("@@")
      ? [
          {
            files: [
              {
                name: "src/main.ts",
                prevName: undefined,
                type: "change",
                hunks: [],
                splitLineCount: 0,
                unifiedLineCount: 0,
              },
            ],
          },
        ]
      : [],
}));

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({
    renderHoverUtility,
  }: {
    renderHoverUtility?: (
      getHoveredLine: () =>
        | { lineNumber: number; side?: "additions" | "deletions" }
        | undefined,
    ) => ReactNode;
  }) => (
    <div>
      {renderHoverUtility
        ? renderHoverUtility(() => ({ lineNumber: 2, side: "additions" }))
        : null}
    </div>
  ),
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
  if (typeof window.ResizeObserver !== "undefined") {
    return;
  }
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
});

afterEach(() => {
  cleanup();
});

describe("GitDiffViewer", () => {
  it("inserts a diff line reference into composer when the line '+' action is clicked", () => {
    const onInsertComposerText = vi.fn();

    render(
      <GitDiffViewer
        diffs={[
          {
            path: "src/main.ts@@item-change-1@@change-0",
            displayPath: "src/main.ts",
            status: "M",
            diff: "@@ -1,1 +1,2 @@\n line one\n+added line",
          },
        ]}
        selectedPath="src/main.ts@@item-change-1@@change-0"
        isLoading={false}
        error={null}
        diffStyle="unified"
        onInsertComposerText={onInsertComposerText}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ask for changes on hovered line" }),
    );

    expect(onInsertComposerText).toHaveBeenCalledTimes(1);
    expect(onInsertComposerText).toHaveBeenCalledWith(
      "src/main.ts:L2\n```diff\n+added line\n```\n\n",
    );
  });

  it("renders raw fallback lines instead of Diff unavailable for non-patch diffs", () => {
    render(
      <GitDiffViewer
        diffs={[
          {
            path: "src/main.ts@@item-change-1@@change-0",
            displayPath: "src/main.ts",
            status: "M",
            diff: "file edited\n+added line\n-removed line",
          },
        ]}
        selectedPath="src/main.ts@@item-change-1@@change-0"
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.queryByText("Diff unavailable.")).toBeNull();
    expect(screen.getByText("added line")).toBeTruthy();
    expect(screen.getByText("removed line")).toBeTruthy();

    const rawLines = Array.from(document.querySelectorAll(".diff-viewer-raw-line"));
    expect(rawLines[1]?.className).toContain("diff-viewer-raw-line-add");
    expect(rawLines[2]?.className).toContain("diff-viewer-raw-line-del");
  });

  it("bounds very large diff previews", () => {
    const largeDiff = Array.from(
      { length: 1_510 },
      (_, index) => `+added ${index + 1}`,
    ).join("\n");

    render(
      <GitDiffViewer
        diffs={[
          {
            path: "src/large.ts",
            displayPath: "src/large.ts",
            status: "M",
            diff: largeDiff,
          },
        ]}
        selectedPath="src/large.ts"
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText(/lines hidden for performance/)).toBeTruthy();
    const rawLines = Array.from(document.querySelectorAll(".diff-viewer-raw-line"));
    expect(rawLines).toHaveLength(1_500);
    expect(rawLines[1_499]?.textContent).toBe("added 1500");
    expect(document.body.textContent).not.toContain("added 1501");
  });
});
