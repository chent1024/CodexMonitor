import type { ConversationItem } from "../../types";
import {
  buildMessageEntries,
  formatActivitySummary,
  type AssistantTurn,
  type AssistantTurnActivityBlock,
  type AssistantTurnBlock,
  type MessageListEntry,
  type ToolGroupItem,
} from "../messages/utils/messageRenderUtils";
import {
  buildVscodeConversationTurns,
  getVscodeAssistantTurnSearchKey,
  getVscodeEntrySearchUnitKey,
  getVscodeEntrySearchUnitKind,
  type VscodeConversationTurn,
} from "./conversationTurns";

export const VSCODE_CONVERSATION_DETAIL_LEVEL = "STEPS_PROSE";
export const VSCODE_SHOULD_AUTO_EXPAND_MCP_APPS = false;
export const VSCODE_MCP_SERVER_STATUSES: Record<string, string> = {};
const TOOL_DETAIL_PARSE_CACHE_LIMIT = 500;
const toolDetailParseCache = new Map<string, Record<string, unknown> | null>();

export type VscodeActivityKind =
  | "context-compaction"
  | "exploration"
  | "multi-agent-group"
  | "patch"
  | "pending-mcp-tool-calls"
  | "reasoning"
  | "web-search-group"
  | string;

export type VscodeActivityGroup = {
  id: string;
  kind: VscodeActivityKind;
  items: ToolGroupItem[];
  summary: string;
  toolCount: number;
  messageCount: number;
  durationMs: number | null;
};

export type VscodeRenderedEntry = {
  id: string;
  entry: MessageListEntry;
  searchUnitKey: string;
  searchUnitKind: string;
  scrollToKey: string;
};

export type VscodeTurnViewModel = VscodeConversationTurn & {
  turnIndex: number;
  assistantTurnSearchKey?: string;
  userSearchUnitKey?: string;
  renderedAgentEntries: VscodeRenderedEntry[];
};

export type VscodeMessagesViewModel = {
  turns: VscodeTurnViewModel[];
  entries: MessageListEntry[];
};

export function formatActivityDurationLabel(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }
  return `${seconds} 秒`;
}

export function formatAssistantTurnActivityStatus(turn: AssistantTurn) {
  if (typeof turn.durationMs === "number") {
    return `已处理 ${formatActivityDurationLabel(turn.durationMs)}`;
  }
  const collapsedCount = turn.toolCount + turn.messageCount;
  if (collapsedCount > 0) {
    return `${collapsedCount} 条前序内容`;
  }
  return "已处理";
}

export function activityBlockHasFileChange(block: AssistantTurnActivityBlock) {
  return block.items.some(
    (item) => item.kind === "tool" && item.toolType === "fileChange",
  );
}

export function getToolActivityKind(item: ConversationItem): VscodeActivityKind {
  if (item.kind === "explore") {
    const hasSearch = item.entries.some((entry) => entry.kind === "search");
    return hasSearch ? "web-search-group" : "exploration";
  }
  if (item.kind === "reasoning") {
    return "reasoning";
  }
  if (item.kind === "userInput") {
    return "pending-mcp-tool-calls";
  }
  if (item.kind !== "tool") {
    return item.kind;
  }
  if (isContextCompactionItem(item)) {
    return "context-compaction";
  }
  if (item.toolType === "collabToolCall") {
    return "multi-agent-group";
  }
  if (item.toolType === "webSearch") {
    return "web-search-group";
  }
  if (item.toolType === "fileChange") {
    return "patch";
  }
  if (item.toolType === "commandExecution") {
    return "exec";
  }
  if (item.toolType.toLowerCase().includes("mcp")) {
    return "pending-mcp-tool-calls";
  }
  return item.toolType;
}

export function isContextCompactionItem(item: ConversationItem) {
  if (item.kind !== "tool") {
    return false;
  }
  const itemType = normalizeActivityTypeName(item.itemType);
  const toolType = normalizeActivityTypeName(item.toolType);
  return (
    itemType === "context-compaction" ||
    toolType === "context-compaction" ||
    toolType === "contextcompaction" ||
    toolType === "compaction"
  );
}

export function isCodexStderrTranscriptItem(
  item: ConversationItem,
): item is Extract<ConversationItem, { kind: "tool" }> {
  return (
    item.kind === "tool" &&
    item.toolType === "error" &&
    item.itemType === "system-error" &&
    item.title === "Codex stderr" &&
    item.detail === "stderr"
  );
}

function normalizeActivityTypeName(value?: string | null) {
  return (value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function getOpenAIActivityItemType(item: ConversationItem) {
  if (item.kind === "message") {
    return item.itemType ?? (item.role === "assistant" ? "assistant-message" : "user-message");
  }
  if (item.kind === "reasoning") {
    return "reasoning";
  }
  if (item.kind === "userInput") {
    return "userInput";
  }
  if (item.kind === "explore") {
    return item.entries.some((entry) => entry.kind === "search") ? "web-search" : "exec";
  }
  if (item.kind === "tool") {
    return item.itemType ?? getToolActivityKind(item);
  }
  return item.kind;
}

export function getOpenAIActivityItemTypes(items: ConversationItem[]) {
  return Array.from(new Set(items.map(getOpenAIActivityItemType).filter(Boolean)));
}

export function getActivityBlockKind(block: AssistantTurnActivityBlock) {
  const kinds = new Set(block.items.map(getToolActivityKind));
  if (kinds.has("patch")) {
    return "patch";
  }
  if (kinds.has("multi-agent-group")) {
    return "multi-agent-group";
  }
  if (kinds.has("web-search-group")) {
    return "web-search-group";
  }
  if (kinds.has("pending-mcp-tool-calls")) {
    return "pending-mcp-tool-calls";
  }
  return kinds.values().next().value ?? "tool";
}

export function groupActivityItemsLikeOpenAI({
  block,
  isActivitySliceClosed,
}: {
  block: AssistantTurnActivityBlock;
  isActivitySliceClosed: boolean;
}): VscodeActivityGroup[] {
  if (isActivitySliceClosed) {
    return [
      {
        id: block.id,
        kind: getActivityBlockKind(block),
        items: block.items,
        summary: block.summary,
        toolCount: block.toolCount,
        messageCount: block.messageCount,
        durationMs: block.durationMs,
      },
    ];
  }
  const groups: VscodeActivityGroup[] = [];
  let current: VscodeActivityGroup | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    groups.push(current);
    current = null;
  };

  block.items.forEach((item) => {
    const kind = getToolActivityKind(item);
    const canGroup =
      kind === "exec" ||
      kind === "patch" ||
      kind === "reasoning" ||
      kind === "pending-mcp-tool-calls" ||
      kind === "multi-agent-group" ||
      kind === "web-search-group";
    if (kind === "context-compaction") {
      flush();
      groups.push(buildActivityGroup(block.id, kind, [item]));
      return;
    }
    if (!canGroup) {
      flush();
      groups.push({
        id: `${block.id}:${item.id}`,
        kind,
        items: [item],
        summary: formatActivitySummary([item]),
        toolCount: item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0,
        messageCount: item.kind === "tool" || item.kind === "explore" ? 0 : 1,
        durationMs: item.kind === "tool" ? item.durationMs ?? null : null,
      });
      return;
    }
    const mcpGroupingKey = kind === "pending-mcp-tool-calls" ? getPendingMcpGroupingKey(item) : null;
    if (kind === "pending-mcp-tool-calls" && mcpGroupingKey == null) {
      flush();
      groups.push(buildActivityGroup(block.id, kind, [item]));
      return;
    }
    const currentMcpGroupingKey = current?.kind === "pending-mcp-tool-calls"
      ? getPendingMcpGroupingKey(current.items[0])
      : null;
    if (
      !current ||
      current.kind !== kind ||
      (kind === "pending-mcp-tool-calls" && currentMcpGroupingKey !== mcpGroupingKey)
    ) {
      flush();
      current = {
        id: `${block.id}:${kind}:${item.id}`,
        kind,
        items: [],
        summary: "",
        toolCount: 0,
        messageCount: 0,
        durationMs: null,
      };
    }
    current.items.push(item);
    current.summary = formatActivitySummary(current.items);
    current.toolCount += item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0;
    current.messageCount += item.kind === "tool" || item.kind === "explore" ? 0 : 1;
    if (item.kind === "tool" && typeof item.durationMs === "number") {
      current.durationMs = (current.durationMs ?? 0) + item.durationMs;
    }
  });
  flush();
  return groups;
}

function buildActivityGroup(
  blockId: string,
  kind: VscodeActivityKind,
  items: ToolGroupItem[],
): VscodeActivityGroup {
  return {
    id: `${blockId}:${kind}:${items[0]?.id ?? "item"}`,
    kind,
    items,
    summary: formatActivitySummary(items),
    toolCount: items.reduce(
      (total, item) => total + (item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0),
      0,
    ),
    messageCount: items.filter((item) => item.kind !== "tool" && item.kind !== "explore").length,
    durationMs: items.reduce<number | null>((total, item) => {
      if (item.kind !== "tool" || typeof item.durationMs !== "number") {
        return total;
      }
      return (total ?? 0) + item.durationMs;
    }, null),
  };
}

function getPendingMcpGroupingKey(item: ToolGroupItem) {
  if (item.kind === "userInput") {
    return "user-input";
  }
  if (item.kind !== "tool") {
    return null;
  }
  const detail = parseToolDetail(item.detail);
  const server = firstString(
    detail?.server,
    detail?.serverName,
    detail?.server_name,
    detail?.invocation && typeof detail.invocation === "object"
      ? (detail.invocation as Record<string, unknown>).server
      : undefined,
    item.toolType,
    item.title,
  ).toLowerCase();
  const tool = firstString(
    detail?.tool,
    detail?.toolName,
    detail?.tool_name,
    detail?.functionName,
    detail?.function_name,
    detail?.invocation && typeof detail.invocation === "object"
      ? (detail.invocation as Record<string, unknown>).tool
      : undefined,
    item.title,
  ).toLowerCase();

  if (server.includes("computer-use") || server.includes("computer_use")) {
    return null;
  }
  if (server.includes("node_repl") && (tool === "js" || tool === "js_reset" || tool.includes(" js"))) {
    return null;
  }
  if (item.mcpApp?.expanded) {
    return null;
  }
  if (item.mcpApp?.id) {
    return `app:${item.mcpApp.id}`;
  }
  return `server:${server || item.toolType || item.id}`;
}

function parseToolDetail(detail: string) {
  const cacheKey = detail;
  const cached = toolDetailParseCache.get(cacheKey);
  if (cached !== undefined || toolDetailParseCache.has(cacheKey)) {
    return cached;
  }
  if (!detail.trim()) {
    toolDetailParseCache.set(cacheKey, null);
    return null;
  }
  let result: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(detail) as unknown;
    result =
      parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : null;
  } catch {
    result = null;
  }
  if (toolDetailParseCache.size >= TOOL_DETAIL_PARSE_CACHE_LIMIT) {
    const oldestKey = toolDetailParseCache.keys().next().value;
    if (oldestKey !== undefined) {
      toolDetailParseCache.delete(oldestKey);
    }
  }
  toolDetailParseCache.set(cacheKey, result);
  return result;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function summarizeAssistantBlocks(blocks: AssistantTurnBlock[]) {
  const activityBlocks = blocks.filter(
    (block): block is AssistantTurnActivityBlock => block.kind === "activity",
  );
  const toolCount = activityBlocks.reduce((total, block) => total + block.toolCount, 0);
  const messageCount = activityBlocks.reduce((total, block) => total + block.messageCount, 0);
  const durationValues = activityBlocks
    .map((block) => block.durationMs)
    .filter((duration): duration is number => duration !== null);
  const durationMs =
    durationValues.length > 0
      ? durationValues.reduce((total, duration) => total + duration, 0)
      : null;
  return { toolCount, messageCount, durationMs };
}

function countActivityTools(items: ToolGroupItem[]) {
  return items.reduce(
    (total, item) => total + (item.kind === "tool" ? 1 : item.kind === "explore" ? item.entries.length : 0),
    0,
  );
}

function countActivityMessages(items: ToolGroupItem[]) {
  return items.filter((item) => item.kind !== "tool" && item.kind !== "explore").length;
}

function sumActivityDuration(items: ToolGroupItem[]) {
  return items.reduce<number | null>((total, item) => {
    if (item.kind !== "tool" || typeof item.durationMs !== "number") {
      return total;
    }
    return (total ?? 0) + item.durationMs;
  }, null);
}

function appendErrorOutput(existing: string | undefined, next: string | undefined) {
  if (!existing) {
    return next ?? "";
  }
  if (!next) {
    return existing;
  }
  return `${existing}\n${next}`;
}

function mergeConsecutiveCodexStderrItems(items: ToolGroupItem[]) {
  const merged: ToolGroupItem[] = [];
  items.forEach((item) => {
    const previous = merged[merged.length - 1];
    if (previous && isCodexStderrTranscriptItem(previous) && isCodexStderrTranscriptItem(item)) {
      merged[merged.length - 1] = {
        ...previous,
        status: item.status ?? previous.status,
        output: appendErrorOutput(previous.output, item.output),
      };
      return;
    }
    merged.push(item);
  });
  return merged;
}

function buildSplitToolGroupEntry(
  source: Extract<MessageListEntry, { kind: "toolGroup" }>["group"],
  items: ToolGroupItem[],
  partIndex: number,
): MessageListEntry {
  if (items.length === 1) {
    return { kind: "item", item: items[0] };
  }
  return {
    kind: "toolGroup",
    group: {
      ...source,
      id: partIndex === 0 ? source.id : `${source.id}:part-${partIndex}`,
      items,
      toolCount: countActivityTools(items),
      messageCount: countActivityMessages(items),
    },
  };
}

function splitToolGroupContextCompactions(
  entry: Extract<MessageListEntry, { kind: "toolGroup" }>,
) {
  const items = mergeConsecutiveCodexStderrItems(entry.group.items);
  if (!items.some(isContextCompactionItem)) {
    if (items === entry.group.items || items.length === entry.group.items.length) {
      return [entry];
    }
    return [buildSplitToolGroupEntry(entry.group, items, 0)];
  }
  const entries: MessageListEntry[] = [];
  let buffer: ToolGroupItem[] = [];
  let partIndex = 0;
  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    entries.push(buildSplitToolGroupEntry(entry.group, buffer, partIndex));
    partIndex += 1;
    buffer = [];
  };

  items.forEach((item) => {
    if (isContextCompactionItem(item)) {
      flushBuffer();
      entries.push({ kind: "item", item });
      return;
    }
    buffer.push(item);
  });
  flushBuffer();
  return entries;
}

function buildSplitActivityBlock(
  source: AssistantTurnActivityBlock,
  items: ToolGroupItem[],
  partIndex: number,
): AssistantTurnActivityBlock {
  return {
    ...source,
    id: partIndex === 0 ? source.id : `${source.id}:part-${partIndex}`,
    summary: formatActivitySummary(items),
    items,
    toolCount: countActivityTools(items),
    messageCount: countActivityMessages(items),
    durationMs: sumActivityDuration(items),
  };
}

function buildSplitAssistantTurnEntry(
  turn: AssistantTurn,
  blocks: AssistantTurnBlock[],
  partIndex: number,
): MessageListEntry {
  const summary = summarizeAssistantBlocks(blocks);
  return {
    kind: "assistantTurn",
    turn: {
      ...turn,
      id: partIndex === 0 ? turn.id : `${turn.id}:part-${partIndex}`,
      blocks,
      ...summary,
    },
  };
}

function splitAssistantTurnContextCompactions(
  entry: Extract<MessageListEntry, { kind: "assistantTurn" }>,
) {
  const hasContextCompaction = entry.turn.blocks.some(
    (block) => block.kind === "activity" && block.items.some(isContextCompactionItem),
  );
  if (!hasContextCompaction) {
    return [entry];
  }

  const entries: MessageListEntry[] = [];
  let blockBuffer: AssistantTurnBlock[] = [];
  let turnPartIndex = 0;
  const flushBlocks = () => {
    if (blockBuffer.length === 0) {
      return;
    }
    entries.push(buildSplitAssistantTurnEntry(entry.turn, blockBuffer, turnPartIndex));
    turnPartIndex += 1;
    blockBuffer = [];
  };

  entry.turn.blocks.forEach((block) => {
    if (block.kind !== "activity") {
      blockBuffer.push(block);
      return;
    }

    let itemBuffer: ToolGroupItem[] = [];
    let activityPartIndex = 0;
    const flushActivity = () => {
      if (itemBuffer.length === 0) {
        return;
      }
      blockBuffer.push(buildSplitActivityBlock(block, itemBuffer, activityPartIndex));
      activityPartIndex += 1;
      itemBuffer = [];
    };

    mergeConsecutiveCodexStderrItems(block.items).forEach((item) => {
      if (isContextCompactionItem(item)) {
        flushActivity();
        flushBlocks();
        entries.push({ kind: "item", item });
        return;
      }
      itemBuffer.push(item);
    });
    flushActivity();
  });
  flushBlocks();
  return entries;
}

function splitContextCompactionEntries(entries: MessageListEntry[]) {
  return entries.flatMap((entry): MessageListEntry[] => {
    if (entry.kind === "toolGroup") {
      return splitToolGroupContextCompactions(entry);
    }
    if (entry.kind === "assistantTurn") {
      return splitAssistantTurnContextCompactions(entry);
    }
    return [entry];
  });
}

export function mergeAssistantAgentEntries(entries: MessageListEntry[]): MessageListEntry[] {
  const merged: MessageListEntry[] = [];
  let assistantBuffer: AssistantTurn | null = null;

  const flushAssistantBuffer = () => {
    if (!assistantBuffer) {
      return;
    }
    const summary = summarizeAssistantBlocks(assistantBuffer.blocks);
    merged.push({
      kind: "assistantTurn",
      turn: {
        ...assistantBuffer,
        ...summary,
      },
    });
    assistantBuffer = null;
  };

  const appendAssistantBlocks = (id: string, blocks: AssistantTurnBlock[]) => {
    if (!assistantBuffer) {
      assistantBuffer = {
        id,
        blocks: [],
        toolCount: 0,
        messageCount: 0,
        durationMs: null,
      };
    } else {
      assistantBuffer.id = `${assistantBuffer.id}-${id}`;
    }
    assistantBuffer.blocks.push(...blocks);
  };

  entries.forEach((entry) => {
    if (entry.kind === "assistantTurn") {
      appendAssistantBlocks(entry.turn.id, entry.turn.blocks);
      return;
    }
    if (
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "user" &&
      entry.item.itemType === "user-message" &&
      entry.item.steeringStatus != null
    ) {
      appendAssistantBlocks(`steering-${entry.item.id}`, [
        { kind: "message", message: entry.item },
      ]);
      return;
    }
    if (
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "assistant"
    ) {
      const turnBlockId = entry.item.id.startsWith("assistant-turn-")
        ? entry.item.id
        : `assistant-turn-${entry.item.id}`;
      appendAssistantBlocks(turnBlockId, [
        { kind: "message", message: entry.item },
      ]);
      return;
    }
    flushAssistantBuffer();
    merged.push(entry);
  });

  flushAssistantBuffer();
  return merged;
}

export function buildVscodeViewModelFromEntries(
  entries: MessageListEntry[],
): VscodeMessagesViewModel {
  const compatEntries = splitContextCompactionEntries(entries);
  const turns = buildVscodeConversationTurns(compatEntries).map((turn, turnIndex) => {
    const assistantTurnSearchKey = getVscodeAssistantTurnSearchKey(turn.agentEntries);
    const renderedAgentEntries = mergeAssistantAgentEntries(turn.agentEntries).map(
      (entry, index) => {
        const searchUnitKey = getVscodeEntrySearchUnitKey(turn.id, entry, index);
        return {
          id: searchUnitKey,
          entry,
          searchUnitKey,
          searchUnitKind: getVscodeEntrySearchUnitKind(entry, getActivityBlockKind),
          scrollToKey: searchUnitKey,
        };
      },
    );
    return {
      ...turn,
      turnIndex,
      assistantTurnSearchKey,
      userSearchUnitKey: turn.userEntry ? `${turn.id}:message` : undefined,
      renderedAgentEntries,
    };
  });
  return { turns, entries: compatEntries };
}

export function buildVscodeMessagesViewModel(
  items: ConversationItem[],
): VscodeMessagesViewModel {
  const transcriptItems = items.filter((item) => !isCodexStderrTranscriptItem(item));
  return buildVscodeViewModelFromEntries(buildMessageEntries(transcriptItems));
}
