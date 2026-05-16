import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Settings from "lucide-react/dist/esm/icons/settings";
import User from "lucide-react/dist/esm/icons/user";
import X from "lucide-react/dist/esm/icons/x";
import { useCallback, useEffect, useState } from "react";
import type { DaemonHealthStatus, TcpDaemonStatus } from "@/types";
import {
  daemonHealthStatus,
  getRestartSafeSessionDebugStatus,
  tailscaleDaemonStatus,
  type RestartSafeDebugStatus,
} from "@/services/tauri";
import {
  MenuTrigger,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../hooks/useMenuController";

type SidebarBottomRailProps = {
  sessionPercent: number | null;
  weeklyRemainingPercent: number | null;
  sessionWindowLabel: string;
  weeklyWindowLabel: string;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  showAccountSwitcher: boolean;
  accountLabel: string;
  accountActionLabel: string;
  accountDisabled: boolean;
  accountSwitching: boolean;
  accountCancelDisabled: boolean;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
};

type UsageRowProps = {
  label: string;
  percent: number | null;
  resetLabel: string | null;
};

type DaemonIndicatorTone = "checking" | "healthy" | "warning" | "stopped" | "error";

type DaemonIndicatorState = {
  tone: DaemonIndicatorTone;
  title: string;
  details: string[];
};

const DAEMON_INDICATOR_REFRESH_INTERVAL_MS = 60_000;
const DAEMON_INDICATOR_ERROR_RETRY_MS = 3_000;

function daemonIndicatorStateEqual(
  a: DaemonIndicatorState,
  b: DaemonIndicatorState,
) {
  return (
    a.tone === b.tone &&
    a.title === b.title &&
    a.details.length === b.details.length &&
    a.details.every((detail, index) => detail === b.details[index])
  );
}

function restartSafeCount(
  status: RestartSafeDebugStatus,
  field: keyof RestartSafeDebugStatus,
  fallbackField?: keyof RestartSafeDebugStatus,
) {
  const value = status[field];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const fallbackValue = fallbackField ? status[fallbackField] : null;
  if (typeof fallbackValue === "number" && Number.isFinite(fallbackValue)) {
    return fallbackValue;
  }
  return 0;
}

function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }
  const runtimeWindow = window as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(runtimeWindow.__TAURI__ || runtimeWindow.__TAURI_INTERNALS__);
}

function formatCompactResetLabel(resetLabel: string | null) {
  const value = resetLabel?.replace(/^Resets\s+/i, "").trim();
  return value || null;
}

function UsageRow({ label, percent, resetLabel }: UsageRowProps) {
  const compactResetLabel = formatCompactResetLabel(resetLabel);

  return (
    <div className="sidebar-usage-row">
      <div className="sidebar-usage-row-head">
        <span className="sidebar-usage-name">{label}</span>
        <span className="sidebar-usage-value">
          {percent === null ? "--" : `${percent}%`}
        </span>
      </div>
      <div className="sidebar-usage-bar" aria-hidden>
        <span className="sidebar-usage-bar-fill" style={{ width: `${percent ?? 0}%` }} />
      </div>
      {compactResetLabel && <div className="sidebar-usage-reset">{compactResetLabel}</div>}
    </div>
  );
}

function getDaemonStatusTitle(status: TcpDaemonStatus, restartSafeError: string | null) {
  if (status.state === "running") {
    return restartSafeError ? "Daemon 可用，重启保护异常" : "Daemon 正常";
  }
  if (status.state === "error") {
    return "Daemon 异常";
  }
  return "Daemon 已停止";
}

function formatDaemonDetailLines(
  status: TcpDaemonStatus,
  restartSafeStatus: RestartSafeDebugStatus | null,
  restartSafeError: string | null,
  healthStatus: DaemonHealthStatus | null,
) {
  const lines: string[] = [];
  if (status.state === "running") {
    const listen = status.listenAddr ?? "未知监听地址";
    lines.push(status.pid ? `监听 ${listen} · PID ${status.pid}` : `监听 ${listen}`);
  } else if (status.state === "error") {
    lines.push(status.lastError ?? "状态读取异常，请在服务器设置中刷新。");
  } else {
    lines.push(status.listenAddr ? `未运行 · ${status.listenAddr}` : "未运行");
  }
  const restartSafeLines = formatRestartSafeDetailLines(restartSafeStatus);
  if (restartSafeLines.length > 0) {
    lines.push(...restartSafeLines);
  }
  if (restartSafeError) {
    lines.push(`重启保护 ${restartSafeError}`);
  }
  if (healthStatus?.connected) {
    lines.push(
      healthStatus.terminalRpcSupported
        ? `Terminal RPC ${healthStatus.terminalRpcVersion}`
        : `Terminal RPC 缺失，需要 ${healthStatus.requiredTerminalRpcVersion}`,
    );
    lines.push(...healthStatus.warnings);
  } else if (healthStatus?.lastError) {
    lines.push(healthStatus.lastError);
  }
  return lines;
}

function formatRestartSafeDetailLines(status: RestartSafeDebugStatus | null) {
  if (!status) {
    return [];
  }
  const retainedSessionCount = restartSafeCount(
    status,
    "retainedSessionCount",
    "sessionCount",
  );
  const processingSessionCount = restartSafeCount(status, "processingSessionCount");
  const pendingRequestCount = restartSafeCount(status, "pendingRequestCount");
  const journalEventCount = restartSafeCount(status, "journalEventCount");
  return [
    `会话 ${retainedSessionCount} 已保留 · ${processingSessionCount} 处理中 · ${pendingRequestCount} 待处理`,
    `事件 ${journalEventCount} 已缓存 · ${
      status.idleShutdownAllowed ? "空闲后可退出" : "将继续保留"
    }`,
  ];
}

function useDaemonIndicatorState(): [DaemonIndicatorState, () => void] {
  const tauriRuntime = isTauriRuntime();
  const [state, setState] = useState<DaemonIndicatorState>(() =>
    tauriRuntime
      ? {
          tone: "checking",
          title: "正在检查 daemon",
          details: ["读取本机 daemon 和重启保护状态。"],
        }
      : {
          tone: "stopped",
          title: "Daemon 状态不可用",
          details: ["仅桌面运行时可读取。"],
        },
  );

  const refresh = useCallback(() => {
    if (!isTauriRuntime()) {
      setState({
        tone: "stopped",
        title: "Daemon 状态不可用",
        details: ["仅桌面运行时可读取。"],
      });
      return () => {};
    }
    let cancelled = false;
    void (async () => {
      setState((current) =>
        current.tone === "checking"
          ? current
          : {
              tone: "checking",
              title: "正在检查 daemon",
              details: ["读取本机 daemon 和重启保护状态。"],
            },
      );
      try {
        const daemonStatus = await tailscaleDaemonStatus();
        let restartSafeStatus: RestartSafeDebugStatus | null = null;
        let restartSafeError: string | null = null;
        let healthStatus: DaemonHealthStatus | null = null;
        if (daemonStatus.state === "running") {
          try {
            restartSafeStatus = await getRestartSafeSessionDebugStatus();
          } catch (error) {
            restartSafeError =
              error instanceof Error ? error.message : String(error);
          }
          try {
            healthStatus = await daemonHealthStatus();
          } catch (error) {
            healthStatus = {
              connected: false,
              name: null,
              version: null,
              appVersion: "",
              mode: null,
              pid: null,
              binaryPath: null,
              terminalRpcVersion: null,
              requiredTerminalRpcVersion: 1,
              terminalRpcSupported: false,
              restartSafeProtocolVersion: null,
              requiredRestartSafeProtocolVersion: 1,
              restartSafeProtocolCompatible: true,
              warnings: [],
              lastError: error instanceof Error ? error.message : String(error),
              roundTripMs: 0,
            };
          }
        }
        if (cancelled) {
          return;
        }
        const hasHealthWarning =
          healthStatus !== null &&
          (!healthStatus.connected ||
            healthStatus.warnings.length > 0 ||
            !healthStatus.terminalRpcSupported);
        const nextState: DaemonIndicatorState = {
          tone:
            daemonStatus.state === "running"
              ? restartSafeError || hasHealthWarning
                ? "warning"
                : "healthy"
              : daemonStatus.state === "error"
                ? "error"
                : "stopped",
          title: getDaemonStatusTitle(daemonStatus, restartSafeError),
          details: formatDaemonDetailLines(
            daemonStatus,
            restartSafeStatus,
            restartSafeError,
            healthStatus,
          ),
        };
        setState((previous) =>
          daemonIndicatorStateEqual(previous, nextState) ? previous : nextState,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const nextState: DaemonIndicatorState = {
          tone: "error",
          title: "Daemon 状态读取失败",
          details: [message],
        };
        setState((previous) =>
          daemonIndicatorStateEqual(previous, nextState) ? previous : nextState,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tauriRuntime) {
      return;
    }
    let cancelRefresh = refresh();
    const interval = window.setInterval(() => {
      cancelRefresh();
      cancelRefresh = refresh();
    }, DAEMON_INDICATOR_REFRESH_INTERVAL_MS);
    const handleFocus = () => {
      cancelRefresh();
      cancelRefresh = refresh();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelRefresh();
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refresh, tauriRuntime]);

  useEffect(() => {
    if (!tauriRuntime || state.tone !== "error") {
      return;
    }
    const retry = window.setTimeout(() => {
      refresh();
    }, DAEMON_INDICATOR_ERROR_RETRY_MS);
    return () => window.clearTimeout(retry);
  }, [refresh, state.tone, tauriRuntime]);

  return [state, () => refresh()];
}

function UsagePanel({
  sessionPercent,
  weeklyRemainingPercent,
  sessionWindowLabel,
  weeklyWindowLabel,
  sessionResetLabel,
  weeklyResetLabel,
  creditsLabel,
  showWeekly,
}: Pick<
  SidebarBottomRailProps,
  | "sessionPercent"
  | "weeklyRemainingPercent"
  | "sessionWindowLabel"
  | "weeklyWindowLabel"
  | "sessionResetLabel"
  | "weeklyResetLabel"
  | "creditsLabel"
  | "showWeekly"
>) {
  return (
    <div className="sidebar-usage-panel">
      {creditsLabel && (
        <div className="sidebar-usage-header">
          <div className="sidebar-usage-credits">{creditsLabel}</div>
        </div>
      )}
      <div className="sidebar-usage-list">
        <UsageRow
          label={sessionWindowLabel}
          percent={sessionPercent}
          resetLabel={sessionResetLabel}
        />
        {showWeekly && (
          <UsageRow
            label={weeklyWindowLabel}
            percent={weeklyRemainingPercent}
            resetLabel={weeklyResetLabel}
          />
        )}
      </div>
    </div>
  );
}

export function SidebarBottomRail({
  sessionPercent,
  weeklyRemainingPercent,
  sessionWindowLabel,
  weeklyWindowLabel,
  sessionResetLabel,
  weeklyResetLabel,
  creditsLabel,
  showWeekly,
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  showAccountSwitcher,
  accountLabel,
  accountActionLabel,
  accountDisabled,
  accountSwitching,
  accountCancelDisabled,
  onSwitchAccount,
  onCancelSwitchAccount,
}: SidebarBottomRailProps) {
  const [daemonIndicator, refreshDaemonIndicator] = useDaemonIndicatorState();
  const daemonTooltipLabel = [daemonIndicator.title, ...daemonIndicator.details].join("\n");
  const accountMenu = useMenuController();
  const {
    isOpen: accountMenuOpen,
    containerRef: accountMenuRef,
    close: closeAccountMenu,
    toggle: toggleAccountMenu,
  } = accountMenu;

  useEffect(() => {
    if (!showAccountSwitcher) {
      closeAccountMenu();
    }
  }, [closeAccountMenu, showAccountSwitcher]);

  return (
    <div className="sidebar-bottom-rail">
      <div
        className={`sidebar-bottom-actions${showAccountSwitcher ? "" : " is-compact"}`}
      >
        {showAccountSwitcher && (
          <div className="sidebar-account-menu" ref={accountMenuRef}>
            {!accountMenuOpen && (
              <PopoverSurface className="sidebar-usage-popover" role="status">
                <UsagePanel
                  sessionPercent={sessionPercent}
                  weeklyRemainingPercent={weeklyRemainingPercent}
                  sessionWindowLabel={sessionWindowLabel}
                  weeklyWindowLabel={weeklyWindowLabel}
                  sessionResetLabel={sessionResetLabel}
                  weeklyResetLabel={weeklyResetLabel}
                  creditsLabel={creditsLabel}
                  showWeekly={showWeekly}
                />
              </PopoverSurface>
            )}
            <MenuTrigger
              isOpen={accountMenuOpen}
              popupRole="dialog"
              className="ghost sidebar-labeled-button sidebar-account-trigger"
              activeClassName="is-open"
              onClick={toggleAccountMenu}
              aria-label="账户"
            >
              <span className="sidebar-account-trigger-content">
                <span className="sidebar-account-avatar" aria-hidden>
                  <User size={14} aria-hidden />
                </span>
                <span className="sidebar-account-trigger-label">账户</span>
              </span>
            </MenuTrigger>
            {accountMenuOpen && (
              <PopoverSurface className="sidebar-account-popover" role="dialog">
                <div className="sidebar-account-title">账户</div>
                <div className="sidebar-account-value">{accountLabel}</div>
                <div className="sidebar-account-actions-row">
                  <button
                    type="button"
                    className="primary sidebar-account-action"
                    onClick={onSwitchAccount}
                    disabled={accountDisabled}
                    aria-busy={accountSwitching}
                  >
                    <span className="sidebar-account-action-content">
                      {accountSwitching && (
                        <span className="sidebar-account-spinner" aria-hidden />
                      )}
                      <span>{accountActionLabel}</span>
                    </span>
                  </button>
                  {accountSwitching && (
                    <button
                      type="button"
                      className="secondary sidebar-account-cancel"
                      onClick={onCancelSwitchAccount}
                      disabled={accountCancelDisabled}
                      aria-label="取消切换账户"
                      title="取消"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </div>
              </PopoverSurface>
            )}
          </div>
        )}
        <div className="sidebar-utility-actions">
            <button
              className="ghost sidebar-labeled-button sidebar-utility-button"
              type="button"
              onClick={onOpenSettings}
              aria-label="打开设置"
            >
              <span className="sidebar-labeled-button-icon" aria-hidden>
                <Settings size={14} aria-hidden />
              </span>
              <span>设置</span>
            </button>
          <div className="sidebar-daemon-status">
            <button
              className={`sidebar-daemon-status-button is-${daemonIndicator.tone}`}
              type="button"
              onClick={refreshDaemonIndicator}
              aria-label={daemonTooltipLabel}
              aria-describedby="sidebar-daemon-status-tooltip"
            >
              <span className="sidebar-daemon-status-dot" aria-hidden />
            </button>
          </div>
          <PopoverSurface
            id="sidebar-daemon-status-tooltip"
            className="sidebar-daemon-status-tooltip"
            role="tooltip"
          >
            <span className="sidebar-daemon-status-tooltip-title">
              {daemonIndicator.title}
            </span>
            {daemonIndicator.details.map((line, index) => (
              <span className="sidebar-daemon-status-tooltip-line" key={`${index}-${line}`}>
                {line}
              </span>
            ))}
          </PopoverSurface>
          {showDebugButton && (
            <button
              className="ghost sidebar-utility-button"
              type="button"
              onClick={onOpenDebug}
              aria-label="打开调试日志"
            >
              <ScrollText size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
