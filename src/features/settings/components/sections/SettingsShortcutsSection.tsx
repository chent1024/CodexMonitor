import { useMemo, useState, type KeyboardEvent } from "react";
import {
  SettingsSection,
  SettingsSubsection,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { formatShortcut, getDefaultInterruptShortcut } from "@utils/shortcuts";
import { isMacPlatform } from "@utils/platformPaths";
import type {
  ShortcutDraftKey,
  ShortcutDrafts,
  ShortcutSettingKey,
} from "@settings/components/settingsTypes";

type ShortcutItem = {
  label: string;
  draftKey: ShortcutDraftKey;
  settingKey: ShortcutSettingKey;
  help: string;
};

type ShortcutGroup = {
  title: string;
  subtitle: string;
  items: ShortcutItem[];
};

type SettingsShortcutsSectionProps = {
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => void;
  onClearShortcut: (key: ShortcutSettingKey) => void;
};

function ShortcutField({
  item,
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
}: {
  item: ShortcutItem;
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => void;
  onClearShortcut: (key: ShortcutSettingKey) => void;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">{item.label}</div>
      <div className="settings-field-row">
        <input
          className="settings-input settings-input--shortcut"
          value={formatShortcut(shortcutDrafts[item.draftKey])}
          onKeyDown={(event) => onShortcutKeyDown(event, item.settingKey)}
          placeholder="按下快捷键"
          readOnly
        />
        <button
          type="button"
          className="ghost settings-button-compact"
          onClick={() => onClearShortcut(item.settingKey)}
        >
          清除
        </button>
      </div>
      <div className="settings-help">{item.help}</div>
    </div>
  );
}

export function SettingsShortcutsSection({
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
}: SettingsShortcutsSectionProps) {
  const isMac = isMacPlatform();
  const [searchQuery, setSearchQuery] = useState("");

  const groups = useMemo<ShortcutGroup[]>(
    () => [
      {
        title: "文件",
        subtitle: "通过键盘创建智能体和 worktree。",
        items: [
          {
            label: "新建智能体",
            draftKey: "newAgent",
            settingKey: "newAgentShortcut",
            help: `默认：${formatShortcut("cmd+n")}`,
          },
          {
            label: "新建 Worktree 智能体",
            draftKey: "newWorktreeAgent",
            settingKey: "newWorktreeAgentShortcut",
            help: `默认：${formatShortcut("cmd+shift+n")}`,
          },
          {
            label: "新建克隆智能体",
            draftKey: "newCloneAgent",
            settingKey: "newCloneAgentShortcut",
            help: `默认：${formatShortcut("cmd+alt+n")}`,
          },
          {
            label: "归档当前会话",
            draftKey: "archiveThread",
            settingKey: "archiveThreadShortcut",
            help: `默认：${formatShortcut(isMac ? "cmd+ctrl+a" : "ctrl+alt+a")}`,
          },
        ],
      },
      {
        title: "Composer",
        subtitle: "在模型、访问、推理和协作模式间切换。",
        items: [
          {
            label: "切换模型",
            draftKey: "model",
            settingKey: "composerModelShortcut",
            help: `聚焦后按新的快捷键。默认：${formatShortcut("cmd+shift+m")}`,
          },
          {
            label: "切换访问模式",
            draftKey: "access",
            settingKey: "composerAccessShortcut",
            help: `默认：${formatShortcut("cmd+shift+a")}`,
          },
          {
            label: "切换推理模式",
            draftKey: "reasoning",
            settingKey: "composerReasoningShortcut",
            help: `默认：${formatShortcut("cmd+shift+r")}`,
          },
          {
            label: "切换协作模式",
            draftKey: "collaboration",
            settingKey: "composerCollaborationShortcut",
            help: `默认：${formatShortcut("shift+tab")}`,
          },
          {
            label: "停止当前运行",
            draftKey: "interrupt",
            settingKey: "interruptShortcut",
            help: `默认：${formatShortcut(getDefaultInterruptShortcut())}`,
          },
        ],
      },
      {
        title: "面板",
        subtitle: "切换侧边栏和面板显示。",
        items: [
          {
            label: "切换项目侧边栏",
            draftKey: "projectsSidebar",
            settingKey: "toggleProjectsSidebarShortcut",
            help: `默认：${formatShortcut("cmd+shift+p")}`,
          },
          {
            label: "切换 Git 侧边栏",
            draftKey: "gitSidebar",
            settingKey: "toggleGitSidebarShortcut",
            help: `默认：${formatShortcut("cmd+shift+g")}`,
          },
          {
            label: "分支切换器",
            draftKey: "branchSwitcher",
            settingKey: "branchSwitcherShortcut",
            help: `默认：${formatShortcut("cmd+b")}`,
          },
          {
            label: "切换调试面板",
            draftKey: "debugPanel",
            settingKey: "toggleDebugPanelShortcut",
            help: `默认：${formatShortcut("cmd+shift+d")}`,
          },
          {
            label: "切换终端面板",
            draftKey: "terminal",
            settingKey: "toggleTerminalShortcut",
            help: `默认：${formatShortcut("cmd+shift+t")}`,
          },
        ],
      },
      {
        title: "导航",
        subtitle: "在智能体和项目间切换。",
        items: [
          {
            label: "下一个智能体",
            draftKey: "cycleAgentNext",
            settingKey: "cycleAgentNextShortcut",
            help: `默认：${formatShortcut(isMac ? "cmd+ctrl+down" : "ctrl+alt+down")}`,
          },
          {
            label: "上一个智能体",
            draftKey: "cycleAgentPrev",
            settingKey: "cycleAgentPrevShortcut",
            help: `默认：${formatShortcut(isMac ? "cmd+ctrl+up" : "ctrl+alt+up")}`,
          },
          {
            label: "下一个项目",
            draftKey: "cycleWorkspaceNext",
            settingKey: "cycleWorkspaceNextShortcut",
            help: `默认：${formatShortcut(isMac ? "cmd+shift+down" : "ctrl+alt+shift+down")}`,
          },
          {
            label: "上一个项目",
            draftKey: "cycleWorkspacePrev",
            settingKey: "cycleWorkspacePrevShortcut",
            help: `默认：${formatShortcut(isMac ? "cmd+shift+up" : "ctrl+alt+shift+up")}`,
          },
        ],
      },
    ],
    [isMac],
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedSearchQuery) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const searchValue = `${group.title} ${group.subtitle} ${item.label} ${item.help}`.toLowerCase();
          return searchValue.includes(normalizedSearchQuery);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedSearchQuery]);

  return (
    <SettingsSection
      title="快捷键"
      subtitle="自定义文件操作、Composer、面板和导航相关的快捷键。"
    >
      <div className="settings-field settings-shortcuts-search">
        <label className="settings-field-label" htmlFor="settings-shortcuts-search">
          搜索快捷键
        </label>
        <div className="settings-field-row">
          <input
            id="settings-shortcuts-search"
            className="settings-input"
            placeholder="搜索快捷键"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => setSearchQuery("")}
            >
              清除
            </button>
          )}
        </div>
        <div className="settings-help">可按分组名、动作名称或默认快捷键过滤。</div>
      </div>
      {filteredGroups.map((group, index) => (
        <div key={group.title}>
          {index > 0 && <div className="settings-divider" />}
          <SettingsSubsection title={group.title} subtitle={group.subtitle} />
          {group.items.map((item) => (
            <ShortcutField
              key={item.settingKey}
              item={item}
              shortcutDrafts={shortcutDrafts}
              onShortcutKeyDown={onShortcutKeyDown}
              onClearShortcut={onClearShortcut}
            />
          ))}
        </div>
      ))}
      {filteredGroups.length === 0 && (
        <div className="settings-empty">
          没有匹配{normalizedSearchQuery ? `“${searchQuery.trim()}”` : "当前搜索"}的快捷键。
        </div>
      )}
    </SettingsSection>
  );
}
