import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import BadgeCheck from "lucide-react/dist/esm/icons/badge-check";
import Brain from "lucide-react/dist/esm/icons/brain";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Copy from "lucide-react/dist/esm/icons/copy";
import Diff from "lucide-react/dist/esm/icons/diff";
import File from "lucide-react/dist/esm/icons/file";
import FileDiffIcon from "lucide-react/dist/esm/icons/file-diff";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Image from "lucide-react/dist/esm/icons/image";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Quote from "lucide-react/dist/esm/icons/quote";
import Search from "lucide-react/dist/esm/icons/search";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Users from "lucide-react/dist/esm/icons/users";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import X from "lucide-react/dist/esm/icons/x";
import { exportMarkdownFile } from "@services/tauri";
import { pushErrorToast } from "@services/toasts";
import type { ConversationItem } from "../../../types";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import { PierreDiffBlock } from "../../git/components/PierreDiffBlock";
import { relativeDisplayPath } from "../utils/messageFileLinks";
import {
  MAX_COMMAND_OUTPUT_LINES,
  basename,
  buildToolSummary,
  exploreKindLabel,
  formatDurationMs,
  formatToolStatusLabel,
  normalizeMessageImageSrc,
  toolNameFromTitle,
  toolStatusTone,
  type MessageImage,
  type ParsedReasoning,
  type StatusTone,
  type ToolSummary,
} from "../utils/messageRenderUtils";
import { Markdown } from "./Markdown";
import { isStandaloneMarkdownTable } from "./Markdown";

type MarkdownFileLinkProps = {
  showMessageFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type WorkingIndicatorProps = {
  isThinking: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  hasItems: boolean;
  reasoningLabel?: string | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
};

type MessageRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "message" }>;
  isCopied: boolean;
  onCopy: (item: Extract<ConversationItem, { kind: "message" }>) => void;
  onQuote?: (item: Extract<ConversationItem, { kind: "message" }>, selectedText?: string) => void;
  onEditMessage?: (item: Extract<ConversationItem, { kind: "message" }>, text: string) => void;
  codeBlockCopyUseModifier?: boolean;
  showActions?: boolean;
};

type ReasoningRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  parsed: ParsedReasoning;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

type ReviewRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "review" }>;
};

type DiffRowProps = {
  item: Extract<ConversationItem, { kind: "diff" }>;
};

type UserInputRowProps = {
  item: Extract<ConversationItem, { kind: "userInput" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

type ToolRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "tool" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
};

type ExploreRowProps = {
  item: Extract<ConversationItem, { kind: "explore" }>;
};

export type FileChangeEntry = NonNullable<
  Extract<ConversationItem, { kind: "tool" }>["changes"]
>[number];

type FileChangeSummaryCardProps = {
  changes: FileChangeEntry[];
  workspacePath?: string | null;
};

type CopyFileDiffHandler = (
  event: MouseEvent<HTMLButtonElement>,
  key: string,
  diff: string,
) => void | Promise<void>;

type FileDiffCardProps = {
  change: FileChangeEntry;
  changeKey: string;
  copiedChangeKey: string | null;
  onCopyFileDiff: CopyFileDiffHandler;
  fileBody?: boolean;
  className?: string;
};

type FileChangeSummaryEntry = FileChangeEntry & {
  displayPath: string;
};

type CommandOutputProps = {
  output: string;
};

function buildUserMessageMetadata(item: Extract<ConversationItem, { kind: "message" }>) {
  const text = item.text.toLowerCase();
  const chips: { kind: string; label: string }[] = [];
  if (
    item.referencesPriorConversation ||
    text.includes("prior conversation") ||
    text.includes("记忆引用")
  ) {
    chips.push({ kind: "prior-conversation", label: "References prior conversation" });
  }
  if (item.reviewMode || text.includes("review mode") || text.includes("审查模式")) {
    chips.push({ kind: "review-mode", label: "Review mode" });
  }
  if (item.pullRequestFixMode) {
    chips.push({ kind: "pull-request-fix", label: "Fix PR" });
  }
  if (item.autoResolveSync) {
    chips.push({ kind: "auto-resolve-sync", label: "Auto-resolve sync" });
  }
  if ((item.commentCount ?? 0) > 0) {
    const count = item.commentCount ?? 0;
    chips.push({ kind: "comments", label: `${count} comment${count === 1 ? "" : "s"}` });
  }
  if ((item.browserCommentCount ?? 0) > 0) {
    const count = item.browserCommentCount ?? 0;
    chips.push({ kind: "browser-comments", label: `${count} browser comment${count === 1 ? "" : "s"}` });
  }
  if ((item.diffCommentCount ?? 0) > 0) {
    const count = item.diffCommentCount ?? 0;
    chips.push({ kind: "diff-comments", label: `${count} diff comment${count === 1 ? "" : "s"}` });
  }
  if ((item.selectedTextAttachmentCount ?? 0) > 0) {
    const count = item.selectedTextAttachmentCount ?? 0;
    chips.push({ kind: "selected-text-attachments", label: `${count} selected text attachment${count === 1 ? "" : "s"}` });
  }
  if ((item.pullRequestCheckCount ?? 0) > 0) {
    const count = item.pullRequestCheckCount ?? 0;
    chips.push({ kind: "pull-request-checks", label: `${count} PR check${count === 1 ? "" : "s"}` });
  }
  if (item.messageStatus) {
    chips.push({ kind: "message-status", label: item.messageStatus });
  }
  if (item.steeringStatus) {
    chips.push({ kind: "steering-status", label: item.steeringStatus });
  }
  if (item.sentAtMs) {
    chips.push({
      kind: "sent-at",
      label: new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(item.sentAtMs)),
    });
  }
  return chips;
}

function buildOpenAIUserAttachments(item: Extract<ConversationItem, { kind: "message" }>) {
  const richAttachments: { kind: string; label: string; title?: string }[] = [];
  if (item.codexDelegation) {
    richAttachments.push({
      kind: "codexDelegation",
      label: item.codexDelegation.label ?? "Sent by Codex from another thread",
      title: item.codexDelegation.sourceThreadId,
    });
  }
  if (item.heartbeatTrigger) {
    richAttachments.push({
      kind: "heartbeatTrigger",
      label: item.heartbeatTrigger.label ?? "Automation heartbeat",
      title: item.heartbeatTrigger.automationId,
    });
  }
  if (item.forkedFromConversation) {
    richAttachments.push({
      kind: "forkedFromConversation",
      label: item.forkedFromConversation.label ?? "Forked from conversation",
      title: item.forkedFromConversation.sourceConversationId,
    });
  }
  if ((item.browserCommentCount ?? 0) > 0) {
    richAttachments.push({
      kind: "browserCommentCount",
      label: `${item.browserCommentCount} browser comment${item.browserCommentCount === 1 ? "" : "s"}`,
    });
  }
  if ((item.diffCommentCount ?? 0) > 0) {
    richAttachments.push({
      kind: "diffCommentCount",
      label: `${item.diffCommentCount} diff comments`,
    });
  }
  if ((item.selectedTextAttachmentCount ?? 0) > 0) {
    richAttachments.push({
      kind: "selectedTextAttachmentCount",
      label: `${item.selectedTextAttachmentCount} selected text`,
    });
  }
  return richAttachments;
}

function attachmentLabel(path: string, label?: string) {
  if (label?.trim()) {
    return label.trim();
  }
  return basename(path);
}

function userMessageIsCollapsible(text: string, collapsedLineCount: number) {
  if (!text.trim()) {
    return false;
  }
  const lineCount = text.split(/\r?\n/).length;
  return lineCount > collapsedLineCount || text.length > collapsedLineCount * 96;
}

const USER_MESSAGE_FALLBACK_FONT_SIZE_PX = 13;
const USER_MESSAGE_LINE_HEIGHT_RATIO = 1.5;
const USER_MESSAGE_COLLAPSE_EPSILON_PX = 1;

function getUserMessageLineHeightPx(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const fontSize = Number.parseFloat(style.fontSize);
  const resolvedFontSize = Number.isFinite(fontSize) ? fontSize : USER_MESSAGE_FALLBACK_FONT_SIZE_PX;
  const lineHeight = Number.parseFloat(style.lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : resolvedFontSize * USER_MESSAGE_LINE_HEIGHT_RATIO;
}

const MessageImageGrid = memo(function MessageImageGrid({
  images,
  onOpen,
  hasText,
}: {
  images: MessageImage[];
  onOpen: (index: number) => void;
  hasText: boolean;
}) {
  return (
    <div
      className={`oai-message-image-grid${hasText ? " oai-message-image-grid-with-text" : ""}`}
      role="list"
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          className="oai-message-image-thumb"
          onClick={() => onOpen(index)}
          aria-label={`Open image ${index + 1}`}
        >
          <img src={image.src} alt={image.label} loading="lazy" />
        </button>
      ))}
    </div>
  );
});

const ImageLightbox = memo(function ImageLightbox({
  images,
  activeIndex,
  onClose,
}: {
  images: MessageImage[];
  activeIndex: number;
  onClose: () => void;
}) {
  const activeImage = images[activeIndex];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!activeImage) {
    return null;
  }

  return createPortal(
    <div
      className="oai-message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="oai-message-image-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="oai-message-image-lightbox-close"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <X size={16} aria-hidden />
        </button>
        <img src={activeImage.src} alt={activeImage.label} />
      </div>
    </div>,
    document.body,
  );
});

const UserMessageAttachments = memo(function UserMessageAttachments({
  images,
  attachments,
  richAttachments,
  parentContext,
  onOpenImage,
}: {
  images: MessageImage[];
  attachments: NonNullable<Extract<ConversationItem, { kind: "message" }>["attachments"]>;
  richAttachments: ReturnType<typeof buildOpenAIUserAttachments>;
  parentContext?: Extract<ConversationItem, { kind: "message" }>["parentContext"];
  onOpenImage: (index: number) => void;
}) {
  if (images.length === 0 && attachments.length === 0 && richAttachments.length === 0 && !parentContext) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-end justify-end gap-2 self-end oai-user-message-attachments"
      data-user-message-attachments
    >
      {parentContext ? (
        <div
          className="group/file-attachment oai-user-message-attachment oai-user-message-parent-context"
          data-user-message-attachment
          data-attachment-kind={parentContext.kind ?? "parent-context"}
          data-parent-context
          data-source-conversation-id={parentContext.sourceConversationId}
          title={parentContext.label ?? parentContext.sourceConversationId}
        >
          <ChevronRight className="oai-user-message-attachment-icon" size={13} aria-hidden />
          <span className="oai-user-message-attachment-label">
            {parentContext.label ?? "Parent chat"}
          </span>
        </div>
      ) : null}
      {richAttachments.map((attachment, index) => (
        <div
          key={`${attachment.kind}-${index}`}
          className="group/file-attachment oai-user-message-attachment oai-user-message-rich-attachment"
          data-user-message-attachment
          data-user-message-rich-attachment
          data-attachment-kind={attachment.kind}
          title={attachment.title ?? attachment.label}
        >
          {attachment.kind === "codexDelegation" || attachment.kind === "heartbeatTrigger" ? (
            <Sparkles className="oai-user-message-attachment-icon" size={13} aria-hidden />
          ) : attachment.kind.includes("Comment") ? (
            <MessageSquare className="oai-user-message-attachment-icon" size={13} aria-hidden />
          ) : (
            <ChevronRight className="oai-user-message-attachment-icon" size={13} aria-hidden />
          )}
          <span className="oai-user-message-attachment-label">{attachment.label}</span>
        </div>
      ))}
      {attachments.map((attachment, index) => {
        const label = attachmentLabel(attachment.path, attachment.label);
        return (
          <div
            key={`${attachment.path}-${index}`}
            className="group/file-attachment oai-user-message-attachment"
            data-user-message-attachment
            data-attachment-kind={attachment.kind ?? "file"}
            title={attachment.path}
          >
            <File className="oai-user-message-attachment-icon" size={13} aria-hidden />
            <span className="oai-user-message-attachment-label">{label}</span>
          </div>
        );
      })}
      {images.length > 0 && (
        <MessageImageGrid
          images={images}
          onOpen={onOpenImage}
          hasText={false}
        />
      )}
    </div>
  );
});

const UserMessageText = memo(function UserMessageText({
  item,
  displayText,
  isEditing,
  editText,
  onEditTextChange,
  onSubmitEdit,
  onCancelEdit,
  codeBlockCopyUseModifier,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "message" }>;
  displayText: string;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
  codeBlockCopyUseModifier?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [textMeasurement, setTextMeasurement] = useState<{
    collapsedHeightPx: number | null;
    contentHeightPx: number;
    lineHeightPx: number;
    maxWidthPx: number;
  } | null>(null);
  const collapsedLineCount = Math.max(1, item.collapsedLineCount ?? 20);
  const fallbackIsCollapsible = userMessageIsCollapsible(displayText, collapsedLineCount);
  const isMeasuredCollapsible =
    textMeasurement?.collapsedHeightPx != null
      ? textMeasurement.contentHeightPx >
        textMeasurement.collapsedHeightPx + USER_MESSAGE_COLLAPSE_EPSILON_PX
      : fallbackIsCollapsible;
  const isCollapsible = isMeasuredCollapsible;

  const setTextContentMeasurementRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || typeof ResizeObserver === "undefined") {
        return;
      }
      const measure = () => {
        const maxWidthPx = Math.floor(element.getBoundingClientRect().width);
        if (maxWidthPx <= 0) {
          return;
        }
        const lineHeightPx = getUserMessageLineHeightPx(element);
        const next = {
          collapsedHeightPx: Math.ceil(lineHeightPx * collapsedLineCount),
          contentHeightPx: Math.ceil(element.scrollHeight),
          lineHeightPx,
          maxWidthPx,
        };
        setTextMeasurement((current) =>
          current?.collapsedHeightPx === next.collapsedHeightPx &&
          current.contentHeightPx === next.contentHeightPx &&
          current.lineHeightPx === next.lineHeightPx &&
          current.maxWidthPx === next.maxWidthPx
            ? current
            : next,
        );
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [collapsedLineCount],
  );

  useEffect(() => {
    if (!isEditing || !textareaRef.current) {
      return;
    }
    const textarea = textareaRef.current;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(48, textarea.scrollHeight)}px`;
  }, [editText, isEditing]);

  if (isEditing) {
    return (
      <form
        className="oai-user-message-edit-form"
        data-user-message-edit-form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitEdit();
        }}
      >
        <textarea
          ref={textareaRef}
          className="oai-user-message-edit-textarea"
          data-user-message-edit-textarea
          value={editText}
          rows={3}
          onChange={(event) => onEditTextChange(event.target.value)}
        />
        <div className="oai-user-message-edit-actions" data-user-message-edit-actions>
          <button
            type="button"
            className="oai-user-message-edit-cancel"
            data-cancel-edit-message="cancelEditMessage"
            onClick={onCancelEdit}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="oai-user-message-edit-submit"
            data-send-edited-message="sendEditedMessage"
          >
            Send
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div
        ref={setTextContentMeasurementRef}
        className="oai-user-message-text-shell"
        data-user-message-text
        data-user-message-collapsed={
          isCollapsible && !isExpanded ? "true" : "false"
        }
        data-user-message-collapse-state={
          isCollapsible ? (isExpanded ? "expanded" : "collapsed") : "uncollapsible"
        }
        data-user-message-collapsed-line-count={String(collapsedLineCount)}
        data-user-message-measured={textMeasurement ? "true" : "false"}
        style={
          isCollapsible && !isExpanded
            ? {
                display: "-webkit-box",
                overflow: "hidden",
                maxHeight: `${collapsedLineCount}lh`,
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: collapsedLineCount,
              }
            : undefined
        }
      >
        <Markdown
          value={displayText}
          className="markdown"
          codeBlockStyle="message"
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      </div>
      {isCollapsible ? (
        <button
          type="button"
          className="oai-user-message-collapse-toggle"
          data-user-message-collapse-toggle
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          <span>{isExpanded ? "Show less" : "Show more"}</span>
          <ChevronDown
            className={isExpanded ? "icon-2xs rotate-180" : "icon-2xs"}
            size={12}
            aria-hidden
          />
        </button>
      ) : null}
    </>
  );
});

const MessageArtifacts = memo(function MessageArtifacts({
  item,
}: {
  item: Extract<ConversationItem, { kind: "message" }>;
}) {
  const artifacts = item.artifacts ?? [];
  if (!item.hasArtifacts && artifacts.length === 0) {
    return null;
  }
  return (
    <div
      className="oai-message-artifacts"
      data-message-artifacts
      data-has-artifacts={item.hasArtifacts ? "true" : "false"}
    >
      {artifacts.length > 0 ? (
        artifacts.map((artifact) => (
          <div
            key={artifact.id}
            className="oai-message-artifact"
            data-message-artifact
            data-artifact-id={artifact.id}
            data-artifact-kind={artifact.kind ?? "artifact"}
          >
            <Sparkles size={13} aria-hidden />
            <span className="oai-message-artifact-title">
              {artifact.title ?? artifact.id}
            </span>
            {artifact.description ? (
              <span className="oai-message-artifact-description">
                {artifact.description}
              </span>
            ) : null}
          </div>
        ))
      ) : (
        <div className="oai-message-artifact" data-message-artifact data-artifact-kind="artifact">
          <Sparkles size={13} aria-hidden />
          <span className="oai-message-artifact-title">Artifact</span>
        </div>
      )}
    </div>
  );
});

const CommandOutput = memo(function CommandOutput({ output }: CommandOutputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const lines = useMemo(() => {
    if (!output) {
      return [];
    }
    return output.split(/\r?\n/);
  }, [output]);
  const lineWindow = useMemo(() => {
    if (lines.length <= MAX_COMMAND_OUTPUT_LINES) {
      return { offset: 0, lines };
    }
    const startIndex = lines.length - MAX_COMMAND_OUTPUT_LINES;
    return { offset: startIndex, lines: lines.slice(startIndex) };
  }, [lines]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const threshold = 6;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setIsPinned(distanceFromBottom <= threshold);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinned) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lineWindow, isPinned]);

  if (lineWindow.lines.length === 0) {
    return null;
  }

  return (
    <div
      className="oai-tool-terminal"
      role="log"
      aria-live="polite"
      data-oai-tool-terminal
    >
      <div
        className="oai-tool-terminal-lines"
        data-oai-tool-terminal-lines
        ref={containerRef}
        onScroll={handleScroll}
      >
        {lineWindow.lines.map((line, index) => (
          <div
            key={`${lineWindow.offset + index}-${line}`}
            className="oai-tool-terminal-line"
            data-oai-tool-terminal-line
          >
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
});

function toolIconForSummary(
  item: Extract<ConversationItem, { kind: "tool" }>,
  summary: ToolSummary,
) {
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

function openAIActivityTypeLabel(item: Extract<ConversationItem, { kind: "tool" }>) {
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

function isMcpAppActivity(item: Extract<ConversationItem, { kind: "tool" }>) {
  return (
    item.itemType === "mcp-server-elicitation" ||
    item.itemType === "mcp-tool-call" ||
    item.toolType.toLowerCase().includes("mcp")
  );
}

function buildMultiAgentRows(item: Extract<ConversationItem, { kind: "tool" }>) {
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

function buildTurnDiffRows(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (item.turnDiffRows?.length) {
    return item.turnDiffRows;
  }
  if (item.changes?.length) {
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
  return [];
}

export function countDiffStats(diff?: string) {
  if (!diff) {
    return { additions: 0, deletions: 0 };
  }
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function DiffStat({
  value,
  tone,
}: {
  value: number;
  tone: "add" | "del";
}) {
  if (value <= 0) {
    return null;
  }

  const sign = tone === "add" ? "+" : "-";
  const digits = String(value).split("");

  return (
    <span
      className={`oai-file-diff-stat oai-file-diff-stat-${tone}`}
      aria-label={`${sign}${value}`}
    >
      <span className="oai-file-diff-stat-text">{`${sign}${value}`}</span>
      <span className="oai-file-diff-stat-sign" aria-hidden>
        {sign}
      </span>
      {digits.map((digit, index) => (
        <span
          key={`${tone}-${value}-${index}`}
          className="diff-stat-digit-column"
          aria-hidden
        >
          <span className={`diff-stat-digit-stack diff-stat-digit-stack-${digit}`}>
            <span>0</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
            <span>6</span>
            <span>7</span>
            <span>8</span>
            <span>9</span>
          </span>
        </span>
      ))}
    </span>
  );
}

function summarizeFileChanges(changes: FileChangeEntry[]) {
  return changes.reduce(
    (summary, change) => {
      const stats = countDiffStats(change.diff);
      summary.additions += stats.additions;
      summary.deletions += stats.deletions;
      return summary;
    },
    { additions: 0, deletions: 0 },
  );
}

function mergeFileChangesForSummary(
  changes: FileChangeEntry[],
  workspacePath?: string | null,
): FileChangeSummaryEntry[] {
  const merged = new Map<string, FileChangeSummaryEntry>();

  for (const change of changes) {
    const reviewPath = change.reviewPath ?? change.path;
    const key = reviewPath || change.path;
    if (!key) {
      continue;
    }
    const displayPath = relativeDisplayPath(key, workspacePath);
    const summaryReviewPath = change.reviewPath ?? displayPath;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...change,
        path: key,
        reviewPath: summaryReviewPath,
        displayPath,
      });
      continue;
    }

    merged.set(key, {
      ...existing,
      kind: existing.kind ?? change.kind,
      diff: [existing.diff, change.diff].filter(Boolean).join("\n\n") || undefined,
      reviewPath: existing.reviewPath ?? summaryReviewPath,
      repositorySource: change.repositorySource ?? existing.repositorySource,
      reviewSummarySource: change.reviewSummarySource ?? existing.reviewSummarySource,
      generatedPathsReady: Boolean(existing.generatedPathsReady || change.generatedPathsReady),
      displayPath,
    });
  }

  return Array.from(merged.values());
}

function formatFileChangeSummary(
  changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>,
) {
  if (changes.length === 0) {
    return "changes";
  }
  if (changes.length > 1) {
    return `${changes.length} files`;
  }
  const change = changes[0];
  const { additions, deletions } = countDiffStats(change.diff);
  const stats = [
    additions > 0 ? `+${additions}` : "",
    deletions > 0 ? `-${deletions}` : "",
  ].filter(Boolean);
  return [basename(change.path), ...stats].filter(Boolean).join(" ");
}

function FileChangeSummaryText({
  changes,
}: {
  changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>;
}) {
  if (changes.length === 0) {
    return <span>changes</span>;
  }
  if (changes.length > 1) {
    const totals = changes.reduce(
      (summary, change) => {
        const stats = countDiffStats(change.diff);
        summary.additions += stats.additions;
        summary.deletions += stats.deletions;
        return summary;
      },
      { additions: 0, deletions: 0 },
    );
    return (
      <span className="oai-file-change-summary-value">
        <span>{changes.length} files</span>
        <span className="oai-inline-diff-stat oai-inline-diff-stat-add">+{totals.additions}</span>
        <span className="oai-inline-diff-stat oai-inline-diff-stat-del">-{totals.deletions}</span>
      </span>
    );
  }
  const change = changes[0];
  const { additions, deletions } = countDiffStats(change.diff);
  return (
    <span className="oai-file-change-summary-value">
      <span>{basename(change.path)}</span>
      <span className="oai-inline-diff-stat oai-inline-diff-stat-add">+{additions}</span>
      <span className="oai-inline-diff-stat oai-inline-diff-stat-del">-{deletions}</span>
    </span>
  );
}

export const WorkingIndicator = memo(function WorkingIndicator({
  isThinking,
  processingStartedAt = null,
  lastDurationMs = null,
  hasItems,
  reasoningLabel = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
}: WorkingIndicatorProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pollCountdownSeconds, setPollCountdownSeconds] = useState(() =>
    Math.max(1, Math.ceil(pollingIntervalMs / 1000)),
  );

  useEffect(() => {
    if (!isThinking || !processingStartedAt) {
      setElapsedMs(0);
      return undefined;
    }
    setElapsedMs(Date.now() - processingStartedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processingStartedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isThinking, processingStartedAt]);

  useEffect(() => {
    if (!showPollingFetchStatus || isThinking) {
      return undefined;
    }
    const intervalSeconds = Math.max(1, Math.ceil(pollingIntervalMs / 1000));
    setPollCountdownSeconds(intervalSeconds);
    const timer = window.setInterval(() => {
      setPollCountdownSeconds((previous) =>
        previous <= 1 ? intervalSeconds : previous - 1,
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking, pollingIntervalMs, showPollingFetchStatus]);

  return (
    <>
      {isThinking && (
        <div className="oai-thinking-shimmer" data-oai-thinking-shimmer>
          <span className="oai-thinking-shimmer__spinner" aria-hidden />
          <div className="oai-thinking-shimmer__timer">
            <span className="oai-thinking-shimmer__timer-clock">{formatDurationMs(elapsedMs)}</span>
          </div>
          <span className="oai-thinking-shimmer__label" data-oai-thinking-shimmer-label>
            {reasoningLabel || "Working…"}
          </span>
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div className="oai-turn-status" aria-live="polite" data-oai-turn-status>
          <span className="oai-turn-status__line" aria-hidden />
          <span className="oai-turn-status__label">
            {showPollingFetchStatus
              ? `New message will be fetched in ${pollCountdownSeconds} seconds`
              : `Done in ${formatDurationMs(lastDurationMs)}`}
          </span>
          <span className="oai-turn-status__line" aria-hidden />
        </div>
      )}
    </>
  );
});

export const MessageRow = memo(function MessageRow({
  item,
  isCopied,
  onCopy,
  onQuote,
  onEditMessage,
  codeBlockCopyUseModifier,
  showActions = true,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MessageRowProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isEditingUserMessage, setIsEditingUserMessage] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [committedUserText, setCommittedUserText] = useState(item.text);
  const [userEditText, setUserEditText] = useState(item.text);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const selectionSnapshotRef = useRef<string | null>(null);
  const displayItem = useMemo(
    () =>
      item.role === "user"
        ? {
            ...item,
            text: committedUserText,
          }
        : item,
    [committedUserText, item],
  );
  const hasText = displayItem.text.trim().length > 0;
  const imageItems = useMemo(() => {
    if (!item.images || item.images.length === 0) {
      return [];
    }
    return item.images
      .map((image, index) => {
        const src = normalizeMessageImageSrc(image);
        if (!src) {
          return null;
        }
        return { src, label: `Image ${index + 1}` };
      })
      .filter(Boolean) as MessageImage[];
  }, [item.images]);
  const isTableOnlyAssistantMessage =
    item.role === "assistant" &&
    hasText &&
    imageItems.length === 0 &&
    isStandaloneMarkdownTable(item.text);
  const isUserMessage = item.role === "user";
  const attachmentItems = item.attachments ?? [];
  const userMetadata = useMemo(() => buildUserMessageMetadata(displayItem), [displayItem]);
  const richUserAttachments = useMemo(
    () => buildOpenAIUserAttachments(displayItem),
    [displayItem],
  );
  const inlineImageItems = isUserMessage ? [] : imageItems;
  const canEditUserMessage = isUserMessage && (item.canEdit ?? true) && hasText;

  useEffect(() => {
    setCommittedUserText(item.text);
    setEditingMessageId(null);
    setIsEditingUserMessage(false);
  }, [item.id, item.text]);

  useEffect(() => {
    if (!isEditingUserMessage) {
      setUserEditText(displayItem.text);
    }
  }, [displayItem.text, isEditingUserMessage]);

  const getSelectedMessageText = useCallback(() => {
    const bubble = bubbleRef.current;
    const selection = window.getSelection();
    if (!bubble || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!bubble.contains(range.commonAncestorContainer)) {
      return null;
    }

    const isWithinMessageControls = (node: Node | null) => {
      if (!node) {
        return false;
      }
      const element = node instanceof Element ? node : node.parentElement;
      return Boolean(element?.closest(".oai-message-quote-button, .oai-message-copy-button"));
    };

    if (isWithinMessageControls(selection.anchorNode) || isWithinMessageControls(selection.focusNode)) {
      return null;
    }
    return selectedText;
  }, []);

  const handleQuote = useCallback(() => {
    if (!onQuote) {
      return;
    }
    const selectedText = getSelectedMessageText() ?? selectionSnapshotRef.current ?? undefined;
    selectionSnapshotRef.current = null;
    onQuote(item, selectedText);
  }, [getSelectedMessageText, item, onQuote]);

  const messageContent = (
    <>
      <div
        className={`oai-message-content ${
          isUserMessage
            ? "text-size-chat relative w-full min-w-0 contain-inline-size"
            : "text-size-chat relative w-full min-w-0 oai-assistant-markdown-content"
        }`}
        data-automation-citations={displayItem.automationCitations?.length ? "true" : "false"}
        data-render-code-blocks-as-writing-blocks={
          displayItem.renderCodeBlocksAsWritingBlocks ? "true" : "false"
        }
        data-force-code-block-word-wrap={displayItem.forceCodeBlockWordWrap ? "true" : "false"}
        data-on-add-selected-text-to-chat={onQuote ? "true" : "false"}
        data-on-add-selected-text-to-chat-handler={onQuote ? "onAddSelectedTextToChat" : undefined}
      >
        {inlineImageItems.length > 0 && (
          <MessageImageGrid
            images={inlineImageItems}
            onOpen={setLightboxIndex}
            hasText={hasText}
          />
        )}
        {hasText && (
          isUserMessage ? (
            <UserMessageText
              item={displayItem}
              displayText={displayItem.text}
              isEditing={isEditingUserMessage}
              editText={userEditText}
              onEditTextChange={setUserEditText}
              onCancelEdit={() => {
                setUserEditText(displayItem.text);
                setEditingMessageId(null);
                setIsEditingUserMessage(false);
              }}
              onSubmitEdit={() => {
                const nextText = userEditText.trim();
                if (nextText) {
                  setCommittedUserText(nextText);
                  onEditMessage?.(displayItem, nextText);
                }
                setEditingMessageId(null);
                setIsEditingUserMessage(false);
              }}
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              showMessageFilePath={showMessageFilePath}
              workspacePath={workspacePath}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
              onOpenThreadLink={onOpenThreadLink}
            />
          ) : (
            <Markdown
              value={displayItem.text}
              className="markdown"
              codeBlockStyle="message"
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              showFilePath={showMessageFilePath}
              workspacePath={workspacePath}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
              onOpenThreadLink={onOpenThreadLink}
            />
          )
        )}
        {!isUserMessage && <MessageArtifacts item={displayItem} />}
      </div>
      {lightboxIndex !== null && imageItems.length > 0 && (
        <ImageLightbox
          images={imageItems}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );

	if (isUserMessage) {
    const shouldRenderBubble = hasText || imageItems.length === 0;
	    return (
	      <div
	        className="group flex w-full flex-col items-end justify-end gap-1 oai-user-message-group"
	        data-message-role="user"
	        data-message-author-role="user"
          data-openai-message-item-type={displayItem.itemType ?? "user-message"}
	      >
          <UserMessageAttachments
            images={imageItems}
            attachments={attachmentItems}
            richAttachments={richUserAttachments}
            parentContext={displayItem.parentContext}
            onOpenImage={setLightboxIndex}
          />
	        <div
	          className={`ms-1 mr-1 flex items-center gap-2 oai-user-message-metadata${
	            userMetadata.length === 0 ? " hidden" : ""
          }`}
          data-user-message-metadata=""
          aria-hidden={userMetadata.length === 0 ? "true" : undefined}
        >
	          {userMetadata.map(({ kind, label }) => (
	            <span
	              key={`${kind}-${label}`}
	              className="oai-user-message-metadata-chip"
	              data-user-message-metadata-chip
                data-user-message-metadata-kind={kind}
	            >
                {kind === "comments" ? (
                  <MessageSquare size={12} aria-hidden />
                ) : kind === "pull-request-checks" ? (
                  <BadgeCheck size={12} aria-hidden />
                ) : null}
	              {label}
	            </span>
	          ))}
	        </div>
          {shouldRenderBubble && (
            <div
              ref={bubbleRef}
              className={`bg-token-foreground/5 max-w-[77%] break-words rounded-2xl px-3 py-2 [&_.contain-inline-size]:[contain:initial]${!hasText && imageItems.length === 0 ? " leading-none" : ""}`}
              data-message-part="content"
              data-message-has-images={imageItems.length > 0 ? "true" : "false"}
              data-message-has-attachments={attachmentItems.length > 0 || richUserAttachments.length > 0 ? "true" : "false"}
              data-editing-message-id={editingMessageId ?? undefined}
              data-send-edited-message={isEditingUserMessage ? "true" : "false"}
              data-cancel-edit-message={isEditingUserMessage ? "true" : "false"}
            >
              {messageContent}
              {!hasText && imageItems.length === 0 && (
                <div
                  className="text-size-chat mb-px text-token-description-foreground oai-user-message-no-content"
                  data-message-empty-content
                >
                  (No content)
                </div>
              )}
            </div>
          )}
	        {showActions && (
          <div
            className="flex flex-row-reverse items-center gap-1"
            data-message-part="actions"
          >
            <div
              className="mr-1 ms-1 flex items-center gap-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              data-message-actions-row
            >
              <span
                className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 oai-message-action-metadata"
                data-message-action-metadata
                aria-hidden
              />
              <div className="flex items-center gap-1" data-message-actions-controls>
                {onQuote && hasText && (
                  <button
                    type="button"
                    className="ghost oai-message-action-button oai-message-quote-button"
                    data-utility-button
                    data-message-action="quote"
                    onMouseDown={() => {
                      selectionSnapshotRef.current = getSelectedMessageText();
                    }}
                    onTouchStart={() => {
                      selectionSnapshotRef.current = getSelectedMessageText();
                    }}
                    onClick={handleQuote}
                    aria-label="Quote message"
                    title="Quote message"
                  >
                    <Quote size={14} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className={`ghost oai-message-action-button oai-message-copy-button${isCopied ? " is-copied" : ""}`}
                  data-utility-button
                  data-message-action="copy"
                  onClick={() => onCopy(displayItem)}
                  aria-label="Copy message"
                  title="Copy message"
                >
                  <span className="oai-message-copy-icon" aria-hidden>
                    <Copy className="oai-message-copy-icon-copy" size={14} />
                    <Check className="oai-message-copy-icon-check" size={14} />
                  </span>
                </button>
                {canEditUserMessage && (
                  <button
                    type="button"
                    className="ghost oai-message-action-button oai-message-edit-button"
                    data-utility-button
                    data-message-action="edit"
                    onClick={() => {
                      setEditingMessageId(displayItem.id);
                      setUserEditText(displayItem.text);
                      setIsEditingUserMessage(true);
                    }}
                    aria-label="Edit message"
                    title="Edit message"
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`w-full min-w-0${isTableOnlyAssistantMessage ? " oai-assistant-table-only" : ""}`}
      data-message-role="assistant"
      data-message-author-role="assistant"
      data-openai-message-item-type={displayItem.itemType ?? "assistant-message"}
      data-message-part="content"
      data-message-content-root
      ref={bubbleRef}
    >
      {messageContent}
    </div>
  );
});

export const ReasoningRow = memo(function ReasoningRow({
  item,
  parsed,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReasoningRowProps) {
  const { summaryTitle, bodyText, hasBody } = parsed;
  const reasoningTone: StatusTone = hasBody ? "completed" : "processing";
  return (
    <div
      className="flex w-full min-w-0 flex-col oai-activity-detail oai-reasoning-detail"
      data-oai-activity-detail="reasoning"
      data-oai-reasoning-detail
    >
      <button
        type="button"
        className="oai-activity-detail-gutter"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle reasoning details"
      />
      <div className="oai-activity-detail-content">
        <button
          type="button"
          className="oai-activity-detail-summary oai-activity-detail-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <Brain
            className={`oai-activity-detail-icon ${reasoningTone}`}
            size={14}
            aria-hidden
          />
          <span className="oai-activity-detail-value">{summaryTitle}</span>
        </button>
        {hasBody && (
          <Markdown
            value={bodyText}
            className={`oai-reasoning-detail-body markdown ${
              isExpanded ? "" : "oai-activity-detail-clamp"
            }`}
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
      </div>
    </div>
  );
});

export const ReviewRow = memo(function ReviewRow({
  item,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReviewRowProps) {
  const title = item.state === "started" ? "Review started" : "Review completed";
  return (
    <div
      className="w-full min-w-0 oai-review-card"
      data-oai-review-row
    >
      <div className="oai-review-header">
        <span className="oai-review-title">{title}</span>
        <span
          className={`oai-review-badge ${item.state === "started" ? "active" : "done"}`}
        >
          Review
        </span>
      </div>
      {item.text && (
        <Markdown
          value={item.text}
          className="oai-review-text markdown"
          showFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      )}
    </div>
  );
});

export const DiffRow = memo(function DiffRow({ item }: DiffRowProps) {
  return (
    <div
      className="w-full min-w-0 oai-diff-card"
      data-oai-diff-row
    >
      <div className="oai-diff-header">
        <span className="oai-diff-title">{item.title}</span>
        {item.status && <span className="oai-diff-status">{item.status}</span>}
      </div>
      <div className="diff-viewer-output">
        <PierreDiffBlock diff={item.diff} displayPath={item.title} />
      </div>
    </div>
  );
});

export const UserInputRow = memo(function UserInputRow({
  item,
  isExpanded,
  onToggle,
}: UserInputRowProps) {
  const first = item.questions[0];
  const previewQuestion =
    first?.question?.trim() || first?.header?.trim() || "Input requested";
  const firstAnswer = first?.answers[0]?.trim() || "No answer provided";
  const previewAnswer =
    first && first.answers.length > 1
      ? `${firstAnswer} +${first.answers.length - 1}`
      : firstAnswer;
  const extraQuestions = Math.max(0, item.questions.length - 1);

  return (
    <div
      className={`flex w-full min-w-0 flex-col oai-activity-detail oai-user-input-detail${isExpanded ? " oai-activity-detail-expanded" : ""}`}
      data-oai-activity-detail="user-input"
      data-oai-user-input-detail
      data-oai-activity-detail-expanded={isExpanded ? "true" : "false"}
    >
      <button
        type="button"
        className="oai-activity-detail-gutter"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle answered input details"
      />
      <div className="oai-activity-detail-content">
        <button
          type="button"
          className="oai-activity-detail-summary oai-activity-detail-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <Check className="oai-activity-detail-icon completed" size={14} aria-hidden />
          <span className="oai-activity-detail-label">answered:</span>
          <span className="oai-activity-detail-value oai-user-input-preview">
            {previewQuestion}: {previewAnswer}
            {extraQuestions > 0 ? ` +${extraQuestions} more` : ""}
          </span>
        </button>
        {isExpanded && (
          <div className="oai-user-input-details">
            {item.questions.map((question, index) => {
              const title = question.question || question.header || `Question ${index + 1}`;
              return (
                <div
                  key={`${question.id}-${index}`}
                  className="oai-user-input-entry"
                >
                  <div className="oai-user-input-question">{title}</div>
                  {question.answers.length > 0 ? (
                    <div className="oai-user-input-answers">
                      {question.answers.map((answer, answerIndex) => (
                        <div
                          key={`${question.id}-answer-${answerIndex}`}
                          className="oai-user-input-answer"
                        >
                          {answer}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="oai-user-input-empty-answer">
                      No answer provided.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export const FileChangeSummaryCard = memo(function FileChangeSummaryCard({
  changes,
  workspacePath = null,
}: FileChangeSummaryCardProps) {
  const [isListExpanded, setIsListExpanded] = useState(true);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [copiedChangeKey, setCopiedChangeKey] = useState<string | null>(null);
  const summaryChanges = useMemo(
    () => mergeFileChangesForSummary(changes, workspacePath),
    [changes, workspacePath],
  );
  const totals = useMemo(() => summarizeFileChanges(summaryChanges), [summaryChanges]);
  const fileCount = summaryChanges.length;

  const handleToggleDiff = useCallback((key: string) => {
    setExpandedDiffs((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleCopyFileDiff = useCallback(
    async (
      event: MouseEvent<HTMLButtonElement>,
      key: string,
      diff: string,
    ) => {
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
        const message = error instanceof Error ? error.message : "Unable to copy diff.";
        pushErrorToast({
          title: "Copy failed",
          message,
        });
      }
    },
    [],
  );

  if (fileCount === 0) {
    return null;
  }

  return (
    <div
      className="codex-review-diff-card oai-review-diff-summary-card"
      data-codex-review-diff-card
      data-codex-review-diff-summary
      data-diffs
      data-diffs-card
      data-diffs-review-summary
      data-diffs-summary-card
      data-diffs-mode="summary"
      data-expanded={isListExpanded ? "true" : "false"}
    >
      <div
        className="group/custom-section-header oai-review-diff-summary-header"
        data-diffs-header="summary"
        data-diffs-summary-header
      >
        <button
          type="button"
          className="oai-review-diff-summary-toggle"
          data-utility-button
          data-diffs-summary-toggle
          onClick={() => setIsListExpanded((current) => !current)}
          aria-expanded={isListExpanded}
        >
          <span className="oai-review-diff-summary-title">
            {fileCount} 个文件已更改
          </span>
          <span className="oai-review-diff-summary-meta" data-diffs-summary-meta>
            <DiffStat value={totals.additions} tone="add" />
            <DiffStat value={totals.deletions} tone="del" />
            <span
              className={`oai-review-diff-summary-chevron${isListExpanded ? " is-expanded" : ""}`}
              aria-hidden
            >
              <ChevronRight size={14} />
            </span>
          </span>
        </button>
      </div>
      {isListExpanded && (
        <div className="oai-review-diff-file-list" data-diffs-file-list>
          {summaryChanges.map((change, index) => {
              const changeKey = `${change.path}-${index}`;
              const { additions, deletions } = countDiffStats(change.diff);
              const isDiffExpanded = expandedDiffs.has(changeKey);
              const reviewPath = change.reviewPath ?? change.path;
              const repositorySource = change.repositorySource ?? "local";
              const reviewSummarySource = change.reviewSummarySource ?? "assistant-turn";
              return (
                <div
                  className="oai-review-diff-file-entry"
                  key={changeKey}
                  data-diffs-file-entry
                  data-expanded={isDiffExpanded ? "true" : "false"}
                  data-review-path={reviewPath}
                  data-repository-source={repositorySource}
                  data-review-summary-source={reviewSummarySource}
                  data-generated-paths-ready={change.generatedPathsReady ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="oai-review-diff-file-row"
                    data-codex-review-diff-file-row
                    data-diffs-file-row
                    data-utility-button
                    data-app-action-review-file
                    data-review-path={reviewPath}
                    data-repository-source={repositorySource}
                    data-review-summary-source={reviewSummarySource}
                    onClick={() => handleToggleDiff(changeKey)}
                  aria-expanded={isDiffExpanded}
                  aria-label={`${basename(change.displayPath)} ${additions > 0 ? `+${additions}` : ""} ${
                    deletions > 0 ? `-${deletions}` : ""
                  }`.trim()}
                >
                  <span className="oai-review-diff-file-name" title={reviewPath}>
                    {change.displayPath}
                  </span>
                  <span className="oai-review-diff-file-meta" data-diffs-file-meta>
                    <DiffStat value={additions} tone="add" />
                    <DiffStat value={deletions} tone="del" />
                    <span
                      className={`oai-review-diff-file-chevron${isDiffExpanded ? " is-expanded" : ""}`}
                      aria-hidden
                    >
                      <ChevronRight size={14} />
                    </span>
                  </span>
                </button>
                {isDiffExpanded && change.diff && (
                  <div
                    className="oai-review-diff-file-panel"
                    data-diffs-file-panel
                    data-expanded="true"
                  >
                    <FileDiffCard
                      change={change}
                      changeKey={changeKey}
                      copiedChangeKey={copiedChangeKey}
                      onCopyFileDiff={handleCopyFileDiff}
                      fileBody
                      className="oai-review-diff-file-body"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const FileDiffCard = memo(function FileDiffCard({
  change,
  changeKey,
  copiedChangeKey,
  onCopyFileDiff,
  fileBody = false,
  className,
}: FileDiffCardProps) {
  const { additions, deletions } = countDiffStats(change.diff);
  const reviewPath = change.reviewPath ?? change.path;
  const fileName = basename(reviewPath || change.path);
  const changeType = change.kind ?? "file";
  const repositorySource = change.repositorySource ?? "local";
  const reviewSummarySource = change.reviewSummarySource ?? "assistant-turn";
  return (
    <div
      className={`codex-review-diff-card oai-file-diff-card${fileBody ? " oai-file-diff-file-body" : ""}${
        className ? ` ${className}` : ""
      }`}
      data-codex-review-diff-card
      data-diffs
      data-diff
      data-file
      data-diffs-card
      data-diffs-mode="file"
      data-change-type={changeType}
      data-review-path={reviewPath}
      data-repository-source={repositorySource}
      data-review-summary-source={reviewSummarySource}
      data-generated-paths-ready={change.generatedPathsReady ? "true" : "false"}
      data-diff-load-status={change.diffLoadStatus ?? (change.diff ? "loaded" : "idle")}
      {...(fileBody
        ? {
            "data-codex-review-diff-file-body": true,
            "data-diffs-file-body": true,
          }
        : {})}
    >
      {!fileBody && (
        <div
          className="oai-file-diff-header"
          data-diffs-header="file"
          data-change-type={changeType}
        >
          <span className="oai-file-diff-change-icon" data-change-icon={changeType} aria-hidden />
          <span className="oai-file-diff-name" title={reviewPath}>
            {fileName}
          </span>
          <span className="oai-file-diff-header-meta" data-diffs-file-header-meta>
            <span className="oai-file-diff-header-metadata" data-header-metadata aria-hidden />
            <DiffStat value={additions} tone="add" />
            <DiffStat value={deletions} tone="del" />
          </span>
          <span className="oai-file-diff-header-controls" data-diffs-file-header-controls>
            {change.diff && (
              <button
                type="button"
                className="oai-file-diff-copy"
                data-utility-button
                data-app-action-review-file
                data-review-path={reviewPath}
                onClick={(event) => onCopyFileDiff(event, changeKey, change.diff ?? "")}
                aria-label={`Copy ${fileName} diff`}
                title="Copy diff"
              >
                {copiedChangeKey === changeKey ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Copy size={12} aria-hidden />
                )}
              </button>
            )}
          </span>
        </div>
      )}
      {change.diff && (
        <div
          className="oai-file-diff-body"
          data-diffs-body
          data-diffs-file-body-content
          data-file-body-content
        >
          <div className="thread-diff-virtualized oai-thread-diff-virtualized" data-thread-diff-virtualized>
            <PierreDiffBlock diff={change.diff} displayPath={reviewPath || change.path} />
          </div>
        </div>
      )}
    </div>
  );
});

export const ToolRow = memo(function ToolRow({
  item,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onRequestAutoScroll,
}: ToolRowProps) {
  const isFileChange = item.toolType === "fileChange";
  const isCommand = item.toolType === "commandExecution";
  const isPlan = item.toolType === "plan";
  const commandText = isCommand
    ? item.title.replace(/^Command:\s*/i, "").trim()
    : "";
  const summary = buildToolSummary(item, commandText);
  const openAIItemTypeLabel = openAIActivityTypeLabel(item);
  const fileChanges = item.changes ?? [];
  const hasChanges = fileChanges.length > 0;
  const tone = toolStatusTone(item, hasChanges);
  const ToolIcon = toolIconForSummary(item, summary);
  const summaryLabel = isFileChange
    ? "edited"
    : isCommand
      ? ""
      : summary.label;
  const inlineStatus = formatToolStatusLabel(item);
  const summaryValue = isFileChange
    ? formatFileChangeSummary(fileChanges)
    : summary.value;
  const shouldFadeCommand =
    isCommand && !isExpanded && (summaryValue?.length ?? 0) > 80;
  const showToolOutput = isExpanded && (!isFileChange || !hasChanges);
  const showFileChangeDetails = isFileChange && hasChanges && isExpanded;
  const isMcpApp = isMcpAppActivity(item);
  const mcpAppId = item.mcpApp?.id ?? item.detail ?? item.id;
  const mcpAppTitle = item.mcpApp?.title ?? summary.value ?? item.title;
  const mcpAppExpanded = item.mcpApp?.expanded ?? isExpanded;
  const multiAgentRows = buildMultiAgentRows(item);
  const showMultiAgentAction = item.itemType === "multi-agent-action";
  const turnDiffRows = buildTurnDiffRows(item);
  const showTurnDiffRow = item.itemType === "turn-diff" || (isFileChange && hasChanges);
  const normalizedStatus = (item.status ?? "").toLowerCase();
  const isCommandRunning = isCommand && /in[_\s-]*progress|running|started/.test(normalizedStatus);
  const commandDurationMs =
    typeof item.durationMs === "number" ? item.durationMs : null;
  const isLongRunning = commandDurationMs !== null && commandDurationMs >= 1200;
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [isExportingPlan, setIsExportingPlan] = useState(false);
  const [copiedChangeKey, setCopiedChangeKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isCommandRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowLiveOutput(true);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCommandRunning]);

  const showCommandOutput =
    isCommand &&
    summary.output &&
    (isExpanded || (isCommandRunning && showLiveOutput) || isLongRunning);
  const hasToolDetailBody = Boolean(
    (isExpanded && summary.detail && !isFileChange) ||
      (isExpanded && isCommand && item.detail) ||
      openAIItemTypeLabel ||
      item.generatedImage ||
      item.artifact ||
      showFileChangeDetails ||
      (isExpanded && isFileChange && !hasChanges && item.detail) ||
      showCommandOutput ||
      (showToolOutput && summary.output && !isCommand) ||
      (showToolOutput && isPlan && (summary.output ?? "").trim()),
  );

  useEffect(() => {
    if (showCommandOutput && isCommandRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isCommandRunning, onRequestAutoScroll, showCommandOutput, showLiveOutput]);

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
        const message = error instanceof Error ? error.message : "Unable to export plan.";
        pushErrorToast({
          title: "Plan export failed",
          message,
        });
      } finally {
        setIsExportingPlan(false);
      }
    },
    [item.id, summary.output],
  );

  const handleCopyFileDiff = useCallback(
    async (
      event: MouseEvent<HTMLButtonElement>,
      key: string,
      diff: string,
    ) => {
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
        const message = error instanceof Error ? error.message : "Unable to copy diff.";
        pushErrorToast({
          title: "Copy failed",
          message,
        });
      }
    },
    [],
  );

  return (
    <div
      className={`flex w-full min-w-0 oai-activity-detail oai-tool-detail${isExpanded ? " oai-activity-detail-expanded" : ""}${
        isFileChange ? " oai-file-change-detail" : ""
      }`}
      data-oai-activity-detail="tool"
      data-oai-tool-detail
      data-oai-activity-detail-expanded={isExpanded ? "true" : "false"}
      data-tool-type={item.toolType}
      data-openai-activity-item-type={item.itemType ?? item.toolType}
      data-auto-review-interruption-warning={item.itemType === "auto-review-interruption-warning" ? "true" : undefined}
      data-automation-update={item.itemType === "automation-update" ? "true" : undefined}
      data-automatic-approval-review={item.itemType === "automatic-approval-review" ? "true" : undefined}
      data-exec={item.itemType === "exec" ? "true" : undefined}
      data-forked-from-conversation={item.itemType === "forked-from-conversation" ? "true" : undefined}
      data-hook={item.itemType === "hook" ? "true" : undefined}
      data-permission-request={item.itemType === "permission-request" ? "true" : undefined}
      data-mcp-server-elicitation={item.itemType === "mcp-server-elicitation" ? "true" : undefined}
      data-mcp-tool-call={item.itemType === "mcp-tool-call" ? "true" : undefined}
      data-dynamic-tool-call={item.itemType === "dynamic-tool-call" ? "true" : undefined}
      data-context-compaction={item.itemType === "context-compaction" ? "true" : undefined}
      data-todo-list={item.itemType === "todo-list" ? "true" : undefined}
      data-generated-image={item.itemType === "generated-image" ? "true" : undefined}
      data-model-rerouted={item.itemType === "model-rerouted" ? "true" : undefined}
      data-multi-agent-action={item.itemType === "multi-agent-action" ? "true" : undefined}
      data-patch={item.itemType === "patch" ? "true" : undefined}
      data-personality-changed={item.itemType === "personality-changed" ? "true" : undefined}
      data-plan-implementation={item.itemType === "plan-implementation" ? "true" : undefined}
      data-proposed-plan={item.itemType === "proposed-plan" ? "true" : undefined}
      data-stream-error={item.itemType === "stream-error" ? "true" : undefined}
      data-system-error={item.itemType === "system-error" ? "true" : undefined}
      data-remote-task-created={item.itemType === "remote-task-created" ? "true" : undefined}
      data-model-changed={item.itemType === "model-changed" ? "true" : undefined}
      data-steered={item.itemType === "steered" ? "true" : undefined}
      data-turn-diff={item.itemType === "turn-diff" ? "true" : undefined}
      data-user-input-response={item.itemType === "user-input-response" ? "true" : undefined}
      data-web-search={item.itemType === "web-search" ? "true" : undefined}
      data-worked-for={item.itemType === "worked-for" ? "true" : undefined}
      data-mcp-app-expanded={isMcpApp && mcpAppExpanded ? "true" : undefined}
    >
      <div
        className="w-full min-w-0 oai-activity-detail-offset"
        data-oai-activity-detail-offset
      >
        <div
          className="flex w-full min-w-0 flex-col oai-activity-detail-stack"
          data-oai-activity-detail-stack
        >
          {!isFileChange && (
            <button
              type="button"
              className="oai-activity-detail-gutter"
              onClick={() => onToggle(item.id)}
              aria-expanded={isExpanded}
              aria-label="Toggle tool details"
            />
          )}
          <div
            className="oai-activity-detail-content"
            data-oai-activity-detail-content
          >
            <button
              type="button"
              className={`oai-activity-detail-summary oai-activity-detail-toggle${
                isFileChange ? " file-change-inline-summary" : ""
              }`}
              onClick={() => onToggle(item.id)}
              aria-expanded={isExpanded}
              aria-label={
                isFileChange && summaryValue
                  ? `${summaryLabel}: ${summaryValue}`
                  : undefined
              }
              data-oai-activity-detail-summary
            >
              <ToolIcon className={`oai-activity-detail-icon ${tone}`} size={14} aria-hidden />
              {summaryLabel && (
                <span className="oai-activity-detail-label">{summaryLabel}:</span>
              )}
              {summaryValue && (
                <span
                  className={`oai-activity-detail-value ${isCommand ? "oai-activity-detail-command" : ""} ${
                    isCommand && isExpanded ? "oai-activity-detail-command-full" : ""
                  }`}
                >
                  {isCommand ? (
                    <span
                      className={`oai-activity-detail-command-text ${
                        shouldFadeCommand ? "oai-activity-detail-command-fade" : ""
                      }`}
                    >
                      {summaryValue}
                    </span>
                  ) : (
                    isFileChange ? <FileChangeSummaryText changes={fileChanges} /> : summaryValue
                  )}
                </span>
              )}
              {inlineStatus && (
                <span className="oai-activity-detail-status">{inlineStatus}</span>
              )}
              {openAIItemTypeLabel && (
                <span className="oai-activity-detail-status oai-activity-detail-openai-type">
                  {openAIItemTypeLabel}
                </span>
              )}
            </button>
            {hasToolDetailBody && (
              <div
                className={`oai-activity-detail-body${isMcpApp ? " pending-mcp-tool-calls-body" : ""}`}
                data-pending-mcp-tool-calls-body={isMcpApp ? "true" : undefined}
                data-oai-activity-detail-body
              >
                {isExpanded && summary.detail && !isFileChange && (
                  <div className="oai-activity-detail-meta">{summary.detail}</div>
                )}
                {isExpanded && isCommand && item.detail && (
                  <div className="oai-activity-detail-meta oai-activity-detail-muted">
                    cwd: {item.detail}
                  </div>
                )}
                {openAIItemTypeLabel && (
                  <div
                    className="oai-activity-detail-meta oai-openai-activity-item"
                    data-openai-activity-item
                    data-openai-activity-item-type={item.itemType}
                  >
                    {openAIItemTypeLabel}
                  </div>
                )}
                {item.generatedImage && (
                  <div className="oai-generated-image" data-generated-image>
                    <img src={item.generatedImage} alt={summary.value || "Generated image"} />
                  </div>
                )}
                {item.artifact && (
                  <div
                    className="oai-message-artifact"
                    data-message-artifact
                    data-artifact-id={item.artifact.id}
                    data-artifact-kind={item.artifact.kind ?? "artifact"}
                  >
                    <Sparkles size={13} aria-hidden />
                    <span className="oai-message-artifact-title">
                      {item.artifact.title ?? item.artifact.id}
                    </span>
                    {item.artifact.description ? (
                      <span className="oai-message-artifact-description">
                        {item.artifact.description}
                      </span>
                    ) : null}
                  </div>
                )}
                {isMcpApp && (
                  <div
                    className="group/mcp-app oai-mcp-app"
                    data-mcp-app
                    data-mcp-app-instance={mcpAppId}
                    data-mcp-app-expanded={mcpAppExpanded ? "true" : "false"}
                    data-mcp-app-portal-target="true"
                    data-mcp-app-loading={/pending|running|progress/.test(normalizedStatus) ? "true" : "false"}
                  >
                    <div
                      className={`oai-mcp-app-frame${
                        /pending|running|progress/.test(normalizedStatus) ? " mcp-app-loading-pulse" : ""
                      }`}
                      data-mcp-app-frame="true"
                      data-mcp-app-frame-loading={/pending|running|progress/.test(normalizedStatus) ? "true" : "false"}
                    >
                      <div className="oai-mcp-app-header">
                        <span className="oai-mcp-app-title">{mcpAppTitle}</span>
                        <span className="oai-mcp-app-kind">mcp-app</span>
                      </div>
                      {item.mcpApp?.url ? (
                        <div className="oai-mcp-app-url">{item.mcpApp.url}</div>
                      ) : null}
                    </div>
                  </div>
                )}
                {showMultiAgentAction && (
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
                )}
                {showTurnDiffRow && (
                  <div className="oai-turn-diff" data-turn-diff-row>
                    <div className="oai-turn-diff-header" data-turn-diff-row-header>
                      <Diff size={13} aria-hidden />
                      <span>{item.itemType === "turn-diff" ? "Turn diff" : "File changes"}</span>
                    </div>
                    <div className="oai-turn-diff-rows" data-turn-diff-row-list>
                      {(turnDiffRows.length ? turnDiffRows : [{ id: item.id, label: summary.value || item.title }]).map((row) => (
                        <div key={row.id} className="oai-turn-diff-row" data-turn-diff-row-item>
                          <span className="oai-turn-diff-label">{row.label}</span>
                          {typeof row.additions === "number" ? (
                            <span className="oai-turn-diff-add">+{row.additions}</span>
                          ) : null}
                          {typeof row.deletions === "number" ? (
                            <span className="oai-turn-diff-del">-{row.deletions}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showFileChangeDetails && (
                  <div className="oai-activity-detail-change-list">
                    {fileChanges.map((change, index) => {
                      const changeKey = `${change.path}-${index}`;
                      return (
                        <FileDiffCard
                          key={changeKey}
                          change={change}
                          changeKey={changeKey}
                          copiedChangeKey={copiedChangeKey}
                          onCopyFileDiff={handleCopyFileDiff}
                        />
                      );
                    })}
                  </div>
                )}
                {isExpanded && isFileChange && !hasChanges && item.detail && (
                  <Markdown
                    value={item.detail}
                    className="oai-activity-detail-output markdown"
                    showFilePath={showMessageFilePath}
                    workspacePath={workspacePath}
                    onOpenFileLink={onOpenFileLink}
                    onOpenFileLinkMenu={onOpenFileLinkMenu}
                    onOpenThreadLink={onOpenThreadLink}
                  />
                )}
                {showCommandOutput && <CommandOutput output={summary.output ?? ""} />}
                {showToolOutput && summary.output && !isCommand && (
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
                )}
                {showToolOutput && isPlan && (summary.output ?? "").trim() && (
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
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export const ExploreRow = memo(function ExploreRow({ item }: ExploreRowProps) {
  return (
    <div
      className="flex w-full min-w-0 oai-activity-detail oai-explore-detail"
      data-oai-activity-detail="explore"
      data-oai-explore-detail
    >
      <div className="oai-activity-detail-gutter" aria-hidden />
      <div className="oai-activity-detail-content">
        <div className="oai-explore-list">
          {item.entries.map((entry, index) => (
            <div key={`${entry.kind}-${entry.label}-${index}`} className="oai-explore-item">
              <span className="oai-explore-kind">{exploreKindLabel(entry.kind)}</span>
              <span className="oai-explore-label">{entry.label}</span>
              {entry.detail && entry.detail !== entry.label && (
                <span className="oai-explore-extra">{entry.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
