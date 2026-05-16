import { describe, expect, it } from "vitest";
import { hasLoadableOlderTurnsForThread } from "./useMainAppLayoutSurfaces";

describe("hasLoadableOlderTurnsForThread", () => {
  it("allows loading when the cursor has not been initialized yet", () => {
    expect(hasLoadableOlderTurnsForThread("thread-1", {}, {})).toBe(true);
  });

  it("allows loading when an older cursor is known", () => {
    expect(
      hasLoadableOlderTurnsForThread(
        "thread-1",
        { "thread-1": "older-cursor" },
        {},
      ),
    ).toBe(true);
  });

  it("stops loading when the cursor is explicitly exhausted", () => {
    expect(
      hasLoadableOlderTurnsForThread("thread-1", { "thread-1": null }, {}),
    ).toBe(false);
  });

  it("stops loading after the oldest turn is loaded", () => {
    expect(
      hasLoadableOlderTurnsForThread(
        "thread-1",
        { "thread-1": "older-cursor" },
        { "thread-1": true },
      ),
    ).toBe(false);
  });
});
