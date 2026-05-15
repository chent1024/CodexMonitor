// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitSnapshot } from "../../../types";
import {
  buildTraySessionUsage,
  useTraySessionUsage,
} from "./useTraySessionUsage";

const isTauriMock = vi.hoisted(() => vi.fn(() => true));
const setTraySessionUsageMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@services/tauri", () => ({
  setTraySessionUsage: (...args: unknown[]) => setTraySessionUsageMock(...args),
}));

function makeRateLimits(
  overrides: Partial<RateLimitSnapshot> = {},
): RateLimitSnapshot {
  return {
    primary: {
      usedPercent: 12,
      windowDurationMins: 300,
      resetsAt: new Date(2026, 0, 1, 12, 0).getTime(),
    },
    secondary: null,
    credits: null,
    planType: null,
    ...overrides,
  };
}

describe("useTraySessionUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
    isTauriMock.mockReturnValue(true);
    setTraySessionUsageMock.mockReset();
    setTraySessionUsageMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the current session usage summary from workspace rate limits", () => {
    expect(buildTraySessionUsage(makeRateLimits(), false)).toEqual({
      sessionLabel: "12% 已使用 · 01/01 12:00 重置",
      weeklyLabel: null,
    });
  });

  it("supports remaining mode to match the sidebar setting", () => {
    expect(
      buildTraySessionUsage(
        makeRateLimits({
          primary: {
            usedPercent: 42,
            windowDurationMins: 300,
            resetsAt: new Date(2026, 0, 1, 12, 0).getTime(),
          },
        }),
        true,
      ),
    ).toEqual({
      sessionLabel: "58% 剩余 · 01/01 12:00 重置",
      weeklyLabel: null,
    });
  });

  it("includes weekly usage when the workspace has a secondary window", () => {
    expect(
      buildTraySessionUsage(
        makeRateLimits({
          secondary: {
            usedPercent: 67,
            windowDurationMins: 10_080,
            resetsAt: new Date(2026, 0, 3, 10, 0).getTime(),
          },
        }),
        false,
      ),
    ).toEqual({
      sessionLabel: "12% 已使用 · 01/01 12:00 重置",
      weeklyLabel: "67% 已使用 · 01/03 10:00 重置",
    });
  });

  it("syncs only when the derived usage changes", async () => {
    type HookProps = {
      accountRateLimits: RateLimitSnapshot | null;
      showRemaining: boolean;
    };
    const initialUsage = makeRateLimits();
    const initialProps: HookProps = {
      accountRateLimits: initialUsage,
      showRemaining: false,
    };
    const { rerender } = renderHook(
      ({ accountRateLimits, showRemaining }: HookProps) =>
        useTraySessionUsage({ accountRateLimits, showRemaining }),
      {
        initialProps,
      },
    );

    await vi.runAllTimersAsync();
    expect(setTraySessionUsageMock).toHaveBeenCalledTimes(1);
    expect(setTraySessionUsageMock).toHaveBeenLastCalledWith({
      sessionLabel: "12% 已使用 · 01/01 12:00 重置",
      weeklyLabel: null,
    });

    rerender({ accountRateLimits: initialUsage, showRemaining: false });
    await vi.runAllTimersAsync();
    expect(setTraySessionUsageMock).toHaveBeenCalledTimes(1);

    rerender({ accountRateLimits: null, showRemaining: false });
    await vi.runAllTimersAsync();
    expect(setTraySessionUsageMock).toHaveBeenCalledTimes(2);
    expect(setTraySessionUsageMock).toHaveBeenLastCalledWith(null);
  });

  it("retries the same usage payload after a transient sync failure", async () => {
    setTraySessionUsageMock
      .mockRejectedValueOnce(new Error("bridge not ready"))
      .mockResolvedValue(undefined);

    renderHook(() =>
      useTraySessionUsage({
        accountRateLimits: makeRateLimits(),
        showRemaining: false,
      }),
    );

    await vi.advanceTimersByTimeAsync(150);
    expect(setTraySessionUsageMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(setTraySessionUsageMock).toHaveBeenCalledTimes(2);
    expect(setTraySessionUsageMock).toHaveBeenLastCalledWith({
      sessionLabel: "12% 已使用 · 01/01 12:00 重置",
      weeklyLabel: null,
    });
  });
});

