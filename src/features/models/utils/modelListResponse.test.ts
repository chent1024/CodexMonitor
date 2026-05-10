import { describe, expect, it } from "vitest";
import { formatModelDisplayName, parseModelListResponse } from "./modelListResponse";

describe("parseModelListResponse", () => {
  it("normalizes GPT displayName when present", () => {
    const response = {
      result: {
        data: [
          { id: "m1", model: "gpt-5.3-codex-spark", displayName: "GPT-5.3-Codex-Spark" },
        ],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("5.3 Codex Spark");
  });

  it("normalizes the model slug when displayName is missing", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.3-codex" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("5.3 Codex");
  });

  it("normalizes the model slug when displayName is an empty string", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.1-codex-mini", displayName: "" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("5.1 Codex Mini");
  });

  it("normalizes displayName when it equals the model slug", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.3-codex", displayName: "gpt-5.3-codex" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("5.3 Codex");
  });

  it("normalizes GPT display names and preserves custom provider names", () => {
    const response = {
      result: {
        data: [
          { id: "m1", model: "gpt-5.3-codex-spark", displayName: "GPT-5.3-Codex-Spark" },
          { id: "m2", model: "gpt-5.2-codex", displayName: "Provider Custom" },
        ],
      },
    };
    const models = parseModelListResponse(response);
    expect(models[0].displayName).toBe("5.3 Codex Spark");
    expect(models[1].displayName).toBe("Provider Custom");
  });

  it("formats GPT names without a GPT prefix", () => {
    expect(formatModelDisplayName("GPT-5.5")).toBe("5.5");
    expect(formatModelDisplayName("gpt-5.4")).toBe("5.4");
    expect(formatModelDisplayName("GPT-5.4-Mini")).toBe("5.4 Mini");
    expect(formatModelDisplayName("gpt-5.3-codex")).toBe("5.3 Codex");
    expect(formatModelDisplayName("gpt-5.3-codex-spark")).toBe(
      "5.3 Codex Spark",
    );
    expect(formatModelDisplayName("custom-model")).toBe("custom-model");
  });
});
