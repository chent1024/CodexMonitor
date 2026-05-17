/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryInitMock = vi.fn();
const sentryMetricsCountMock = vi.fn();
const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({
  render: renderMock,
}));

vi.mock("@sentry/react", () => ({
  init: sentryInitMock,
  metrics: {
    count: sentryMetricsCountMock,
  },
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: createRootMock,
  },
  createRoot: createRootMock,
}));

vi.mock("./App", () => ({
  default: () => null,
}));

describe("main sentry bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    sentryInitMock.mockClear();
    sentryMetricsCountMock.mockClear();
    createRootMock.mockClear();
    renderMock.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.removeAttribute("style");
  });

  it("initializes sentry and records app_open", async () => {
    await import("./main");

    expect(sentryInitMock).toHaveBeenCalledTimes(1);
    expect(sentryInitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: expect.stringContaining("ingest.us.sentry.io"),
        enabled: true,
        release: expect.any(String),
      }),
    );
    expect(sentryMetricsCountMock).toHaveBeenCalledTimes(1);
    expect(sentryMetricsCountMock).toHaveBeenCalledWith(
      "app_open",
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({
          platform: "macos",
        }),
      }),
    );
  });

  it("syncs app height from the real viewport on desktop", async () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(713);

    await import("./main");

    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("713px");
  });
});
