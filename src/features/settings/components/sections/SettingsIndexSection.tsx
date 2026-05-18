import { useCallback, useEffect, useMemo, useState } from "react";
import Database from "lucide-react/dist/esm/icons/database";
import Download from "lucide-react/dist/esm/icons/download";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { ThreadSearchIndexStats, ThreadSearchIndexStatus } from "@/types";
import {
  clearThreadSearchIndex,
  getThreadSearchIndexStatus,
  rebuildThreadSearchIndex,
} from "@services/tauri";

type IndexAction = "refresh" | "clear" | "codex_sessions" | "app_server";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatTime(value?: number | null) {
  if (!value) {
    return "无";
  }
  return new Date(value).toLocaleString();
}

function statusRows(status: ThreadSearchIndexStatus | null) {
  return [
    { label: "总大小", value: formatBytes(status?.totalBytes ?? 0) },
    { label: "数据库", value: formatBytes(status?.dbBytes ?? 0) },
    { label: "WAL", value: formatBytes(status?.walBytes ?? 0) },
    { label: "SHM", value: formatBytes(status?.shmBytes ?? 0) },
    { label: "会话数", value: formatCount(status?.indexedThreads ?? 0) },
    { label: "工作区", value: formatCount(status?.indexedWorkspaces ?? 0) },
    { label: "FTS 行", value: formatCount(status?.ftsRows ?? 0) },
    { label: "标题数据", value: formatBytes(status?.titleBytes ?? 0) },
    { label: "正文数据", value: formatBytes(status?.contentBytes ?? 0) },
    { label: "最后更新", value: formatTime(status?.lastIndexedAt) },
  ];
}

function statsSummary(stats: ThreadSearchIndexStats | null) {
  if (!stats) {
    return null;
  }
  return [
    `来源 ${stats.source}`,
    `索引 ${formatCount(stats.indexedThreads)}`,
    `扫描文件 ${formatCount(stats.scannedFiles)}`,
    `扫描会话 ${formatCount(stats.scannedThreads)}`,
    `跳过 ${formatCount(stats.skipped)}`,
    `错误 ${formatCount(stats.errorCount)}`,
  ].join(" · ");
}

export function SettingsIndexSection() {
  const [status, setStatus] = useState<ThreadSearchIndexStatus | null>(null);
  const [lastStats, setLastStats] = useState<ThreadSearchIndexStats | null>(null);
  const [activeAction, setActiveAction] = useState<IndexAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => statusRows(status), [status]);
  const sourceLabel = useMemo(() => {
    if (!status || status.sourceCounts.length === 0) {
      return "无";
    }
    return status.sourceCounts
      .map((item) => `${item.source}: ${formatCount(item.count)}`)
      .join(" · ");
  }, [status]);

  const refresh = useCallback(async () => {
    const next = await getThreadSearchIndexStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getThreadSearchIndexStatus();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const runAction = useCallback(
    async (action: IndexAction) => {
      setActiveAction(action);
      setError(null);
      try {
        if (action === "refresh") {
          await refresh();
          return;
        }
        if (action === "clear") {
          const next = await clearThreadSearchIndex();
          setStatus(next);
          setLastStats(null);
          return;
        }
        const stats = await rebuildThreadSearchIndex({
          source: action,
          reset: true,
        });
        setLastStats(stats);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActiveAction(null);
      }
    },
    [refresh],
  );

  const busy = activeAction !== null;
  const summary = statsSummary(lastStats);

  return (
    <>
      <div className="settings-field">
        <div className="settings-field-label settings-field-label--section">
          会话搜索索引
        </div>
        <div className="settings-help">
          索引只保存会话标题、用户输入、助手输出文案；工具、运行、文件编辑和推理内容不会进入索引。
        </div>
      </div>

      <div className="settings-field settings-index-panel">
        <div className="settings-index-header">
          <div>
            <div className="settings-toggle-title">
              {status?.exists ? "索引已建立" : "索引未建立"}
            </div>
            <div className="settings-toggle-subtitle">
              {status?.dbPath || "等待读取索引路径"}
            </div>
          </div>
          <button
            type="button"
            className="button settings-button-compact"
            disabled={busy}
            onClick={() => void runAction("refresh")}
          >
            <RefreshCw aria-hidden />
            刷新
          </button>
        </div>

        <div className="settings-index-grid">
          {rows.map((row) => (
            <div className="settings-index-metric" key={row.label}>
              <div className="settings-index-metric-label">{row.label}</div>
              <div className="settings-index-metric-value">{row.value}</div>
            </div>
          ))}
        </div>

        <div className="settings-help">来源分布：{sourceLabel}</div>
        {summary && <div className="settings-help">最近重建：{summary}</div>}
        {error && <div className="settings-help settings-help-error">{error}</div>}
      </div>

      <div className="settings-field">
        <div className="settings-field-label">索引操作</div>
        <div className="settings-field-row settings-index-actions">
          <button
            type="button"
            className="button settings-button-compact"
            disabled={busy}
            onClick={() => void runAction("codex_sessions")}
          >
            <Database aria-hidden />
            从 .codex 重建
          </button>
          <button
            type="button"
            className="button settings-button-compact"
            disabled={busy}
            onClick={() => void runAction("app_server")}
          >
            <Download aria-hidden />
            拉历史重建
          </button>
          <button
            type="button"
            className="ghost settings-button-compact settings-index-danger"
            disabled={busy}
            onClick={() => void runAction("clear")}
          >
            <Trash2 aria-hidden />
            清空索引
          </button>
        </div>
        {busy && <div className="settings-help">正在执行索引操作...</div>}
      </div>
    </>
  );
}
