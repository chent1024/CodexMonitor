/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreviewPopover } from "./FilePreviewPopover";

vi.mock("../../app/components/OpenAppMenu", () => ({
  OpenAppMenu: () => <div data-testid="open-app-menu" />,
}));

afterEach(() => {
  cleanup();
});

describe("FilePreviewPopover", () => {
  it("renders selection hints for text previews", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        selectionHints={["Shift + click or drag + click", "for multi-line selection"]}
      />,
    );

    expect(screen.getByText("Shift + click or drag + click")).toBeTruthy();
    expect(screen.getByText("for multi-line selection")).toBeTruthy();
  });

  it("copies the absolute file path from the title action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
    });

    expect(writeText).toHaveBeenCalledWith("/workspace/src/example.ts");
  });

  it("wires drag selection mouse events to line handlers", () => {
    const onSelectLine = vi.fn();
    const onLineMouseDown = vi.fn();
    const onLineMouseEnter = vi.fn();
    const onLineMouseUp = vi.fn();

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={onSelectLine}
        onLineMouseDown={onLineMouseDown}
        onLineMouseEnter={onLineMouseEnter}
        onLineMouseUp={onLineMouseUp}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const firstLine = screen.getByText("one").closest("button");
    const secondLine = screen.getByText("two").closest("button");
    expect(firstLine).not.toBeNull();
    expect(secondLine).not.toBeNull();

    fireEvent.mouseDown(firstLine as HTMLButtonElement);
    fireEvent.mouseEnter(secondLine as HTMLButtonElement);
    fireEvent.mouseUp(secondLine as HTMLButtonElement);
    fireEvent.click(secondLine as HTMLButtonElement);

    expect(onLineMouseDown).toHaveBeenCalledWith(0, expect.any(Object));
    expect(onLineMouseEnter).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onLineMouseUp).toHaveBeenCalledWith(1, expect.any(Object));
    expect(onSelectLine).toHaveBeenCalledWith(1, expect.any(Object));
  });

  it("hides add-to-chat when insertion is not allowed", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        canInsertText={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Add to chat" })).toBeNull();
  });

  it("toggles fullscreen preview mode", () => {
    const contentLayer = document.createElement("div");
    contentLayer.className = "content-layer is-active";
    contentLayer.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 80,
        width: 900,
        height: 600,
        right: 1000,
        bottom: 680,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(contentLayer);

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={{ start: 0, end: 0 }}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand preview" }));

    const popover = document.querySelector(".file-preview-popover") as HTMLElement;
    expect(popover.className).toContain("is-fullscreen");
    expect(popover.style.left).toBe("100px");
    expect(popover.style.top).toBe("80px");
    expect(popover.style.width).toBe("900px");
    expect(popover.style.height).toBe("600px");
    expect(screen.getByRole("button", { name: "Restore preview" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore preview" }));
    expect(popover.className).not.toContain("is-fullscreen");
  });

  it("renders diff summary and line markers", () => {
    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo\nthree"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        diffInfo={{
          additions: 1,
          deletions: 2,
          lineMarkers: new Map([[1, "modify"]]),
          deletionMarkers: [{ lineIndex: 2, count: 1 }],
        }}
      />,
    );

    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-2")).toBeTruthy();
    expect(screen.getByText("-1 deleted line")).toBeTruthy();
    expect(screen.getByText("two").closest("button")?.className).toContain("is-diff-modify");
  });

  it("scrolls to the first changed line when diff markers are available", () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <FilePreviewPopover
        path="src/example.ts"
        absolutePath="/workspace/src/example.ts"
        content={"one\ntwo\nthree"}
        truncated={false}
        previewKind="text"
        imageSrc={null}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        selection={null}
        onSelectLine={vi.fn()}
        onClearSelection={vi.fn()}
        onAddSelection={vi.fn()}
        onClose={vi.fn()}
        diffInfo={{
          additions: 1,
          deletions: 0,
          lineMarkers: new Map([[1, "add"]]),
          deletionMarkers: [],
        }}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });

    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

});
