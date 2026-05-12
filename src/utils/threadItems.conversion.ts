import type { ConversationItem } from "../types";
import type { OpenAIConversationItemType } from "../types";
import { parseCollabToolCallItem } from "./threadItems.collab";
import { asNumber, asString } from "./threadItems.shared";

const OPENAI_ITEM_TYPE_BY_PROTOCOL_TYPE = new Map<string, OpenAIConversationItemType>([
  ["agentMessage", "assistant-message"],
  ["assistantMessage", "assistant-message"],
  ["assistant-message", "assistant-message"],
  ["autoReviewInterruptionWarning", "auto-review-interruption-warning"],
  ["auto-review-interruption-warning", "auto-review-interruption-warning"],
  ["automationUpdate", "automation-update"],
  ["automation-update", "automation-update"],
  ["automaticApprovalReview", "automatic-approval-review"],
  ["automatic-approval-review", "automatic-approval-review"],
  ["commandExecution", "exec"],
  ["exec", "exec"],
  ["contextCompaction", "context-compaction"],
  ["context-compaction", "context-compaction"],
  ["dynamicToolCall", "dynamic-tool-call"],
  ["dynamic-tool-call", "dynamic-tool-call"],
  ["fileChange", "patch"],
  ["patch", "patch"],
  ["forkedFromConversation", "forked-from-conversation"],
  ["forked-from-conversation", "forked-from-conversation"],
  ["generatedImage", "generated-image"],
  ["generated-image", "generated-image"],
  ["hook", "hook"],
  ["mcpServerElicitation", "mcp-server-elicitation"],
  ["mcp-server-elicitation", "mcp-server-elicitation"],
  ["mcpToolCall", "mcp-tool-call"],
  ["mcp-tool-call", "mcp-tool-call"],
  ["modelChanged", "model-changed"],
  ["model-changed", "model-changed"],
  ["modelRerouted", "model-rerouted"],
  ["model-rerouted", "model-rerouted"],
  ["multiAgentAction", "multi-agent-action"],
  ["multi-agent-action", "multi-agent-action"],
  ["permissionRequest", "permission-request"],
  ["permission-request", "permission-request"],
  ["personalityChanged", "personality-changed"],
  ["personality-changed", "personality-changed"],
  ["planImplementation", "plan-implementation"],
  ["plan-implementation", "plan-implementation"],
  ["proposedPlan", "proposed-plan"],
  ["proposed-plan", "proposed-plan"],
  ["reasoning", "reasoning"],
  ["remoteTaskCreated", "remote-task-created"],
  ["remote-task-created", "remote-task-created"],
  ["steered", "steered"],
  ["streamError", "stream-error"],
  ["stream-error", "stream-error"],
  ["systemError", "system-error"],
  ["system-error", "system-error"],
  ["todoList", "todo-list"],
  ["todo-list", "todo-list"],
  ["turnDiff", "turn-diff"],
  ["turn-diff", "turn-diff"],
  ["userInputResponse", "user-input-response"],
  ["user-input-response", "user-input-response"],
  ["userMessage", "user-message"],
  ["user-message", "user-message"],
  ["userInput", "userInput"],
  ["webSearch", "web-search"],
  ["web-search", "web-search"],
  ["workedFor", "worked-for"],
  ["worked-for", "worked-for"],
]);

const GENERIC_OPENAI_TOOL_ITEM_TYPES = new Set<OpenAIConversationItemType>([
  "auto-review-interruption-warning",
  "automation-update",
  "automatic-approval-review",
  "dynamic-tool-call",
  "forked-from-conversation",
  "generated-image",
  "hook",
  "mcp-server-elicitation",
  "model-changed",
  "model-rerouted",
  "multi-agent-action",
  "permission-request",
  "personality-changed",
  "plan-implementation",
  "proposed-plan",
  "remote-task-created",
  "steered",
  "stream-error",
  "system-error",
  "todo-list",
  "turn-diff",
  "user-input-response",
  "worked-for",
]);

function normalizeOpenAIItemType(type: string) {
  return OPENAI_ITEM_TYPE_BY_PROTOCOL_TYPE.get(type) ?? null;
}

function openAIItemTitle(itemType: OpenAIConversationItemType) {
  switch (itemType) {
    case "auto-review-interruption-warning":
      return "Auto-review interruption warning";
    case "automation-update":
      return "Automation update";
    case "automatic-approval-review":
      return "Automatic approval review";
    case "dynamic-tool-call":
      return "Dynamic tool call";
    case "forked-from-conversation":
      return "Forked from conversation";
    case "generated-image":
      return "Generated image";
    case "hook":
      return "Hook";
    case "mcp-server-elicitation":
      return "MCP server requested input";
    case "model-changed":
      return "Model changed";
    case "model-rerouted":
      return "Model rerouted";
    case "multi-agent-action":
      return "Multi-agent action";
    case "permission-request":
      return "Permission request";
    case "personality-changed":
      return "Personality changed";
    case "plan-implementation":
      return "Plan implementation";
    case "proposed-plan":
      return "Proposed plan";
    case "remote-task-created":
      return "Remote task created";
    case "steered":
      return "Steered";
    case "stream-error":
      return "Stream error";
    case "system-error":
      return "System error";
    case "todo-list":
      return "Todo list";
    case "turn-diff":
      return "Turn diff";
    case "user-input-response":
      return "User input response";
    case "worked-for":
      return "Worked for";
    default:
      return itemType;
  }
}

function extractOpenAIDetail(item: Record<string, unknown>) {
  const value =
    asString(item.detail ?? "") ||
    asString(item.message ?? "") ||
    asString(item.text ?? "") ||
    asString(item.name ?? "") ||
    asString(item.status ?? "") ||
    asString(item.summary ?? "");
  return value.trim();
}

function extractOpenAIOutput(item: Record<string, unknown>) {
  return (
    asString(item.output ?? "") ||
    asString(item.result ?? "") ||
    asString(item.error ?? "") ||
    asString(item.content ?? "")
  );
}

function extractGeneratedImage(item: Record<string, unknown>) {
  return (
    asString(item.src ?? "") ||
    asString(item.url ?? "") ||
    asString(item.path ?? "") ||
    asString(item.image ?? "") ||
    asString(item.generatedImage ?? "")
  ).trim();
}

function buildGenericOpenAIActivityItem(
  item: Record<string, unknown>,
  itemType: OpenAIConversationItemType,
): ConversationItem {
  const title = asString(item.title ?? "") || openAIItemTitle(itemType);
  const detail = extractOpenAIDetail(item);
  const status = asString(item.status ?? "");
  const generatedImage =
    itemType === "generated-image" ? extractGeneratedImage(item) || null : null;
  const mcpAppId =
    itemType === "mcp-server-elicitation" || itemType === "mcp-tool-call"
      ? asString(item.mcpAppId ?? item.appId ?? item.server ?? item.id)
      : "";
  return {
    id: asString(item.id),
    kind: "tool",
    toolType: itemType,
    itemType,
    title,
    detail,
    status,
    output: extractOpenAIOutput(item),
    generatedImage,
    mcpApp: mcpAppId
      ? {
          id: mcpAppId,
          title: asString(item.mcpAppTitle ?? item.server ?? item.title ?? "") || undefined,
          expanded: Boolean(item.expanded),
          url: asString(item.url ?? "") || null,
        }
      : null,
  };
}

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.path ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const images: string[] = [];
  inputs.forEach((input) => {
    const type = asString(input.type);
    if (type === "text") {
      const text = asString(input.text);
      if (text) {
        textParts.push(text);
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      if (name) {
        textParts.push(`$${name}`);
      }
      return;
    }
    if (type === "image" || type === "localImage") {
      const value = extractImageInputValue(input);
      if (value) {
        images.push(value);
      }
    }
  });
  return { text: textParts.join(" ").trim(), images };
}

export function buildConversationItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  const openAIItemType = normalizeOpenAIItemType(type);
  if (type === "agentMessage" || type === "assistantMessage" || type === "assistant-message") {
    const text = asString(item.text ?? item.content ?? "");
    return text
      ? {
          id,
          kind: "message",
          role: "assistant",
          text,
          itemType: "assistant-message",
        }
      : null;
  }
  if (type === "userMessage" || type === "user-message") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text: text || asString(item.text ?? ""),
      itemType: "user-message",
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "reasoning") {
    const summary = asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      itemType: openAIItemType === "proposed-plan" ? "proposed-plan" : undefined,
      title: "Plan",
      detail: asString(item.status ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.text ?? ""),
    };
  }
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map((part) => asString(part)).join(" ")
      : asString(item.command ?? "");
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "exec",
      title: command ? `Command: ${command}` : "Command",
      detail: asString(item.cwd ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.aggregatedOutput ?? ""),
      durationMs,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const normalizedChanges = changes
      .map((change) => {
        const path = asString(change?.path ?? "");
        const kind = change?.kind as Record<string, unknown> | string | undefined;
        const kindType =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind
              ? asString((kind as Record<string, unknown>).type ?? "")
              : "";
        const normalizedKind = kindType ? kindType.toLowerCase() : "";
        const diff = asString(change?.diff ?? "");
        return { path, kind: normalizedKind || undefined, diff: diff || undefined };
      })
      .filter((change) => change.path);
    const formattedChanges = normalizedChanges
      .map((change) => {
        const prefix =
          change.kind === "add"
            ? "A"
            : change.kind === "delete"
              ? "D"
              : change.kind
                ? "M"
                : "";
        return [prefix, change.path].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const paths = formattedChanges.join(", ");
    const diffOutput = normalizedChanges
      .map((change) => change.diff ?? "")
      .filter(Boolean)
      .join("\n\n");
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "patch",
      title: "File changes",
      detail: paths || "Pending changes",
      status: asString(item.status ?? ""),
      output: diffOutput,
      changes: normalizedChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "mcp-tool-call",
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output: asString(item.result ?? item.error ?? ""),
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    return parseCollabToolCallItem(item);
  }
  if (type === "webSearch") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "web-search",
      title: "Web search",
      detail: asString(item.query ?? ""),
      status: status || "completed",
      output: "",
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "contextCompaction") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "context-compaction",
      title: "Context compaction",
      detail: "Compacting conversation context to fit token limits.",
      status: status || "completed",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  if (openAIItemType && GENERIC_OPENAI_TOOL_ITEM_TYPES.has(openAIItemType)) {
    return buildGenericOpenAIActivityItem(item, openAIItemType);
  }
  return null;
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage" || type === "user-message") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text: text || asString(item.text ?? ""),
      itemType: "user-message",
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "agentMessage" || type === "assistantMessage" || type === "assistant-message") {
    return {
      id,
      kind: "message",
      role: "assistant",
      text: asString(item.text),
      itemType: "assistant-message",
    };
  }
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.map((entry) => asString(entry)).join("\n")
      : asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const converted = buildConversationItemFromThreadItem(item);
      if (converted) {
        items.push(converted);
      }
    });
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}
