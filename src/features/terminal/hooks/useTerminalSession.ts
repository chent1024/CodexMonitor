import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { DebugEntry, TerminalStatus, WorkspaceInfo } from "../../../types";
import { buildErrorDebugEntry } from "../../../utils/debugEntries";
import {
  subscribeTerminalExit,
  subscribeTerminalOutput,
  type TerminalExitEvent,
  type TerminalOutputEvent,
} from "../../../services/events";
import {
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "../../../services/tauri";
import { formatTerminalOpenErrorMessage } from "../utils/terminalErrorMessage";

const MAX_BUFFER_CHARS = 200_000;
const TERMINAL_METRICS_REPORT_INTERVAL_MS = 5_000;
const TERMINAL_METRICS_MIN_EVENTS = 50;

type TerminalRenderMetrics = {
  bytesReceived: number;
  eventsReceived: number;
  bytesWritten: number;
  writeFlushes: number;
  maxWriteBatch: number;
  startedAt: number;
  lastReportAt: number;
};

type UseTerminalSessionOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeTerminalId: string | null;
  isVisible: boolean;
  focusRequestVersion: number;
  codeFontSize: number;
  onDebug?: (entry: DebugEntry) => void;
  onSessionExit?: (workspaceId: string, terminalId: string) => void;
};

type TerminalAppearance = {
  theme: {
    background: string;
    foreground: string;
    cursor: string;
    selection?: string;
  };
  fontFamily: string;
  fontSize: number;
};

export type TerminalSessionState = {
  status: TerminalStatus;
  message: string;
  containerRef: RefObject<HTMLDivElement | null>;
  hasSession: boolean;
  readyKey: string | null;
  cleanupTerminalSession: (workspaceId: string, terminalId: string) => void;
};

function appendBuffer(existing: string | undefined, data: string): string {
  const next = (existing ?? "") + data;
  if (next.length <= MAX_BUFFER_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_BUFFER_CHARS);
}

function shouldIgnoreTerminalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("terminal session not found") ||
    lower.includes("broken pipe") ||
    lower.includes("input/output error") ||
    lower.includes("os error 5") ||
    lower.includes("eio") ||
    lower.includes("not connected") ||
    lower.includes("closed")
  );
}

function createTerminalMetrics(now: number): TerminalRenderMetrics {
  return {
    bytesReceived: 0,
    eventsReceived: 0,
    bytesWritten: 0,
    writeFlushes: 0,
    maxWriteBatch: 0,
    startedAt: now,
    lastReportAt: now,
  };
}

function getTerminalAppearance(container: HTMLElement | null): TerminalAppearance {
  if (typeof window === "undefined") {
    return {
      theme: {
        background: "transparent",
        foreground: "#d9dee7",
        cursor: "#d9dee7",
      },
      fontFamily: "Menlo, Monaco, \"Courier New\", monospace",
      fontSize: 12,
    };
  }

  const target = container ?? document.documentElement;
  const styles = getComputedStyle(target);
  const background =
    styles.getPropertyValue("--terminal-background").trim() ||
    styles.getPropertyValue("--surface-debug").trim() ||
    styles.getPropertyValue("--surface-panel").trim() ||
    "#11151b";
  const foreground =
    styles.getPropertyValue("--terminal-foreground").trim() ||
    styles.getPropertyValue("--text-stronger").trim() ||
    "#d9dee7";
  const cursor =
    styles.getPropertyValue("--terminal-cursor").trim() || foreground;
  const selection = styles.getPropertyValue("--terminal-selection").trim();
  const fontFamily =
    styles.getPropertyValue("--terminal-font-family").trim() ||
    styles.getPropertyValue("--code-font-family").trim() ||
    "Menlo, Monaco, \"Courier New\", monospace";
  const parsedFontSize = Number.parseFloat(
    styles.getPropertyValue("--code-font-size").trim() || "12",
  );
  const fontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : 12;

  return {
    theme: {
      background,
      foreground,
      cursor,
      selection: selection || undefined,
    },
    fontFamily,
    fontSize,
  };
}

export function useTerminalSession({
  activeWorkspace,
  activeTerminalId,
  isVisible,
  focusRequestVersion,
  codeFontSize,
  onDebug,
  onSessionExit,
}: UseTerminalSessionOptions): TerminalSessionState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const openedSessionsRef = useRef<Set<string>>(new Set());
  const outputBuffersRef = useRef<Map<string, string>>(new Map());
  const pendingWriteBuffersRef = useRef<Map<string, string>>(new Map());
  const terminalWriteFrameRef = useRef<number | null>(null);
  const terminalMetricsRef = useRef<Map<string, TerminalRenderMetrics>>(new Map());
  const activeKeyRef = useRef<string | null>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const activeWorkspaceRef = useRef<WorkspaceInfo | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef(false);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState("Open a terminal to start a session.");
  const [hasSession, setHasSession] = useState(false);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [sessionResetCounter, setSessionResetCounter] = useState(0);
  const cleanupTerminalSession = useCallback((workspaceId: string, terminalId: string) => {
    const key = `${workspaceId}:${terminalId}`;
    outputBuffersRef.current.delete(key);
    pendingWriteBuffersRef.current.delete(key);
    terminalMetricsRef.current.delete(key);
    openedSessionsRef.current.delete(key);
    if (readyKey === key) {
      setReadyKey(null);
    }
    setSessionResetCounter((prev) => prev + 1);
    if (activeKeyRef.current === key) {
      if (terminalWriteFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalWriteFrameRef.current);
        terminalWriteFrameRef.current = null;
      }
      pendingWriteBuffersRef.current.clear();
      terminalRef.current?.reset();
      setHasSession(false);
      setStatus("idle");
      setMessage("Open a terminal to start a session.");
    }
  }, [readyKey]);

  const activeKey = useMemo(() => {
    if (!activeWorkspace || !activeTerminalId) {
      return null;
    }
    return `${activeWorkspace.id}:${activeTerminalId}`;
  }, [activeTerminalId, activeWorkspace]);

  const reportTerminalMetrics = useCallback(
    (key: string, metrics: TerminalRenderMetrics, now: number) => {
      if (
        metrics.eventsReceived < TERMINAL_METRICS_MIN_EVENTS ||
        now - metrics.lastReportAt < TERMINAL_METRICS_REPORT_INTERVAL_MS
      ) {
        return;
      }
      const elapsedMs = Math.max(1, now - metrics.startedAt);
      onDebug?.({
        id: `${now}-terminal-throughput-${key}`,
        timestamp: now,
        source: "event",
        label: "terminal throughput",
        payload: {
          key,
          bytesReceived: metrics.bytesReceived,
          bytesWritten: metrics.bytesWritten,
          eventsReceived: metrics.eventsReceived,
          writeFlushes: metrics.writeFlushes,
          maxWriteBatch: metrics.maxWriteBatch,
          receivedBytesPerSecond: Math.round((metrics.bytesReceived * 1000) / elapsedMs),
        },
      });
      metrics.lastReportAt = now;
    },
    [onDebug],
  );

  const recordTerminalOutput = useCallback(
    (key: string, data: string) => {
      const now = Date.now();
      let metrics = terminalMetricsRef.current.get(key);
      if (!metrics) {
        metrics = createTerminalMetrics(now);
        terminalMetricsRef.current.set(key, metrics);
      }
      metrics.bytesReceived += data.length;
      metrics.eventsReceived += 1;
      reportTerminalMetrics(key, metrics, now);
    },
    [reportTerminalMetrics],
  );

  const cancelPendingTerminalWrite = useCallback(() => {
    if (terminalWriteFrameRef.current !== null) {
      window.cancelAnimationFrame(terminalWriteFrameRef.current);
      terminalWriteFrameRef.current = null;
    }
    pendingWriteBuffersRef.current.clear();
  }, []);

  const scheduleTerminalWrite = useCallback(
    (key: string, data: string) => {
      pendingWriteBuffersRef.current.set(
        key,
        (pendingWriteBuffersRef.current.get(key) ?? "") + data,
      );
      if (terminalWriteFrameRef.current !== null) {
        return;
      }
      terminalWriteFrameRef.current = window.requestAnimationFrame(() => {
        terminalWriteFrameRef.current = null;
        const currentKey = activeKeyRef.current;
        const pending = pendingWriteBuffersRef.current;
        const dataToWrite = currentKey ? pending.get(currentKey) : undefined;
        pending.clear();
        if (!currentKey || !dataToWrite) {
          return;
        }
        terminalRef.current?.write(dataToWrite);
        const now = Date.now();
        let metrics = terminalMetricsRef.current.get(currentKey);
        if (!metrics) {
          metrics = createTerminalMetrics(now);
          terminalMetricsRef.current.set(currentKey, metrics);
        }
        metrics.bytesWritten += dataToWrite.length;
        metrics.writeFlushes += 1;
        metrics.maxWriteBatch = Math.max(metrics.maxWriteBatch, dataToWrite.length);
        reportTerminalMetrics(currentKey, metrics, now);
      });
    },
    [reportTerminalMetrics],
  );

  useEffect(() => {
    activeKeyRef.current = activeKey;
    activeWorkspaceRef.current = activeWorkspace;
    activeTerminalIdRef.current = activeTerminalId;
  }, [activeKey, activeTerminalId, activeWorkspace]);

  const focusTerminalIfRequested = useCallback(() => {
    if (!pendingFocusRef.current) {
      return;
    }
    pendingFocusRef.current = false;
    terminalRef.current?.focus();
  }, []);

  const refreshTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const lastRow = Math.max(0, terminal.rows - 1);
    terminal.refresh(0, lastRow);
    focusTerminalIfRequested();
  }, [focusTerminalIfRequested]);

  const syncActiveBuffer = useCallback(
    (key: string) => {
      const term = terminalRef.current;
      if (!term) {
        return;
      }
      cancelPendingTerminalWrite();
      term.reset();
      const buffered = outputBuffersRef.current.get(key);
      if (buffered) {
        term.write(buffered);
      }
      refreshTerminal();
    },
    [cancelPendingTerminalWrite, refreshTerminal],
  );

  useEffect(() => {
    const unlisten = subscribeTerminalOutput(
      (payload: TerminalOutputEvent) => {
        const { workspaceId, terminalId, data } = payload;
        const key = `${workspaceId}:${terminalId}`;
        const next = appendBuffer(outputBuffersRef.current.get(key), data);
        outputBuffersRef.current.set(key, next);
        recordTerminalOutput(key, data);
        if (activeKeyRef.current === key) {
          scheduleTerminalWrite(key, data);
        }
      },
      {
        onError: (error) => {
          onDebug?.(buildErrorDebugEntry("terminal listen error", error));
        },
      },
    );
    return () => {
      unlisten();
    };
  }, [onDebug, recordTerminalOutput, scheduleTerminalWrite]);

  useEffect(() => {
    const unlisten = subscribeTerminalExit(
      (payload: TerminalExitEvent) => {
        cleanupTerminalSession(payload.workspaceId, payload.terminalId);
        onSessionExit?.(payload.workspaceId, payload.terminalId);
      },
      {
        onError: (error) => {
          onDebug?.(buildErrorDebugEntry("terminal exit listen error", error));
        },
      },
    );
    return () => {
      unlisten();
    };
  }, [cleanupTerminalSession, onDebug, onSessionExit]);

  useEffect(() => {
    if (!isVisible) {
      cancelPendingTerminalWrite();
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
      renderedKeyRef.current = null;
      return;
    }

    if (!terminalRef.current && containerRef.current) {
      const appearance = getTerminalAppearance(containerRef.current);
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: appearance.fontSize,
        fontFamily: appearance.fontFamily,
        allowTransparency: true,
        theme: appearance.theme,
        scrollback: 5000,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      inputDisposableRef.current = terminal.onData((data: string) => {
        const workspace = activeWorkspaceRef.current;
        const terminalId = activeTerminalIdRef.current;
        if (!workspace || !terminalId) {
          return;
        }
        const key = `${workspace.id}:${terminalId}`;
        if (!openedSessionsRef.current.has(key)) {
          return;
        }
        void writeTerminalSession(workspace.id, terminalId, data).catch((error) => {
          if (shouldIgnoreTerminalError(error)) {
            openedSessionsRef.current.delete(key);
            return;
          }
          onDebug?.(buildErrorDebugEntry("terminal write error", error));
        });
      });
    }
  }, [cancelPendingTerminalWrite, isVisible, onDebug]);

  useEffect(() => {
    if (!isVisible || !terminalRef.current) {
      return;
    }
    const appearance = getTerminalAppearance(containerRef.current);
    terminalRef.current.options.fontFamily = appearance.fontFamily;
    terminalRef.current.options.fontSize = appearance.fontSize;
    terminalRef.current.options.theme = appearance.theme;
    fitAddonRef.current?.fit();
    refreshTerminal();
  }, [codeFontSize, isVisible, refreshTerminal]);

  useEffect(() => {
    return () => {
      cancelPendingTerminalWrite();
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [cancelPendingTerminalWrite]);

  useEffect(() => {
    if (!isVisible) {
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    if (!activeWorkspace || !activeTerminalId) {
      setStatus("idle");
      setMessage("Open a terminal to start a session.");
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    if (!terminalRef.current || !fitAddonRef.current) {
      setStatus("idle");
      setMessage("Preparing terminal...");
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    const key = `${activeWorkspace.id}:${activeTerminalId}`;
    const fitAddon = fitAddonRef.current;
    fitAddon.fit();

    const cols = terminalRef.current.cols;
    const rows = terminalRef.current.rows;
    const openSession = async () => {
      setStatus("connecting");
      setMessage("Starting terminal session...");
      if (!openedSessionsRef.current.has(key)) {
        await openTerminalSession(activeWorkspace.id, activeTerminalId, cols, rows);
        openedSessionsRef.current.add(key);
      }
      setStatus("ready");
      setMessage("Terminal ready.");
      setHasSession(true);
      setReadyKey(key);
      if (renderedKeyRef.current !== key) {
        syncActiveBuffer(key);
        renderedKeyRef.current = key;
      } else {
        refreshTerminal();
      }
    };

    openSession().catch((error) => {
      setStatus("error");
      setMessage(formatTerminalOpenErrorMessage(error));
      onDebug?.(buildErrorDebugEntry("terminal open error", error));
    });
  }, [
    activeTerminalId,
    activeWorkspace,
    isVisible,
    onDebug,
    refreshTerminal,
    syncActiveBuffer,
    sessionResetCounter,
  ]);

  useEffect(() => {
    if (!isVisible || focusRequestVersion === 0) {
      return;
    }
    pendingFocusRef.current = true;
    focusTerminalIfRequested();
  }, [focusRequestVersion, focusTerminalIfRequested, isVisible]);

  useEffect(() => {
    if (!isVisible || !activeKey || !terminalRef.current || !fitAddonRef.current) {
      return;
    }
    fitAddonRef.current.fit();
    refreshTerminal();
  }, [activeKey, isVisible, refreshTerminal]);

  useEffect(() => {
    if (
      !isVisible ||
      !terminalRef.current ||
      !activeWorkspace ||
      !activeTerminalId ||
      !hasSession
    ) {
      return;
    }
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon) {
      return;
    }

    let resizeFrame: number | null = null;
    let lastSentSize: string | null = null;

    const resize = () => {
      fitAddon.fit();
      const sizeKey = `${terminal.cols}x${terminal.rows}`;
      if (sizeKey === lastSentSize) {
        return;
      }
      lastSentSize = sizeKey;
      const key = `${activeWorkspace.id}:${activeTerminalId}`;
      resizeTerminalSession(
        activeWorkspace.id,
        activeTerminalId,
        terminal.cols,
        terminal.rows,
      ).catch((error) => {
        if (shouldIgnoreTerminalError(error)) {
          openedSessionsRef.current.delete(key);
          return;
        }
        onDebug?.(buildErrorDebugEntry("terminal resize error", error));
      });
    };

    const scheduleResize = () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    scheduleResize();

    return () => {
      observer.disconnect();
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
    };
  }, [activeTerminalId, activeWorkspace, hasSession, isVisible, onDebug]);

  return {
    status,
    message,
    containerRef,
    hasSession,
    readyKey,
    cleanupTerminalSession,
  };
}
