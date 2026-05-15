import { useMemo } from "react";
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

type LocalMemoryReviewItem =
  SettingsFeaturesSectionProps["localMemoryReviewQueue"][number];

function memoryMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function memoryReviewLabel(memory: LocalMemoryReviewItem): string {
  const capture = memoryMetadataValue(memory.metadata, "capture");
  const trigger = memoryMetadataValue(memory.metadata, "trigger");
  const source = memoryMetadataValue(memory.metadata, "source");
  return [memory.scope, memory.kind, capture, trigger, source].filter(Boolean).join(" / ");
}

function memoryReviewSearchText(memory: LocalMemoryReviewItem): string {
  return [
    memory.content,
    memory.scope,
    memory.kind,
    memory.workspacePath,
    memory.threadId,
    memoryReviewLabel(memory),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
  localMemoryStatus,
  localMemoryLoading,
  localMemoryUpdating,
  localMemoryError,
  localMemoryQuery,
  localMemoryDraft,
  localMemoryDbPathDraft,
  localMemoryReviewFilter,
  localMemorySelectedReviewIds,
  localMemoryRecords,
  localMemoryReviewQueue,
  localMemoryEntities,
  localMemoryEvents,
  localMemoryConnection,
  localMemoryActionLoading,
  onOpenConfig,
  onToggleLocalMemory,
  onLocalMemoryQueryChange,
  onLocalMemoryDraftChange,
  onLocalMemoryDbPathDraftChange,
  onLocalMemoryReviewFilterChange,
  onApplyLocalMemoryDbPath,
  onApplyLocalMemoryEmbeddingModel,
  onCheckLocalMemoryConnection,
  onRefreshLocalMemories,
  onSearchLocalMemories,
  onAddLocalMemory,
  onUpdateLocalMemory,
  onDeleteLocalMemory,
  onDeleteAllLocalMemories,
  onDeleteLocalMemoryEntities,
  onRebuildLocalMemoryIndexes,
  onExportLocalMemories,
  onImportLocalMemories,
  onToggleLocalMemoryReviewSelection,
  onToggleAllLocalMemoryReviewSelection,
  onApproveLocalMemory,
  onEditAndApproveLocalMemory,
  onApproveSelectedLocalMemories,
  onRejectLocalMemory,
  onRejectSelectedLocalMemories,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  const visibleReviewQueue = useMemo(() => {
    const query = localMemoryReviewFilter.trim().toLowerCase();
    if (!query) {
      return localMemoryReviewQueue;
    }
    return localMemoryReviewQueue.filter((memory) =>
      memoryReviewSearchText(memory).includes(query),
    );
  }, [localMemoryReviewFilter, localMemoryReviewQueue]);
  const selectedReviewIds = useMemo(
    () => new Set(localMemorySelectedReviewIds),
    [localMemorySelectedReviewIds],
  );
  const visibleReviewIds = visibleReviewQueue.map((memory) => memory.id);
  const selectedVisibleReviewCount = visibleReviewIds.filter((id) =>
    selectedReviewIds.has(id),
  ).length;
  const allVisibleReviewSelected =
    visibleReviewIds.length > 0 && selectedVisibleReviewCount === visibleReviewIds.length;

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
      <SettingsToggleRow
        title="本地记忆"
        subtitle={
          <>
            使用本地 SQLite 与 sqlite-vec 的 Mem0-compatible MCP 服务。
            {localMemoryStatus ? (
              <>
                <br />
                <code>{localMemoryStatus.serverName}</code>
                {" -> "}
                <code>{localMemoryStatus.dbPath}</code>
                <br />
                <code>{localMemoryStatus.embeddingModel}</code>
                {" / "}
                <code>{localMemoryStatus.embeddingDim}d</code>
              </>
            ) : null}
          </>
        }
      >
        <SettingsToggleSwitch
          pressed={localMemoryStatus?.enabled ?? false}
          onClick={onToggleLocalMemory}
          disabled={localMemoryLoading || localMemoryUpdating}
        />
      </SettingsToggleRow>
      {localMemoryError && <div className="settings-help">{localMemoryError}</div>}
      {localMemoryStatus?.enabled && (
        <div className="settings-memory-manager">
          <div className="settings-memory-path-row">
            <input
              className="settings-input"
              value={localMemoryDbPathDraft}
              onChange={(event) => onLocalMemoryDbPathDraftChange(event.target.value)}
              placeholder="Local memory database path"
              aria-label="Local memory database path"
            />
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onApplyLocalMemoryDbPath}
              disabled={
                localMemoryActionLoading ||
                localMemoryDbPathDraft.trim() === localMemoryStatus.dbPath
              }
            >
              Apply Path
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onCheckLocalMemoryConnection}
              disabled={localMemoryActionLoading}
            >
              Check MCP
            </button>
          </div>
          {localMemoryConnection && (
            <div className="settings-memory-connection">
              <span>{localMemoryConnection.ok ? "MCP connected" : "MCP failed"}</span>
              {localMemoryConnection.protocolVersion && (
                <span>{localMemoryConnection.protocolVersion}</span>
              )}
              {localMemoryConnection.toolCount != null && (
                <span>{localMemoryConnection.toolCount} tools</span>
              )}
            </div>
          )}
          <div className="settings-memory-embedding-row">
            <select
              className="settings-select"
              value={localMemoryStatus.embeddingModel}
              onChange={(event) => onApplyLocalMemoryEmbeddingModel(event.target.value)}
              aria-label="Local memory embedding model"
              disabled={localMemoryActionLoading}
            >
              {(localMemoryStatus.embeddingModels ?? []).map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label} ({model.dim}d)
                </option>
              ))}
            </select>
            {localMemoryStatus.indexRebuildRecommended && (
              <span className="settings-memory-rebuild-hint">
                Rebuild recommended
              </span>
            )}
          </div>
          <div className="settings-memory-toolbar">
            <input
              className="settings-input"
              value={localMemoryQuery}
              onChange={(event) => onLocalMemoryQueryChange(event.target.value)}
              placeholder="Search local memory"
              aria-label="Search local memory"
            />
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onSearchLocalMemories}
              disabled={localMemoryActionLoading}
            >
              Search
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onRefreshLocalMemories}
              disabled={localMemoryActionLoading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onRebuildLocalMemoryIndexes}
              disabled={localMemoryActionLoading}
            >
              Rebuild
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onExportLocalMemories}
              disabled={localMemoryActionLoading || localMemoryRecords.length === 0}
            >
              Export
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onImportLocalMemories}
              disabled={localMemoryActionLoading}
            >
              Import
            </button>
          </div>
          <div className="settings-memory-add">
            <textarea
              className="settings-textarea"
              value={localMemoryDraft}
              onChange={(event) => onLocalMemoryDraftChange(event.target.value)}
              placeholder="Add a durable memory"
              aria-label="Add local memory"
              rows={3}
            />
            <button
              type="button"
              className="primary settings-button-compact"
              onClick={onAddLocalMemory}
              disabled={localMemoryActionLoading || !localMemoryDraft.trim()}
            >
              Add
            </button>
          </div>
          <div className="settings-memory-summary">
            <span>{localMemoryRecords.length} memories</span>
            <span>{localMemoryReviewQueue.length} pending</span>
            <span>{localMemoryEntities.length} entities</span>
            <span>{localMemoryEvents.length} events</span>
            {localMemoryActionLoading && <span>Working...</span>}
          </div>
          {localMemoryReviewQueue.length > 0 && (
            <div className="settings-memory-review">
              <div className="settings-memory-review-title">
                <span>Pending review</span>
                <span>
                  {visibleReviewQueue.length} / {localMemoryReviewQueue.length}
                </span>
              </div>
              <div className="settings-memory-review-toolbar">
                <input
                  className="settings-input"
                  value={localMemoryReviewFilter}
                  onChange={(event) =>
                    onLocalMemoryReviewFilterChange(event.target.value)
                  }
                  placeholder="Filter pending memory"
                  aria-label="Filter pending memory"
                />
                <button
                  type="button"
                  className="ghost settings-button-compact"
                  onClick={() => onToggleAllLocalMemoryReviewSelection(visibleReviewIds)}
                  disabled={localMemoryActionLoading || visibleReviewIds.length === 0}
                >
                  {allVisibleReviewSelected ? "Clear visible" : "Select visible"}
                </button>
                <button
                  type="button"
                  className="ghost settings-button-compact"
                  onClick={onApproveSelectedLocalMemories}
                  disabled={
                    localMemoryActionLoading ||
                    localMemorySelectedReviewIds.length === 0
                  }
                >
                  Approve selected
                </button>
                <button
                  type="button"
                  className="ghost settings-button-compact"
                  onClick={onRejectSelectedLocalMemories}
                  disabled={
                    localMemoryActionLoading ||
                    localMemorySelectedReviewIds.length === 0
                  }
                >
                  Reject selected
                </button>
              </div>
              {visibleReviewQueue.length === 0 && (
                <div className="settings-memory-review-empty">
                  No pending memories match the current filter.
                </div>
              )}
              {visibleReviewQueue.map((memory) => (
                <div className="settings-memory-row" key={memory.id}>
                  <label className="settings-memory-review-check">
                    <input
                      type="checkbox"
                      checked={selectedReviewIds.has(memory.id)}
                      onChange={() => onToggleLocalMemoryReviewSelection(memory.id)}
                      disabled={localMemoryActionLoading}
                      aria-label={`Select pending memory ${memory.id}`}
                    />
                  </label>
                  <div className="settings-memory-row-main">
                    <div className="settings-memory-row-meta">
                      {memoryReviewLabel(memory)}
                    </div>
                    <div className="settings-memory-row-content">{memory.content}</div>
                  </div>
                  <div className="settings-memory-row-actions">
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => onEditAndApproveLocalMemory(memory)}
                      disabled={localMemoryActionLoading}
                    >
                      Edit approve
                    </button>
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => onApproveLocalMemory(memory.id)}
                      disabled={localMemoryActionLoading}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => onRejectLocalMemory(memory.id)}
                      disabled={localMemoryActionLoading}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="settings-memory-list">
            {localMemoryRecords.map((memory) => (
              <div className="settings-memory-row" key={memory.id}>
                <div className="settings-memory-row-main">
                  <div className="settings-memory-row-meta">
                    {memory.scope} / {memory.kind}
                  </div>
                  <div className="settings-memory-row-content">{memory.content}</div>
                </div>
                <div className="settings-memory-row-actions">
                  <button
                    type="button"
                    className="ghost settings-button-compact"
                    onClick={() => onUpdateLocalMemory(memory)}
                    disabled={localMemoryActionLoading}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost settings-button-compact"
                    onClick={() => onDeleteLocalMemory(memory.id)}
                    disabled={localMemoryActionLoading}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {localMemoryRecords.length === 0 && (
              <div className="settings-help">No local memories found.</div>
            )}
          </div>
          {localMemoryEntities.length > 0 && (
            <div className="settings-memory-entities">
              {localMemoryEntities.slice(0, 24).map((entity) => (
                <span className="settings-memory-entity" key={entity.id}>
                  {entity.name} ({entity.memoryCount})
                </span>
              ))}
            </div>
          )}
          {localMemoryEvents.length > 0 && (
            <div className="settings-memory-events">
              {localMemoryEvents.slice(0, 8).map((event) => (
                <div className="settings-memory-event" key={event.id}>
                  <span>{event.event}</span>
                  <span>{event.status}</span>
                  {event.resultCount != null && <span>{event.resultCount} results</span>}
                </div>
              ))}
            </div>
          )}
          <div className="settings-memory-danger">
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onDeleteLocalMemoryEntities}
              disabled={localMemoryActionLoading || localMemoryEntities.length === 0}
            >
              Clear Entities
            </button>
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={onDeleteAllLocalMemories}
              disabled={localMemoryActionLoading || localMemoryRecords.length === 0}
            >
              Delete All
            </button>
          </div>
        </div>
      )}
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
