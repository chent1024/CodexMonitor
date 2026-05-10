import type { Dispatch, SetStateAction } from "react";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { WorkspaceInfo } from "@/types";
import { pushErrorToast } from "@services/toasts";

type SettingsEnvironmentsSectionProps = {
  mainWorkspaces: WorkspaceInfo[];
  environmentWorkspace: WorkspaceInfo | null;
  environmentSaving: boolean;
  environmentError: string | null;
  environmentDraftScript: string;
  environmentSavedScript: string | null;
  environmentDirty: boolean;
  globalWorktreesFolderDraft: string;
  globalWorktreesFolderSaved: string | null;
  globalWorktreesFolderDirty: boolean;
  worktreesFolderDraft: string;
  worktreesFolderSaved: string | null;
  worktreesFolderDirty: boolean;
  onSetEnvironmentWorkspaceId: Dispatch<SetStateAction<string | null>>;
  onSetEnvironmentDraftScript: Dispatch<SetStateAction<string>>;
  onSetGlobalWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSetWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSaveEnvironmentSetup: () => Promise<void>;
};

export function SettingsEnvironmentsSection({
  mainWorkspaces,
  environmentWorkspace,
  environmentSaving,
  environmentError,
  environmentDraftScript,
  environmentSavedScript,
  environmentDirty,
  globalWorktreesFolderDraft,
  globalWorktreesFolderSaved: _globalWorktreesFolderSaved,
  globalWorktreesFolderDirty,
  worktreesFolderDraft,
  worktreesFolderSaved: _worktreesFolderSaved,
  worktreesFolderDirty,
  onSetEnvironmentWorkspaceId,
  onSetEnvironmentDraftScript,
  onSetGlobalWorktreesFolderDraft,
  onSetWorktreesFolderDraft,
  onSaveEnvironmentSetup,
}: SettingsEnvironmentsSectionProps) {
  const hasAnyChanges =
    environmentDirty || globalWorktreesFolderDirty || worktreesFolderDirty;
  const hasProjects = mainWorkspaces.length > 0;

  return (
    <SettingsSection
      title="环境"
      subtitle="配置项目级初始化脚本和 worktree 路径。"
    >
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="settings-global-worktrees-folder">
          全局 worktrees 根目录
        </label>
        <div className="settings-help">
          当项目没有单独覆盖时，新建 worktree 的默认目录。每个项目会在这里拥有自己的子目录。
        </div>
        <div className="settings-field-row">
          <input
            id="settings-global-worktrees-folder"
            type="text"
            className="settings-input"
            value={globalWorktreesFolderDraft}
            onChange={(event) => onSetGlobalWorktreesFolderDraft(event.target.value)}
            placeholder="/path/to/worktrees-root"
            disabled={environmentSaving}
          />
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={async () => {
              try {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({
                  directory: true,
                  multiple: false,
                  title: "选择全局 worktrees 根目录",
                });
                if (selected && typeof selected === "string") {
                  onSetGlobalWorktreesFolderDraft(selected);
                }
              } catch (error) {
                pushErrorToast({
                  title: "无法打开文件夹选择器",
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }}
            disabled={environmentSaving}
          >
            浏览
          </button>
        </div>
        {!hasProjects ? (
          <div className="settings-field-actions">
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => onSetGlobalWorktreesFolderDraft(_globalWorktreesFolderSaved ?? "")}
              disabled={environmentSaving || !globalWorktreesFolderDirty}
            >
              重置
            </button>
            <button
              type="button"
              className="primary settings-button-compact"
              onClick={() => {
                void onSaveEnvironmentSetup();
              }}
              disabled={environmentSaving || !globalWorktreesFolderDirty}
            >
              {environmentSaving ? "保存中..." : "保存"}
            </button>
          </div>
        ) : null}
        {!hasProjects && environmentError ? (
          <div className="settings-agents-error">{environmentError}</div>
        ) : null}
      </div>

      {!hasProjects ? (
        <div className="settings-empty">还没有项目。</div>
      ) : (
        <>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-environment-project">
              项目
            </label>
            <select
              id="settings-environment-project"
              className="settings-select"
              value={environmentWorkspace?.id ?? ""}
              onChange={(event) => onSetEnvironmentWorkspaceId(event.target.value)}
              disabled={environmentSaving}
            >
              {mainWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            {environmentWorkspace ? (
              <div className="settings-help">{environmentWorkspace.path}</div>
            ) : null}
          </div>

          <div className="settings-field">
            <div className="settings-field-label">初始化脚本</div>
            <div className="settings-help">
              每次新建 worktree 后，会在独立终端里运行一次。
            </div>
            {environmentError ? (
              <div className="settings-agents-error">{environmentError}</div>
            ) : null}
            <textarea
              className="settings-agents-textarea"
              value={environmentDraftScript}
              onChange={(event) => onSetEnvironmentDraftScript(event.target.value)}
              placeholder="pnpm install"
              spellCheck={false}
              disabled={environmentSaving}
            />
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
                  if (!clipboard?.writeText) {
                    pushErrorToast({
                      title: "复制失败",
                      message:
                        "当前环境不支持剪贴板访问，请手动复制脚本。",
                    });
                    return;
                  }

                  void clipboard.writeText(environmentDraftScript).catch(() => {
                    pushErrorToast({
                      title: "复制失败",
                      message:
                        "无法写入剪贴板，请手动复制脚本。",
                    });
                  });
                }}
                disabled={environmentSaving || environmentDraftScript.length === 0}
              >
                复制
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => onSetEnvironmentDraftScript(environmentSavedScript ?? "")}
                disabled={environmentSaving || !environmentDirty}
              >
                重置
              </button>
              <button
                type="button"
                className="primary settings-button-compact"
                onClick={() => {
                  void onSaveEnvironmentSetup();
                }}
                disabled={environmentSaving || !hasAnyChanges}
              >
                {environmentSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-worktrees-folder">
              Worktrees 目录
            </label>
            <div className="settings-help">
              当前项目的自定义 worktree 路径。留空则使用全局根目录或内置默认值。
            </div>
            <div className="settings-field-row">
              <input
                id="settings-worktrees-folder"
                type="text"
                className="settings-input"
                value={worktreesFolderDraft}
                onChange={(event) => onSetWorktreesFolderDraft(event.target.value)}
                placeholder="/path/to/worktrees"
                disabled={environmentSaving}
              />
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      title: "选择 worktrees 目录",
                    });
                    if (selected && typeof selected === "string") {
                      onSetWorktreesFolderDraft(selected);
                    }
                  } catch (error) {
                    pushErrorToast({
                      title: "无法打开文件夹选择器",
                      message: error instanceof Error ? error.message : String(error),
                    });
                  }
                }}
                disabled={environmentSaving}
              >
                浏览
              </button>
            </div>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
