/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { ThreadTokenUsage } from "../../../types";
import { ComposerMetaBar } from "./ComposerMetaBar";

function renderMetaBar({
  contextUsage = null,
}: {
  contextUsage?: ThreadTokenUsage | null;
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ComposerMetaBar
        disabled={false}
        collaborationModes={[]}
        selectedCollaborationModeId={null}
        onSelectCollaborationMode={() => {}}
        models={[
          { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5" },
          {
            id: "gpt-5.3-codex-spark",
            model: "gpt-5.3-codex-spark",
            displayName: "gpt-5.3-codex-spark",
          },
        ]}
        selectedModelId="gpt-5.5"
        onSelectModel={() => {}}
        reasoningOptions={[]}
        selectedEffort={null}
        onSelectEffort={() => {}}
        selectedServiceTier={null}
        reasoningSupported={false}
        accessMode="current"
        onSelectAccessMode={() => {}}
        contextUsage={contextUsage}
      />,
    );
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("ComposerMetaBar", () => {
  it("normalizes GPT model labels in the composer menu", () => {
    const harness = renderMetaBar();
    const options = Array.from(
      harness.container.querySelectorAll<HTMLSelectElement>(
        'select[aria-label="Model"] option',
      ),
    ).map((option) => option.textContent);

    expect(options).toEqual(["5.5", "5.3 Codex Spark"]);

    harness.unmount();
  });

  it("shows context as used percent in the composer status bar", () => {
    const harness = renderMetaBar({
      contextUsage: {
        total: {
          totalTokens: 4_100,
          inputTokens: 4_100,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        last: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 10_000,
      },
    });

    const contextValue = harness.container.querySelector(
      '[aria-label="Context used percent"]',
    );

    expect(contextValue?.textContent).toBe("已使用41%");
    expect(harness.container.querySelector('[aria-label="Context free percent"]')).toBeNull();

    harness.unmount();
  });
});
