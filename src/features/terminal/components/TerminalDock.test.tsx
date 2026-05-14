// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalDock } from "./TerminalDock";

function renderDock() {
  return render(
    <TerminalDock
      isOpen
      terminals={[{ id: "terminal-1", title: "Terminal 1" }]}
      activeTerminalId="terminal-1"
      onSelectTerminal={vi.fn()}
      onNewTerminal={vi.fn()}
      onCloseTerminal={vi.fn()}
      onResizeStart={vi.fn()}
      terminalNode={<div data-testid="terminal-node" />}
    />,
  );
}

describe("TerminalDock", () => {
  it("toggles fullscreen mode from the header action", () => {
    const { container } = renderDock();
    const panel = container.querySelector(".terminal-panel");
    const toggle = screen.getByRole("button", { name: "Enter terminal fullscreen" });

    expect(panel?.className).not.toContain("is-fullscreen");
    expect(toggle.querySelector("svg")).toBeTruthy();

    fireEvent.click(toggle);

    expect(panel?.className).toContain("is-fullscreen");
    const exitToggle = screen.getByRole("button", { name: "Exit terminal fullscreen" });
    expect(exitToggle.querySelector("svg")).toBeTruthy();
  });
});
