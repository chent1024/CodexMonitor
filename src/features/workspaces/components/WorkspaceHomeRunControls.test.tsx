/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../../../types";
import { WorkspaceHomeRunControls } from "./WorkspaceHomeRunControls";

const models: ModelOption[] = [
  {
    id: "gpt-a",
    model: "gpt-a",
    displayName: "GPT A",
    description: "Model A",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
  {
    id: "gpt-b",
    model: "gpt-b",
    displayName: "GPT B",
    description: "Model B",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
];

function renderControls() {
  return render(
    <WorkspaceHomeRunControls
      workspaceKind="main"
      runMode="worktree"
      onRunModeChange={vi.fn()}
      models={models}
      selectedModelId={null}
      onSelectModel={vi.fn()}
      modelSelections={{ "gpt-a": 2 }}
      onToggleModel={vi.fn()}
      onModelCountChange={vi.fn()}
      collaborationModes={[]}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={vi.fn()}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={vi.fn()}
      reasoningSupported
      isSubmitting={false}
    />,
  );
}

function getInstanceButtons() {
  return screen.queryAllByRole("button", { name: /^[1-4]x$/ });
}

describe("WorkspaceHomeRunControls", () => {
  it("renders only the active model count submenu", () => {
    renderControls();

    fireEvent.click(screen.getByRole("button", { name: "Select models" }));
    expect(getInstanceButtons()).toHaveLength(0);

    const firstModel = screen.getByRole("button", { name: "GPT A" });
    const firstOption = firstModel.closest(".workspace-home-model-option");
    expect(firstOption).toBeTruthy();
    fireEvent.mouseEnter(firstOption as Element);
    expect(getInstanceButtons()).toHaveLength(4);

    const secondModel = screen.getByRole("button", { name: "GPT B" });
    const secondOption = secondModel.closest(".workspace-home-model-option");
    expect(secondOption).toBeTruthy();
    fireEvent.mouseEnter(secondOption as Element);
    expect(getInstanceButtons()).toHaveLength(4);

    fireEvent.mouseLeave(secondOption as Element);
    expect(getInstanceButtons()).toHaveLength(0);
  });
});
