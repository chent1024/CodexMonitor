import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import Brain from "lucide-react/dist/esm/icons/brain";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Copy from "lucide-react/dist/esm/icons/copy";
import Diff from "lucide-react/dist/esm/icons/diff";
import FileDiffIcon from "lucide-react/dist/esm/icons/file-diff";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Image from "lucide-react/dist/esm/icons/image";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Search from "lucide-react/dist/esm/icons/search";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Users from "lucide-react/dist/esm/icons/users";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import { exportMarkdownFile } from "@services/tauri";
import { pushErrorToast } from "@services/toasts";
import type { ConversationItem } from "../../types";
import type { ParsedFileLocation } from "../../utils/fileLinks";
import { PierreDiffBlock } from "../git/components/PierreDiffBlock";
import {
  buildToolSummary,
  exploreKindLabel,
  formatDurationMs,
  parseReasoning,
  toolStatusTone,
  type ParsedReasoning,
  type ToolSummary,
  toolNameFromTitle,
} from "../messages/utils/messageRenderUtils";
import { Markdown } from "../messages/components/Markdown";
import {
  AnimatedDisclosureBody,
  VSCODE_COMMAND_OUTPUT_MAX_HEIGHT_PX,
  VSCODE_REASONING_HEIGHT_BY_STATE,
  getCommandText,
  nextReasoningState,
  type VscodeDisclosureState,
} from "./behavior";

type MarkdownFileLinkProps = {
  showMessageFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type ActivityItemRowProps = MarkdownFileLinkProps & {
  item: Exclude<ConversationItem, Extract<ConversationItem, { kind: "message" }>>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
};

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;
type FileChangeEntry = NonNullable<ToolItem["changes"]>[number];
type DiffStats = { additions: number; deletions: number };

const DIFF_STATS_CACHE_LIMIT = 500;
const diffStatsCache = new Map<string, DiffStats>();

function isRunningStatus(status?: string | null) {
  return /in[_\s-]*progress|running|started/.test((status ?? "").toLowerCase());
}

function isInterruptedStatus(status?: string | null) {
  return /interrupt|stop|cancel/.test((status ?? "").toLowerCase());
}

function isFailedStatus(status?: string | null) {
  return /fail|error/.test((status ?? "").toLowerCase());
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function countDiffStats(diff?: string): DiffStats {
  if (!diff) {
    return { additions: 0, deletions: 0 };
  }
  const cached = diffStatsCache.get(diff);
  if (cached) {
    return cached;
  }
  let additions = 0;
  let deletions = 0;
  diff.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("+++") || line.startsWith("---")) {
      return;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  });
  const stats = { additions, deletions };
  if (diffStatsCache.size >= DIFF_STATS_CACHE_LIMIT) {
    const oldestKey = diffStatsCache.keys().next().value;
    if (oldestKey !== undefined) {
      diffStatsCache.delete(oldestKey);
    }
  }
  diffStatsCache.set(diff, stats);
  return stats;
}

function getFileChangeSummaryParts(changes: FileChangeEntry[]) {
  if (changes.length === 0) {
    return { label: "files", additions: null, deletions: null };
  }
  if (changes.length === 1) {
    const change = changes[0];
    const stats = countDiffStats(change.diff);
    return {
      label: basename(change.path),
      additions: stats.additions,
      deletions: stats.deletions,
    };
  }
  const stats = changes.reduce(
    (total, change) => {
      const next = countDiffStats(change.diff);
      return {
        additions: total.additions + next.additions,
        deletions: total.deletions + next.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
  return {
    label: `${changes.length} files`,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function formatFileChangeSummary(changes: FileChangeEntry[]) {
  const { label, additions, deletions } = getFileChangeSummaryParts(changes);
  return [
    label,
    typeof additions === "number" ? `+${additions}` : "",
    typeof deletions === "number" ? `-${deletions}` : "",
  ].filter(Boolean).join(" ");
}

function FileChangeSummaryText({ changes }: { changes: FileChangeEntry[] }) {
  const { label, additions, deletions } = getFileChangeSummaryParts(changes);
  return (
    <span className="oai-file-change-summary-value">
      <span>{label}</span>
      {typeof additions === "number" ? (
        <span className="oai-inline-diff-stat oai-inline-diff-stat-add">+{additions}</span>
      ) : null}
      {typeof deletions === "number" ? (
        <span className="oai-inline-diff-stat oai-inline-diff-stat-del">-{deletions}</span>
      ) : null}
    </span>
  );
}

function buildTurnDiffRows(item: ToolItem) {
  if (item.turnDiffRows?.length) {
    return item.turnDiffRows;
  }
  if (!item.changes?.length) {
    return [];
  }
  return item.changes.map((change, index) => {
    const stats = countDiffStats(change.diff);
    return {
      id: `${change.path}-${index}`,
      label: change.path,
      additions: stats.additions,
      deletions: stats.deletions,
    };
  });
}

function buildMultiAgentRows(item: ToolItem) {
  if (item.multiAgentRows?.length) {
    return item.multiAgentRows;
  }
  if (item.collabStatuses?.length) {
    return item.collabStatuses.map((status) => ({
      id: status.threadId,
      label: status.nickname || status.threadId,
      status: status.status,
      detail: status.role ?? null,
    }));
  }
  return [];
}

function openAIActivityTypeLabel(item: ToolItem) {
  switch (item.itemType) {
    case "auto-review-interruption-warning":
      return "Auto-review interruption warning";
    case "automation-update":
      return "Automation updated";
    case "automatic-approval-review":
      return "Automatic approval review";
    case "permission-request":
      return "Permission requested";
    case "mcp-server-elicitation":
      return "MCP server requested input";
    case "dynamic-tool-call":
      return "Dynamic tool call";
    case "forked-from-conversation":
      return "Forked from conversation";
    case "context-compaction":
      return "Context compacted";
    case "todo-list":
      return "Todo list updated";
    case "generated-image":
      return "Generated image";
    case "hook":
      return "Hook";
    case "mcp-tool-call":
      return "MCP tool call";
    case "model-rerouted":
      return "Model rerouted";
    case "multi-agent-action":
      return "Multi-agent action";
    case "personality-changed":
      return "Personality changed";
    case "plan-implementation":
      return "Plan implementation";
    case "proposed-plan":
      return "Proposed plan";
    case "stream-error":
      return "Stream error";
    case "system-error":
      return "System error";
    case "remote-task-created":
      return "Remote task created";
    case "model-changed":
      return "Model changed";
    case "steered":
      return "Steered";
    case "turn-diff":
      return "Turn diff";
    case "user-input-response":
      return "User input response";
    case "web-search":
      return "Web search";
    case "worked-for":
      return "Worked for";
    default:
      return null;
  }
}

function isMcpAppActivity(item: ToolItem) {
  const app = item.mcpApp;
  return Boolean((app?.id && app.id.trim()) || (app?.url && app.url.trim()));
}

function toolIconForSummary(item: ToolItem, summary: ToolSummary) {
  if (item.toolType === "commandExecution") {
    return Terminal;
  }
  if (item.toolType === "fileChange") {
    return FileDiffIcon;
  }
  if (item.toolType === "webSearch") {
    return Search;
  }
  if (item.toolType === "imageView") {
    return Image;
  }
  if (item.toolType === "collabToolCall") {
    return Users;
  }
  const label = summary.label.toLowerCase();
  if (label === "read") {
    return FileText;
  }
  if (label === "searched" || label === "searching") {
    return Search;
  }
  const toolName = toolNameFromTitle(item.title).toLowerCase();
  const title = item.title.toLowerCase();
  if (toolName.includes("diff") || title.includes("diff")) {
    return Diff;
  }
  return Wrench;
}

function buildPlanExportFileName(itemId: string) {
  const normalized = itemId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!normalized) {
    return "plan.md";
  }
  return normalized.startsWith("plan-") ? `${normalized}.md` : `plan-${normalized}.md`;
}

function formatInlineStatus(item: ToolItem) {
  const parts = [
    item.status,
    typeof item.durationMs === "number" ? formatDurationMs(item.durationMs) : null,
  ].filter(Boolean);
  return parts.join(" • ");
}

function formatReasoningElapsed(durationMs?: number | null) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function contextCompactionTone(item: ToolItem) {
  const normalizedStatus = (item.status ?? "").toLowerCase();
  if (/(fail|error)/.test(normalizedStatus)) {
    return "failed";
  }
  if (/(pending|running|processing|started|in[_\s-]?progress)/.test(normalizedStatus)) {
    return "processing";
  }
  return "completed";
}

function contextCompactionLabel(tone: "completed" | "processing" | "failed") {
  if (tone === "processing") {
    return "上下文压缩中";
  }
  if (tone === "failed") {
    return "上下文压缩失败";
  }
  return "上下文已自动压缩";
}

const VscodeCommandOutput = memo(function VscodeCommandOutput({
  output,
  command,
  status,
  commandExpanded,
  onExpandCommand,
}: {
  output: string;
  command: string;
  status?: string | null;
  commandExpanded: boolean;
  onExpandCommand: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const hasOutput = /\S/.test(output);
  const outputText = hasOutput ? output : "No output";

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    setIsPinned(node.scrollHeight - node.scrollTop - node.clientHeight <= 6);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinned) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [isPinned, outputText]);

  const copyText = useCallback(async (value: string, type: "command" | "output") => {
    if (type === "command" && !value.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      if (type === "command") {
        setCopiedCommand(true);
        window.setTimeout(() => setCopiedCommand(false), 1200);
      } else {
        setCopiedOutput(true);
        window.setTimeout(() => setCopiedOutput(false), 1200);
      }
    } catch (error) {
      pushErrorToast({
        title: "Copy failed",
        message: error instanceof Error ? error.message : "Unable to copy.",
      });
    }
  }, []);

  return (
    <div
      className="oai-tool-terminal oai-vscode-terminal"
      role="log"
      aria-live="polite"
      data-oai-tool-terminal
      data-vscode-command-output
      data-command-expanded={commandExpanded ? "true" : "false"}
      data-output-expanded="true"
    >
      <div className="oai-vscode-shell-header" data-vscode-shell-header>
        <span>Shell</span>
      </div>
      <div className="oai-vscode-command-panel" data-vscode-command-panel>
        <div className="oai-vscode-command-shell-row">
          <div
            className={`oai-vscode-command-text${commandExpanded ? " is-expanded" : " line-clamp-2"}`}
            data-vscode-command-text
            data-command-line-clamp={commandExpanded ? "none" : "2"}
            role="button"
            tabIndex={0}
            aria-expanded={commandExpanded}
            onClick={onExpandCommand}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpandCommand();
              }
            }}
          >
            <span className="oai-vscode-command-prompt" aria-hidden>$ </span>
            {command || "Command"}
          </div>
          <button
            type="button"
            className="ghost oai-vscode-command-copy"
            data-vscode-copy-command
            aria-label={copiedCommand ? "Copied command" : "Copy command"}
            title={copiedCommand ? "Copied command" : "Copy command"}
            onClick={() => copyText(command, "command")}
            disabled={!command.trim()}
          >
            <Copy size={12} aria-hidden />
            <span>{copiedCommand ? "Copied" : "Copy command"}</span>
          </button>
        </div>
      </div>
      <div className="oai-vscode-output-shell" data-vscode-output-shell>
        <div
          className="oai-tool-terminal-lines oai-vscode-terminal-lines vertical-scroll-fade-mask"
          data-oai-tool-terminal-lines
          data-vscode-command-output-lines
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            justifyContent: "flex-start",
            maxHeight: `${VSCODE_COMMAND_OUTPUT_MAX_HEIGHT_PX}px`,
            overflowX: "auto",
            overflowY: "auto",
          }}
        >
          <div
            className={`oai-tool-terminal-line${hasOutput ? "" : " oai-vscode-no-output"}`}
            data-oai-tool-terminal-line
            data-vscode-no-output={hasOutput ? undefined : "true"}
          >
            {outputText}
          </div>
        </div>
        <button
          type="button"
          className="ghost oai-vscode-output-copy"
          data-vscode-copy-output
          aria-label={copiedOutput ? "Copied output" : "Copy output"}
          title={copiedOutput ? "Copied output" : "Copy output"}
          onClick={() => copyText(output, "output")}
        >
          <Copy size={12} aria-hidden />
          <span>{copiedOutput ? "Copied" : "Copy output"}</span>
        </button>
      </div>
      <CommandFooter status={status} />
    </div>
  );
});

function VscodeFileDiffCard({
  change,
  changeKey,
  copiedChangeKey,
  onCopy,
}: {
  change: FileChangeEntry;
  changeKey: string;
  copiedChangeKey: string | null;
  onCopy: (event: MouseEvent<HTMLButtonElement>, key: string, diff: string) => void;
}) {
  const stats = countDiffStats(change.diff);
  const displayPath = change.reviewPath || change.path;
  return (
    <div
      className="oai-file-diff-card codex-review-diff-card oai-vscode-file-diff-card"
      data-diff
      data-file
      data-codex-review-diff-card
      data-diffs
      data-diffs-mode="file"
      data-review-path={displayPath}
      data-repository-source={change.repositorySource}
      data-review-summary-source={change.reviewSummarySource ?? undefined}
      data-generated-paths-ready={
        typeof change.generatedPathsReady === "boolean"
          ? String(change.generatedPathsReady)
          : undefined
      }
    >
      <div
        className="oai-file-diff-header"
        data-diffs-header="file"
        data-diffs-file-header
      >
        <span className="oai-file-diff-title" data-app-action-review-file>
          <FileDiffIcon size={13} data-change-icon aria-hidden />
          <span>{basename(displayPath)}</span>
        </span>
        <span className="oai-file-diff-meta" data-diffs-file-header-meta>
          <span className="oai-turn-diff-add">+{stats.additions}</span>
          <span className="oai-turn-diff-del">-{stats.deletions}</span>
        </span>
        <div className="oai-file-diff-controls" data-diffs-file-header-controls>
          {change.diff ? (
            <button
              type="button"
              className="ghost oai-file-diff-copy"
              data-utility-button
              onClick={(event) => onCopy(event, changeKey, change.diff ?? "")}
              aria-label={copiedChangeKey === changeKey ? "Copied diff" : "Copy diff"}
              title={copiedChangeKey === changeKey ? "Copied" : "Copy diff"}
            >
              {copiedChangeKey === changeKey ? (
                <Check size={12} aria-hidden />
              ) : (
                <Copy size={12} aria-hidden />
              )}
              <span>{copiedChangeKey === changeKey ? "Copied" : "Copy"}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="oai-file-diff-body thread-diff-virtualized"
        data-diffs-file-body-content
        data-file-body-content
        data-thread-diff-virtualized
      >
        {change.diff ? (
          <PierreDiffBlock diff={change.diff} displayPath={displayPath} />
        ) : (
          <div className="oai-file-diff-empty">No diff available.</div>
        )}
      </div>
      <div className="oai-file-diff-footer" data-diffs-file-meta>
        {displayPath}
      </div>
    </div>
  );
}

function VscodeReasoningRow({
  item,
  parsed,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  parsed: ParsedReasoning;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  const { summaryTitle, bodyText, hasBody } = parsed;
  const [viewState, setViewState] = useState<VscodeDisclosureState>(hasBody ? "preview" : "collapsed");
  const status = (item.status ?? "").toLowerCase();
  const isRunning = /in[_\s-]*progress|running|started|thinking/.test(status);
  const elapsed = formatReasoningElapsed(item.durationMs);
  const title = isRunning ? "Thinking" : elapsed ? `Thought for ${elapsed}` : "Thought";
  const ariaExpanded = viewState !== "collapsed";
  return (
    <div
      className={`oai-vscode-activity-row oai-vscode-reasoning-row is-${viewState}`}
      data-oai-activity-detail="reasoning"
      data-oai-reasoning-detail
      data-vscode-activity-row
      data-vscode-activity-kind="reasoning"
      data-vscode-reasoning-item-id={item.id}
      data-vscode-reasoning-elapsed={elapsed ?? undefined}
      data-vscode-reasoning-running={isRunning ? "true" : "false"}
      data-oai-activity-detail-expanded={ariaExpanded ? "true" : "false"}
      data-vscode-reasoning-state={viewState}
    >
      <button
        type="button"
        className="oai-vscode-activity-summary"
        onClick={() => hasBody && setViewState((current) => nextReasoningState(current))}
        aria-expanded={ariaExpanded}
        aria-label="Toggle reasoning details"
      >
        <Brain className="oai-vscode-activity-icon completed" size={13} aria-hidden />
        <span className="oai-vscode-activity-title">{summaryTitle || title}</span>
        <span className="oai-vscode-activity-status" data-vscode-reasoning-status>{title}</span>
      </button>
      {hasBody && (
        <div
          className="oai-vscode-activity-body"
          data-oai-activity-detail-body
          data-vscode-reasoning-body
          data-vscode-reasoning-body-state={viewState}
          style={{
            maxHeight: VSCODE_REASONING_HEIGHT_BY_STATE[viewState],
            opacity: viewState === "collapsed" ? 0 : 1,
            overflowY: viewState === "collapsed" ? "hidden" : "auto",
          }}
        >
          <Markdown
            value={bodyText}
            className="oai-reasoning-detail-body markdown vertical-scroll-fade-mask"
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        </div>
      )}
    </div>
  );
}

function VscodeUserInputRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: Extract<ConversationItem, { kind: "userInput" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  const first = item.questions[0];
  const previewQuestion = first?.question?.trim() || first?.header?.trim() || "Input requested";
  const firstAnswer = first?.answers[0]?.trim() || "No answer provided";
  const previewAnswer =
    first && first.answers.length > 1
      ? `${firstAnswer} +${first.answers.length - 1}`
      : firstAnswer;
  const extraQuestions = Math.max(0, item.questions.length - 1);
  return (
    <div
      className={`oai-vscode-activity-row oai-vscode-user-input-row${isExpanded ? " is-expanded" : ""}`}
      data-oai-activity-detail="user-input"
      data-oai-user-input-detail
      data-vscode-activity-row
      data-vscode-activity-kind="pending-mcp-tool-calls"
      data-oai-activity-detail-expanded={isExpanded ? "true" : "false"}
    >
      <button
        type="button"
        className="oai-vscode-activity-summary"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle answered input details"
      >
        <Check className="oai-vscode-activity-icon completed" size={13} aria-hidden />
        <span className="oai-vscode-activity-label">answered:</span>
        <span className="oai-vscode-activity-title">
          {previewQuestion}: {previewAnswer}
          {extraQuestions > 0 ? ` +${extraQuestions} more` : ""}
        </span>
      </button>
      <AnimatedDisclosureBody
        className="oai-vscode-activity-body pending-mcp-tool-calls-body"
        isExpanded={isExpanded}
        aria-expanded={isExpanded}
        data-oai-activity-detail-body="true"
        data-pending-mcp-tool-calls-body="true"
        data-pending-mcp-tool-calls-view-state={isExpanded ? "expanded" : "collapsed"}
        data-testid="pending-mcp-tool-calls-body"
      >
          {item.questions.map((question, index) => (
            <div key={`${question.id}-${index}`} className="oai-user-input-entry">
              <div className="oai-user-input-question">
                {question.question || question.header || `Question ${index + 1}`}
              </div>
              <div className="oai-user-input-answers">
                {question.answers.length
                  ? question.answers.map((answer, answerIndex) => (
                      <div key={`${question.id}-${answerIndex}`} className="oai-user-input-answer">
                        {answer}
                      </div>
                    ))
                  : <div className="oai-user-input-empty-answer">No answer provided.</div>}
              </div>
            </div>
          ))}
      </AnimatedDisclosureBody>
    </div>
  );
}

function VscodeExploreRow({ item }: { item: Extract<ConversationItem, { kind: "explore" }> }) {
  return (
    <div
      className="oai-vscode-activity-row oai-vscode-explore-row"
      data-oai-activity-detail="explore"
      data-oai-explore-detail
      data-vscode-activity-row
      data-vscode-activity-kind={item.entries.some((entry) => entry.kind === "search") ? "web-search-group" : "exec"}
    >
      <div className="oai-vscode-explore-list">
        {item.entries.map((entry, index) => (
          <div key={`${entry.kind}-${entry.label}-${index}`} className="oai-explore-item oai-vscode-explore-item">
            <span className="oai-explore-kind">{exploreKindLabel(entry.kind)}</span>
            <span className="oai-explore-label">{entry.label}</span>
            {entry.detail && entry.detail !== entry.label ? (
              <span className="oai-explore-extra">{entry.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function VscodeReviewRow({
  item,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "review" }>;
}) {
  const title = item.state === "started" ? "Review started" : "Review completed";
  return (
    <div className="oai-vscode-activity-row oai-vscode-review-row" data-oai-review-row data-vscode-activity-row>
      <div className="oai-vscode-activity-summary">
        <Diff className="oai-vscode-activity-icon completed" size={13} aria-hidden />
        <span className="oai-vscode-activity-title">{title}</span>
        <span className="oai-vscode-activity-status">Review</span>
      </div>
      {item.text ? (
        <Markdown
          value={item.text}
          className="oai-vscode-activity-body markdown"
          showFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      ) : null}
    </div>
  );
}

function VscodeDiffRow({ item }: { item: Extract<ConversationItem, { kind: "diff" }> }) {
  return (
    <div
      className="oai-vscode-activity-row oai-vscode-diff-row"
      data-oai-diff-row
      data-vscode-activity-row
      data-vscode-activity-kind="patch"
    >
      <div className="oai-vscode-activity-summary">
        <FileDiffIcon className="oai-vscode-activity-icon completed" size={13} aria-hidden />
        <span className="oai-vscode-activity-title">{item.title}</span>
        {item.status ? <span className="oai-vscode-activity-status">{item.status}</span> : null}
      </div>
      <div className="oai-vscode-activity-body oai-file-diff-body" data-oai-activity-detail-body>
        <PierreDiffBlock diff={item.diff} displayPath={item.title} />
      </div>
    </div>
  );
}

function VscodeContextCompactionRow({ item }: { item: ToolItem }) {
  const tone = contextCompactionTone(item);
  const label = contextCompactionLabel(tone);
  return (
    <div
      className={`oai-context-compaction-row is-${tone}`}
      data-oai-activity-detail="context-compaction"
      data-vscode-activity-row
      data-vscode-activity-kind="context-compaction"
      data-openai-activity-item-type="context-compaction"
      data-context-compaction="true"
      data-context-compaction-status={tone}
    >
      <span className="oai-context-compaction-divider" aria-hidden />
      <span className="oai-context-compaction-label">
        <span className="oai-context-compaction-icon-badge" aria-hidden>
          <ScrollText className="oai-context-compaction-icon" size={15} />
        </span>
        <span>{label}</span>
      </span>
      <span className="oai-context-compaction-divider" aria-hidden />
    </div>
  );
}

function CommandActivitySummaryText({
  item,
  command,
}: {
  item: ToolItem;
  command: string;
}) {
  const cleanedCommand = command.trim();
  const label = isRunningStatus(item.status)
    ? "正在运行"
    : isInterruptedStatus(item.status)
      ? "已停止"
      : "已运行";

  return (
    <>
      <span className="oai-vscode-command-summary-status">{label}</span>
      {cleanedCommand ? <span className="oai-vscode-command-summary-command"> {cleanedCommand}</span> : null}
    </>
  );
}

function CommandFooter({ status }: { status?: string | null }) {
  if (isRunningStatus(status)) {
    return <div className="oai-vscode-command-footer" data-vscode-command-footer />;
  }

  if (isInterruptedStatus(status)) {
    return (
      <div className="oai-vscode-command-footer" data-vscode-command-footer>
        <span className="oai-vscode-command-footer-label" data-vscode-command-footer-status>
          已停止
        </span>
      </div>
    );
  }

  if (isFailedStatus(status)) {
    return (
      <div className="oai-vscode-command-footer" data-vscode-command-footer>
        <span className="oai-vscode-command-footer-label" data-vscode-command-footer-status>
          失败
        </span>
      </div>
    );
  }

  return (
    <div className="oai-vscode-command-footer" data-vscode-command-footer>
      <span className="oai-vscode-command-footer-label" data-vscode-command-footer-status>
        <Check size={12} aria-hidden />
        成功
      </span>
    </div>
  );
}

function VscodeToolRow({
  item,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onRequestAutoScroll,
}: MarkdownFileLinkProps & {
  item: ToolItem;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
}) {
  const isFileChange = item.toolType === "fileChange";
  const isCommand = item.toolType === "commandExecution";
  const isPlan = item.toolType === "plan";
  const commandText = useMemo(
    () => (isCommand ? getCommandText(item) : ""),
    [isCommand, item],
  );
  const summary = useMemo(
    () => buildToolSummary(item, commandText),
    [commandText, item],
  );
  const fileChanges = useMemo(() => item.changes ?? [], [item.changes]);
  const hasChanges = fileChanges.length > 0;
  const summaryLabel = isFileChange || isCommand ? "" : summary.label;
  const summaryValue = useMemo(
    () => {
      if (isFileChange) {
        return formatFileChangeSummary(fileChanges);
      }
      return summary.value;
    },
    [fileChanges, isFileChange, summary.value],
  );
  const openAIItemTypeLabel = useMemo(() => openAIActivityTypeLabel(item), [item]);
  const tone = toolStatusTone(item, hasChanges);
  const ToolIcon = useMemo(() => toolIconForSummary(item, summary), [item, summary]);
  const normalizedStatus = (item.status ?? "").toLowerCase();
  const isCommandRunning = isCommand && isRunningStatus(normalizedStatus);
  const isLongRunning = typeof item.durationMs === "number" && item.durationMs >= 1200;
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [commandExpanded, setCommandExpanded] = useState(false);
  const [mcpAppExpandedOverride, setMcpAppExpandedOverride] = useState<boolean | null>(null);
  const [mcpAppFullscreen, setMcpAppFullscreen] = useState(false);
  const [isExportingPlan, setIsExportingPlan] = useState(false);
  const [copiedChangeKey, setCopiedChangeKey] = useState<string | null>(null);
  const isMcpApp = isMcpAppActivity(item);
  const mcpAppExpanded = mcpAppExpandedOverride ?? item.mcpApp?.expanded ?? isExpanded;
  const mcpAppId = item.mcpApp?.id ?? item.detail ?? item.id;
  const mcpAppTitle = item.mcpApp?.title ?? summary.value ?? item.title;
  const inlineStatus = useMemo(() => formatInlineStatus(item), [item]);
  const summaryAriaLabel = isFileChange && summaryValue
    ? summaryValue
    : "Toggle tool details";
  const showCommandOutput =
    isCommand && (isExpanded || (isCommandRunning && showLiveOutput) || isLongRunning);
  const showToolOutput = isExpanded && (!isFileChange || !hasChanges);
  const showFileChangeDetails = isFileChange && hasChanges && isExpanded;
  const showMultiAgentAction = item.itemType === "multi-agent-action";
  const showTurnDiffRow = item.itemType === "turn-diff" || (isFileChange && hasChanges);
  const multiAgentRows = useMemo(
    () => (showMultiAgentAction ? buildMultiAgentRows(item) : []),
    [item, showMultiAgentAction],
  );
  const turnDiffRows = useMemo(
    () => (showTurnDiffRow ? buildTurnDiffRows(item) : []),
    [item, showTurnDiffRow],
  );
  const hasBody = Boolean(
    (isExpanded && summary.detail && !isFileChange) ||
      (isExpanded && isCommand && item.detail) ||
      openAIItemTypeLabel ||
      item.generatedImage ||
      item.artifact ||
      showFileChangeDetails ||
      (isExpanded && isFileChange && !hasChanges && item.detail) ||
      showCommandOutput ||
      (isExpanded && isCommand) ||
      (showToolOutput && summary.output && !isCommand) ||
      (showToolOutput && isPlan && (summary.output ?? "").trim()),
  );

  useEffect(() => {
    if (!isCommandRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setShowLiveOutput(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, [isCommandRunning]);

  useEffect(() => {
    if (showCommandOutput && isCommandRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isCommandRunning, onRequestAutoScroll, showCommandOutput, showLiveOutput]);

  const handleCopyFileDiff = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, key: string, diff: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (!diff.trim()) {
        return;
      }
      try {
        await navigator.clipboard.writeText(diff);
        setCopiedChangeKey(key);
        window.setTimeout(() => {
          setCopiedChangeKey((current) => (current === key ? null : current));
        }, 1400);
      } catch (error) {
        pushErrorToast({
          title: "Copy failed",
          message: error instanceof Error ? error.message : "Unable to copy diff.",
        });
      }
    },
    [],
  );

  const handlePlanExport = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const output = (summary.output ?? "").trim();
      if (!output) {
        return;
      }
      setIsExportingPlan(true);
      try {
        await exportMarkdownFile(output, buildPlanExportFileName(item.id));
      } catch (error) {
        pushErrorToast({
          title: "Plan export failed",
          message: error instanceof Error ? error.message : "Unable to export plan.",
        });
      } finally {
        setIsExportingPlan(false);
      }
    },
    [item.id, summary.output],
  );

  return (
    <div
      className={`oai-vscode-activity-row oai-vscode-tool-row${isExpanded ? " is-expanded" : ""}${
        isFileChange ? " oai-file-change-detail" : ""
      }`}
      data-oai-activity-detail="tool"
      data-oai-tool-detail
      data-oai-activity-detail-offset
      data-oai-activity-detail-stack
      data-vscode-activity-row
      data-vscode-activity-kind={item.itemType ?? item.toolType}
      data-oai-activity-detail-expanded={isExpanded ? "true" : "false"}
      data-tool-type={item.toolType}
      data-openai-activity-item-type={item.itemType ?? item.toolType}
      data-exec={item.itemType === "exec" ? "true" : undefined}
      data-patch={item.itemType === "patch" ? "true" : undefined}
      data-stream-error={item.itemType === "stream-error" ? "true" : undefined}
      data-system-error={item.itemType === "system-error" ? "true" : undefined}
      data-web-search={item.itemType === "web-search" ? "true" : undefined}
      data-mcp-server-elicitation={item.itemType === "mcp-server-elicitation" ? "true" : undefined}
      data-mcp-tool-call={item.itemType === "mcp-tool-call" ? "true" : undefined}
      data-dynamic-tool-call={item.itemType === "dynamic-tool-call" ? "true" : undefined}
      data-multi-agent-action={item.itemType === "multi-agent-action" ? "true" : undefined}
      data-turn-diff={item.itemType === "turn-diff" ? "true" : undefined}
      data-generated-image={item.itemType === "generated-image" ? "true" : undefined}
      data-mcp-app-expanded={isMcpApp && mcpAppExpanded ? "true" : undefined}
      data-mcp-app-fullscreen={isMcpApp && mcpAppFullscreen ? "true" : undefined}
    >
      <button
        type="button"
        className={`oai-vscode-activity-summary${isCommand ? " oai-vscode-exec-summary" : ""}`}
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label={summaryAriaLabel}
        data-oai-activity-detail-summary
        data-oai-activity-detail-content
        data-vscode-exec-summary={isCommand ? "true" : undefined}
      >
        {isCommand ? null : (
          <ToolIcon className={`oai-vscode-activity-icon ${tone}`} size={13} aria-hidden />
        )}
        {summaryLabel ? <span className="oai-vscode-activity-label">{summaryLabel}:</span> : null}
        {summaryValue ? (
          <span className={`oai-vscode-activity-title${isCommand ? " oai-vscode-command-text" : ""}`}>
            {isFileChange ? (
              <FileChangeSummaryText changes={fileChanges} />
            ) : isCommand ? (
              <CommandActivitySummaryText item={item} command={String(summaryValue)} />
            ) : (
              summaryValue
            )}
          </span>
        ) : null}
        {isCommand ? (
          <span
            className={`oai-vscode-command-chevron${isExpanded ? " is-expanded" : ""}`}
            data-vscode-command-chevron
            aria-hidden
          >
            <ChevronRight size={12} />
          </span>
        ) : null}
        {inlineStatus && !isFileChange && !isCommand ? (
          <span className="oai-vscode-activity-status">{inlineStatus}</span>
        ) : null}
        {openAIItemTypeLabel ? (
          <span className="oai-vscode-activity-status oai-activity-detail-openai-type">
            {openAIItemTypeLabel}
          </span>
        ) : null}
      </button>
      <AnimatedDisclosureBody
          isExpanded={hasBody && isExpanded}
          className={`oai-vscode-activity-body${isMcpApp ? " pending-mcp-tool-calls-body" : ""}`}
          aria-expanded={isExpanded}
          data-oai-activity-detail-body
          data-pending-mcp-tool-calls-body={isMcpApp ? "true" : undefined}
          data-pending-mcp-tool-calls-view-state={isMcpApp ? (isExpanded ? "expanded" : "collapsed") : undefined}
          data-testid={isMcpApp ? "pending-mcp-tool-calls-body" : undefined}
        >
          {isExpanded && summary.detail && !isFileChange && !isCommand ? (
            <div className="oai-vscode-activity-meta">{summary.detail}</div>
          ) : null}
          {openAIItemTypeLabel ? (
            <div
              className="oai-vscode-activity-meta oai-openai-activity-item"
              data-openai-activity-item
              data-openai-activity-item-type={item.itemType}
            >
              {openAIItemTypeLabel}
            </div>
          ) : null}
          {item.generatedImage ? (
            <div className="oai-generated-image" data-generated-image>
              <img src={item.generatedImage} alt={summary.value || "Generated image"} />
            </div>
          ) : null}
          {item.artifact ? (
            <div
              className="oai-message-artifact"
              data-message-artifact
              data-artifact-id={item.artifact.id}
              data-artifact-kind={item.artifact.kind ?? "artifact"}
            >
              <Sparkles size={13} aria-hidden />
              <span className="oai-message-artifact-title">{item.artifact.title ?? item.artifact.id}</span>
              {item.artifact.description ? (
                <span className="oai-message-artifact-description">{item.artifact.description}</span>
              ) : null}
            </div>
          ) : null}
          {isMcpApp ? (
            <div
              className="group/mcp-app oai-mcp-app"
              data-mcp-app
              data-mcp-app-instance={mcpAppId}
              data-mcp-app-expanded={mcpAppExpanded ? "true" : "false"}
              data-mcp-app-fullscreen={mcpAppFullscreen ? "true" : "false"}
              data-mcp-app-portal-target="true"
              data-mcp-app-loading={/pending|running|progress/.test(normalizedStatus) ? "true" : "false"}
            >
              <div className="oai-mcp-app-controls" data-mcp-app-controls>
                <button
                  type="button"
                  className="ghost oai-mcp-app-toggle"
                  data-mcp-app-toggle-expanded
                  aria-expanded={mcpAppExpanded}
                  onClick={() => setMcpAppExpandedOverride((current) => !(current ?? mcpAppExpanded))}
                >
                  {mcpAppExpanded ? "Collapse app" : "Expand app"}
                </button>
                <button
                  type="button"
                  className="ghost oai-mcp-app-fullscreen"
                  data-mcp-app-toggle-fullscreen
                  aria-pressed={mcpAppFullscreen}
                  onClick={() => setMcpAppFullscreen((current) => !current)}
                >
                  {mcpAppFullscreen ? "Exit fullscreen" : "Fullscreen"}
                </button>
              </div>
              <div
                className={`oai-mcp-app-frame${/pending|running|progress/.test(normalizedStatus) ? " mcp-app-loading-pulse" : ""}`}
                data-mcp-app-frame="true"
                data-mcp-app-frame-loading={/pending|running|progress/.test(normalizedStatus) ? "true" : "false"}
              >
                <div className="oai-mcp-app-header">
                  <span className="oai-mcp-app-title">{mcpAppTitle}</span>
                  <span className="oai-mcp-app-kind">mcp-app</span>
                </div>
                {item.mcpApp?.url ? <div className="oai-mcp-app-url">{item.mcpApp.url}</div> : null}
              </div>
            </div>
          ) : null}
          {showMultiAgentAction ? (
            <div className="oai-multi-agent-action" data-multi-agent-action>
              <div className="multi-agent-action-header" data-multi-agent-action-header>
                <Users size={13} aria-hidden />
                <span>{summary.value || "Multi-agent action"}</span>
              </div>
              <div className="multi-agent-action-rows" data-multi-agent-action-rows>
                {(multiAgentRows.length ? multiAgentRows : [{ id: item.id, label: item.detail || item.title, status: item.status ?? null }]).map((row) => (
                  <div
                    key={row.id}
                    className="oai-multi-agent-action-row"
                    data-multi-agent-action-row
                    data-agent-status={row.status ?? undefined}
                  >
                    <span className="oai-multi-agent-action-label">{row.label}</span>
                    {row.detail ? <span className="oai-multi-agent-action-detail">{row.detail}</span> : null}
                    {row.status ? <span className="oai-multi-agent-action-status">{row.status}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {showTurnDiffRow ? (
            <div className="oai-turn-diff" data-turn-diff-row>
              <div className="oai-turn-diff-header" data-turn-diff-row-header>
                <Diff size={13} aria-hidden />
                <span>{item.itemType === "turn-diff" ? "Turn diff" : "File changes"}</span>
              </div>
              <div className="oai-turn-diff-rows" data-turn-diff-row-list>
                {(turnDiffRows.length ? turnDiffRows : [{ id: item.id, label: summary.value || item.title }]).map((row) => (
                  <div key={row.id} className="oai-turn-diff-row" data-turn-diff-row-item>
                    <span className="oai-turn-diff-label">{row.label}</span>
                    {typeof row.additions === "number" ? <span className="oai-turn-diff-add">+{row.additions}</span> : null}
                    {typeof row.deletions === "number" ? <span className="oai-turn-diff-del">-{row.deletions}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {showFileChangeDetails ? (
            <div className="oai-activity-detail-change-list">
              {fileChanges.map((change, index) => {
                const changeKey = `${change.path}-${index}`;
                return (
                  <VscodeFileDiffCard
                    key={changeKey}
                    change={change}
                    changeKey={changeKey}
                    copiedChangeKey={copiedChangeKey}
                    onCopy={handleCopyFileDiff}
                  />
                );
              })}
            </div>
          ) : null}
          {isExpanded && isFileChange && !hasChanges && item.detail ? (
            <Markdown
              value={item.detail}
              className="oai-activity-detail-output markdown"
              showFilePath={showMessageFilePath}
              workspacePath={workspacePath}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
              onOpenThreadLink={onOpenThreadLink}
            />
          ) : null}
          {showCommandOutput ? (
            <VscodeCommandOutput
              command={commandText}
              output={summary.output ?? ""}
              status={item.status}
              commandExpanded={commandExpanded}
              onExpandCommand={() => setCommandExpanded(true)}
            />
          ) : null}
          {showToolOutput && summary.output && !isCommand ? (
            <Markdown
              value={summary.output}
              className="oai-activity-detail-output markdown"
              codeBlock={item.toolType !== "plan"}
              showFilePath={showMessageFilePath}
              workspacePath={workspacePath}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
              onOpenThreadLink={onOpenThreadLink}
            />
          ) : null}
          {showToolOutput && isPlan && (summary.output ?? "").trim() ? (
            <div className="oai-activity-detail-actions">
              <button
                type="button"
                className="ghost oai-activity-detail-action"
                onClick={handlePlanExport}
                disabled={isExportingPlan}
              >
                {isExportingPlan ? "Exporting..." : "Export .md"}
              </button>
            </div>
          ) : null}
      </AnimatedDisclosureBody>
    </div>
  );
}

export const ActivityItemRow = memo(function ActivityItemRow({
  item,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onRequestAutoScroll,
}: ActivityItemRowProps) {
  if (item.kind === "reasoning") {
    return (
      <VscodeReasoningRow
        item={item}
        parsed={parseReasoning(item)}
        isExpanded={isExpanded}
        onToggle={onToggle}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
      />
    );
  }
  if (item.kind === "userInput") {
    return <VscodeUserInputRow item={item} isExpanded={isExpanded} onToggle={onToggle} />;
  }
  if (item.kind === "explore") {
    return <VscodeExploreRow item={item} />;
  }
  if (item.kind === "review") {
    return (
      <VscodeReviewRow
        item={item}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
      />
    );
  }
  if (item.kind === "diff") {
    return <VscodeDiffRow item={item} />;
  }
  if (item.itemType === "context-compaction") {
    return <VscodeContextCompactionRow item={item} />;
  }
  return (
    <VscodeToolRow
      item={item}
      isExpanded={isExpanded}
      onToggle={onToggle}
      showMessageFilePath={showMessageFilePath}
      workspacePath={workspacePath}
      onOpenFileLink={onOpenFileLink}
      onOpenFileLinkMenu={onOpenFileLinkMenu}
      onOpenThreadLink={onOpenThreadLink}
      onRequestAutoScroll={onRequestAutoScroll}
    />
  );
});
