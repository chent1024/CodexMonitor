import { describe, expect, it } from "vitest";
import { buildFilePreviewDiffInfo } from "./filePreviewDiff";

describe("buildFilePreviewDiffInfo", () => {
  it("maps additions, replacements, and deletion-only changes onto preview lines", () => {
    const diff = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,5 +1,5 @@",
      " one",
      "-old two",
      "+two",
      "+extra",
      " three",
      "-removed",
      " four",
    ].join("\n");

    const info = buildFilePreviewDiffInfo(diff);

    expect(info?.additions).toBe(2);
    expect(info?.deletions).toBe(2);
    expect(info?.lineMarkers.get(1)).toBe("modify");
    expect(info?.lineMarkers.get(2)).toBe("modify");
    expect(info?.deletionMarkers).toEqual([{ lineIndex: 4, count: 1 }]);
  });
});
