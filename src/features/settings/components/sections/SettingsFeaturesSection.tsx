import type { CodexFeature } from "@/types";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsFeaturesSectionProps } from "@settings/hooks/useSettingsFeaturesSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";

const FEATURE_DESCRIPTION_FALLBACKS: Record<string, string> = {
  undo: "每轮创建一个幽灵提交。",
  shell_tool: "启用默认 shell 工具。",
  unified_exec: "使用统一的 PTY 执行工具。",
  shell_snapshot: "启用 shell 快照。",
  js_repl: "启用由持久 Node 内核支持的 JavaScript REPL 工具。",
  js_repl_tools_only: "只向模型直接暴露 js_repl 工具。",
  web_search_request: "已废弃。请改用顶层 web_search。",
  web_search_cached: "已废弃。请改用顶层 web_search。",
  search_tool: "已移除的旧搜索标记，仅保留兼容性。",
  runtime_metrics: "通过手动读取器启用运行时指标快照。",
  sqlite: "将 rollout 元数据持久化到本地 SQLite 数据库。",
  memory_tool: "启用启动记忆提取和记忆整理。",
  child_agents_md: "将额外的 AGENTS.md 指引追加到用户说明中。",
  apply_patch_freeform: "包含自由格式的 apply_patch 工具。",
  use_linux_sandbox_bwrap: "使用基于 bubblewrap 的 Linux 沙箱流程。",
  request_rule: "允许审批请求和 exec 规则提议。",
  experimental_windows_sandbox:
    "已移除的 Windows 沙箱标记，仅保留兼容性。",
  elevated_windows_sandbox:
    "已移除的高权限 Windows 沙箱标记，仅保留兼容性。",
  remote_models: "在 AppReady 之前刷新远端模型。",
  powershell_utf8: "强制 PowerShell 使用 UTF-8 输出。",
  enable_request_compression:
    "压缩发送到 codex-backend 的流式请求体。",
  apps: "启用 ChatGPT Apps 集成。",
  apps_mcp_gateway: "通过已配置网关转发 Apps MCP 调用。",
  skill_mcp_dependency_install:
    "允许提示并安装缺失的 MCP 依赖。",
  skill_env_var_dependency_prompt:
    "为缺失的技能环境变量依赖提供提示。",
  steer: "当 Codex 支持时启用 turn steering 能力。",
  collaboration_modes: "启用协作模式预设。",
  personality: "启用人格选择。",
  responses_websockets:
    "默认对 OpenAI 使用 Responses API WebSocket 传输。",
  responses_websockets_v2: "启用 Responses API WebSocket v2 模式。",
};

function formatFeatureLabel(feature: CodexFeature): string {
  const displayName = feature.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return feature.name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function featureSubtitle(feature: CodexFeature): string {
  if (feature.description?.trim()) {
    return feature.description;
  }
  if (feature.announcement?.trim()) {
    return feature.announcement;
  }
  const fallbackDescription = FEATURE_DESCRIPTION_FALLBACKS[feature.name];
  if (fallbackDescription) {
    return fallbackDescription;
  }
  if (feature.stage === "deprecated") {
    return "已废弃的功能开关。";
  }
  if (feature.stage === "removed") {
    return "为兼容性保留的旧功能开关。";
  }
  return `功能键：features.${feature.name}`;
}

export function SettingsFeaturesSection({
  appSettings,
  hasFeatureWorkspace,
  openConfigError,
  featureError,
  featuresLoading,
  featureUpdatingKey,
  stableFeatures,
  experimentalFeatures,
  hasDynamicFeatureRows,
  onOpenConfig,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  return (
    <SettingsSection
      title="功能特性"
      subtitle="管理稳定版和实验性的 Codex 功能。"
    >
      <SettingsToggleRow
        title="配置文件"
        subtitle={`在${fileManagerName()}中打开 Codex 配置。`}
      >
        <button type="button" className="ghost" onClick={onOpenConfig}>
          {openInFileManagerLabel()}
        </button>
      </SettingsToggleRow>
      {openConfigError && <div className="settings-help">{openConfigError}</div>}
      <SettingsSubsection
        title="稳定功能"
        subtitle="默认启用、可用于生产的功能。"
      />
      <SettingsToggleRow
        title="人格"
        subtitle={
          <>
            选择 Codex 的沟通风格（会写入 config.toml 顶层的 <code>personality</code>）。
          </>
        }
      >
        <select
          id="features-personality-select"
          className="settings-select"
          value={appSettings.personality}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              personality: event.target.value as (typeof appSettings)["personality"],
            })
          }
          aria-label="人格"
        >
          <option value="friendly">友好</option>
          <option value="pragmatic">务实</option>
        </select>
      </SettingsToggleRow>
      <SettingsToggleRow
        title="需要回应时暂停排队消息"
        subtitle="当 Codex 正在等待你接受/修改计划或回答问题时，暂停排队消息。"
      >
        <SettingsToggleSwitch
          pressed={appSettings.pauseQueuedMessagesWhenResponseRequired}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              pauseQueuedMessagesWhenResponseRequired:
                !appSettings.pauseQueuedMessagesWhenResponseRequired,
            })
          }
        />
      </SettingsToggleRow>
      {stableFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        stableFeatures.length === 0 && (
        <div className="settings-help">Codex 没有返回稳定功能开关。</div>
      )}
      <SettingsSubsection
        title="实验功能"
        subtitle="预览版和开发中的功能。"
      />
      {experimentalFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        hasDynamicFeatureRows &&
        experimentalFeatures.length === 0 && (
          <div className="settings-help">
            Codex 没有返回预览版或开发中的功能开关。
          </div>
        )}
      {featuresLoading && (
        <div className="settings-help">正在加载 Codex 功能开关...</div>
      )}
      {!hasFeatureWorkspace && !featuresLoading && (
        <div className="settings-help">
          连接一个项目后才能加载 Codex 功能开关。
        </div>
      )}
      {featureError && <div className="settings-help">{featureError}</div>}
    </SettingsSection>
  );
}
