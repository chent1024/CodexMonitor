import { describe, expect, it } from "vitest";

import { formatTerminalOpenErrorMessage } from "./terminalErrorMessage";

describe("formatTerminalOpenErrorMessage", () => {
  it("includes backend detail when terminal open fails", () => {
    expect(formatTerminalOpenErrorMessage("unknown method: terminal_open")).toBe(
      "Failed to start terminal session: unknown method: terminal_open",
    );
  });

  it("falls back to the generic message when no useful detail exists", () => {
    expect(formatTerminalOpenErrorMessage(undefined)).toBe(
      "Failed to start terminal session.",
    );
  });
});
