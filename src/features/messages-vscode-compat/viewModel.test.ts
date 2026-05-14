import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../types";
import {
  VSCODE_CONVERSATION_DETAIL_LEVEL,
  buildVscodeMessagesViewModel,
  getActivityBlockKind,
  getOpenAIActivityItemTypes,
  groupActivityItemsLikeOpenAI,
} from "./viewModel";

describe("VSCode-compatible message view model", () => {
  it("adapts ConversationItem history into target turn/search metadata", () => {
    const items: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Inspect",
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: rg renderer",
        detail: "/repo",
        status: "completed",
        output: "ok",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "Done.",
      },
    ];

    const model = buildVscodeMessagesViewModel(items);

    expect(model.turns).toHaveLength(1);
    expect(model.turns[0]).toMatchObject({
      id: "user:user-1",
      turnIndex: 0,
      userSearchUnitKey: "user:user-1:message",
      assistantTurnSearchKey: "assistant:assistant-turn-tool-1-assistant-1",
      orphan: false,
    });
    expect(model.turns[0].renderedAgentEntries).toHaveLength(1);
    expect(model.turns[0].renderedAgentEntries[0]).toMatchObject({
      searchUnitKey: "user:user-1:assistant-turn-tool-1-assistant-1:assistant",
      searchUnitKind: "assistant-turn",
      scrollToKey: "user:user-1:assistant-turn-tool-1-assistant-1:assistant",
    });
  });

  it("preserves orphan assistant entries and merges adjacent assistant messages", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-a",
        kind: "message",
        role: "assistant",
        text: "First.",
      },
      {
        id: "assistant-b",
        kind: "message",
        role: "assistant",
        text: "Second.",
      },
    ];

    const model = buildVscodeMessagesViewModel(items);

    expect(model.turns).toHaveLength(1);
    expect(model.turns[0].orphan).toBe(true);
    expect(model.turns[0].assistantTurnSearchKey).toBe(
      "assistant:assistant-turn-message-assistant-a-assistant-b",
    );
    expect(model.turns[0].renderedAgentEntries).toHaveLength(1);
    expect(model.turns[0].renderedAgentEntries[0].searchUnitKind).toBe("assistant-turn");
    expect(model.turns[0].renderedAgentEntries[0].searchUnitKey).toBe(
      "assistant:assistant-turn-message-assistant-a-assistant-b:assistant-turn-message-assistant-a-assistant-b:assistant",
    );
  });

  it("classifies target activity groups for MCP, web search, multi-agent, and patch rows", () => {
    const mcp: ConversationItem = {
      id: "mcp-1",
      kind: "tool",
      toolType: "mcpToolCall",
      itemType: "mcp-tool-call",
      title: "Tool: mcp/search",
      detail: "{}",
    };
    const web: ConversationItem = {
      id: "web-1",
      kind: "tool",
      toolType: "webSearch",
      itemType: "web-search",
      title: "Search web",
      detail: "query",
    };
    const collab: ConversationItem = {
      id: "agent-1",
      kind: "tool",
      toolType: "collabToolCall",
      itemType: "multi-agent-action",
      title: "collab: spawn",
      detail: "",
    };
    const patch: ConversationItem = {
      id: "patch-1",
      kind: "tool",
      toolType: "fileChange",
      itemType: "patch",
      title: "Patch",
      detail: "",
      changes: [{ path: "src/App.tsx", kind: "edit" }],
    };

    expect(getActivityBlockKind({
      kind: "activity",
      id: "mcp-block",
      summary: "",
      items: [mcp],
      toolCount: 1,
      messageCount: 0,
      durationMs: null,
    })).toBe("pending-mcp-tool-calls");
    expect(getActivityBlockKind({
      kind: "activity",
      id: "web-block",
      summary: "",
      items: [web],
      toolCount: 1,
      messageCount: 0,
      durationMs: null,
    })).toBe("web-search-group");
    expect(getActivityBlockKind({
      kind: "activity",
      id: "agent-block",
      summary: "",
      items: [collab],
      toolCount: 1,
      messageCount: 0,
      durationMs: null,
    })).toBe("multi-agent-group");
    expect(getActivityBlockKind({
      kind: "activity",
      id: "patch-block",
      summary: "",
      items: [patch],
      toolCount: 1,
      messageCount: 0,
      durationMs: null,
    })).toBe("patch");
    expect(getOpenAIActivityItemTypes([mcp, web, collab, patch])).toEqual([
      "mcp-tool-call",
      "web-search",
      "multi-agent-action",
      "patch",
    ]);
  });

  it("groups expanded activity slices like the target extension", () => {
    const block = {
      kind: "activity" as const,
      id: "activity-1",
      summary: "3 条前序内容",
      items: [
        {
          id: "mcp-1",
          kind: "tool" as const,
          toolType: "mcpToolCall",
          title: "Tool: mcp/read",
          detail: "{}",
        },
        {
          id: "mcp-2",
          kind: "tool" as const,
          toolType: "mcpToolCall",
          title: "Tool: mcp/search",
          detail: "{}",
        },
        {
          id: "exec-1",
          kind: "tool" as const,
          toolType: "commandExecution",
          title: "Command: npm test",
          detail: "",
        },
      ],
      toolCount: 3,
      messageCount: 0,
      durationMs: null,
    };

    expect(VSCODE_CONVERSATION_DETAIL_LEVEL).toBe("STEPS_PROSE");
    expect(groupActivityItemsLikeOpenAI({ block, isActivitySliceClosed: true })).toEqual([
      expect.objectContaining({
        id: "activity-1",
        kind: "pending-mcp-tool-calls",
        items: block.items,
      }),
    ]);
    expect(groupActivityItemsLikeOpenAI({ block, isActivitySliceClosed: false })).toEqual([
      expect.objectContaining({
        kind: "pending-mcp-tool-calls",
        items: [block.items[0], block.items[1]],
      }),
      expect.objectContaining({
        kind: "exec",
        items: [block.items[2]],
      }),
    ]);
  });

  it("splits context compaction out of tool groups and assistant activity blocks", () => {
    const command: ConversationItem = {
      id: "exec-1",
      kind: "tool",
      toolType: "commandExecution",
      itemType: "exec",
      title: "Command: npm test",
      detail: "",
    };
    const compaction: ConversationItem = {
      id: "compact-1",
      kind: "tool",
      toolType: "contextCompaction",
      itemType: "context-compaction",
      title: "Context compaction",
      detail: "",
      status: "completed",
    };

    const model = buildVscodeMessagesViewModel([
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Run",
      },
      command,
      compaction,
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "Done.",
      },
    ]);

    const agentEntries = model.turns[0].renderedAgentEntries.map((entry) => entry.entry);
    expect(agentEntries).toHaveLength(3);
    expect(agentEntries[0]).toMatchObject({
      kind: "assistantTurn",
      turn: { blocks: [expect.objectContaining({ items: [command] })] },
    });
    expect(agentEntries[1]).toMatchObject({ kind: "item", item: compaction });
    expect(agentEntries[2]).toMatchObject({ kind: "assistantTurn" });
    expect(
      agentEntries.some((entry) => entry.kind === "toolGroup"),
    ).toBe(false);

    expect(groupActivityItemsLikeOpenAI({
      block: {
        kind: "activity",
        id: "activity-1",
        summary: "",
        items: [command, compaction],
        toolCount: 2,
        messageCount: 0,
        durationMs: null,
      },
      isActivitySliceClosed: false,
    })).toEqual([
      expect.objectContaining({ kind: "exec", items: [command] }),
      expect.objectContaining({ kind: "context-compaction", items: [compaction] }),
    ]);
  });

  it("omits Codex stderr system errors from the transcript view model", () => {
    const first: ConversationItem = {
      id: "stderr-1",
      kind: "tool",
      toolType: "error",
      itemType: "system-error",
      title: "Codex stderr",
      detail: "stderr",
      output: "Codex stderr: apply_patch verification failed",
      status: "failed",
    };
    const second: ConversationItem = {
      id: "stderr-2",
      kind: "tool",
      toolType: "error",
      itemType: "system-error",
      title: "Codex stderr",
      detail: "stderr",
      output: "Codex stderr: expected line",
      status: "failed",
    };

    const model = buildVscodeMessagesViewModel([
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Patch",
      },
      first,
      second,
    ]);

    const agentEntries = model.turns[0].renderedAgentEntries.map((entry) => entry.entry);
    expect(agentEntries).toHaveLength(0);
    expect(model.entries.some((entry) => (
      entry.kind === "item" &&
      entry.item.kind === "tool" &&
      entry.item.title === "Codex stderr"
    ))).toBe(false);
  });
});
