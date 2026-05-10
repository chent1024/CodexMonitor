/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ComposerMetaBar } from "./ComposerMetaBar";

function renderMetaBar() {
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
});
