import { useCallback, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AppSettings, CodexFeature, CodexFeatureStage } from "@/types";
import {
  getCodexFeatureFlag,
  getCodexConfigPath,
  getExperimentalFeatureList,
  getLocalMemoryStatus,
  listLocalMemories,
  searchLocalMemories,
  addLocalMemory,
  updateLocalMemory,
  deleteLocalMemory,
  deleteAllLocalMemories,
  importLocalMemories,
  listLocalMemoryReviewQueue,
  approveLocalMemory,
  rejectLocalMemory,
  listLocalMemoryEntities,
  deleteLocalMemoryEntities,
  rebuildLocalMemoryIndexes,
  listLocalMemoryEvents,
  setLocalMemoryEnabled,
  setLocalMemoryDbPath,
  setLocalMemoryEmbeddingModel,
  checkLocalMemoryConnection,
  setCodexFeatureFlag,
  type ImportLocalMemoryRecord,
  type LocalMemoryConnectionCheck,
  type LocalMemoryConfigStatus,
  type LocalMemoryAccessLogEntry,
  type LocalMemoryEntity,
  type LocalMemoryRecord,
} from "@services/tauri";

type UseSettingsFeaturesSectionArgs = {
  appSettings: AppSettings;
  featureWorkspaceId: string | null;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

const HIDDEN_DYNAMIC_FEATURE_KEYS = new Set<string>([
  "personality",
  "collab",
  "steer",
]);

const FAST_MODE_FEATURE_KEY = "fast_mode";

function localFastModeFeature(enabled: boolean): CodexFeature {
  return {
    name: FAST_MODE_FEATURE_KEY,
    stage: "stable",
    enabled,
    defaultEnabled: false,
    displayName: "Fast Mode",
    description: null,
    announcement: null,
  };
}

export type SettingsFeaturesSectionProps = {
  appSettings: AppSettings;
  hasFeatureWorkspace: boolean;
  openConfigError: string | null;
  featureError: string | null;
  featuresLoading: boolean;
  featureUpdatingKey: string | null;
  stableFeatures: CodexFeature[];
  experimentalFeatures: CodexFeature[];
  hasDynamicFeatureRows: boolean;
  localMemoryStatus: LocalMemoryConfigStatus | null;
  localMemoryLoading: boolean;
  localMemoryUpdating: boolean;
  localMemoryError: string | null;
  localMemoryQuery: string;
  localMemoryDraft: string;
  localMemoryDbPathDraft: string;
  localMemoryReviewFilter: string;
  localMemorySelectedReviewIds: string[];
  localMemoryRecords: LocalMemoryRecord[];
  localMemoryReviewQueue: LocalMemoryRecord[];
  localMemoryEntities: LocalMemoryEntity[];
  localMemoryEvents: LocalMemoryAccessLogEntry[];
  localMemoryConnection: LocalMemoryConnectionCheck | null;
  localMemoryActionLoading: boolean;
  onOpenConfig: () => void;
  onToggleLocalMemory: () => void;
  onLocalMemoryQueryChange: (value: string) => void;
  onLocalMemoryDraftChange: (value: string) => void;
  onLocalMemoryDbPathDraftChange: (value: string) => void;
  onLocalMemoryReviewFilterChange: (value: string) => void;
  onApplyLocalMemoryDbPath: () => void;
  onApplyLocalMemoryEmbeddingModel: (embeddingModel: string) => void;
  onCheckLocalMemoryConnection: () => void;
  onRefreshLocalMemories: () => void;
  onSearchLocalMemories: () => void;
  onAddLocalMemory: () => void;
  onUpdateLocalMemory: (memory: LocalMemoryRecord) => void;
  onDeleteLocalMemory: (id: string) => void;
  onDeleteAllLocalMemories: () => void;
  onDeleteLocalMemoryEntities: () => void;
  onRebuildLocalMemoryIndexes: () => void;
  onExportLocalMemories: () => void;
  onImportLocalMemories: () => void;
  onToggleLocalMemoryReviewSelection: (id: string) => void;
  onToggleAllLocalMemoryReviewSelection: (ids: string[]) => void;
  onApproveLocalMemory: (id: string) => void;
  onEditAndApproveLocalMemory: (memory: LocalMemoryRecord) => void;
  onApproveSelectedLocalMemories: () => void;
  onRejectLocalMemory: (id: string) => void;
  onRejectSelectedLocalMemories: () => void;
  onToggleCodexFeature: (feature: CodexFeature) => void;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

function normalizeStage(value: unknown): CodexFeatureStage | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "underdevelopment" || raw === "under_development") {
    return "under_development";
  }
  if (raw === "beta" || raw === "experimental") {
    return "beta";
  }
  if (raw === "stable") {
    return "stable";
  }
  if (raw === "deprecated") {
    return "deprecated";
  }
  if (raw === "removed") {
    return "removed";
  }
  return null;
}

function normalizeFeature(item: unknown): CodexFeature | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  const stage = normalizeStage(record.stage);
  if (!name || !stage) {
    return null;
  }
  const displayName =
    typeof record.displayName === "string"
      ? record.displayName
      : typeof record.display_name === "string"
        ? record.display_name
        : null;
  const description =
    typeof record.description === "string" ? record.description : null;
  const announcement =
    typeof record.announcement === "string" ? record.announcement : null;
  const enabled = Boolean(record.enabled);
  const defaultEnabled =
    typeof record.defaultEnabled === "boolean"
      ? record.defaultEnabled
      : Boolean(record.default_enabled);
  return {
    name,
    stage,
    enabled,
    defaultEnabled,
    displayName,
    description,
    announcement,
  };
}

function parseFeaturePage(response: unknown): {
  data: CodexFeature[];
  nextCursor: string | null;
} {
  if (!response || typeof response !== "object") {
    return { data: [], nextCursor: null };
  }
  const root = response as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  const dataRaw = Array.isArray(result.data) ? result.data : [];
  const data = dataRaw
    .map((item) => normalizeFeature(item))
    .filter((item): item is CodexFeature => item !== null);
  const nextCursorRaw =
    typeof result.nextCursor === "string"
      ? result.nextCursor
      : typeof result.next_cursor === "string"
        ? result.next_cursor
        : null;
  return { data, nextCursor: nextCursorRaw };
}

function mapFeatureToAppSettings(
  appSettings: AppSettings,
  featureKey: string,
  enabled: boolean,
): AppSettings | null {
  if (featureKey === "apps") {
    return { ...appSettings, experimentalAppsEnabled: enabled };
  }
  if (featureKey === "collaboration_modes") {
    return { ...appSettings, collaborationModesEnabled: enabled };
  }
  if (featureKey === "steer") {
    return { ...appSettings, steerEnabled: enabled };
  }
  if (featureKey === "unified_exec") {
    return { ...appSettings, unifiedExecEnabled: enabled };
  }
  return null;
}

function importRecordFromValue(value: unknown): ImportLocalMemoryRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = String(record.content ?? record.text ?? record.memory ?? "").trim();
  if (!content) {
    return null;
  }
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};
  const categories = Array.isArray(record.categories)
    ? record.categories
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0)
    : [];
  return {
    content,
    scope: typeof record.scope === "string" ? record.scope : null,
    kind: typeof record.kind === "string" ? record.kind : null,
    metadata,
    categories,
    confidence: typeof record.confidence === "number" ? record.confidence : null,
    expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : null,
    supersedesId:
      typeof record.supersedesId === "string" ? record.supersedesId : null,
    filters: {
      workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : null,
      workspacePath:
        typeof record.workspacePath === "string" ? record.workspacePath : null,
      threadId: typeof record.threadId === "string" ? record.threadId : null,
      userId: typeof record.userId === "string" ? record.userId : null,
      agentId: typeof record.agentId === "string" ? record.agentId : null,
      appId: typeof record.appId === "string" ? record.appId : null,
      runId: typeof record.runId === "string" ? record.runId : null,
      scope: typeof record.scope === "string" ? record.scope : null,
      kind: typeof record.kind === "string" ? record.kind : null,
      categories,
    },
  };
}

function importRecordsFromJson(raw: string): ImportLocalMemoryRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  const source =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)
      ? (parsed as { memories: unknown[] }).memories
      : Array.isArray(parsed)
        ? parsed
        : [];
  return source
    .map((item) => importRecordFromValue(item))
    .filter((item): item is ImportLocalMemoryRecord => item !== null);
}

export const useSettingsFeaturesSection = ({
  appSettings,
  featureWorkspaceId,
  onUpdateAppSettings,
}: UseSettingsFeaturesSectionArgs): SettingsFeaturesSectionProps => {
  const [openConfigError, setOpenConfigError] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [featureUpdatingKey, setFeatureUpdatingKey] = useState<string | null>(null);
  const [features, setFeatures] = useState<CodexFeature[]>([]);
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const [localMemoryStatus, setLocalMemoryStatus] =
    useState<LocalMemoryConfigStatus | null>(null);
  const [localMemoryLoading, setLocalMemoryLoading] = useState(false);
  const [localMemoryUpdating, setLocalMemoryUpdating] = useState(false);
  const [localMemoryError, setLocalMemoryError] = useState<string | null>(null);
  const [localMemoryQuery, setLocalMemoryQuery] = useState("");
  const [localMemoryDraft, setLocalMemoryDraft] = useState("");
  const [localMemoryDbPathDraft, setLocalMemoryDbPathDraft] = useState("");
  const [localMemoryReviewFilter, setLocalMemoryReviewFilter] = useState("");
  const [localMemorySelectedReviewIds, setLocalMemorySelectedReviewIds] = useState<
    string[]
  >([]);
  const [localMemoryRecords, setLocalMemoryRecords] = useState<LocalMemoryRecord[]>([]);
  const [localMemoryReviewQueue, setLocalMemoryReviewQueue] = useState<
    LocalMemoryRecord[]
  >([]);
  const [localMemoryEntities, setLocalMemoryEntities] = useState<LocalMemoryEntity[]>([]);
  const [localMemoryEvents, setLocalMemoryEvents] = useState<LocalMemoryAccessLogEntry[]>([]);
  const [localMemoryConnection, setLocalMemoryConnection] =
    useState<LocalMemoryConnectionCheck | null>(null);
  const [localMemoryActionLoading, setLocalMemoryActionLoading] = useState(false);

  const handleOpenConfig = useCallback(async () => {
    setOpenConfigError(null);
    try {
      const configPath = await getCodexConfigPath();
      await revealItemInDir(configPath);
    } catch (error) {
      setOpenConfigError(
        error instanceof Error ? error.message : "Unable to open config.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const enabled = await getCodexFeatureFlag(FAST_MODE_FEATURE_KEY);
        if (active) {
          setFastModeEnabled(enabled);
        }
      } catch {
        if (active) {
          setFastModeEnabled(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshLocalMemoryData = useCallback(async () => {
    setLocalMemoryActionLoading(true);
    setLocalMemoryError(null);
    try {
      const [records, entities, events, reviewQueue] = await Promise.all([
        listLocalMemories({ limit: 50 }),
        listLocalMemoryEntities(),
        listLocalMemoryEvents({ limit: 25 }),
        listLocalMemoryReviewQueue(50),
      ]);
      setLocalMemoryRecords(records);
      setLocalMemoryReviewQueue(reviewQueue);
      setLocalMemorySelectedReviewIds((current) => {
        const available = new Set(reviewQueue.map((memory) => memory.id));
        return current.filter((id) => available.has(id));
      });
      setLocalMemoryEntities(entities.slice(0, 50));
      setLocalMemoryEvents(events);
    } catch (error) {
      setLocalMemoryError(
        error instanceof Error ? error.message : "Unable to load local memories.",
      );
    } finally {
      setLocalMemoryActionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (localMemoryStatus?.enabled) {
      void refreshLocalMemoryData();
    } else {
      setLocalMemoryRecords([]);
      setLocalMemoryReviewQueue([]);
      setLocalMemorySelectedReviewIds([]);
      setLocalMemoryEntities([]);
      setLocalMemoryEvents([]);
    }
  }, [localMemoryStatus?.enabled, refreshLocalMemoryData]);

  useEffect(() => {
    setLocalMemoryDbPathDraft(localMemoryStatus?.dbPath ?? "");
  }, [localMemoryStatus?.dbPath]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLocalMemoryLoading(true);
      setLocalMemoryError(null);
      try {
        const status = await getLocalMemoryStatus();
        if (active) {
          setLocalMemoryStatus(status);
        }
      } catch (error) {
        if (active) {
          setLocalMemoryStatus(null);
          setLocalMemoryError(
            error instanceof Error
              ? error.message
              : "Unable to load local memory status.",
          );
        }
      } finally {
        if (active) {
          setLocalMemoryLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!featureWorkspaceId) {
      setFeatures([]);
      setFeatureError(null);
      setFeaturesLoading(false);
      return () => {
        active = false;
      };
    }

    void (async () => {
      setFeatureError(null);
      setFeaturesLoading(true);
      try {
        const loaded: CodexFeature[] = [];
        const seen = new Set<string>();
        let cursor: string | null = null;
        for (let page = 0; page < 20; page += 1) {
          const response = await getExperimentalFeatureList(
            featureWorkspaceId,
            cursor,
            100,
          );
          const parsed = parseFeaturePage(response);
          for (const item of parsed.data) {
            if (seen.has(item.name)) {
              continue;
            }
            seen.add(item.name);
            loaded.push(item);
          }
          if (!parsed.nextCursor) {
            break;
          }
          cursor = parsed.nextCursor;
        }
        if (!active) {
          return;
        }
        loaded.sort((left, right) => left.name.localeCompare(right.name));
        setFeatures(loaded);
      } catch (error) {
        if (!active) {
          return;
        }
        setFeatures([]);
        setFeatureError(
          error instanceof Error
            ? error.message
            : "Unable to load Codex feature flags.",
        );
      } finally {
        if (active) {
          setFeaturesLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [featureWorkspaceId]);

  const stableFeatures = useMemo(() => {
    let sawFastMode = false;
    const rows = features
      .filter((feature) => feature.stage === "stable")
      .filter((feature) => !HIDDEN_DYNAMIC_FEATURE_KEYS.has(feature.name))
      .map((feature) => {
        if (feature.name !== FAST_MODE_FEATURE_KEY) {
          return feature;
        }
        sawFastMode = true;
        return {
          ...feature,
          enabled: fastModeEnabled,
          defaultEnabled: false,
          displayName: feature.displayName ?? "Fast Mode",
        };
      });
    if (!sawFastMode) {
      rows.push(localFastModeFeature(fastModeEnabled));
    }
    return rows;
  }, [features, fastModeEnabled]);
  const experimentalFeatures = useMemo(
    () =>
      features.filter(
        (feature) =>
          (feature.stage === "beta" || feature.stage === "under_development") &&
          feature.name !== FAST_MODE_FEATURE_KEY &&
          !HIDDEN_DYNAMIC_FEATURE_KEYS.has(feature.name),
      ),
    [features],
  );
  const hasDynamicFeatureRows = stableFeatures.length > 0 || experimentalFeatures.length > 0;

  const onToggleCodexFeature = useCallback(
    (feature: CodexFeature) => {
      void (async () => {
        const nextEnabled = !feature.enabled;
        setFeatureUpdatingKey(feature.name);
        setFeatureError(null);
        try {
          const nextSettings = mapFeatureToAppSettings(
            appSettings,
            feature.name,
            nextEnabled,
          );
          if (nextSettings) {
            await onUpdateAppSettings(nextSettings);
          } else {
            await setCodexFeatureFlag(feature.name, nextEnabled);
          }
          if (feature.name === FAST_MODE_FEATURE_KEY) {
            setFastModeEnabled(nextEnabled);
          }
          setFeatures((current) =>
            current.map((item) =>
              item.name === feature.name ? { ...item, enabled: nextEnabled } : item,
            ),
          );
        } catch (error) {
          setFeatureError(
            error instanceof Error
              ? error.message
              : `Unable to update feature "${feature.name}".`,
          );
        } finally {
          setFeatureUpdatingKey((current) =>
            current === feature.name ? null : current,
          );
        }
      })();
    },
    [appSettings, onUpdateAppSettings],
  );

  const onToggleLocalMemory = useCallback(() => {
    void (async () => {
      const nextEnabled = !(localMemoryStatus?.enabled ?? false);
      setLocalMemoryUpdating(true);
      setLocalMemoryError(null);
      try {
        const status = await setLocalMemoryEnabled(nextEnabled);
        setLocalMemoryStatus(status);
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error
            ? error.message
            : "Unable to update local memory.",
        );
      } finally {
        setLocalMemoryUpdating(false);
      }
    })();
  }, [localMemoryStatus?.enabled]);

  const onApplyLocalMemoryDbPath = useCallback(() => {
    void (async () => {
      const dbPath = localMemoryDbPathDraft.trim();
      if (!dbPath || dbPath === localMemoryStatus?.dbPath) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        const status = await setLocalMemoryDbPath(dbPath);
        setLocalMemoryStatus(status);
        setLocalMemoryConnection(null);
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error
            ? error.message
            : "Unable to update local memory database path.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [localMemoryDbPathDraft, localMemoryStatus?.dbPath]);

  const onApplyLocalMemoryEmbeddingModel = useCallback(
    (embeddingModel: string) => {
      void (async () => {
        const nextModel = embeddingModel.trim();
        if (!nextModel || nextModel === localMemoryStatus?.embeddingModel) {
          return;
        }
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          const status = await setLocalMemoryEmbeddingModel(nextModel);
          setLocalMemoryStatus(status);
          setLocalMemoryConnection(null);
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error
              ? error.message
              : "Unable to update local memory embedding model.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [localMemoryStatus?.embeddingModel],
  );

  const onCheckLocalMemoryConnection = useCallback(() => {
    void (async () => {
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        const result = await checkLocalMemoryConnection();
        setLocalMemoryConnection(result);
        if (!result.ok && result.error) {
          setLocalMemoryError(result.error);
        }
      } catch (error) {
        setLocalMemoryConnection(null);
        setLocalMemoryError(
          error instanceof Error
            ? error.message
            : "Unable to check local memory MCP connection.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, []);

  const onSearchLocalMemories = useCallback(() => {
    void (async () => {
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        const query = localMemoryQuery.trim();
        const records = query
          ? await searchLocalMemories({ query, limit: 50 })
          : await listLocalMemories({ limit: 50 });
        setLocalMemoryRecords(records);
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to search local memories.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [localMemoryQuery]);

  const onAddLocalMemory = useCallback(() => {
    void (async () => {
      const content = localMemoryDraft.trim();
      if (!content) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await addLocalMemory({
          content,
          scope: "user",
          kind: "user_preferences",
          categories: ["manual"],
        });
        setLocalMemoryDraft("");
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to add local memory.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [localMemoryDraft, refreshLocalMemoryData]);

  const onUpdateLocalMemory = useCallback(
    (memory: LocalMemoryRecord) => {
      void (async () => {
        const next = window.prompt("Update memory content", memory.content);
        if (next == null || next.trim() === memory.content.trim()) {
          return;
        }
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          await updateLocalMemory(memory.id, next);
          await refreshLocalMemoryData();
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error ? error.message : "Unable to update local memory.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [refreshLocalMemoryData],
  );

  const onDeleteLocalMemory = useCallback(
    (id: string) => {
      void (async () => {
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          await deleteLocalMemory(id);
          await refreshLocalMemoryData();
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error ? error.message : "Unable to delete local memory.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [refreshLocalMemoryData],
  );

  const onDeleteAllLocalMemories = useCallback(() => {
    void (async () => {
      if (!window.confirm("Delete all local memories?")) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await deleteAllLocalMemories();
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to delete local memories.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [refreshLocalMemoryData]);

  const onDeleteLocalMemoryEntities = useCallback(() => {
    void (async () => {
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await deleteLocalMemoryEntities();
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to delete memory entities.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [refreshLocalMemoryData]);

  const onRebuildLocalMemoryIndexes = useCallback(() => {
    void (async () => {
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await rebuildLocalMemoryIndexes();
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to rebuild memory indexes.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [refreshLocalMemoryData]);

  const onExportLocalMemories = useCallback(() => {
    const payload = JSON.stringify(
      { memories: localMemoryRecords, entities: localMemoryEntities, events: localMemoryEvents },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "codex-local-memory-export.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [localMemoryEntities, localMemoryEvents, localMemoryRecords]);

  const onImportLocalMemories = useCallback(() => {
    void (async () => {
      const raw = window.prompt("Paste a codex-local-memory-export.json payload");
      if (!raw?.trim()) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        const memories = importRecordsFromJson(raw);
        if (memories.length === 0) {
          throw new Error("No memories found in import payload.");
        }
        await importLocalMemories({ memories });
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error ? error.message : "Unable to import local memories.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [refreshLocalMemoryData]);

  const onApproveLocalMemory = useCallback(
    (id: string) => {
      void (async () => {
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          await approveLocalMemory(id);
          await refreshLocalMemoryData();
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error ? error.message : "Unable to approve local memory.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [refreshLocalMemoryData],
  );

  const onEditAndApproveLocalMemory = useCallback(
    (memory: LocalMemoryRecord) => {
      void (async () => {
        const next = window.prompt("Edit and approve memory content", memory.content);
        if (next == null) {
          return;
        }
        const content = next.trim();
        if (!content) {
          setLocalMemoryError("Memory content is empty.");
          return;
        }
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          if (content !== memory.content.trim()) {
            await updateLocalMemory(memory.id, content);
          }
          await approveLocalMemory(memory.id);
          await refreshLocalMemoryData();
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error
              ? error.message
              : "Unable to edit and approve local memory.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [refreshLocalMemoryData],
  );

  const onApproveSelectedLocalMemories = useCallback(() => {
    void (async () => {
      if (localMemorySelectedReviewIds.length === 0) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await Promise.all(
          localMemorySelectedReviewIds.map((id) => approveLocalMemory(id)),
        );
        setLocalMemorySelectedReviewIds([]);
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error
            ? error.message
            : "Unable to approve selected local memories.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [localMemorySelectedReviewIds, refreshLocalMemoryData]);

  const onRejectLocalMemory = useCallback(
    (id: string) => {
      void (async () => {
        setLocalMemoryActionLoading(true);
        setLocalMemoryError(null);
        try {
          await rejectLocalMemory(id);
          await refreshLocalMemoryData();
        } catch (error) {
          setLocalMemoryError(
            error instanceof Error ? error.message : "Unable to reject local memory.",
          );
        } finally {
          setLocalMemoryActionLoading(false);
        }
      })();
    },
    [refreshLocalMemoryData],
  );

  const onRejectSelectedLocalMemories = useCallback(() => {
    void (async () => {
      if (localMemorySelectedReviewIds.length === 0) {
        return;
      }
      setLocalMemoryActionLoading(true);
      setLocalMemoryError(null);
      try {
        await Promise.all(localMemorySelectedReviewIds.map((id) => rejectLocalMemory(id)));
        setLocalMemorySelectedReviewIds([]);
        await refreshLocalMemoryData();
      } catch (error) {
        setLocalMemoryError(
          error instanceof Error
            ? error.message
            : "Unable to reject selected local memories.",
        );
      } finally {
        setLocalMemoryActionLoading(false);
      }
    })();
  }, [localMemorySelectedReviewIds, refreshLocalMemoryData]);

  const onToggleLocalMemoryReviewSelection = useCallback((id: string) => {
    setLocalMemorySelectedReviewIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);

  const onToggleAllLocalMemoryReviewSelection = useCallback((ids: string[]) => {
    setLocalMemorySelectedReviewIds((current) => {
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      if (uniqueIds.length === 0) {
        return current;
      }
      const selected = new Set(current);
      const allSelected = uniqueIds.every((id) => selected.has(id));
      if (allSelected) {
        return current.filter((id) => !uniqueIds.includes(id));
      }
      for (const id of uniqueIds) {
        selected.add(id);
      }
      return Array.from(selected);
    });
  }, []);

  return {
    appSettings,
    hasFeatureWorkspace: featureWorkspaceId != null,
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
    onOpenConfig: () => {
      void handleOpenConfig();
    },
    onToggleLocalMemory,
    onLocalMemoryQueryChange: setLocalMemoryQuery,
    onLocalMemoryDraftChange: setLocalMemoryDraft,
    onLocalMemoryDbPathDraftChange: setLocalMemoryDbPathDraft,
    onLocalMemoryReviewFilterChange: setLocalMemoryReviewFilter,
    onApplyLocalMemoryDbPath,
    onApplyLocalMemoryEmbeddingModel,
    onCheckLocalMemoryConnection,
    onRefreshLocalMemories: () => {
      void refreshLocalMemoryData();
    },
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
  };
};
