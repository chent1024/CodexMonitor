import type {
  AccountSnapshot,
  LocalUsageDay,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../types";
import { formatRelativeTime } from "../../utils/time";
import { getUsageLabels } from "../app/utils/usageLabels";
import {
  buildWindowCaption,
  formatAccountTypeLabel,
  formatCompactNumber,
  formatCount,
  formatCreditsBalance,
  formatDayCount,
  formatDayLabel,
  formatDuration,
  formatDurationCompact,
  formatPlanType,
  isUsageDayActive,
} from "./homeFormatters";
import type { HomeStatCard, UsageMetric } from "./homeTypes";

type HomeUsageViewModel = {
  accountCards: HomeStatCard[];
  accountMeta: string | null;
  updatedLabel: string | null;
  usageCards: HomeStatCard[];
  usageDays: LocalUsageDay[];
  usageInsights: HomeStatCard[];
};

export function buildHomeUsageViewModel({
  accountInfo,
  accountRateLimits,
  localUsageSnapshot,
  usageMetric,
  usageShowRemaining,
}: {
  accountInfo: AccountSnapshot | null;
  accountRateLimits: RateLimitSnapshot | null;
  localUsageSnapshot: LocalUsageSnapshot | null;
  usageMetric: UsageMetric;
  usageShowRemaining: boolean;
}): HomeUsageViewModel {
  const usageTotals = localUsageSnapshot?.totals ?? null;
  const usageDays = localUsageSnapshot?.days ?? [];
  const latestUsageDay = usageDays[usageDays.length - 1] ?? null;
  const last7Days = usageDays.slice(-7);
  const last7Tokens = last7Days.reduce((total, day) => total + day.totalTokens, 0);
  const last7Input = last7Days.reduce((total, day) => total + day.inputTokens, 0);
  const last7Cached = last7Days.reduce(
    (total, day) => total + day.cachedInputTokens,
    0,
  );
  const last7AgentMs = last7Days.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const last30AgentMs = usageDays.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const averageDailyAgentMs =
    last7Days.length > 0 ? Math.round(last7AgentMs / last7Days.length) : 0;
  const last7AgentRuns = last7Days.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const last30AgentRuns = usageDays.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const averageTokensPerRun =
    last7AgentRuns > 0 ? Math.round(last7Tokens / last7AgentRuns) : null;
  const averageRunDurationMs =
    last7AgentRuns > 0 ? Math.round(last7AgentMs / last7AgentRuns) : null;
  const last7ActiveDays = last7Days.filter(isUsageDayActive).length;
  const last30ActiveDays = usageDays.filter(isUsageDayActive).length;
  const averageActiveDayAgentMs =
    last7ActiveDays > 0 ? Math.round(last7AgentMs / last7ActiveDays) : null;
  const peakAgentDay = usageDays.reduce<
    | { day: string; agentTimeMs: number }
    | null
  >((best, day) => {
    const value = day.agentTimeMs ?? 0;
    if (value <= 0) {
      return best;
    }
    if (!best || value > best.agentTimeMs) {
      return { day: day.day, agentTimeMs: value };
    }
    return best;
  }, null);

  let longestStreak = 0;
  let runningStreak = 0;
  for (const day of usageDays) {
    if (isUsageDayActive(day)) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const usageCards: HomeStatCard[] =
    usageMetric === "tokens"
      ? [
          {
            label: "今天",
            value: formatCompactNumber(latestUsageDay?.totalTokens ?? 0),
            suffix: "Token",
            caption: latestUsageDay
              ? `${formatDayLabel(latestUsageDay.day)} · ${formatCount(
                  latestUsageDay.inputTokens,
                )} 输入 / ${formatCount(latestUsageDay.outputTokens)} 输出`
              : "最近可用日期",
          },
          {
            label: "近 7 天",
            value: formatCompactNumber(usageTotals?.last7DaysTokens ?? last7Tokens),
            suffix: "Token",
            caption: `日均 ${formatCompactNumber(usageTotals?.averageDailyTokens)}`,
          },
          {
            label: "近 30 天",
            value: formatCompactNumber(usageTotals?.last30DaysTokens ?? last7Tokens),
            suffix: "Token",
            caption: `合计 ${formatCount(usageTotals?.last30DaysTokens ?? last7Tokens)}`,
          },
          {
            label: "缓存命中率",
            value: usageTotals
              ? `${usageTotals.cacheHitRatePercent.toFixed(1)}%`
              : "--",
            caption: "近 7 天",
          },
          {
            label: "缓存 Token",
            value: formatCompactNumber(last7Cached),
            suffix: "已节省",
            caption:
              last7Input > 0
                ? `${((last7Cached / last7Input) * 100).toFixed(1)}% 提示词 Token`
                : "近 7 天",
          },
          {
            label: "平均 / 次",
            value:
              averageTokensPerRun === null
                ? "--"
                : formatCompactNumber(averageTokensPerRun),
            suffix: "Token",
            caption:
              last7AgentRuns > 0
                ? `近 7 天 ${formatCount(last7AgentRuns)} 次运行`
                : "暂无运行",
          },
          {
            label: "峰值日期",
            value: formatDayLabel(usageTotals?.peakDay),
            caption: `${formatCompactNumber(usageTotals?.peakDayTokens)} Token`,
          },
        ]
      : [
          {
            label: "近 7 天",
            value: formatDurationCompact(last7AgentMs),
            suffix: "智能体时长",
            caption: `日均 ${formatDurationCompact(averageDailyAgentMs)}`,
          },
          {
            label: "近 30 天",
            value: formatDurationCompact(last30AgentMs),
            suffix: "智能体时长",
            caption: `合计 ${formatDuration(last30AgentMs)}`,
          },
          {
            label: "运行次数",
            value: formatCount(last7AgentRuns),
            suffix: "次",
            caption: `近 30 天：${formatCount(last30AgentRuns)} 次`,
          },
          {
            label: "平均 / 次",
            value: formatDurationCompact(averageRunDurationMs),
            caption:
              last7AgentRuns > 0
                ? `基于 ${formatCount(last7AgentRuns)} 次运行`
                : "暂无运行",
          },
          {
            label: "平均 / 活跃日",
            value: formatDurationCompact(averageActiveDayAgentMs),
            caption:
              last7ActiveDays > 0
                ? `近 7 天 ${formatCount(last7ActiveDays)} 个活跃日`
                : "暂无活跃日",
          },
          {
            label: "峰值日期",
            value: formatDayLabel(peakAgentDay?.day ?? null),
            caption: `${formatDurationCompact(peakAgentDay?.agentTimeMs ?? 0)} 智能体时长`,
          },
        ];

  const usageInsights = [
    {
      label: "最长连续活跃",
      value: longestStreak > 0 ? formatDayCount(longestStreak) : "--",
      caption:
        longestStreak > 0
          ? "当前统计范围内"
          : "暂无连续活跃",
      compact: true,
    },
    {
      label: "活跃天数",
      value: last7Days.length > 0 ? `${last7ActiveDays} / ${last7Days.length}` : "--",
      caption:
        usageDays.length > 0
          ? `当前范围 ${last30ActiveDays} / ${usageDays.length}`
          : "暂无活动",
      compact: true,
    },
  ] satisfies HomeStatCard[];

  const usagePercentLabels = getUsageLabels(accountRateLimits, usageShowRemaining);
  const planLabel = formatPlanType(accountRateLimits?.planType ?? accountInfo?.planType);
  const creditsBalance = formatCreditsBalance(accountRateLimits?.credits?.balance);
  const accountCards: HomeStatCard[] = [];

  if (usagePercentLabels.sessionPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? "会话剩余" : "会话已用",
      value: `${usagePercentLabels.sessionPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.sessionResetLabel,
        accountRateLimits?.primary?.windowDurationMins,
        "当前窗口",
      ),
    });
  }

  if (usagePercentLabels.showWeekly && usagePercentLabels.weeklyPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? "每周剩余" : "每周已用",
      value: `${usagePercentLabels.weeklyPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.weeklyResetLabel,
        accountRateLimits?.secondary?.windowDurationMins,
        "长周期窗口",
      ),
    });
  }

  if (accountRateLimits?.credits?.hasCredits) {
    accountCards.push(
      accountRateLimits.credits.unlimited
        ? {
            label: "额度",
            value: "不限量",
            caption: "可用余额",
          }
        : {
            label: "额度",
            value: creditsBalance ?? "--",
            suffix: creditsBalance ? "额度" : null,
            caption: "可用余额",
          },
    );
  }

  if (planLabel) {
    accountCards.push({
      label: "套餐",
      value: planLabel,
      caption: formatAccountTypeLabel(accountInfo?.type),
    });
  }

  return {
    accountCards,
    accountMeta: accountInfo?.email ?? null,
    updatedLabel: localUsageSnapshot
      ? `更新于 ${formatRelativeTime(localUsageSnapshot.updatedAt)}`
      : null,
    usageCards,
    usageDays,
    usageInsights,
  };
}
