import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";

export type SidebarToggleProps = {
  isCompact: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCollapseRightPanel: () => void;
  onExpandRightPanel: () => void;
};

export function SidebarCollapseButton({
  isCompact,
  sidebarCollapsed,
  onCollapseSidebar,
}: SidebarToggleProps) {
  if (isCompact || sidebarCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action ds-tooltip-trigger"
      onClick={onCollapseSidebar}
      data-tauri-drag-region="false"
      aria-label="隐藏线程侧栏"
      title="隐藏线程侧栏"
      data-tooltip="隐藏线程侧栏"
      data-tooltip-placement="bottom"
    >
      <PanelLeftClose size={14} aria-hidden />
    </button>
  );
}

export function RightPanelCollapseButton({
  isCompact,
  rightPanelCollapsed,
  onCollapseRightPanel,
}: SidebarToggleProps) {
  if (isCompact || rightPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action ds-tooltip-trigger"
      onClick={onCollapseRightPanel}
      data-tauri-drag-region="false"
      aria-label="Hide git sidebar"
      title="Hide git sidebar"
      data-tooltip="Hide git sidebar"
      data-tooltip-placement="bottom"
    >
      <PanelRightClose size={14} aria-hidden />
    </button>
  );
}

export function RightPanelExpandButton({
  isCompact,
  rightPanelCollapsed,
  onExpandRightPanel,
}: SidebarToggleProps) {
  if (isCompact || !rightPanelCollapsed) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action ds-tooltip-trigger"
      onClick={onExpandRightPanel}
      data-tauri-drag-region="false"
      aria-label="Show git sidebar"
      title="Show git sidebar"
      data-tooltip="Show git sidebar"
      data-tooltip-placement="bottom"
    >
      <PanelRightOpen size={14} aria-hidden />
    </button>
  );
}

export function SidebarTitlebarControls({
  isCompact,
  sidebarCollapsed,
  onCollapseSidebar,
  onExpandSidebar,
}: SidebarToggleProps) {
  if (isCompact) {
    return null;
  }
  const Icon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const label = sidebarCollapsed ? "显示线程侧栏" : "隐藏线程侧栏";
  const onClick = sidebarCollapsed ? onExpandSidebar : onCollapseSidebar;

  return (
    <div className="titlebar-controls">
      <div className="titlebar-toggle titlebar-toggle-left">
        <button
          type="button"
          className="ghost main-header-action titlebar-sidebar-toggle-button ds-tooltip-trigger"
          onClick={onClick}
          data-tauri-drag-region="false"
          aria-label={label}
          title={label}
          data-tooltip={label}
          data-tooltip-placement="bottom"
        >
          <Icon size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
