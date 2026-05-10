import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Settings from "lucide-react/dist/esm/icons/settings";
import User from "lucide-react/dist/esm/icons/user";
import X from "lucide-react/dist/esm/icons/x";
import { useEffect } from "react";
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
