import { useEffect, useRef } from "react";
import type {
  AppServerEvent,
  ApprovalRequest,
  RequestUserInputRequest,
} from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import {
  getAppServerParams,
  getAppServerRawMethod,
  getAppServerRequestId,
  isApprovalRequestMethod,
  isSupportedAppServerMethod,
} from "../../../utils/appServerEvents";
import type { SupportedAppServerMethod } from "../../../utils/appServerEvents";

type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
};

type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
};

type HookEvent = {
  workspaceId: string;
  threadId: string;
  turnId: string | null;
  run: Record<string, unknown>;
};

type AppServerEventHandlers = {
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (workspaceId: string, thread: Record<string, unknown>) => void;
  onThreadNameUpdated?: (
    workspaceId: string,
    payload: { threadId: string; threadName: string | null },
  ) => void;
  onThreadStatusChanged?: (
    workspaceId: string,
    threadId: string,
    status: Record<string, unknown>,
  ) => void;
  onThreadClosed?: (workspaceId: string, threadId: string) => void;
  onThreadArchived?: (workspaceId: string, threadId: string) => void;
  onThreadUnarchived?: (workspaceId: string, threadId: string) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { message: string; willRetry: boolean },
  ) => void;
  onThreadStreamError?: (
    workspaceId: string,
    threadId: string,
    message: string,
    options?: { willRetry?: boolean },
  ) => void;
  onThreadRealtimeClosed?: (workspaceId: string, threadId: string) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onHookStarted?: (event: HookEvent) => void;
  onHookCompleted?: (event: HookEvent) => void;
  onItemStarted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onItemCompleted?: (workspaceId: string, threadId: string, item: Record<string, unknown>) => void;
  onReasoningSummaryDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onReasoningSummaryBoundary?: (workspaceId: string, threadId: string, itemId: string) => void;
  onReasoningTextDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onPlanDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onCommandOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
  ) => void;
  onFileChangeOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onServerRequestResolved?: (workspaceId: string, requestId: string | number) => void;
  onTurnDiffUpdated?: (workspaceId: string, threadId: string, diff: string) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown> | null,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  onAccountUpdated?: (workspaceId: string, authMode: string | null) => void;
  onAccountLoginCompleted?: (
    workspaceId: string,
    payload: { loginId: string | null; success: boolean; error: string | null },
  ) => void;
};

export const METHODS_ROUTED_IN_USE_APP_SERVER_EVENTS = [
  "account/login/completed",
  "account/rateLimits/updated",
  "account/updated",
  "codex/backgroundThread",
  "codex/connected",
  "codex/stderr",
  "error",
  "hook/completed",
  "hook/started",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/completed",
  "item/autoApprovalReview/completed",
  "item/autoApprovalReview/started",
  "item/fileChange/outputDelta",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "item/tool/call",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "serverRequest/resolved",
  "thread/archived",
  "thread/closed",
  "thread/name/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/status/changed",
  "thread/started",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/started",
] as const satisfies readonly SupportedAppServerMethod[];

function parseHookEvent(
  workspaceId: string,
  params: Record<string, unknown>,
): HookEvent | null {
  const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
  if (!threadId) {
    return null;
  }
  const run = params.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return null;
  }
  const turnIdRaw = params.turnId ?? params.turn_id ?? null;
  const turnId =
    typeof turnIdRaw === "string" && turnIdRaw.trim().length > 0
      ? turnIdRaw.trim()
      : null;
  return {
    workspaceId,
    threadId,
    turnId,
    run: run as Record<string, unknown>,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getStringParam(params: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function parseRequestUserInputQuestions(params: Record<string, unknown>) {
  const questionsRaw = Array.isArray(params.questions) ? params.questions : [];
  const questions = questionsRaw
    .map((entry) => {
      const question = asRecord(entry) ?? {};
      const optionsRaw = Array.isArray(question.options) ? question.options : [];
      const options = optionsRaw
        .map((option) => {
          const record = asRecord(option) ?? {};
          const label = String(record.label ?? "").trim();
          const description = String(record.description ?? "").trim();
          if (!label && !description) {
            return null;
          }
          return { label, description };
        })
        .filter((option): option is { label: string; description: string } => Boolean(option));
      return {
        id: String(question.id ?? "").trim(),
        header: String(question.header ?? ""),
        question: String(question.question ?? ""),
        isOther: Boolean(question.isOther ?? question.is_other),
        options: options.length ? options : undefined,
      };
    })
    .filter((question) => question.id);

  if (questions.length > 0) {
    return questions;
  }

  const prompt = getStringParam(params, "question", "prompt", "message", "text", "description");
  if (!prompt) {
    return [];
  }
  return [
    {
      id: getStringParam(params, "questionId", "question_id", "itemId", "item_id") || "mcp_elicitation",
      header: getStringParam(params, "header", "title"),
      question: prompt,
      isOther: Boolean(params.isOther ?? params.is_other),
      options: undefined,
    },
  ];
}

function buildRequestUserInputRequest(
  workspaceId: string,
  requestId: string | number,
  params: Record<string, unknown>,
): RequestUserInputRequest | null {
  const requestParams = asRecord(params.params) ?? params;
  const questions = parseRequestUserInputQuestions(requestParams);
  if (questions.length === 0) {
    return null;
  }
  return {
    workspace_id: workspaceId,
    request_id: requestId,
    params: {
      thread_id: getStringParam(requestParams, "threadId", "thread_id"),
      turn_id: getStringParam(requestParams, "turnId", "turn_id"),
      item_id: getStringParam(requestParams, "itemId", "item_id"),
      questions,
    },
  };
}

function buildAutoApprovalReviewItem(
  params: Record<string, unknown>,
  status: "inProgress" | "completed",
) {
  const source = asRecord(params.item) ?? asRecord(params.review) ?? params;
  const id =
    getStringParam(source, "id") ||
    getStringParam(params, "itemId", "item_id", "reviewId", "review_id") ||
    `auto-approval-review-${getStringParam(params, "turnId", "turn_id") || "unknown"}`;
  return {
    ...source,
    id,
    type: "autoApprovalReview",
    status: getStringParam(source, "status") || status,
    title: getStringParam(source, "title") || "Automatic approval review",
  };
}

export function useAppServerEvents(handlers: AppServerEventHandlers) {
  // Use ref to keep handlers current without triggering re-subscription
  const handlersRef = useRef(handlers);
  
  // Update ref on every render to always have latest handlers
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const unlisten = subscribeAppServerEvents((payload) => {
      const currentHandlers = handlersRef.current;
      currentHandlers.onAppServerEvent?.(payload);

      const { workspace_id } = payload;
      const method = getAppServerRawMethod(payload);
      if (!method) {
        return;
      }
      const params = getAppServerParams(payload);

      if (method === "codex/connected") {
        currentHandlers.onWorkspaceConnected?.(workspace_id);
        return;
      }

      if (method === "codex/stderr") {
        return;
      }

      const requestId = getAppServerRequestId(payload);
      const hasRequestId = requestId !== null;

      if (isApprovalRequestMethod(method) && hasRequestId) {
        currentHandlers.onApprovalRequest?.({
          workspace_id,
          request_id: requestId as string | number,
          method,
          params,
        });
        return;
      }

      if (!isSupportedAppServerMethod(method)) {
        return;
      }

      if (method === "item/tool/requestUserInput" && hasRequestId) {
        const request = buildRequestUserInputRequest(
          workspace_id,
          requestId as string | number,
          params,
        );
        if (request) {
          currentHandlers.onRequestUserInput?.(request);
        }
        return;
      }

      if (method === "mcpServer/elicitation/request" && hasRequestId) {
        const request = buildRequestUserInputRequest(
          workspace_id,
          requestId as string | number,
          params,
        );
        if (request) {
          currentHandlers.onRequestUserInput?.(request);
        }
        return;
      }

      if (method === "serverRequest/resolved") {
        const resolvedRequestId =
          requestId ??
          params.requestId ??
          params.request_id ??
          params.id;
        if (
          typeof resolvedRequestId === "string" ||
          typeof resolvedRequestId === "number"
        ) {
          currentHandlers.onServerRequestResolved?.(workspace_id, resolvedRequestId);
        }
        return;
      }

      if (method === "item/agentMessage/delta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onAgentMessageDelta?.({
            workspaceId: workspace_id,
            threadId,
            itemId,
            delta,
          });
        }
        return;
      }

      if (method === "turn/started") {
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          currentHandlers.onTurnStarted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "hook/started") {
        const event = parseHookEvent(workspace_id, params);
        if (event) {
          currentHandlers.onHookStarted?.(event);
        }
        return;
      }

      if (method === "hook/completed") {
        const event = parseHookEvent(workspace_id, params);
        if (event) {
          currentHandlers.onHookCompleted?.(event);
        }
        return;
      }

      if (method === "thread/started") {
        const thread = (params.thread as Record<string, unknown> | undefined) ?? null;
        const threadId = String(thread?.id ?? "");
        if (thread && threadId) {
          currentHandlers.onThreadStarted?.(workspace_id, thread);
        }
        return;
      }

      if (method === "thread/name/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        const threadNameRaw = params.threadName ?? params.thread_name ?? null;
        const threadName =
          typeof threadNameRaw === "string" && threadNameRaw.trim().length > 0
            ? threadNameRaw.trim()
            : null;
        if (threadId) {
          currentHandlers.onThreadNameUpdated?.(workspace_id, { threadId, threadName });
        }
        return;
      }

      if (method === "thread/status/changed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (!threadId) {
          return;
        }
        const statusRaw = params.status;
        if (statusRaw && typeof statusRaw === "object" && !Array.isArray(statusRaw)) {
          currentHandlers.onThreadStatusChanged?.(
            workspace_id,
            threadId,
            statusRaw as Record<string, unknown>,
          );
          return;
        }
        if (typeof statusRaw === "string" && statusRaw.trim().length > 0) {
          currentHandlers.onThreadStatusChanged?.(workspace_id, threadId, {
            type: statusRaw.trim(),
          });
        }
        return;
      }

      if (method === "thread/closed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadClosed?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "thread/archived") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadArchived?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "thread/unarchived") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadUnarchived?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "codex/backgroundThread") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const action = String(params.action ?? "hide");
        if (threadId) {
          currentHandlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
        }
        return;
      }

      if (method === "error") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        const error = (params.error as Record<string, unknown> | undefined) ?? {};
        const messageText = String(
          error.message ?? params.message ?? params.error ?? "",
        );
        const willRetry = Boolean(params.willRetry ?? params.will_retry);
        if (threadId) {
          currentHandlers.onTurnError?.(workspace_id, threadId, turnId, {
            message: messageText,
            willRetry,
          });
        }
        return;
      }

      if (method === "thread/realtime/error") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const error =
          params.error && typeof params.error === "object" && !Array.isArray(params.error)
            ? (params.error as Record<string, unknown>)
            : {};
        const message = String(
          error.message ?? params.message ?? params.error ?? "Realtime stream error",
        );
        const willRetry = Boolean(params.willRetry ?? params.will_retry);
        if (threadId) {
          currentHandlers.onThreadStreamError?.(workspace_id, threadId, message, {
            willRetry,
          });
        }
        return;
      }

      if (method === "thread/realtime/closed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        if (threadId) {
          currentHandlers.onThreadRealtimeClosed?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "turn/completed") {
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          currentHandlers.onTurnCompleted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "turn/plan/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          currentHandlers.onTurnPlanUpdated?.(workspace_id, threadId, turnId, {
            explanation: params.explanation,
            plan: params.plan,
          });
        }
        return;
      }

      if (method === "turn/diff/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const diff = String(params.diff ?? "");
        if (threadId && diff) {
          currentHandlers.onTurnDiffUpdated?.(workspace_id, threadId, diff);
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const tokenUsage =
          (params.tokenUsage as Record<string, unknown> | null | undefined) ??
          (params.token_usage as Record<string, unknown> | null | undefined);
        if (threadId && tokenUsage !== undefined) {
          currentHandlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
        }
        return;
      }

      if (method === "account/rateLimits/updated") {
        const rateLimits =
          (params.rateLimits as Record<string, unknown> | undefined) ??
          (params.rate_limits as Record<string, unknown> | undefined);
        if (rateLimits) {
          currentHandlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
        }
        return;
      }

      if (method === "account/updated") {
        const authModeRaw = params.authMode ?? params.auth_mode ?? null;
        const authMode =
          typeof authModeRaw === "string" && authModeRaw.trim().length > 0
            ? authModeRaw
            : null;
        currentHandlers.onAccountUpdated?.(workspace_id, authMode);
        return;
      }

      if (method === "account/login/completed") {
        const loginIdRaw = params.loginId ?? params.login_id ?? null;
        const loginId =
          typeof loginIdRaw === "string" && loginIdRaw.trim().length > 0
            ? loginIdRaw
            : null;
        const success = Boolean(params.success);
        const errorRaw = params.error ?? null;
        const error =
          typeof errorRaw === "string" && errorRaw.trim().length > 0 ? errorRaw : null;
        currentHandlers.onAccountLoginCompleted?.(workspace_id, {
          loginId,
          success,
          error,
        });
        return;
      }

      if (method === "item/completed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const item = params.item as Record<string, unknown> | undefined;
        if (threadId && item) {
          currentHandlers.onItemCompleted?.(workspace_id, threadId, item);
        }
        if (threadId && item?.type === "agentMessage") {
          const itemId = String(item.id ?? "");
          const text = String(item.text ?? "");
          if (itemId) {
            currentHandlers.onAgentMessageCompleted?.({
              workspaceId: workspace_id,
              threadId,
              itemId,
              text,
            });
          }
        }
        return;
      }

      if (method === "item/autoApprovalReview/started") {
        const source = asRecord(params.item) ?? asRecord(params.review) ?? params;
        const threadId =
          getStringParam(params, "threadId", "thread_id") ||
          getStringParam(source, "threadId", "thread_id");
        if (threadId) {
          currentHandlers.onItemStarted?.(
            workspace_id,
            threadId,
            buildAutoApprovalReviewItem(params, "inProgress"),
          );
        }
        return;
      }

      if (method === "item/autoApprovalReview/completed") {
        const source = asRecord(params.item) ?? asRecord(params.review) ?? params;
        const threadId =
          getStringParam(params, "threadId", "thread_id") ||
          getStringParam(source, "threadId", "thread_id");
        if (threadId) {
          currentHandlers.onItemCompleted?.(
            workspace_id,
            threadId,
            buildAutoApprovalReviewItem(params, "completed"),
          );
        }
        return;
      }

      if (method === "item/mcpToolCall/progress") {
        const source = asRecord(params.item) ?? params;
        const threadId =
          getStringParam(params, "threadId", "thread_id") ||
          getStringParam(source, "threadId", "thread_id");
        const itemId =
          getStringParam(params, "itemId", "item_id", "callId", "call_id") ||
          getStringParam(source, "id", "itemId", "item_id", "callId", "call_id");
        if (threadId && itemId) {
          currentHandlers.onItemStarted?.(workspace_id, threadId, {
            ...source,
            id: itemId,
            type: "mcpToolCall",
            status:
              getStringParam(source, "status", "state") ||
              getStringParam(params, "status", "state", "progress") ||
              "inProgress",
            output:
              getStringParam(source, "output", "message", "text") ||
              getStringParam(params, "output", "message", "text", "delta"),
          });
        }
        return;
      }

      if (method === "item/tool/call" && hasRequestId) {
        const source = asRecord(params.item) ?? asRecord(params.toolCall) ?? params;
        const threadId =
          getStringParam(params, "threadId", "thread_id") ||
          getStringParam(source, "threadId", "thread_id");
        const itemId =
          getStringParam(params, "itemId", "item_id", "callId", "call_id") ||
          getStringParam(source, "id", "itemId", "item_id", "callId", "call_id") ||
          String(requestId);
        if (threadId && itemId) {
          currentHandlers.onItemStarted?.(workspace_id, threadId, {
            ...source,
            id: itemId,
            type: getStringParam(source, "type") || "dynamicToolCall",
            title:
              getStringParam(source, "title", "name", "toolName", "tool_name") ||
              "Tool call",
            status: getStringParam(source, "status") || "pending",
          });
        }
        return;
      }

      if (method === "item/started") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const item = params.item as Record<string, unknown> | undefined;
        if (threadId && item) {
          currentHandlers.onItemStarted?.(workspace_id, threadId, item);
        }
        return;
      }

      if (method === "item/reasoning/summaryTextDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onReasoningSummaryDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/reasoning/summaryPartAdded") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        if (threadId && itemId) {
          currentHandlers.onReasoningSummaryBoundary?.(workspace_id, threadId, itemId);
        }
        return;
      }

      if (method === "item/reasoning/textDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onReasoningTextDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/plan/delta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onPlanDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/outputDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onCommandOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/terminalInteraction") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const stdin = String(params.stdin ?? "");
        if (threadId && itemId) {
          currentHandlers.onTerminalInteraction?.(workspace_id, threadId, itemId, stdin);
        }
        return;
      }

      if (method === "item/fileChange/outputDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onFileChangeOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }
    });

    return () => {
      unlisten();
    };
  }, []);
}
