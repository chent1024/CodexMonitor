// @ts-expect-error Node built-in types are intentionally not part of the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node built-in types are intentionally not part of the app tsconfig.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readStyle(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("theme backgrounds", () => {
  it("keeps the app shell background tied to theme tokens", () => {
    const baseCss = readStyle("./base.css");

    expect(baseCss).toContain("background: var(--app-background);");
  });

  it("does not hard-code the main conversation surface to light mode", () => {
    const mainCss = readStyle("./main.css");
    const mainRule = mainCss.match(/\.main\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(mainRule).not.toContain("--surface-messages:");
    expect(mainRule).not.toContain("#ffffff");
  });
});

describe("app viewport sizing", () => {
  it("keeps the desktop app grid row constrained to the viewport", () => {
    const baseCss = readStyle("./base.css");
    const appRule = baseCss.match(/\.app\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(appRule).toContain("grid-template-rows: minmax(0, 1fr);");
  });
});
