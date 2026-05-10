import { useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ModelOption } from "@/types";
import {
  MagicSparkleIcon,
  MagicSparkleLoaderIcon,
} from "@/features/shared/components/MagicSparkleIcon";
import type { SettingsAgentsSectionProps } from "@settings/hooks/useSettingsAgentsSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";

const FALLBACK_AGENT_MODELS: ModelOption[] = [
  {
    id: "gpt-5-codex",
    model: "gpt-5-codex",
    displayName: "gpt-5-codex",
    description: "Fallback model while workspace model list is unavailable.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
      { reasoningEffort: "high", description: "" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
];

const MIN_MAX_THREADS = 1;
const MAX_MAX_THREADS = 12;
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 4;

export function SettingsAgentsSection({
  settings,
  isLoading,
  isUpdatingCore,
  creatingAgent,
  updatingAgentName,
  deletingAgentName,
  readingConfigAgentName,
  writingConfigAgentName,
  createDescriptionGenerating,
  editDescriptionGenerating,
  error,
  onRefresh,
  onSetMultiAgentEnabled,
  onSetMaxThreads,
  onSetMaxDepth,
  onCreateAgent,
  onUpdateAgent,
  onDeleteAgent,
  onReadAgentConfig,
  onWriteAgentConfig,
  onGenerateCreateDescription,
  onGenerateEditDescription,
  modelOptions,
  modelOptionsLoading,
  modelOptionsError,
}: SettingsAgentsSectionProps) {
  const [openPathError, setOpenPathError] = useState<string | null>(null);
  const [maxThreadsDraft, setMaxThreadsDraft] = useState("6");
  const [maxDepthDraft, setMaxDepthDraft] = useState("1");

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createDeveloperInstructions, setCreateDeveloperInstructions] = useState("");
  const [createModel, setCreateModel] = useState("");
  const [createReasoningEffort, setCreateReasoningEffort] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [pendingDeleteAgentName, setPendingDeleteAgentName] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [editDescriptionDraft, setEditDescriptionDraft] = useState("");
  const [editDeveloperInstructionsDraft, setEditDeveloperInstructionsDraft] = useState("");
  const [renameManagedFile, setRenameManagedFile] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const [configEditorAgentName, setConfigEditorAgentName] = useState<string | null>(null);
  const [configEditorContent, setConfigEditorContent] = useState("");
  const [configEditorDirty, setConfigEditorDirty] = useState(false);
  const canGenerateCreateFromName = createName.trim().length > 0;
  const effectiveModelOptions = modelOptions.length > 0 ? modelOptions : FALLBACK_AGENT_MODELS;

  useEffect(() => {
    if (!settings) {
      return;
    }
    setMaxThreadsDraft(String(settings.maxThreads));
    setMaxDepthDraft(String(settings.maxDepth));
  }, [settings]);

  const parseMaxThreads = (rawValue: string): number | null => {
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value) || value < MIN_MAX_THREADS || value > MAX_MAX_THREADS) {
      return null;
    }
    return value;
  };

  const parseMaxDepth = (rawValue: string): number | null => {
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value) || value < MIN_MAX_DEPTH || value > MAX_MAX_DEPTH) {
      return null;
    }
    return value;
  };

  const selectedCreateModel = useMemo(
    () => effectiveModelOptions.find((option) => option.model === createModel) ?? null,
    [createModel, effectiveModelOptions],
  );

  const createReasoningOptions = useMemo(() => {
    if (!selectedCreateModel) {
      return [];
    }
    const supported = selectedCreateModel.supportedReasoningEfforts
      .map((option) => option.reasoningEffort.trim().toLowerCase())
      .filter((value) => value.length > 0);
    if (supported.length > 0) {
      return Array.from(new Set(supported));
    }
    const fallback = selectedCreateModel.defaultReasoningEffort?.trim().toLowerCase() ?? "";
    return fallback ? [fallback] : [];
  }, [selectedCreateModel]);

  useEffect(() => {
    if (!effectiveModelOptions.length) {
      return;
    }
    if (
      !createModel ||
      !effectiveModelOptions.some((option) => option.model === createModel)
    ) {
      setCreateModel(effectiveModelOptions[0].model);
    }
  }, [createModel, effectiveModelOptions]);

  useEffect(() => {
    if (createReasoningOptions.length === 0) {
      setCreateReasoningEffort("");
      return;
    }
    if (!createReasoningOptions.includes(createReasoningEffort)) {
      if (createReasoningOptions.includes("medium")) {
        setCreateReasoningEffort("medium");
      } else {
        setCreateReasoningEffort(createReasoningOptions[0]);
      }
    }
  }, [createReasoningEffort, createReasoningOptions]);

  const handleOpenPath = async (path: string) => {
    setOpenPathError(null);
    try {
      await revealItemInDir(path);
    } catch (openError) {
      setOpenPathError(
        openError instanceof Error ? openError.message : "无法打开路径。",
      );
    }
  };

  const handleToggleMultiAgent = async () => {
    if (!settings) {
      return;
    }
    await onSetMultiAgentEnabled(!settings.multiAgentEnabled);
  };

  const handleMaxThreadsChange = async (rawValue: string) => {
    setMaxThreadsDraft(rawValue);
    const parsed = parseMaxThreads(rawValue);
    if (parsed == null) {
      setCreateError(null);
      setEditError(null);
      setOpenPathError(
        `最大线程数必须是 ${MIN_MAX_THREADS} 到 ${MAX_MAX_THREADS} 之间的整数。`,
      );
      return;
    }
    setOpenPathError(null);
    if (settings && parsed !== settings.maxThreads) {
      await onSetMaxThreads(parsed);
    }
  };

  const currentMaxThreads = settings
    ? (parseMaxThreads(maxThreadsDraft) ?? settings.maxThreads)
    : MIN_MAX_THREADS;

  const handleMaxThreadsStep = async (delta: number) => {
    if (!settings || isUpdatingCore) {
      return;
    }
    const nextValue = Math.min(
      MAX_MAX_THREADS,
      Math.max(MIN_MAX_THREADS, currentMaxThreads + delta),
    );
    if (nextValue === currentMaxThreads) {
      return;
    }
    await handleMaxThreadsChange(String(nextValue));
  };

  const handleMaxDepthChange = async (rawValue: string) => {
    setMaxDepthDraft(rawValue);
    const parsed = parseMaxDepth(rawValue);
    if (parsed == null) {
      setCreateError(null);
      setEditError(null);
      setOpenPathError(
        `最大深度必须是 ${MIN_MAX_DEPTH} 到 ${MAX_MAX_DEPTH} 之间的整数。`,
      );
      return;
    }
    setOpenPathError(null);
    if (settings && parsed !== settings.maxDepth) {
      await onSetMaxDepth(parsed);
    }
  };

  const currentMaxDepth = settings
    ? (parseMaxDepth(maxDepthDraft) ?? settings.maxDepth)
    : MIN_MAX_DEPTH;

  const handleMaxDepthStep = async (delta: number) => {
    if (!settings || isUpdatingCore) {
      return;
    }
    const nextValue = Math.min(
      MAX_MAX_DEPTH,
      Math.max(MIN_MAX_DEPTH, currentMaxDepth + delta),
    );
    if (nextValue === currentMaxDepth) {
      return;
    }
    await handleMaxDepthChange(String(nextValue));
  };

  const handleCreateAgent = async () => {
    const name = createName.trim();
    if (!name) {
      setCreateError("必须填写智能体名称。");
      return;
    }
    setCreateError(null);
    const success = await onCreateAgent({
      name,
      description: createDescription.trim() || null,
      developerInstructions: createDeveloperInstructions.trim() || null,
      template: "blank",
      model: createModel || null,
      reasoningEffort: createReasoningEffort || null,
    });
    if (success) {
      setCreateName("");
      setCreateDescription("");
      setCreateDeveloperInstructions("");
      setCreateReasoningEffort("");
    }
  };

  const startEditing = (agent: NonNullable<SettingsAgentsSectionProps["settings"]>["agents"][number]) => {
    setEditingName(agent.name);
    setEditNameDraft(agent.name);
    setEditDescriptionDraft(agent.description ?? "");
    setEditDeveloperInstructionsDraft(agent.developerInstructions ?? "");
    setRenameManagedFile(true);
    setEditError(null);
  };

  const handleUpdateAgent = async () => {
    if (!editingName) {
      return;
    }
    const nextName = editNameDraft.trim();
    if (!nextName) {
      setEditError("必须填写智能体名称。");
      return;
    }
    const editingAgent = settings?.agents.find((agent) => agent.name === editingName) ?? null;
    const previousDeveloperInstructions =
      editingAgent?.developerInstructions?.trim() ?? "";
    const nextDeveloperInstructions = editDeveloperInstructionsDraft.trim();
    const developerInstructionsChanged =
      nextDeveloperInstructions !== previousDeveloperInstructions;
    setEditError(null);
    const updateInput: Parameters<typeof onUpdateAgent>[0] = {
      originalName: editingName,
      name: nextName,
      description: editDescriptionDraft.trim() || null,
      renameManagedFile,
    };
    if (developerInstructionsChanged) {
      // Send only when explicitly changed so metadata edits don't depend on parsing
      // potentially-invalid per-agent config TOML files.
      updateInput.developerInstructions = editDeveloperInstructionsDraft;
    }
    const success = await onUpdateAgent(updateInput);
    if (success) {
      if (configEditorAgentName === editingName) {
        setConfigEditorAgentName(nextName);
      }
      setEditingName(null);
    }
  };

  const handleDeleteAgent = (name: string) => {
    setPendingDeleteAgentName(name);
  };

  const handleConfirmDeleteAgent = async (name: string) => {
    const success = await onDeleteAgent({ name, deleteManagedFile: true });
    if (!success) {
      return;
    }
    setPendingDeleteAgentName((current) => (current === name ? null : current));
    if (configEditorAgentName === name) {
      setConfigEditorAgentName(null);
      setConfigEditorContent("");
      setConfigEditorDirty(false);
    }
  };

  const handleOpenConfigEditor = async (agentName: string) => {
    const content = await onReadAgentConfig(agentName);
    if (content == null) {
      return;
    }
    setConfigEditorAgentName(agentName);
    setConfigEditorContent(content);
    setConfigEditorDirty(false);
  };

  const handleSaveConfigEditor = async () => {
    if (!configEditorAgentName) {
      return;
    }
    const success = await onWriteAgentConfig(configEditorAgentName, configEditorContent);
    if (success) {
      setConfigEditorDirty(false);
    }
  };

  return (
    <SettingsSection
      title="智能体"
      subtitle="配置多智能体模式、限制和自定义智能体角色。"
    >
      <div className="settings-help settings-agents-builtins-help">
        Codex 内置角色仍然可用：<code>default</code>、<code>explorer</code> 和 <code>worker</code>。
      </div>

      <SettingsToggleRow
        title="配置文件"
        subtitle={<>在 {fileManagerName()} 中打开全局 Codex 配置。</>}
      >
        <div className="settings-agents-actions">
          <button type="button" className="ghost" onClick={onRefresh} disabled={isLoading}>
            刷新
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => settings && void handleOpenPath(settings.configPath)}
            disabled={!settings}
          >
            {openInFileManagerLabel()}
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title="启用多智能体"
        subtitle={
          <>
            写入 config.toml 中的 <code>features.multi_agent</code>。
          </>
        }
      >
        <SettingsToggleSwitch
          pressed={settings?.multiAgentEnabled ?? false}
          onClick={() => void handleToggleMultiAgent()}
          disabled={!settings || isUpdatingCore}
        />
      </SettingsToggleRow>

      <SettingsToggleRow
        title="最大线程数"
        subtitle={
          <>
            可同时打开的最大智能体线程数。有效范围：<code>1-12</code>。修改会立即保存。
          </>
        }
      >
        <div className="settings-agents-stepper" role="group" aria-label="最大智能体线程数">
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxThreadsStep(-1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxThreads <= MIN_MAX_THREADS}
            aria-label="减少最大线程数"
          >
            ▼
          </button>
          <div className="settings-agents-stepper-value" aria-live="polite" aria-atomic="true">
            {currentMaxThreads}
          </div>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxThreadsStep(1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxThreads >= MAX_MAX_THREADS}
            aria-label="增加最大线程数"
          >
            ▲
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title="最大深度"
        subtitle={
          <>
            嵌套生成的最大深度。有效范围：<code>1-4</code>。修改会立即保存。
          </>
        }
      >
        <div className="settings-agents-stepper" role="group" aria-label="最大智能体深度">
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxDepthStep(-1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxDepth <= MIN_MAX_DEPTH}
            aria-label="减少最大深度"
          >
            ▼
          </button>
          <div className="settings-agents-stepper-value" aria-live="polite" aria-atomic="true">
            {currentMaxDepth}
          </div>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxDepthStep(1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxDepth >= MAX_MAX_DEPTH}
            aria-label="增加最大深度"
          >
            ▲
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsSubsection
        title="创建智能体"
        subtitle={
          <>
            在 <code>[agents.&lt;name&gt;]</code> 下添加自定义角色，并创建对应配置文件。
          </>
        }
      />
      <div className="settings-field settings-agents-form">
        <div className="settings-agents-description-row">
          <label className="settings-label" htmlFor="settings-agent-create-name">
            名称
          </label>
          <button
            type="button"
            className="ghost settings-icon-button settings-agents-generate-button"
            onClick={() => {
              if (createDescriptionGenerating || !canGenerateCreateFromName) {
                return;
              }
              void (async () => {
                const generated = await onGenerateCreateDescription({
                  name: createName,
                  description: createDescription,
                  developerInstructions: createDeveloperInstructions,
                });
                if (generated != null) {
                  if (generated.description.trim().length > 0) {
                    setCreateDescription(generated.description);
                  }
                  if (generated.developerInstructions.trim().length > 0) {
                    setCreateDeveloperInstructions(generated.developerInstructions);
                  }
                }
              })();
            }}
            disabled={creatingAgent || createDescriptionGenerating || !canGenerateCreateFromName}
            title="使用 AI 生成描述和开发者说明"
            aria-label="为新智能体生成字段"
          >
            {createDescriptionGenerating ? (
              <MagicSparkleLoaderIcon className="settings-agents-generate-loader" />
            ) : (
              <MagicSparkleIcon />
            )}
          </button>
        </div>
        <input
          id="settings-agent-create-name"
          className="settings-input"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder="researcher"
          disabled={creatingAgent}
        />
        <label className="settings-label" htmlFor="settings-agent-create-description">
          描述
        </label>
        <textarea
          id="settings-agent-create-description"
          className="settings-agents-textarea settings-agents-textarea--compact"
          value={createDescription}
          onChange={(event) => setCreateDescription(event.target.value)}
          placeholder="简短的角色说明。"
          rows={2}
          disabled={creatingAgent}
        />
        <label className="settings-label" htmlFor="settings-agent-create-developer-instructions">
          开发者说明
        </label>
        <textarea
          id="settings-agent-create-developer-instructions"
          className="settings-agents-textarea"
          value={createDeveloperInstructions}
          onChange={(event) => setCreateDeveloperInstructions(event.target.value)}
          placeholder="为该智能体设置多行开发者说明。"
          disabled={creatingAgent}
        />
        <div className="settings-agents-model-row">
          <div className="settings-agents-model-field settings-agents-model-field--model">
            <span className="settings-agents-inline-label">model:</span>
            <select
              id="settings-agent-create-model"
              className="settings-select settings-select--compact"
              value={createModel}
              onChange={(event) => setCreateModel(event.target.value)}
              disabled={creatingAgent}
              aria-label="智能体模型"
            >
              {effectiveModelOptions.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.model}
                </option>
              ))}
            </select>
          </div>
          <span className="settings-agents-inline-separator" aria-hidden>
            |
          </span>
          <div className="settings-agents-model-field settings-agents-model-field--effort">
            <span className="settings-agents-inline-label">推理：</span>
            <select
              id="settings-agent-create-effort"
              className="settings-select settings-select--compact"
              value={createReasoningEffort}
              onChange={(event) => setCreateReasoningEffort(event.target.value)}
              disabled={creatingAgent || createReasoningOptions.length === 0}
              aria-label="智能体推理强度"
            >
              {createReasoningOptions.length === 0 && <option value="">不支持</option>}
              {createReasoningOptions.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-agents-actions">
          <button type="button" className="ghost" onClick={() => void handleCreateAgent()}>
            {creatingAgent ? "创建中..." : "创建智能体"}
          </button>
        </div>
        {modelOptions.length === 0 && (
          <div className="settings-help">
            {modelOptionsLoading
              ? "正在加载项目模型元数据。当前暂用后备模型默认值。"
              : "在项目模型元数据可用前，使用后备模型默认值。"}
          </div>
        )}
        {modelOptionsError && <div className="settings-help">{modelOptionsError}</div>}
        {createError && <div className="settings-agents-error">{createError}</div>}
      </div>

      <SettingsSubsection
        title="已配置智能体"
        subtitle="管理自定义角色及其对应的智能体配置文件。"
      />

      {settings && settings.agents.length === 0 && !isLoading && (
        <div className="settings-help">还没有配置自定义智能体。</div>
      )}

      {settings?.agents.map((agent) => {
        const isEditing = editingName === agent.name;
        const isPendingDelete = pendingDeleteAgentName === agent.name;
        const isUpdating = updatingAgentName === agent.name;
        const isDeleting = deletingAgentName === agent.name;
        const isReadingConfig = readingConfigAgentName === agent.name;
        const isWritingConfig = writingConfigAgentName === agent.name;
        const isConfigEditorOpen = configEditorAgentName === agent.name;
        const canGenerateEditFromName = editNameDraft.trim().length > 0;
        return (
          <div className="settings-field settings-agent-card" key={agent.name}>
            <div className="settings-agent-card-header">
              <div>
                <div className="settings-toggle-title">{agent.name}</div>
                <div className="settings-toggle-subtitle">
                  {agent.description || "没有描述。"}
                </div>
              </div>
            </div>

            <div className="settings-help settings-help-inline">
              <code>{agent.configFile || "(missing config_file)"}</code>
            </div>
            <div className="settings-agents-actions">
              {!isPendingDelete && (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => startEditing(agent)}
                    disabled={isUpdating || isDeleting}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleDeleteAgent(agent.name)}
                    disabled={isUpdating || isDeleting}
                  >
                    删除
                  </button>
                </>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => void handleOpenPath(agent.resolvedPath)}
              >
                {openInFileManagerLabel()}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void handleOpenConfigEditor(agent.name)}
                disabled={!agent.managedByApp || isReadingConfig || isWritingConfig}
              >
                {isReadingConfig ? "打开中..." : "编辑文件"}
              </button>
              {!agent.managedByApp && (
                <span className="settings-help settings-help-inline">外部路径</span>
              )}
            </div>
            {isPendingDelete && (
              <div className="settings-agents-actions">
                <span className="settings-help settings-help-inline">
                  删除智能体及其受管配置文件？
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setPendingDeleteAgentName(null);
                  }}
                  disabled={isDeleting}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleConfirmDeleteAgent(agent.name)}
                  disabled={isDeleting}
                >
                  {isDeleting ? "删除中..." : "确认删除"}
                </button>
              </div>
            )}

            {isEditing && (
              <div className="settings-agents-edit-form">
                <div className="settings-agents-description-row">
                  <label
                    className="settings-label"
                    htmlFor={`settings-agent-edit-name-${agent.name}`}
                  >
                    名称
                  </label>
                  <button
                    type="button"
                    className="ghost settings-icon-button settings-agents-generate-button"
                    onClick={() => {
                      if (editDescriptionGenerating || !canGenerateEditFromName) {
                        return;
                      }
                      void (async () => {
                        const generated = await onGenerateEditDescription({
                          name: editNameDraft || agent.name,
                          description: editDescriptionDraft,
                          developerInstructions: editDeveloperInstructionsDraft,
                        });
                        if (generated != null) {
                          if (generated.description.trim().length > 0) {
                            setEditDescriptionDraft(generated.description);
                          }
                          if (generated.developerInstructions.trim().length > 0) {
                            setEditDeveloperInstructionsDraft(generated.developerInstructions);
                          }
                        }
                      })();
                    }}
                    disabled={
                      isUpdating || editDescriptionGenerating || !canGenerateEditFromName
                    }
                    title="使用 AI 生成描述和开发者说明"
                    aria-label={`为 ${agent.name} 生成字段`}
                  >
                    {editDescriptionGenerating ? (
                      <MagicSparkleLoaderIcon className="settings-agents-generate-loader" />
                    ) : (
                      <MagicSparkleIcon />
                    )}
                  </button>
                </div>
                <input
                  id={`settings-agent-edit-name-${agent.name}`}
                  className="settings-input"
                  value={editNameDraft}
                  onChange={(event) => setEditNameDraft(event.target.value)}
                  disabled={isUpdating}
                />
                <label
                  className="settings-label"
                  htmlFor={`settings-agent-edit-description-${agent.name}`}
                >
                  描述
                </label>
                <textarea
                  id={`settings-agent-edit-description-${agent.name}`}
                  className="settings-agents-textarea settings-agents-textarea--compact"
                  value={editDescriptionDraft}
                  onChange={(event) => setEditDescriptionDraft(event.target.value)}
                  placeholder="简短的角色说明。"
                  rows={2}
                  disabled={isUpdating}
                />
                <label
                  className="settings-label"
                  htmlFor={`settings-agent-edit-developer-instructions-${agent.name}`}
                >
                  开发者说明
                </label>
                <textarea
                  id={`settings-agent-edit-developer-instructions-${agent.name}`}
                  className="settings-agents-textarea"
                  value={editDeveloperInstructionsDraft}
                  onChange={(event) =>
                    setEditDeveloperInstructionsDraft(event.target.value)
                  }
                  placeholder="为该智能体设置多行开发者说明。"
                  disabled={isUpdating}
                />
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={renameManagedFile}
                    onChange={(event) => setRenameManagedFile(event.target.checked)}
                  />
                  智能体名称变更时，同时重命名受管配置文件
                </label>
                <div className="settings-agents-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setEditingName(null);
                      setEditError(null);
                    }}
                    disabled={isUpdating}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void handleUpdateAgent()}
                    disabled={isUpdating}
                  >
                    {isUpdating ? "保存中..." : "保存"}
                  </button>
                </div>
                {editError && <div className="settings-agents-error">{editError}</div>}
              </div>
            )}

            {isConfigEditorOpen && (
              <div className="settings-field settings-agents-editor">
                <div className="settings-agents-header">
                  <div>
                    <div className="settings-toggle-title">{agent.name} config file</div>
                    <div className="settings-toggle-subtitle">
                      <code>{agent.configFile}</code>
                    </div>
                  </div>
                  <div className="settings-agents-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setConfigEditorAgentName(null);
                        setConfigEditorDirty(false);
                      }}
                    >
                      关闭
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleSaveConfigEditor()}
                      disabled={!configEditorDirty || writingConfigAgentName === agent.name}
                    >
                      {isWritingConfig ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
                <textarea
                  className="settings-agents-textarea"
                  value={configEditorContent}
                  onChange={(event) => {
                    setConfigEditorContent(event.target.value);
                    setConfigEditorDirty(true);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}

      {isLoading && <div className="settings-help">正在加载智能体设置...</div>}
      {openPathError && <div className="settings-agents-error">{openPathError}</div>}
      {error && <div className="settings-agents-error">{error}</div>}
    </SettingsSection>
  );
}
