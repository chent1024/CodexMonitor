// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  buildVirtualScrollLayout,
  getBottomVirtualRange,
  getMaxScrollDistanceFromBottom,
  getMirroredVirtualRange,
  getScrollDistanceFromBottom,
  isNearScrollBottom,
  isNearScrollTop,
  setScrollDistanceFromBottom,
} from "./threadScroll";

function makeScrollNode({
  clientHeight,
  scrollHeight,
  scrollTop,
  reverse = false,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  reverse?: boolean;
}) {
  const node = document.createElement("div");
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  node.scrollTop = scrollTop;
  if (reverse) {
    node.dataset.threadReverseScroll = "true";
  }
  return node;
}

describe("threadScroll", () => {
  it("measures and sets distance from bottom for normal scroll containers", () => {
    const node = makeScrollNode({
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: 250,
    });

    expect(getMaxScrollDistanceFromBottom(node)).toBe(700);
    expect(getScrollDistanceFromBottom(node)).toBe(450);

    setScrollDistanceFromBottom(node, 120);
    expect(node.scrollTop).toBe(580);
    expect(getScrollDistanceFromBottom(node)).toBe(120);
  });

  it("measures and sets distance from bottom for reverse scroll containers", () => {
    const node = makeScrollNode({
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: -340,
      reverse: true,
    });

    expect(getMaxScrollDistanceFromBottom(node)).toBe(700);
    expect(getScrollDistanceFromBottom(node)).toBe(340);

    setScrollDistanceFromBottom(node, 0);
    expect(node.scrollTop).toBe(0);

    setScrollDistanceFromBottom(node, 220);
    expect(node.scrollTop).toBe(-220);
  });

  it("uses native smooth scrolling when a behavior is requested", () => {
    const node = makeScrollNode({
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: -340,
      reverse: true,
    });
    const scrollTo = vi.fn();
    node.scrollTo = scrollTo;

    setScrollDistanceFromBottom(node, 0, "smooth");

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("classifies bottom and top thresholds in reverse scroll mode", () => {
    const node = makeScrollNode({
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: 0,
      reverse: true,
    });

    expect(isNearScrollBottom(node)).toBe(true);
    expect(isNearScrollTop(node)).toBe(false);

    node.scrollTop = -680;
    expect(isNearScrollBottom(node)).toBe(false);
    expect(isNearScrollTop(node)).toBe(true);
  });

  it("computes VS Code-style bottom-anchored virtual ranges", () => {
    const layout = buildVirtualScrollLayout([100, 100, 100, 100, 100], 10);

    expect(layout.bottomOffsets).toEqual([440, 330, 220, 110, 0]);
    expect(
      getBottomVirtualRange({
        layout,
        viewportTopDistanceFromBottom: 250,
        viewportBottomDistanceFromBottom: 40,
        overscanCount: 1,
      }),
    ).toEqual({ startIndex: 1, endIndex: 5 });
  });

  it("mirrors virtual ranges from a first visible turn anchor", () => {
    expect(
      getMirroredVirtualRange({
        entriesLength: 12,
        firstVisibleTurnIndex: 5,
        visibleTurnStartIndex: 3,
        visibleTurnEndIndex: 7,
      }),
    ).toEqual({ startIndex: 5, endIndex: 9 });

    expect(
      getMirroredVirtualRange({
        entriesLength: 12,
        firstVisibleTurnIndex: 3,
        visibleTurnStartIndex: 3,
        visibleTurnEndIndex: 7,
      }),
    ).toBeNull();
  });
});
