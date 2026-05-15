// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGitDiffs, openWorkspaceIn, readWorkspaceFile } from "../../../services/tauri";
import { fileTarget } from "../test/fileLinkAssertions";
import { useFileLinkOpener } from "./useFileLinkOpener";

vi.mock("../../../services/tauri", () => ({
  getGitDiffs: vi.fn(),
  openWorkspaceIn: vi.fn(),
  readWorkspaceFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

describe("useFileLinkOpener", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function copyLinkFor(rawPath: string) {
    const clipboardWriteTextMock = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteTextMock },
      configurable: true,
    });

    let hookResult: ReturnType<typeof useFileLinkOpener> | null = null;
    function Harness() {
      hookResult = useFileLinkOpener(null, [], "");
      return <>{hookResult.fileLinkMenu}</>;
    }

    render(<Harness />);

    await act(async () => {
      await hookResult?.showFileLinkMenu(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 12,
          clientY: 24,
        } as never,
        fileTarget(rawPath),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    });
    return clipboardWriteTextMock.mock.calls[0]?.[0];
  }

  it("copies namespace-prefixed Windows drive paths as round-trippable file URLs", async () => {
    expect(await copyLinkFor("\\\\?\\C:\\repo\\src\\App.tsx:42")).toBe(
      "file:///%5C%5C%3F%5CC%3A%5Crepo%5Csrc%5CApp.tsx#L42",
    );
  });

  it("copies namespace-prefixed Windows UNC paths as round-trippable file URLs", async () => {
    expect(await copyLinkFor("\\\\?\\UNC\\server\\share\\repo\\App.tsx:42")).toBe(
      "file:///%5C%5C%3F%5CUNC%5Cserver%5Cshare%5Crepo%5CApp.tsx#L42",
    );
  });

  it("percent-encodes copied file URLs for Windows paths with reserved characters", async () => {
    expect(await copyLinkFor("C:\\repo\\My File #100%.tsx:42")).toBe(
      "file:///C:/repo/My%20File%20%23100%25.tsx#L42",
    );
  });

  it("maps /workspace root-relative paths to the active workspace path", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(
        fileTarget("/workspace/src/features/messages/components/Markdown.tsx"),
      );
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src/features/messages/components/Markdown.tsx",
      expect.objectContaining({ appName: "Visual Studio Code", args: [] }),
    );
  });

  it("maps /workspace/<workspace-name>/... paths to the active workspace path", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(fileTarget("/workspace/CodexMonitor/LICENSE"));
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/LICENSE",
      expect.objectContaining({ appName: "Visual Studio Code", args: [] }),
    );
  });

  it("maps extensionless files under /workspace/settings to the active workspace path", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/settings";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(fileTarget("/workspace/settings/LICENSE"));
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/settings/LICENSE",
      expect.objectContaining({ appName: "Visual Studio Code", args: [] }),
    );
  });

  it("maps nested /workspaces/.../<workspace-name>/... paths to the active workspace path", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(fileTarget("/workspaces/team/CodexMonitor/src"));
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src",
      expect.objectContaining({ appName: "Visual Studio Code", args: [] }),
    );
  });

  it("preserves file link line and column metadata for editor opens", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(
        fileTarget("/workspace/src/features/messages/components/Markdown.tsx:33:7"),
      );
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src/features/messages/components/Markdown.tsx",
      expect.objectContaining({
        appName: "Visual Studio Code",
        args: [],
        line: 33,
        column: 7,
      }),
    );
  });

  it("parses #L line anchors before opening the editor", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(fileTarget("/workspace/src/App.tsx#L33"));
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src/App.tsx",
      expect.objectContaining({
        appName: "Visual Studio Code",
        args: [],
        line: 33,
      }),
    );
  });

  it("previews workspace file links in-app when preview mode is enabled", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "first line\nsecond line",
      truncated: false,
    });
    vi.mocked(getGitDiffs).mockResolvedValue([
      {
        path: "src/App.tsx",
        diff: [
          "diff --git a/src/App.tsx b/src/App.tsx",
          "--- a/src/App.tsx",
          "+++ b/src/App.tsx",
          "@@ -1,2 +1,2 @@",
          " first line",
          "-old second line",
          "+second line",
        ].join("\n"),
      },
    ]);
    let hookResult: ReturnType<typeof useFileLinkOpener> | null = null;

    function Harness() {
      hookResult = useFileLinkOpener(workspacePath, [], "", {
        workspaceId: "ws-1",
        previewOnOpen: true,
      });
      return <>{hookResult.fileLinkPreview}</>;
    }

    render(<Harness />);

    await act(async () => {
      await hookResult?.openFileLink(fileTarget("/workspace/src/App.tsx#L2"));
    });

    expect(openWorkspaceIn).not.toHaveBeenCalled();
    expect(readWorkspaceFile).toHaveBeenCalledWith("ws-1", "src/App.tsx");
    expect(getGitDiffs).toHaveBeenCalledWith("ws-1");
    await waitFor(() => {
      expect(screen.getByText("src/App.tsx")).toBeTruthy();
      expect(screen.getByText("second line")).toBeTruthy();
      expect(screen.getByText("Lines 2-2")).toBeTruthy();
      expect(screen.getByText("+1")).toBeTruthy();
      expect(screen.getByText("-1")).toBeTruthy();
    });
    const preview = document.querySelector(".file-preview-popover") as HTMLElement;
    expect(preview.style.left).toBe("50%");
    expect(preview.style.transform).toBe("translateX(-50%)");
  });

  it("keeps context-menu open action external when preview mode is enabled", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    let hookResult: ReturnType<typeof useFileLinkOpener> | null = null;

    function Harness() {
      hookResult = useFileLinkOpener(workspacePath, [], "", {
        workspaceId: "ws-1",
        previewOnOpen: true,
      });
      return (
        <>
          {hookResult.fileLinkMenu}
          {hookResult.fileLinkPreview}
        </>
      );
    }

    render(<Harness />);

    await act(async () => {
      await hookResult?.showFileLinkMenu(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 12,
          clientY: 24,
        } as never,
        fileTarget("/workspace/src/App.tsx#L2"),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Open in Visual Studio Code" }));
    });

    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(openWorkspaceIn).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src/App.tsx",
      expect.objectContaining({ appName: "Visual Studio Code", line: 2 }),
    );
  });

  it("opens structured file targets without re-parsing #L-like filename endings", async () => {
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(null, [], ""));

    await act(async () => {
      await result.current.openFileLink({
        path: "/tmp/#L12",
        line: null,
        column: null,
      });
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/tmp/#L12",
      expect.objectContaining({ appName: "Visual Studio Code", args: [] }),
    );
  });

  it("normalizes line ranges to the starting line before opening the editor", async () => {
    const workspacePath = "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor";
    const openWorkspaceInMock = vi.mocked(openWorkspaceIn);
    const { result } = renderHook(() => useFileLinkOpener(workspacePath, [], ""));

    await act(async () => {
      await result.current.openFileLink(
        fileTarget("/workspace/src/features/messages/components/Markdown.tsx:366-369"),
      );
    });

    expect(openWorkspaceInMock).toHaveBeenCalledWith(
      "/Users/sotiriskaniras/Documents/Development/Forks/CodexMonitor/src/features/messages/components/Markdown.tsx",
      expect.objectContaining({
        appName: "Visual Studio Code",
        args: [],
        line: 366,
      }),
    );
  });
});
