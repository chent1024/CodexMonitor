import { useCallback, useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AppSettings, CodexFeature, CodexFeatureStage } from "@/types";
import {
  getCodexFeatureFlag,
  getCodexConfigPath,
  getExperimentalFeatureList,
  getLocalMemoryStatus,
  getRestartSafeSessionDebugStatus,
  setLocalMemoryEnabled,
  setCodexFeatureFlag,
  type LocalMemoryConfigStatus,
  type RestartSafeDebugStatus,
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
  restartSafeSessionStatus: RestartSafeDebugStatus | null;
  restartSafeSessionLoading: boolean;
  restartSafeSessionError: string | null;
  onOpenConfig: () => void;
  onToggleLocalMemory: () => void;
  onRefreshRestartSafeSessionStatus: () => void;
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
  const [restartSafeSessionStatus, setRestartSafeSessionStatus] =
    useState<RestartSafeDebugStatus | null>(null);
  const [restartSafeSessionLoading, setRestartSafeSessionLoading] = useState(false);
  const [restartSafeSessionError, setRestartSafeSessionError] = useState<string | null>(
    null,
  );

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

  const refreshRestartSafeSessionStatus = useCallback(() => {
    if (!appSettings.restartSafeSessions) {
      setRestartSafeSessionStatus(null);
      setRestartSafeSessionError(null);
      setRestartSafeSessionLoading(false);
      return;
    }
    void (async () => {
      setRestartSafeSessionLoading(true);
      setRestartSafeSessionError(null);
      try {
        const status = await getRestartSafeSessionDebugStatus();
        setRestartSafeSessionStatus(status);
      } catch (error) {
        setRestartSafeSessionStatus(null);
        setRestartSafeSessionError(
          error instanceof Error
            ? error.message
            : "Unable to load restart-safe session status.",
        );
      } finally {
        setRestartSafeSessionLoading(false);
      }
    })();
  }, [appSettings.restartSafeSessions]);

  useEffect(() => {
    refreshRestartSafeSessionStatus();
  }, [refreshRestartSafeSessionStatus]);

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
    restartSafeSessionStatus,
    restartSafeSessionLoading,
    restartSafeSessionError,
    onOpenConfig: () => {
      void handleOpenConfig();
    },
    onToggleLocalMemory,
    onRefreshRestartSafeSessionStatus: refreshRestartSafeSessionStatus,
    onToggleCodexFeature,
    onUpdateAppSettings,
  };
};
