import type { RateLimitSnapshot } from "../../../types";

type UsageLabels = {
  sessionPercent: number | null;
  weeklyPercent: number | null;
  weeklyRemainingPercent: number | null;
  sessionWindowLabel: string;
  weeklyWindowLabel: string;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
};

const clampPercent = (value: number) =>
  Math.min(Math.max(Math.round(value), 0), 100);

const pad2 = (value: number) => String(value).padStart(2, "0");

function formatResetDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

function formatResetLabel(resetsAt?: number | null) {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) {
    return null;
  }
  const resetMs = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1000;
  return `${formatResetDate(resetMs)} 重置`;
}

function formatWindowLimitLabel(
  windowDurationMins: number | null | undefined,
  fallback: string,
) {
  if (
    typeof windowDurationMins !== "number" ||
    !Number.isFinite(windowDurationMins) ||
    windowDurationMins <= 0
  ) {
    return fallback;
  }

  const roundedMins = Math.round(windowDurationMins);
  if (roundedMins % (60 * 24) === 0) {
    return `${roundedMins / (60 * 24)}天`;
  }
  if (roundedMins % 60 === 0) {
    return `${roundedMins / 60}小时`;
  }
  return `${roundedMins}分钟`;
}

function formatCreditsLabel(accountRateLimits: RateLimitSnapshot | null) {
  const credits = accountRateLimits?.credits ?? null;
  if (!credits?.hasCredits) {
    return null;
  }
  if (credits.unlimited) {
    return "可用额度：不限量";
  }
  const balance = credits.balance?.trim() ?? "";
  if (!balance) {
    return null;
  }
  const intValue = Number.parseInt(balance, 10);
  if (Number.isFinite(intValue) && intValue > 0) {
    return `可用额度：${intValue}`;
  }
  const floatValue = Number.parseFloat(balance);
  if (Number.isFinite(floatValue) && floatValue > 0) {
    const rounded = Math.round(floatValue);
    return rounded > 0 ? `可用额度：${rounded}` : null;
  }
  return null;
}

export function getUsageLabels(
  accountRateLimits: RateLimitSnapshot | null,
  showRemaining: boolean,
): UsageLabels {
  const usagePercent = accountRateLimits?.primary?.usedPercent;
  const globalUsagePercent = accountRateLimits?.secondary?.usedPercent;
  const sessionPercent =
    typeof usagePercent === "number"
      ? showRemaining
        ? 100 - clampPercent(usagePercent)
        : clampPercent(usagePercent)
      : null;
  const weeklyPercent =
    typeof globalUsagePercent === "number"
      ? showRemaining
        ? 100 - clampPercent(globalUsagePercent)
        : clampPercent(globalUsagePercent)
      : null;
  const weeklyRemainingPercent =
    typeof globalUsagePercent === "number"
      ? 100 - clampPercent(globalUsagePercent)
      : null;

  return {
    sessionPercent,
    weeklyPercent,
    weeklyRemainingPercent,
    sessionWindowLabel: formatWindowLimitLabel(
      accountRateLimits?.primary?.windowDurationMins,
      "本轮会话",
    ),
    weeklyWindowLabel: formatWindowLimitLabel(
      accountRateLimits?.secondary?.windowDurationMins,
      "本周",
    ),
    sessionResetLabel: formatResetLabel(accountRateLimits?.primary?.resetsAt),
    weeklyResetLabel: formatResetLabel(accountRateLimits?.secondary?.resetsAt),
    creditsLabel: formatCreditsLabel(accountRateLimits),
    showWeekly: Boolean(accountRateLimits?.secondary),
  };
}
