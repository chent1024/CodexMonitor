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
  ["autoApprovalReview", "automatic-approval-review"],
  ["auto-approval-review", "automatic-approval-review"],
  ["automaticApprovalReview", "automatic-approval-review"],
  ["automatic-approval-review", "automatic-approval-review"],
  ["commandExecution", "exec"],
  ["exec", "exec"],
  ["contextCompaction", "context-compaction"],
  ["context-compaction", "context-compaction"],
  ["context_compaction", "context-compaction"],
  ["compaction", "context-compaction"],
  ["dynamicToolCall", "dynamic-tool-call"],
  ["dynamic-tool-call", "dynamic-tool-call"],
  ["fileChange", "patch"],
  ["patch", "patch"],
  ["forkedFromConversation", "forked-from-conversation"],
  ["forked-from-conversation", "forked-from-conversation"],
  ["generatedImage", "generated-image"],
  ["generated-image", "generated-image"],
  ["imageGeneration", "generated-image"],
  ["image-generation", "generated-image"],
  ["image_generation", "generated-image"],
  ["imageGenerationCall", "generated-image"],
  ["image-generation-call", "generated-image"],
  ["hook", "hook"],
  ["mcpServerElicitation", "mcp-server-elicitation"],
  ["mcp-server-elicitation", "mcp-server-elicitation"],
  ["mcpToolCall", "mcp-tool-call"],
  ["mcp-tool-call", "mcp-tool-call"],
  ["modelChanged", "model-changed"],
  ["model-changed", "model-changed"],
  ["model_change", "model-changed"],
  ["modelChange", "model-changed"],
  ["modelRerouted", "model-rerouted"],
  ["model-rerouted", "model-rerouted"],
  ["modelReroute", "model-rerouted"],
  ["model_rerouted", "model-rerouted"],
  ["model_reroute", "model-rerouted"],
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

type FunctionCallRecord = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  itemIndex: number | null;
  sessionId: string;
};

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

function extractMessageStatus(item: Record<string, unknown>) {
  const status = asString(
    item.messageStatus ??
      item.message_status ??
      item.statusText ??
      item.status_text ??
      "",
  ).trim();
  return status || null;
}

function extractSteeringStatus(item: Record<string, unknown>) {
  const steering =
    item.steering && typeof item.steering === "object" && !Array.isArray(item.steering)
      ? (item.steering as Record<string, unknown>)
      : {};
  const status = asString(
    item.steeringStatus ??
      item.steering_status ??
      steering.status ??
      steering.statusText ??
      steering.status_text ??
      "",
  ).trim();
  return status || null;
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

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = asString(value);
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function unwrapResponseItem(item: Record<string, unknown>) {
  if (asString(item.type) !== "response_item") {
    return item;
  }
  const payload = item.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : item;
}

function extractMessageContentText(content: unknown) {
  if (!Array.isArray(content)) {
    return asString(content);
  }
  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return asString(entry);
      }
      const record = entry as Record<string, unknown>;
      return asString(record.text ?? record.content ?? record.value ?? "");
    })
    .filter(Boolean)
    .join("\n");
}

function parseFunctionCallArguments(item: Record<string, unknown>) {
  return parseJsonObject(item.arguments ?? item.args ?? item.parameters ?? {});
}

function getFunctionCallId(item: Record<string, unknown>) {
  return asString(item.call_id ?? item.callId ?? item.id);
}

function getFunctionCallSessionId(args: Record<string, unknown>) {
  const value = args.session_id ?? args.sessionId;
  return asString(value).trim();
}

function extractSessionIdFromToolOutput(output: string) {
  return output.match(/session ID\s+([0-9]+)/i)?.[1] ?? "";
}

function extractToolOutputBody(output: string) {
  const parsedOutput = parseJsonObject(output);
  const parsedBody = asString(parsedOutput.output ?? "");
  if (parsedBody) {
    return parsedBody;
  }
  const marker = "\nOutput:\n";
  const markerIndex = output.indexOf(marker);
  if (markerIndex < 0) {
    return output;
  }
  return output.slice(markerIndex + marker.length);
}

function durationMsFromToolOutput(output: string) {
  const match = output.match(/Wall time:\s*([0-9.]+)\s*seconds/i);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function statusFromToolOutput(output: string) {
  const parsedOutput = parseJsonObject(output);
  const metadata =
    parsedOutput.metadata && typeof parsedOutput.metadata === "object"
      ? (parsedOutput.metadata as Record<string, unknown>)
      : {};
  const parsedExitCode = asNumber(metadata.exit_code ?? metadata.exitCode);
  if (parsedExitCode !== null) {
    return parsedExitCode === 0 ? "completed" : "failed";
  }
  const exitMatch = output.match(/Process exited with code\s+(-?\d+)/i);
  if (exitMatch) {
    return Number(exitMatch[1]) === 0 ? "completed" : "failed";
  }
  if (/Process running with session ID/i.test(output)) {
    return "inProgress";
  }
  return output.trim() ? "completed" : "";
}

function mergeToolOutput(
  item: ConversationItem,
  output: string,
): ConversationItem {
  if (item.kind !== "tool") {
    return item;
  }
  const body = extractToolOutputBody(output);
  const nextOutput = [item.output ?? "", body].filter(Boolean).join("\n");
  const durationMs = durationMsFromToolOutput(output);
  const status = statusFromToolOutput(output) || item.status;
  return {
    ...item,
    status,
    output: nextOutput,
    durationMs:
      durationMs === null
        ? item.durationMs
        : (item.durationMs ?? 0) + durationMs,
  };
}

function buildFunctionCallItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const callId = getFunctionCallId(item);
  const name = asString(item.name ?? item.toolName ?? "").trim();
  if (!callId || !name) {
    return null;
  }
  const args =
    name === "apply_patch" && !item.arguments && item.input
      ? { input: asString(item.input) }
      : parseFunctionCallArguments(item);
  if (name === "exec_command" || name === "exec") {
    const command = asString(args.cmd ?? args.command ?? "").trim();
    return {
      id: callId,
      kind: "tool",
      toolType: "commandExecution",
      itemType: "exec",
      title: command ? `Command: ${command}` : "Command",
      detail: asString(args.workdir ?? args.cwd ?? "").trim(),
      status: asString(item.status ?? "") || "inProgress",
      output: "",
    };
  }
  if (name === "apply_patch") {
    return {
      id: callId,
      kind: "tool",
      toolType: "fileChange",
      itemType: "patch",
      title: "File changes",
      detail: "Patch",
      status: asString(item.status ?? "") || "inProgress",
      output: asString(args.input ?? args.patch ?? ""),
    };
  }
  if (name === "update_plan") {
    const plan = args.plan ?? args;
    const output = Array.isArray(plan)
      ? plan
          .map((entry) => {
            const record = entry as Record<string, unknown>;
            const status = asString(record.status ?? "").trim();
            const step = asString(record.step ?? "").trim();
            return [status, step].filter(Boolean).join(": ");
          })
          .filter(Boolean)
          .join("\n")
      : JSON.stringify(plan, null, 2);
    return {
      id: callId,
      kind: "tool",
      toolType: "plan",
      itemType: "plan-implementation",
      title: "Plan",
      detail: asString(item.status ?? "") || "Updating plan",
      status: asString(item.status ?? "") || "completed",
      output,
    };
  }
  if (name === "view_image") {
    const path = asString(args.path ?? args.image ?? args.url ?? "").trim();
    return {
      id: callId,
      kind: "tool",
      toolType: "imageView",
      title: "Image view",
      detail: path,
      status: asString(item.status ?? "") || "completed",
      output: "",
      generatedImage: path || null,
    };
  }
  if (name === "request_user_input") {
    return buildRequestUserInputCallItem(item);
  }
  if (name === "write_stdin" || name === "wait") {
    return null;
  }
  return {
    id: callId,
    kind: "tool",
    toolType: "dynamicToolCall",
    itemType: "dynamic-tool-call",
    title: `Tool: ${name}`,
    detail: Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : "",
    status: asString(item.status ?? "") || "inProgress",
    output: "",
  };
}

function buildCustomToolCallItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const normalized = {
    ...item,
    type: "function_call",
    arguments: item.arguments ?? (item.input ? JSON.stringify({ input: item.input }) : undefined),
  };
  return buildFunctionCallItem(normalized);
}

function buildFunctionCallOutputItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const callId = getFunctionCallId(item);
  if (!callId) {
    return null;
  }
  const output = asString(item.output ?? "");
  return {
    id: callId,
    kind: "tool",
    toolType: "dynamicToolCall",
    itemType: "dynamic-tool-call",
    title: "Tool output",
    detail: "",
    status: statusFromToolOutput(output) || "completed",
    output: extractToolOutputBody(output),
    durationMs: durationMsFromToolOutput(output),
  };
}

function buildWebSearchCallItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const id = asString(item.id ?? item.call_id ?? item.callId);
  if (!id) {
    return null;
  }
  const action =
    item.action && typeof item.action === "object"
      ? (item.action as Record<string, unknown>)
      : {};
  const actionType = asString(action.type ?? "").trim();
  const query = asString(action.query ?? "");
  const queries = Array.isArray(action.queries)
    ? action.queries.map((entry) => asString(entry)).filter(Boolean)
    : [];
  const url = asString(action.url ?? "");
  const pattern = asString(action.pattern ?? "");
  const detail =
    query ||
    queries.join("\n") ||
    url ||
    pattern ||
    (actionType ? `Web ${actionType.replace(/_/g, " ")}` : "");
  return {
    id,
    kind: "tool",
    toolType: "webSearch",
    itemType: "web-search",
    title: "Web search",
    detail,
    status: asString(item.status ?? "") || "completed",
    output: "",
  };
}

function buildImageGenerationCallItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const id = asString(item.id ?? item.call_id ?? item.callId);
  if (!id) {
    return null;
  }
  const result = asString(item.result ?? item.image ?? item.url ?? "").trim();
  const generatedImage =
    result && !result.startsWith("data:") && !result.startsWith("http")
      ? `data:image/png;base64,${result}`
      : result || null;
  return {
    id,
    kind: "tool",
    toolType: "generatedImage",
    itemType: "generated-image",
    title: "Generated image",
    detail: asString(item.revised_prompt ?? item.prompt ?? ""),
    status: asString(item.status ?? "") || (generatedImage ? "completed" : "inProgress"),
    output: asString(item.revised_prompt ?? item.prompt ?? ""),
    generatedImage,
  };
}

function buildRequestUserInputCallItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const callId = getFunctionCallId(item);
  if (!callId) {
    return null;
  }
  const args = parseFunctionCallArguments(item);
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const detail = questions
    .map((entry, index) => {
      const question = entry as Record<string, unknown>;
      const label =
        asString(question.question ?? "").trim() ||
        asString(question.header ?? "").trim() ||
        `Question ${index + 1}`;
      const options = Array.isArray(question.options)
        ? question.options
            .map((option) => asString((option as Record<string, unknown>).label ?? "").trim())
            .filter(Boolean)
            .join(", ")
        : "";
      return options ? `${label}\nOptions: ${options}` : label;
    })
    .filter(Boolean)
    .join("\n\n");
  return {
    id: callId,
    kind: "tool",
    toolType: "requestUserInput",
    itemType: "userInput",
    title: "User input requested",
    detail,
    status: asString(item.status ?? "") || "completed",
    output: "",
  };
}

function extractGeneratedImage(item: Record<string, unknown>) {
  return (
    asString(item.src ?? "") ||
    asString(item.url ?? "") ||
    asString(item.path ?? "") ||
    asString(item.image ?? "") ||
    asString(item.generatedImage ?? "") ||
    asString(item.result ?? "") ||
    asString(item.savedPath ?? "") ||
    asString(item.saved_path ?? "")
  ).trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractMcpAppDescriptor(item: Record<string, unknown>) {
  const descriptor =
    asRecord(item.mcpApp) ??
    asRecord(item.mcp_app) ??
    asRecord(item.app) ??
    asRecord(item.frame) ??
    asRecord(item.resource) ??
    {};
  const id = (
    asString(descriptor.id ?? "") ||
    asString(descriptor.appId ?? descriptor.app_id ?? "") ||
    asString(descriptor.resourceUri ?? descriptor.resource_uri ?? "") ||
    asString(item.mcpAppId ?? item.mcp_app_id ?? "") ||
    asString(item.appId ?? item.app_id ?? "") ||
    asString(item.resourceUri ?? item.resource_uri ?? "") ||
    asString(item.url ?? item.mcpAppUrl ?? item.mcp_app_url ?? "")
  ).trim();
  const url = (
    asString(descriptor.url ?? "") ||
    asString(descriptor.resourceUri ?? descriptor.resource_uri ?? "") ||
    asString(item.url ?? "") ||
    asString(item.resourceUri ?? item.resource_uri ?? "") ||
    asString(item.mcpAppUrl ?? item.mcp_app_url ?? "")
  ).trim();
  if (!id && !url) {
    return null;
  }
  return {
    id: id || url,
    title:
      asString(descriptor.title ?? descriptor.name ?? "") ||
      asString(item.mcpAppTitle ?? item.mcp_app_title ?? item.appTitle ?? item.app_title ?? "") ||
      asString(item.server ?? item.title ?? "") ||
      undefined,
    expanded: Boolean(descriptor.expanded ?? item.expanded),
    url: url || null,
  };
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
  const mcpApp =
    itemType === "mcp-server-elicitation" || itemType === "mcp-tool-call"
      ? extractMcpAppDescriptor(item)
      : null;
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
    mcpApp,
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
  const normalizedItem = unwrapResponseItem(item);
  const type = asString(normalizedItem.type);
  const id = asString(normalizedItem.id ?? normalizedItem.call_id ?? normalizedItem.callId);
  if (!id || !type) {
    return null;
  }
  const openAIItemType = normalizeOpenAIItemType(type);
  if (type === "message") {
    const role = asString(normalizedItem.role);
    if (role === "assistant") {
      const text = extractMessageContentText(normalizedItem.content ?? normalizedItem.text ?? "");
      return text
        ? {
            id,
            kind: "message",
            role: "assistant",
            text,
            itemType: "assistant-message",
            messageStatus: extractMessageStatus(normalizedItem),
          }
        : null;
    }
    if (role === "user") {
      return {
        id,
        kind: "message",
        role: "user",
        text: extractMessageContentText(normalizedItem.content ?? normalizedItem.text ?? ""),
        itemType: "user-message",
        messageStatus: extractMessageStatus(normalizedItem),
        steeringStatus: extractSteeringStatus(normalizedItem),
      };
    }
    return null;
  }
  if (type === "function_call") {
    return buildFunctionCallItem(normalizedItem);
  }
  if (type === "function_call_output") {
    return buildFunctionCallOutputItem(normalizedItem);
  }
  if (type === "custom_tool_call") {
    return buildCustomToolCallItem(normalizedItem);
  }
  if (type === "custom_tool_call_output") {
    return buildFunctionCallOutputItem(normalizedItem);
  }
  if (type === "web_search_call") {
    return buildWebSearchCallItem(normalizedItem);
  }
  if (type === "image_generation_call") {
    return buildImageGenerationCallItem(normalizedItem);
  }
  if (type === "agentMessage" || type === "assistantMessage" || type === "assistant-message") {
    const text = asString(normalizedItem.text ?? normalizedItem.content ?? "");
    return text
      ? {
          id,
          kind: "message",
          role: "assistant",
          text,
          itemType: "assistant-message",
          messageStatus: extractMessageStatus(normalizedItem),
        }
      : null;
  }
  if (type === "userMessage" || type === "user-message") {
    const content = Array.isArray(normalizedItem.content) ? normalizedItem.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text: text || asString(normalizedItem.text ?? ""),
      itemType: "user-message",
      images: images.length > 0 ? images : undefined,
      messageStatus: extractMessageStatus(normalizedItem),
      steeringStatus: extractSteeringStatus(normalizedItem),
    };
  }
  if (type === "reasoning") {
    const summary = asString(normalizedItem.summary ?? "");
    const content = Array.isArray(normalizedItem.content)
      ? normalizedItem.content.map((entry) => asString(entry)).join("\n")
      : asString(normalizedItem.content ?? "");
    const durationMs = asNumber(
      normalizedItem.durationMs ??
      normalizedItem.duration_ms ??
      normalizedItem.elapsedMs ??
      normalizedItem.elapsed_ms,
    );
    return summary.trim() || content.trim()
      ? {
          id,
          kind: "reasoning",
          summary,
          content,
          status: asString(normalizedItem.status ?? "") || null,
          durationMs,
        }
      : null;
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      itemType: openAIItemType === "proposed-plan" ? "proposed-plan" : undefined,
      title: "Plan",
      detail: asString(normalizedItem.status ?? ""),
      status: asString(normalizedItem.status ?? ""),
      output: asString(normalizedItem.text ?? ""),
    };
  }
  if (type === "commandExecution") {
    const command = Array.isArray(normalizedItem.command)
      ? normalizedItem.command.map((part) => asString(part)).join(" ")
      : asString(normalizedItem.command ?? "");
    const durationMs = asNumber(normalizedItem.durationMs ?? normalizedItem.duration_ms);
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "exec",
      title: command ? `Command: ${command}` : "Command",
      detail: asString(normalizedItem.cwd ?? ""),
      status: asString(normalizedItem.status ?? ""),
      output: asString(normalizedItem.aggregatedOutput ?? ""),
      durationMs,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(normalizedItem.changes) ? normalizedItem.changes : [];
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
      status: asString(normalizedItem.status ?? ""),
      output: diffOutput,
      changes: normalizedChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(normalizedItem.server ?? "");
    const tool = asString(normalizedItem.tool ?? "");
    const args = normalizedItem.arguments ? JSON.stringify(normalizedItem.arguments, null, 2) : "";
    const mcpApp = extractMcpAppDescriptor(normalizedItem);
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "mcp-tool-call",
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(normalizedItem.status ?? ""),
      output: asString(normalizedItem.result ?? normalizedItem.error ?? ""),
      mcpApp,
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    return parseCollabToolCallItem(normalizedItem);
  }
  if (type === "webSearch") {
    const status = asString(normalizedItem.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      itemType: "web-search",
      title: "Web search",
      detail: asString(normalizedItem.query ?? ""),
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
      detail: asString(normalizedItem.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (openAIItemType === "context-compaction") {
    const status = asString(normalizedItem.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: "contextCompaction",
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
      text: asString(normalizedItem.review ?? ""),
    };
  }
  if (openAIItemType && GENERIC_OPENAI_TOOL_ITEM_TYPES.has(openAIItemType)) {
    return buildGenericOpenAIActivityItem(normalizedItem, openAIItemType);
  }
  return null;
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const normalizedItem = unwrapResponseItem(item);
  const type = asString(normalizedItem.type);
  const id = asString(normalizedItem.id ?? normalizedItem.call_id ?? normalizedItem.callId);
  if (!id || !type) {
    return null;
  }
  if (type === "message") {
    return buildConversationItem(normalizedItem);
  }
  if (type === "userMessage" || type === "user-message") {
    const content = Array.isArray(normalizedItem.content) ? normalizedItem.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text: text || asString(normalizedItem.text ?? ""),
      itemType: "user-message",
      images: images.length > 0 ? images : undefined,
      messageStatus: extractMessageStatus(normalizedItem),
      steeringStatus: extractSteeringStatus(normalizedItem),
    };
  }
  if (type === "agentMessage" || type === "assistantMessage" || type === "assistant-message") {
    return {
      id,
      kind: "message",
      role: "assistant",
      text: asString(normalizedItem.text),
      itemType: "assistant-message",
      messageStatus: extractMessageStatus(normalizedItem),
    };
  }
  if (type === "reasoning") {
    const summary = Array.isArray(normalizedItem.summary)
      ? normalizedItem.summary.map((entry) => asString(entry)).join("\n")
      : asString(normalizedItem.summary ?? "");
    const content = Array.isArray(normalizedItem.content)
      ? normalizedItem.content.map((entry) => asString(entry)).join("\n")
      : asString(normalizedItem.content ?? "");
    const durationMs = asNumber(
      normalizedItem.durationMs ??
      normalizedItem.duration_ms ??
      normalizedItem.elapsedMs ??
      normalizedItem.elapsed_ms,
    );
    return summary.trim() || content.trim()
      ? {
          id,
          kind: "reasoning",
          summary,
          content,
          status: asString(normalizedItem.status ?? "") || null,
          durationMs,
        }
      : null;
  }
  return buildConversationItem(normalizedItem);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  const callsById = new Map<string, FunctionCallRecord>();
  const commandIndexBySessionId = new Map<string, number>();
  turns.forEach((turn, turnIndex) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item, itemIndex) => {
      const rawItem = unwrapResponseItem(item);
      const type = asString(rawItem.type);
      const syntheticId = `thread-item-${turnIndex}-${itemIndex}`;
      const itemWithId: Record<string, unknown> = {
        ...rawItem,
        id: asString(rawItem.id ?? rawItem.call_id ?? rawItem.callId) || syntheticId,
      };
      if (type === "function_call" || type === "custom_tool_call") {
        const callId = getFunctionCallId(itemWithId);
        const name = asString(itemWithId.name ?? itemWithId.toolName ?? "").trim();
        const args =
          type === "custom_tool_call" && itemWithId.input
            ? { input: asString(itemWithId.input) }
            : parseFunctionCallArguments(itemWithId);
        const converted = buildConversationItemFromThreadItem(itemWithId);
        let insertedIndex: number | null = null;
        if (converted) {
          insertedIndex = items.length;
          items.push(converted);
        }
        if (callId) {
          callsById.set(callId, {
            callId,
            name,
            args,
            itemIndex: insertedIndex,
            sessionId: getFunctionCallSessionId(args),
          });
        }
        return;
      }
      if (type === "function_call_output" || type === "custom_tool_call_output") {
        const callId = getFunctionCallId(itemWithId);
        const output = asString(itemWithId.output ?? "");
        const call = callId ? callsById.get(callId) : null;
        const sessionIdFromOutput = extractSessionIdFromToolOutput(output);
        const sessionId = call?.sessionId || sessionIdFromOutput;
        let targetIndex = call?.itemIndex ?? null;
        if (
          (call?.name === "write_stdin" || call?.name === "wait") &&
          sessionId &&
          commandIndexBySessionId.has(sessionId)
        ) {
          targetIndex = commandIndexBySessionId.get(sessionId) ?? null;
        }
        if (targetIndex !== null && items[targetIndex]) {
          items[targetIndex] = mergeToolOutput(items[targetIndex], output);
          if (sessionIdFromOutput) {
            commandIndexBySessionId.set(sessionIdFromOutput, targetIndex);
          }
          return;
        }
        const converted = buildConversationItemFromThreadItem(itemWithId);
        if (converted) {
          const insertedIndex = items.length;
          items.push(converted);
          if (sessionId) {
            commandIndexBySessionId.set(sessionId, insertedIndex);
          }
        }
        return;
      }
      const converted = buildConversationItemFromThreadItem(itemWithId);
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
