// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, WorkspaceInfo } from "@/types";
import {
  connectWorkspace,
  getAppBuildType,
  getAgentsSettings,
  getCodexFeatureFlag,
  getConfigModel,
  getExperimentalFeatureList,
  getLocalMemoryStatus,
  isMobileRuntime,
  getModelList,
  listWorkspaces,
  setCodexFeatureFlag,
  setLocalMemoryEnabled,
} from "@services/tauri";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "@utils/commitMessagePrompt";
import { SettingsView } from "./SettingsView";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@services/tauri", async () => {
  const actual = await vi.importActual<typeof import("@services/tauri")>(
    "@services/tauri",
  );
  return {
    ...actual,
    connectWorkspace: vi.fn(),
    getAppBuildType: vi.fn(),
    getModelList: vi.fn(),
    getConfigModel: vi.fn(),
    getCodexFeatureFlag: vi.fn(),
    getExperimentalFeatureList: vi.fn(),
    getLocalMemoryStatus: vi.fn(),
    getAgentsSettings: vi.fn(),
    isMobileRuntime: vi.fn(),
    listWorkspaces: vi.fn(),
    setCodexFeatureFlag: vi.fn(),
    setLocalMemoryEnabled: vi.fn(),
  };
});

const connectWorkspaceMock = vi.mocked(connectWorkspace);
const getAppBuildTypeMock = vi.mocked(getAppBuildType);
const getCodexFeatureFlagMock = vi.mocked(getCodexFeatureFlag);
const getConfigModelMock = vi.mocked(getConfigModel);
const getModelListMock = vi.mocked(getModelList);
const getExperimentalFeatureListMock = vi.mocked(getExperimentalFeatureList);
const getLocalMemoryStatusMock = vi.mocked(getLocalMemoryStatus);
const getAgentsSettingsMock = vi.mocked(getAgentsSettings);
const isMobileRuntimeMock = vi.mocked(isMobileRuntime);
const listWorkspacesMock = vi.mocked(listWorkspaces);
const setCodexFeatureFlagMock = vi.mocked(setCodexFeatureFlag);
const setLocalMemoryEnabledMock = vi.mocked(setLocalMemoryEnabled);
connectWorkspaceMock.mockResolvedValue(undefined);
getAppBuildTypeMock.mockResolvedValue("release");
getCodexFeatureFlagMock.mockResolvedValue(false);
getLocalMemoryStatusMock.mockResolvedValue({
  enabled: false,
  serverName: "local_memory",
  configPath: "/Users/me/.codex/config.toml",
  commandPath: "/tmp/codex-monitor-memory-mcp",
  dbPath: "/Users/me/.codex/local-memory/memory.sqlite",
  vectorBackend: "sqlite-vec",
});
getConfigModelMock.mockResolvedValue(null);
isMobileRuntimeMock.mockResolvedValue(false);
listWorkspacesMock.mockResolvedValue([]);
setCodexFeatureFlagMock.mockResolvedValue(undefined);
setLocalMemoryEnabledMock.mockResolvedValue({
  enabled: true,
  serverName: "local_memory",
  configPath: "/Users/me/.codex/config.toml",
  commandPath: "/tmp/codex-monitor-memory-mcp",
  dbPath: "/Users/me/.codex/local-memory/memory.sqlite",
  vectorBackend: "sqlite-vec",
});
getAgentsSettingsMock.mockResolvedValue({
  configPath: "/Users/me/.codex/config.toml",
  multiAgentEnabled: false,
  maxThreads: 6,
  maxDepth: 1,
  agents: [],
});

const baseSettings: AppSettings = {
  codexBin: null,
  codexArgs: null,
  backendMode: "local",
  remoteBackendProvider: "tcp",
  remoteBackendHost: "127.0.0.1:4732",
  remoteBackendToken: null,
  remoteBackends: [
    {
      id: "remote-default",
      name: "Primary remote",
      provider: "tcp",
      host: "127.0.0.1:4732",
      token: null,
    },
  ],
  activeRemoteBackendId: "remote-default",
  keepDaemonRunningAfterAppClose: false,
  defaultAccessMode: "current",
  reviewDeliveryMode: "inline",
  composerModelShortcut: null,
  composerAccessShortcut: null,
  composerReasoningShortcut: null,
  composerCollaborationShortcut: null,
  interruptShortcut: null,
  newAgentShortcut: null,
  newWorktreeAgentShortcut: null,
  newCloneAgentShortcut: null,
  archiveThreadShortcut: null,
  toggleProjectsSidebarShortcut: null,
  toggleGitSidebarShortcut: null,
  branchSwitcherShortcut: null,
  toggleDebugPanelShortcut: null,
  toggleTerminalShortcut: null,
  cycleAgentNextShortcut: null,
  cycleAgentPrevShortcut: null,
  cycleWorkspaceNextShortcut: null,
  cycleWorkspacePrevShortcut: null,
  lastComposerModelId: null,
  lastComposerReasoningEffort: null,
  uiScale: 1,
  theme: "system",
  usageShowRemaining: false,
  showMessageFilePath: true,
  chatHistoryScrollbackItems: 200,
  threadTitleAutogenerationEnabled: false,
  automaticAppUpdateChecksEnabled: false,
  uiFontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  uiFontSize: 14,
  codeFontFamily:
    'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  codeFontSize: 14,
  notificationSoundsEnabled: true,
  systemNotificationsEnabled: true,
  subagentSystemNotificationsEnabled: true,
  splitChatDiffView: false,
  preloadGitDiffs: true,
  gitDiffIgnoreWhitespaceChanges: false,
  commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
  commitMessageModelId: null,
  collaborationModesEnabled: true,
  steerEnabled: true,
  followUpMessageBehavior: "queue",
  composerFollowUpHintEnabled: true,
  pauseQueuedMessagesWhenResponseRequired: true,
  unifiedExecEnabled: true,
  experimentalAppsEnabled: false,
  personality: "friendly",
  composerEditorPreset: "default",
  composerFenceExpandOnSpace: false,
  composerFenceExpandOnEnter: false,
  composerFenceLanguageTags: false,
  composerFenceWrapSelection: false,
  composerFenceAutoWrapPasteMultiline: false,
  composerFenceAutoWrapPasteCodeLike: false,
  composerListContinuation: false,
  composerCodeBlockCopyUseModifier: false,
  workspaceGroups: [],
  openAppTargets: [
    {
      id: "vscode",
      label: "VS Code",
      kind: "app",
      appName: "Visual Studio Code",
      command: null,
      args: [],
    },
  ],
  selectedOpenAppId: "vscode",
  globalWorktreesFolder: null,
};

const createDoctorResult = () => ({
  ok: true,
  codexBin: null,
  version: null,
  appServerOk: true,
  details: null,
  path: null,
  nodeOk: true,
  nodeVersion: null,
  nodeDetails: null,
});

const createUpdateResult = () => ({
  ok: true,
  method: "brew_formula" as const,
  package: "codex",
  beforeVersion: "codex 0.0.0",
  afterVersion: "codex 0.0.1",
  upgraded: true,
  output: null,
  details: null,
});

const renderDisplaySection = (
  options: {
    appSettings?: Partial<AppSettings>;
    reduceTransparency?: boolean;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
    onToggleTransparency?: ComponentProps<typeof SettingsView>["onToggleTransparency"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const onToggleTransparency = options.onToggleTransparency ?? vi.fn();
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: options.reduceTransparency ?? false,
    onToggleTransparency,
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: [],
    ungroupedLabel: "未分组",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    onTestSystemNotification: vi.fn(),
  };

  render(<SettingsView {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "显示与声音" }));

  return { onUpdateAppSettings, onToggleTransparency };
};

const renderComposerSection = (
  options: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: false,
    onToggleTransparency: vi.fn(),
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: [],
    ungroupedLabel: "未分组",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    onTestSystemNotification: vi.fn(),
    initialSection: "composer",
  };

  render(<SettingsView {...props} />);
  return { onUpdateAppSettings };
};

const renderAboutSection = (
  options: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
    onToggleAutomaticAppUpdateChecks?: ComponentProps<
      typeof SettingsView
    >["onToggleAutomaticAppUpdateChecks"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const onToggleAutomaticAppUpdateChecks =
    options.onToggleAutomaticAppUpdateChecks ?? vi.fn();
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: false,
    onToggleTransparency: vi.fn(),
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    onToggleAutomaticAppUpdateChecks,
    workspaceGroups: [],
    groupedWorkspaces: [],
    ungroupedLabel: "未分组",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    onTestSystemNotification: vi.fn(),
  };

  render(<SettingsView {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "关于" }));

  return { onUpdateAppSettings, onToggleAutomaticAppUpdateChecks };
};

const renderFeaturesSection = (
  options: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
    experimentalFeaturesResponse?: unknown;
    fastModeEnabled?: boolean;
    localMemoryEnabled?: boolean;
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  getCodexFeatureFlagMock.mockResolvedValue(options.fastModeEnabled ?? false);
  setCodexFeatureFlagMock.mockResolvedValue(undefined);
  getLocalMemoryStatusMock.mockResolvedValue({
    enabled: options.localMemoryEnabled ?? false,
    serverName: "local_memory",
    configPath: "/Users/me/.codex/config.toml",
    commandPath: "/tmp/codex-monitor-memory-mcp",
    dbPath: "/Users/me/.codex/local-memory/memory.sqlite",
    vectorBackend: "sqlite-vec",
  });
  setLocalMemoryEnabledMock.mockImplementation(async (enabled) => ({
    enabled,
    serverName: "local_memory",
    configPath: "/Users/me/.codex/config.toml",
    commandPath: "/tmp/codex-monitor-memory-mcp",
    dbPath: "/Users/me/.codex/local-memory/memory.sqlite",
    vectorBackend: "sqlite-vec",
  }));
  getExperimentalFeatureListMock.mockResolvedValue(
    (options.experimentalFeaturesResponse as Record<string, unknown>) ?? {
      data: [
        {
          name: "steer",
          stage: "stable",
          enabled: true,
          defaultEnabled: true,
          displayName: "Steer mode",
          description:
            "Send messages immediately. Use Tab to queue while a run is active.",
          announcement: null,
        },
        {
          name: "unified_exec",
          stage: "stable",
          enabled: true,
          defaultEnabled: true,
          displayName: "Background terminal",
          description: "Run long-running terminal commands in the background.",
          announcement: null,
        },
      ],
      nextCursor: null,
    },
  );
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: false,
    onToggleTransparency: vi.fn(),
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: [
      {
        id: null,
        name: "未分组",
        workspaces: [workspace({ id: "w-features", name: "Features Workspace", connected: true })],
      },
    ],
    ungroupedLabel: "未分组",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    onTestSystemNotification: vi.fn(),
    initialSection: "features",
  };

  render(<SettingsView {...props} />);
  return { onUpdateAppSettings };
};

const workspace = (
  overrides: Omit<Partial<WorkspaceInfo>, "settings"> &
    Pick<WorkspaceInfo, "id" | "name"> & {
      settings?: Partial<WorkspaceInfo["settings"]>;
    },
): WorkspaceInfo => ({
  id: overrides.id,
  name: overrides.name,
  path: overrides.path ?? `/tmp/${overrides.id}`,
  connected: overrides.connected ?? false,
  kind: overrides.kind ?? "main",
  parentId: overrides.parentId ?? null,
  worktree: overrides.worktree ?? null,
  settings: {
    sidebarCollapsed: false,
    sortOrder: null,
    groupId: null,
    gitRoot: null,
    launchScript: null,
    launchScripts: null,
    worktreeSetupScript: null,
    ...overrides.settings,
  },
});

const renderEnvironmentsSection = (
  options: {
    appSettings?: Partial<AppSettings>;
    groupedWorkspaces?: ComponentProps<typeof SettingsView>["groupedWorkspaces"];
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
    onUpdateWorkspaceSettings?: ComponentProps<typeof SettingsView>["onUpdateWorkspaceSettings"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const onUpdateWorkspaceSettings =
    options.onUpdateWorkspaceSettings ?? vi.fn().mockResolvedValue(undefined);
  const defaultGroupedWorkspaces =
    options.groupedWorkspaces ??
    [
      {
        id: null,
        name: "未分组",
        workspaces: [
          workspace({
            id: "w1",
            name: "Project One",
            settings: {
              sidebarCollapsed: false,
              worktreeSetupScript: "echo one",
            },
          }),
        ],
      },
    ];

  const buildProps = (
    nextOptions: {
      appSettings?: Partial<AppSettings>;
      groupedWorkspaces?: ComponentProps<typeof SettingsView>["groupedWorkspaces"];
    } = {},
  ): ComponentProps<typeof SettingsView> => ({
    reduceTransparency: false,
    onToggleTransparency: vi.fn(),
    appSettings: { ...baseSettings, ...options.appSettings, ...nextOptions.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: nextOptions.groupedWorkspaces ?? defaultGroupedWorkspaces,
    ungroupedLabel: "未分组",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    onUpdateWorkspaceSettings,
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    onTestSystemNotification: vi.fn(),
    initialSection: "environments",
  });

  const renderResult = render(<SettingsView {...buildProps()} />);
  return {
    onUpdateAppSettings,
    onUpdateWorkspaceSettings,
    rerender: (
      nextOptions: {
        appSettings?: Partial<AppSettings>;
        groupedWorkspaces?: ComponentProps<typeof SettingsView>["groupedWorkspaces"];
      } = {},
    ) => renderResult.rerender(<SettingsView {...buildProps(nextOptions)} />),
  };
};

describe("SettingsView Display", () => {
  it("updates the theme selection", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const select = screen.getByLabelText("主题");
    fireEvent.change(select, { target: { value: "dark" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });
  });

  it("toggles remaining limits display", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const row = screen
      .getByText("显示剩余额度")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected remaining limits row");
    }
    const toggle = row.querySelector(
      "button.settings-toggle",
    ) as HTMLButtonElement | null;
    if (!toggle) {
      throw new Error("Expected remaining limits toggle");
    }
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ usageShowRemaining: true }),
      );
    });
  });

  it("toggles file path visibility in messages", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const row = screen
      .getByText("在消息中显示文件路径")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected file path visibility row");
    }
    const toggle = row.querySelector(
      "button.settings-toggle",
    ) as HTMLButtonElement | null;
    if (!toggle) {
      throw new Error("Expected file path visibility toggle");
    }
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ showMessageFilePath: false }),
      );
    });
  });

  it("toggles split chat and diff center panes", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const row = screen
      .getByText("拆分聊天与 diff 中央面板")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected split center panes row");
    }
    const toggle = row.querySelector("button.settings-toggle") as HTMLButtonElement | null;
    if (!toggle) {
      throw new Error("Expected split center panes toggle");
    }
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ splitChatDiffView: true }),
      );
    });
  });

  it("toggles reduce transparency", async () => {
    const onToggleTransparency = vi.fn();
    renderDisplaySection({ onToggleTransparency, reduceTransparency: false });

    const row = screen
      .getByText("降低透明效果")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected reduce transparency row");
    }
    const toggle = row.querySelector(
      "button.settings-toggle",
    ) as HTMLButtonElement | null;
    if (!toggle) {
      throw new Error("Expected reduce transparency toggle");
    }
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onToggleTransparency).toHaveBeenCalledWith(true);
    });
  });

  it("commits interface scale on blur and enter with clamping", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const scaleInput = screen.getByLabelText("界面缩放");

    fireEvent.change(scaleInput, { target: { value: "500%" } });
    fireEvent.blur(scaleInput);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: 3 }),
      );
    });

    fireEvent.change(scaleInput, { target: { value: "3%" } });
    fireEvent.keyDown(scaleInput, { key: "Enter" });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: 0.1 }),
      );
    });
  });

  it("commits font family changes on blur and enter", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const uiFontInput = screen.getByLabelText("界面字体");
    fireEvent.change(uiFontInput, { target: { value: "Avenir, sans-serif" } });
    fireEvent.blur(uiFontInput);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiFontFamily: "Avenir, sans-serif" }),
      );
    });

    const codeFontInput = screen.getByLabelText("代码字体");
    fireEvent.change(codeFontInput, {
      target: { value: "JetBrains Mono, monospace" },
    });
    fireEvent.keyDown(codeFontInput, { key: "Enter" });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontFamily: "JetBrains Mono, monospace" }),
      );
    });
  });

  it("resets font families to defaults", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const resetButtons = screen.getAllByRole("button", { name: "重置" });
    fireEvent.click(resetButtons[1]);
    fireEvent.click(resetButtons[2]);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          uiFontFamily: expect.stringContaining("system-ui"),
        }),
      );
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          codeFontFamily: expect.stringContaining("ui-monospace"),
        }),
      );
    });
  });

  it("updates code font size from the number input", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const input = screen.getByLabelText("代码字号");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontSize: 15 }),
      );
    });
  });

  it("updates UI font size from the number input", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const input = screen.getByLabelText("界面字号");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiFontSize: 15 }),
      );
    });
  });

  it("toggles notification sounds", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { notificationSoundsEnabled: false },
    });

    const row = screen
      .getByText("通知提示音")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected notification sounds row");
    }
    fireEvent.click(within(row).getByRole("button"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ notificationSoundsEnabled: true }),
      );
    });
  });

  it("toggles sub-agent system notifications", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { subagentSystemNotificationsEnabled: false },
    });

    const row = screen
      .getByText("子智能体通知")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected sub-agent notifications row");
    }
    fireEvent.click(within(row).getByRole("button"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ subagentSystemNotificationsEnabled: true }),
      );
    });
  });
});

describe("SettingsView About", () => {
  it("toggles automatic app update checks", async () => {
    const onToggleAutomaticAppUpdateChecks = vi.fn();
    renderAboutSection({
      onToggleAutomaticAppUpdateChecks,
      appSettings: { automaticAppUpdateChecksEnabled: false },
    });

    const row = screen
      .getByText("自动检查应用更新")
      .closest(".settings-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected automatic app update checks row");
    }
    fireEvent.click(within(row).getByRole("button"));

    await waitFor(() => {
      expect(onToggleAutomaticAppUpdateChecks).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SettingsView Environments", () => {
  it("shows the global worktrees root input", () => {
    renderEnvironmentsSection({
      appSettings: { globalWorktreesFolder: "I:/existing-worktrees" },
    });

    const input = screen.getByLabelText("全局 worktrees 根目录");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("I:/existing-worktrees");
    expect((input as HTMLInputElement).placeholder).toBe("/path/to/worktrees-root");
  });

  it("saves the global worktrees root through app settings", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    renderEnvironmentsSection({
      onUpdateAppSettings,
      onUpdateWorkspaceSettings,
    });

    const input = screen.getByLabelText("全局 worktrees 根目录");
    fireEvent.change(input, { target: { value: "I:/cm-worktrees" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          globalWorktreesFolder: "I:/cm-worktrees",
        }),
      );
    });
    expect(onUpdateWorkspaceSettings).not.toHaveBeenCalled();
  });

  it("does not clear an existing global worktrees root when saving project-only changes", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    renderEnvironmentsSection({
      appSettings: { globalWorktreesFolder: "I:/existing-worktrees" },
      onUpdateAppSettings,
      onUpdateWorkspaceSettings,
    });

    const textarea = screen.getByPlaceholderText("pnpm install");
    fireEvent.change(textarea, { target: { value: "echo updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("w1", {
        worktreeSetupScript: "echo updated",
        worktreesFolder: null,
      });
    });
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("keeps the global worktrees root marked as saved after workspace save fails", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const onUpdateWorkspaceSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to save workspace settings"))
      .mockResolvedValueOnce(undefined);
    renderEnvironmentsSection({
      appSettings: { globalWorktreesFolder: "I:/existing-worktrees" },
      onUpdateAppSettings,
      onUpdateWorkspaceSettings,
    });

    fireEvent.change(screen.getByLabelText("全局 worktrees 根目录"), {
      target: { value: "I:/cm-worktrees" },
    });
    fireEvent.change(screen.getByPlaceholderText("pnpm install"), {
      target: { value: "echo updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("Failed to save workspace settings"),
    ).toBeTruthy();
    expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateWorkspaceSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the global worktrees root editable when there are no projects", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderEnvironmentsSection({
      groupedWorkspaces: [],
      onUpdateAppSettings,
    });

    expect(screen.getByText("还没有项目。")).toBeTruthy();
    const input = screen.getByLabelText("全局 worktrees 根目录");
    fireEvent.change(input, { target: { value: "I:/cm-worktrees" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          globalWorktreesFolder: "I:/cm-worktrees",
        }),
      );
    });
  });

  it("keeps the no-project global worktrees root save state active until the request resolves", async () => {
    let resolveSave: (() => void) | null = null;
    const pendingSave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onUpdateAppSettings = vi.fn().mockImplementation(() => pendingSave);
    renderEnvironmentsSection({
      groupedWorkspaces: [],
      onUpdateAppSettings,
    });

    fireEvent.change(screen.getByLabelText("全局 worktrees 根目录"), {
      target: { value: "I:/cm-worktrees" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "保存中..." }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    expect((screen.getByLabelText("全局 worktrees 根目录") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "保存中..." }));
    expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave?.();
      await pendingSave;
    });

    await waitFor(() => {
      expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
  });

  it("resyncs the global worktrees root baseline after dirty state clears", async () => {
    const { rerender } = renderEnvironmentsSection({
      groupedWorkspaces: [],
      appSettings: { globalWorktreesFolder: null },
    });

    const input = screen.getByLabelText("全局 worktrees 根目录");
    fireEvent.change(input, { target: { value: "I:/typing" } });

    rerender({
      groupedWorkspaces: [],
      appSettings: { globalWorktreesFolder: "I:/loaded-from-settings" },
    });

    expect((screen.getByLabelText("全局 worktrees 根目录") as HTMLInputElement).value).toBe(
      "I:/typing",
    );

    fireEvent.click(screen.getByRole("button", { name: "重置" }));

    await waitFor(() => {
      expect((screen.getByLabelText("全局 worktrees 根目录") as HTMLInputElement).value).toBe(
        "I:/loaded-from-settings",
      );
    });
  });

  it("shows save errors for the global worktrees root when there are no projects", async () => {
    const onUpdateAppSettings = vi
      .fn()
      .mockRejectedValue(new Error("Failed to save global worktrees root"));
    renderEnvironmentsSection({
      groupedWorkspaces: [],
      onUpdateAppSettings,
    });

    const input = screen.getByLabelText("全局 worktrees 根目录");
    fireEvent.change(input, { target: { value: "I:/cm-worktrees" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("Failed to save global worktrees root"),
    ).toBeTruthy();
  });

  it("keeps the new global worktrees root as saved when workspace settings fail afterward", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const onUpdateWorkspaceSettings = vi
      .fn()
      .mockRejectedValue(new Error("Failed to save workspace settings"));
    renderEnvironmentsSection({
      appSettings: { globalWorktreesFolder: "I:/existing-worktrees" },
      onUpdateAppSettings,
      onUpdateWorkspaceSettings,
    });

    const input = screen.getByLabelText("全局 worktrees 根目录");
    const textarea = screen.getByPlaceholderText("pnpm install");
    fireEvent.change(input, { target: { value: "I:/cm-worktrees" } });
    fireEvent.change(textarea, { target: { value: "echo updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("Failed to save workspace settings"),
    ).toBeTruthy();

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          globalWorktreesFolder: "I:/cm-worktrees",
        }),
      );
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("w1", {
        worktreeSetupScript: "echo updated",
        worktreesFolder: null,
      });
    });

    expect((input as HTMLInputElement).value).toBe("I:/cm-worktrees");

    onUpdateWorkspaceSettings.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);
  });

  it("saves the setup script for the selected project", async () => {
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    renderEnvironmentsSection({ onUpdateWorkspaceSettings });

    expect(
      screen.getByText("环境", { selector: ".settings-section-title" }),
    ).toBeTruthy();
    const textarea = screen.getByPlaceholderText("pnpm install");
    expect((textarea as HTMLTextAreaElement).value).toBe("echo one");

    fireEvent.change(textarea, { target: { value: "echo updated" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("w1", {
        worktreeSetupScript: "echo updated",
        worktreesFolder: null,
      });
    });
  });

  it("normalizes whitespace-only scripts to null", async () => {
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    renderEnvironmentsSection({ onUpdateWorkspaceSettings });

    const textarea = screen.getByPlaceholderText("pnpm install");
    fireEvent.change(textarea, { target: { value: "   \n\t" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("w1", {
        worktreeSetupScript: null,
        worktreesFolder: null,
      });
    });
  });

  it("copies the setup script to the clipboard", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    try {
      renderEnvironmentsSection();

      fireEvent.click(screen.getByRole("button", { name: "复制" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("echo one");
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "clipboard", originalDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (navigator as any).clipboard;
      }
    }
  });
});

describe("SettingsView Codex section", () => {
  it("updates review mode in codex section", async () => {
    cleanup();
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={onUpdateAppSettings}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onRunCodexUpdate={vi.fn().mockResolvedValue(createUpdateResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
        initialSection="codex"
      />,
    );

    fireEvent.change(screen.getByLabelText("Review 模式"), {
      target: { value: "detached" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ reviewDeliveryMode: "detached" }),
      );
    });
  });

  it("renders mobile daemon controls in local backend mode for TCP provider", async () => {
    cleanup();
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={{
          ...baseSettings,
          backendMode: "local",
          remoteBackendProvider: "tcp",
        }}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
        initialSection="server"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "启动 daemon" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "停止 daemon" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "刷新状态" })).toBeTruthy();
      expect(screen.getByLabelText("远端后端 host")).toBeTruthy();
      expect(screen.getByLabelText("远端后端 token")).toBeTruthy();
    });
  });

  it("shows mobile-only server controls on iOS runtime", async () => {
    cleanup();
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "platform",
    );
    const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "userAgent",
    );
    const originalTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "maxTouchPoints",
    );

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });

    try {
      render(
        <SettingsView
          workspaceGroups={[]}
          groupedWorkspaces={[]}
          ungroupedLabel="未分组"
          onClose={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          reduceTransparency={false}
          onToggleTransparency={vi.fn()}
          appSettings={{
            ...baseSettings,
            backendMode: "local",
            remoteBackendProvider: "tcp",
          }}
          openAppIconById={{}}
          onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
          onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
          onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
          scaleShortcutTitle="Scale shortcut"
          scaleShortcutText="Use Command +/-"
          onTestNotificationSound={vi.fn()}
          onTestSystemNotification={vi.fn()}
          initialSection="server"
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText("远端后端 host")).toBeTruthy();
        expect(screen.getByLabelText("远端后端 token")).toBeTruthy();
        expect(screen.getByRole("button", { name: "连接并测试" })).toBeTruthy();
      });

      expect(screen.queryByLabelText("后端模式")).toBeNull();
      expect(screen.queryByRole("button", { name: "启动 daemon" })).toBeNull();
      expect(screen.queryByRole("button", { name: "检测 Tailscale" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start Runner" })).toBeNull();
      expect(
        screen.getByText(/从桌面端 CodexMonitor 设置中获取 Tailscale 主机名和 token/),
      ).toBeTruthy();
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(window.navigator, "platform", originalPlatformDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "platform");
      }
      if (originalUserAgentDescriptor) {
        Object.defineProperty(window.navigator, "userAgent", originalUserAgentDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "userAgent");
      }
      if (originalTouchPointsDescriptor) {
        Object.defineProperty(
          window.navigator,
          "maxTouchPoints",
          originalTouchPointsDescriptor,
        );
      } else {
        Reflect.deleteProperty(window.navigator, "maxTouchPoints");
      }
    }
  });

  it("supports multiple saved remotes on iOS runtime", async () => {
    cleanup();
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "platform",
    );
    const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "userAgent",
    );
    const originalTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "maxTouchPoints",
    );

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });

    try {
      render(
        <SettingsView
          workspaceGroups={[]}
          groupedWorkspaces={[]}
          ungroupedLabel="未分组"
          onClose={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          reduceTransparency={false}
          onToggleTransparency={vi.fn()}
          appSettings={{
            ...baseSettings,
            remoteBackendProvider: "tcp",
            remoteBackendHost: "127.0.0.1:4732",
            remoteBackendToken: "token-a",
            remoteBackends: [
              {
                id: "remote-a",
                name: "Home Mac",
                provider: "tcp",
                host: "127.0.0.1:4732",
                token: "token-a",
              },
              {
                id: "remote-b",
                name: "Office Mac",
                provider: "tcp",
                host: "office-mac.tailnet.ts.net:4732",
                token: "token-b",
              },
            ],
            activeRemoteBackendId: "remote-a",
          }}
          openAppIconById={{}}
          onUpdateAppSettings={onUpdateAppSettings}
          onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
          onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
          scaleShortcutTitle="Scale shortcut"
          scaleShortcutText="Use Command +/-"
          onTestNotificationSound={vi.fn()}
          onTestSystemNotification={vi.fn()}
          initialSection="server"
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("list", { name: "已保存远端" })).toBeTruthy();
        expect(screen.getByLabelText("远端名称")).toBeTruthy();
      });
      expect(screen.getAllByText(/上次连接：\s*从未连接/i).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: "使用 Office Mac 远端" }));

      await waitFor(() => {
        expect(onUpdateAppSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            activeRemoteBackendId: "remote-b",
            remoteBackendProvider: "tcp",
            remoteBackendHost: "office-mac.tailnet.ts.net:4732",
            remoteBackendToken: "token-b",
          }),
        );
      });

      onUpdateAppSettings.mockClear();
      fireEvent.change(screen.getByLabelText("远端名称"), {
        target: { value: "Home Mac" },
      });
      fireEvent.blur(screen.getByLabelText("远端名称"));

      await waitFor(() => {
        expect(
          screen.getAllByText('A remote named "Home Mac" already exists.').length,
        ).toBeGreaterThan(0);
      });

      onUpdateAppSettings.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "添加远端" }));
      expect(screen.getByRole("dialog", { name: "添加远端" })).toBeTruthy();
      expect(onUpdateAppSettings).toHaveBeenCalledTimes(0);

      fireEvent.click(screen.getByRole("button", { name: "关闭添加远端窗口" }));
      expect(screen.queryByRole("dialog", { name: "添加远端" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "添加远端" }));
      fireEvent.change(screen.getByLabelText("新远端名称"), {
        target: { value: "Travel Mac" },
      });
      fireEvent.change(screen.getByLabelText("新远端 host"), {
        target: { value: "travel-mac.tailnet.ts.net:4732" },
      });
      fireEvent.change(screen.getByLabelText("新远端 token"), {
        target: { value: "token-travel" },
      });
      fireEvent.click(screen.getByRole("button", { name: "连接并添加" }));

      await waitFor(() => {
        expect(onUpdateAppSettings).toHaveBeenCalledTimes(2);
      });
      const trialSettings = onUpdateAppSettings.mock.calls[0]?.[0] as AppSettings;
      const connectedSettings = onUpdateAppSettings.mock.calls[1]?.[0] as AppSettings;
      expect(trialSettings.remoteBackends).toHaveLength(3);
      expect(trialSettings.activeRemoteBackendId).toBeTruthy();
      expect(trialSettings.remoteBackendHost).toBe("travel-mac.tailnet.ts.net:4732");
      expect(trialSettings.remoteBackendToken).toBe("token-travel");
      expect(connectedSettings.remoteBackends).toHaveLength(3);
      const connectedEntry = connectedSettings.remoteBackends.find(
        (entry) => entry.id === connectedSettings.activeRemoteBackendId,
      );
      expect(connectedEntry?.lastConnectedAtMs).toEqual(expect.any(Number));
      expect(screen.queryByRole("dialog", { name: "添加远端" })).toBeNull();
      expect(listWorkspacesMock).toHaveBeenCalled();

      onUpdateAppSettings.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "添加远端" }));
      fireEvent.change(screen.getByLabelText("新远端 token"), {
        target: { value: "" },
      });
      fireEvent.click(screen.getByRole("button", { name: "连接并添加" }));

      await waitFor(() => {
        expect(screen.getByText("Remote backend token is required.")).toBeTruthy();
      });

      onUpdateAppSettings.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "下移 Home Mac" }));

      await waitFor(() => {
        expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);
        const nextSettings = onUpdateAppSettings.mock.calls[0]?.[0] as AppSettings;
        expect(nextSettings.remoteBackends[0]?.id).toBe("remote-b");
      });

      onUpdateAppSettings.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "删除 Office Mac" }));
      fireEvent.click(screen.getByRole("button", { name: "删除远端" }));

      await waitFor(() => {
        expect(onUpdateAppSettings).toHaveBeenCalledTimes(1);
        const nextSettings = onUpdateAppSettings.mock.calls[0]?.[0] as AppSettings;
        expect(nextSettings.remoteBackends.length).toBeGreaterThanOrEqual(1);
      });
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(window.navigator, "platform", originalPlatformDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "platform");
      }
      if (originalUserAgentDescriptor) {
        Object.defineProperty(window.navigator, "userAgent", originalUserAgentDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "userAgent");
      }
      if (originalTouchPointsDescriptor) {
        Object.defineProperty(
          window.navigator,
          "maxTouchPoints",
          originalTouchPointsDescriptor,
        );
      } else {
        Reflect.deleteProperty(window.navigator, "maxTouchPoints");
      }
    }
  });

});

describe("SettingsView Codex defaults", () => {
  const createModelListResponse = (models: Array<Record<string, unknown>>) => ({
    result: { data: models },
  });

  it("uses the latest model and medium effort by default (no Default option)", async () => {
    cleanup();
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    getModelListMock.mockResolvedValue(
      createModelListResponse([
        {
          id: "gpt-4.1",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          description: "",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
            { reasoningEffort: "high", description: "" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
        {
          id: "gpt-5.1",
          model: "gpt-5.1",
          displayName: "GPT-5.1",
          description: "",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
            { reasoningEffort: "high", description: "" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
      ]),
    );

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[
          {
            id: null,
            name: "未分组",
            workspaces: [workspace({ id: "w1", name: "Workspace", connected: true })],
          },
        ]}
        ungroupedLabel="未分组"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={onUpdateAppSettings}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onRunCodexUpdate={vi.fn().mockResolvedValue(createUpdateResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
        initialSection="codex"
      />,
    );

    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement;
    const effortSelect = screen.getByLabelText(
      "推理强度",
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(getModelListMock).toHaveBeenCalledWith("w1");
      expect(modelSelect.value).toBe("gpt-5.1");
    });

    expect(within(modelSelect).queryByRole("option", { name: /default/i })).toBeNull();
    expect(within(effortSelect).queryByRole("option", { name: /default/i })).toBeNull();
    expect(effortSelect.value).toBe("medium");

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          lastComposerModelId: "gpt-5.1",
          lastComposerReasoningEffort: "medium",
        }),
      );
    });
  });

  it("updates model and effort when the user changes the selects", async () => {
    cleanup();
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    getModelListMock.mockResolvedValue(
      createModelListResponse([
        {
          id: "gpt-4.1",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          description: "",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
            { reasoningEffort: "high", description: "" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
        {
          id: "gpt-5.1",
          model: "gpt-5.1",
          displayName: "GPT-5.1",
          description: "",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "" },
            { reasoningEffort: "medium", description: "" },
            { reasoningEffort: "high", description: "" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
      ]),
    );

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[
          {
            id: null,
            name: "未分组",
            workspaces: [workspace({ id: "w1", name: "Workspace", connected: true })],
          },
        ]}
        ungroupedLabel="未分组"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={onUpdateAppSettings}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onRunCodexUpdate={vi.fn().mockResolvedValue(createUpdateResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
        initialSection="codex"
      />,
    );

    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement;
    const effortSelect = screen.getByLabelText(
      "推理强度",
    ) as HTMLSelectElement;

    await waitFor(() => {
      expect(modelSelect.disabled).toBe(false);
      expect(modelSelect.value).toBe("gpt-5.1");
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lastComposerModelId: "gpt-5.1" }),
      );
    });

    onUpdateAppSettings.mockClear();
    fireEvent.change(modelSelect, { target: { value: "gpt-4.1" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lastComposerModelId: "gpt-4.1" }),
      );
    });

    onUpdateAppSettings.mockClear();
    fireEvent.change(effortSelect, { target: { value: "high" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ lastComposerReasoningEffort: "high" }),
      );
    });
  });
});

describe("SettingsView Features", () => {
  it("updates personality selection", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderFeaturesSection({ onUpdateAppSettings });

    fireEvent.change(screen.getByLabelText("人格"), {
      target: { value: "pragmatic" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ personality: "pragmatic" }),
      );
    });
  });

  it("hides steer mode dynamic feature row", async () => {
    renderFeaturesSection({
      appSettings: { steerEnabled: true },
    });

    await screen.findByText("Background terminal");
    expect(screen.queryByText("Steer mode")).toBeNull();
  });

  it("hides steer mode when returned as an experimental feature", async () => {
    renderFeaturesSection({
      appSettings: { steerEnabled: true },
      experimentalFeaturesResponse: {
        data: [
          {
            name: "steer",
            stage: "underDevelopment",
            enabled: true,
            defaultEnabled: true,
            displayName: "Steer mode",
            description: "Legacy steer feature row.",
            announcement: null,
          },
          {
            name: "responses_websockets",
            stage: "underDevelopment",
            enabled: false,
            defaultEnabled: false,
            displayName: null,
            description: null,
            announcement: null,
          },
        ],
        nextCursor: null,
      },
    });

    await screen.findByText(
      "默认对 OpenAI 使用 Responses API WebSocket 传输。",
    );
    expect(screen.queryByText("Steer mode")).toBeNull();
  });

  it("toggles background terminal in stable features", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderFeaturesSection({
      onUpdateAppSettings,
      appSettings: { unifiedExecEnabled: true },
    });

    const terminalTitle = await screen.findByText("Background terminal");
    const terminalRow = terminalTitle.closest(".settings-toggle-row");
    expect(terminalRow).not.toBeNull();

    const toggle = within(terminalRow as HTMLElement).getByRole("button");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ unifiedExecEnabled: false }),
      );
    });
  });

  it("shows Fast Mode as a stable config feature defaulted off", async () => {
    renderFeaturesSection({
      experimentalFeaturesResponse: { data: [], nextCursor: null },
    });

    const fastModeTitle = await screen.findByText("Fast Mode");
    const fastModeRow = fastModeTitle.closest(".settings-toggle-row");
    expect(fastModeRow).not.toBeNull();
    expect(
      within(fastModeRow as HTMLElement)
        .getByRole("button")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getAllByText((_, element) =>
        Boolean(element?.textContent?.includes("features.fast_mode")),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("writes features.fast_mode when toggling Fast Mode", async () => {
    renderFeaturesSection({
      experimentalFeaturesResponse: { data: [], nextCursor: null },
    });

    const fastModeTitle = await screen.findByText("Fast Mode");
    const fastModeRow = fastModeTitle.closest(".settings-toggle-row");
    expect(fastModeRow).not.toBeNull();

    fireEvent.click(within(fastModeRow as HTMLElement).getByRole("button"));

    await waitFor(() => {
      expect(setCodexFeatureFlagMock).toHaveBeenCalledWith("fast_mode", true);
    });
  });

  it("toggles the local memory MCP server from settings", async () => {
    renderFeaturesSection({
      experimentalFeaturesResponse: { data: [], nextCursor: null },
      localMemoryEnabled: false,
    });

    const localMemoryTitle = await screen.findByText("本地记忆");
    const localMemoryRow = localMemoryTitle.closest(".settings-toggle-row");
    expect(localMemoryRow).not.toBeNull();

    fireEvent.click(within(localMemoryRow as HTMLElement).getByRole("button"));

    await waitFor(() => {
      expect(setLocalMemoryEnabledMock).toHaveBeenCalledWith(true);
    });
    expect(screen.getByText(/memory\.sqlite/)).toBeTruthy();
  });

  it("shows fallback description when Codex omits feature description", async () => {
    renderFeaturesSection({
      experimentalFeaturesResponse: {
        data: [
          {
            name: "responses_websockets",
            stage: "underDevelopment",
            enabled: false,
            defaultEnabled: false,
            displayName: null,
            description: null,
            announcement: null,
          },
        ],
        nextCursor: null,
      },
    });

    await screen.findByText(
      "默认对 OpenAI 使用 Responses API WebSocket 传输。",
    );
  });
});

describe("SettingsView Composer", () => {
  it("toggles follow-up hint visibility", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderComposerSection({
      onUpdateAppSettings,
      appSettings: {
        composerFollowUpHintEnabled: true,
      },
    });

    const hintTitle = await screen.findByText("处理中显示追问提示");
    const hintRow = hintTitle.closest(".settings-toggle-row");
    expect(hintRow).not.toBeNull();
    fireEvent.click(within(hintRow as HTMLElement).getByRole("button"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ composerFollowUpHintEnabled: false }),
      );
    });
  });

  it("updates follow-up behavior from queue to steer", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderComposerSection({
      onUpdateAppSettings,
      appSettings: {
        steerEnabled: true,
        followUpMessageBehavior: "queue",
      },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Steer" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ followUpMessageBehavior: "steer" }),
      );
    });
  });

  it("disables steer follow-up behavior when steer is unavailable", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderComposerSection({
      onUpdateAppSettings,
      appSettings: {
        steerEnabled: false,
        followUpMessageBehavior: "queue",
      },
    });

    const steerOption = screen.getByRole("radio", { name: "Steer" });
    expect(steerOption.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        "当前 Codex 配置不支持 Steer。追问将按排队方式发送。",
      ),
    ).not.toBeNull();

    fireEvent.click(steerOption);
    await waitFor(() => {
      expect(onUpdateAppSettings).not.toHaveBeenCalled();
    });
  });
});

describe("SettingsView mobile layout", () => {
  it("uses a master/detail flow on narrow mobile widths", async () => {
    cleanup();
    const originalMatchMedia = window.matchMedia;
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "platform",
    );
    const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "userAgent",
    );
    const originalTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "maxTouchPoints",
    );

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width: 720px"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "iPhone",
    });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });

    try {
      const rendered = render(
        <SettingsView
          workspaceGroups={[]}
          groupedWorkspaces={[]}
          ungroupedLabel="未分组"
          onClose={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
          reduceTransparency={false}
          onToggleTransparency={vi.fn()}
          appSettings={baseSettings}
          openAppIconById={{}}
          onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
          onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
          onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
          scaleShortcutTitle="Scale shortcut"
          scaleShortcutText="Use Command +/-"
          onTestNotificationSound={vi.fn()}
          onTestSystemNotification={vi.fn()}
        />,
      );

      expect(
        within(rendered.container).queryByText("分区"),
      ).toBeNull();
      expect(
        rendered.container.querySelectorAll(".ds-panel-nav-item-disclosure")
          .length,
      ).toBeGreaterThan(0);

      fireEvent.click(
        within(rendered.container).getByRole("button", {
          name: "显示与声音",
        }),
      );

      await waitFor(() => {
        expect(
          within(rendered.container).getByRole("button", {
            name: "返回设置分区",
          }),
        ).toBeTruthy();
        expect(
          within(rendered.container).getByText("显示与声音", {
            selector: ".settings-mobile-detail-title",
          }),
        ).toBeTruthy();
      });

      fireEvent.click(
        within(rendered.container).getByRole("button", {
          name: "返回设置分区",
        }),
      );

      await waitFor(() => {
        expect(within(rendered.container).queryByText("分区")).toBeNull();
      });
    } finally {
      if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: originalMatchMedia,
        });
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
      if (originalPlatformDescriptor) {
        Object.defineProperty(window.navigator, "platform", originalPlatformDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "platform");
      }
      if (originalUserAgentDescriptor) {
        Object.defineProperty(window.navigator, "userAgent", originalUserAgentDescriptor);
      } else {
        Reflect.deleteProperty(window.navigator, "userAgent");
      }
      if (originalTouchPointsDescriptor) {
        Object.defineProperty(
          window.navigator,
          "maxTouchPoints",
          originalTouchPointsDescriptor,
        );
      } else {
        Reflect.deleteProperty(window.navigator, "maxTouchPoints");
      }
    }
  });
});

describe("SettingsView Shortcuts", () => {
  it("closes on Cmd+W", async () => {
    const onClose = vi.fn();
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
      />,
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
      />,
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closes when clicking the modal backdrop", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
      />,
    );

    const backdrop = container.querySelector(".ds-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (!backdrop) {
      throw new Error("Expected settings modal backdrop");
    }

    await act(async () => {
      fireEvent.click(backdrop);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("filters shortcuts by search query", async () => {
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="未分组"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        onTestSystemNotification={vi.fn()}
        initialSection="shortcuts"
      />,
    );

    const searchInput = screen.getByLabelText("搜索快捷键");
    expect(screen.getByText("切换终端面板")).toBeTruthy();
    expect(screen.getByText("切换模型")).toBeTruthy();

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "导航" } });
    });
    await waitFor(() => {
      expect(screen.getByText("下一个项目")).toBeTruthy();
      expect(screen.queryByText("切换终端面板")).toBeNull();
    });

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "侧边栏" } });
    });
    await waitFor(() => {
      expect(screen.getByText("切换项目侧边栏")).toBeTruthy();
      expect(screen.queryByText("下一个项目")).toBeNull();
    });

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "聚焦" } });
    });
    await waitFor(() => {
      expect(screen.getByText("切换模型")).toBeTruthy();
      expect(screen.queryByText("切换终端面板")).toBeNull();
    });

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "no-such-shortcut" } });
    });
    await waitFor(() => {
      expect(screen.getByText('没有匹配“no-such-shortcut”的快捷键。')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "清除" }));
    });
    await waitFor(() => {
      expect(screen.getByText("切换终端面板")).toBeTruthy();
      expect(screen.queryByText('没有匹配“no-such-shortcut”的快捷键。')).toBeNull();
    });
  });
});
