import { describe, expect, it } from "vitest";
import type { MessageListEntry } from "../messages/utils/messageRenderUtils";
import {
  buildVscodeConversationTurns,
  getVscodeAssistantTurnSearchKey,
  getVscodeEntrySearchUnitKey,
  getVscodeEntrySearchUnitKind,
} from "./conversationTurns";

describe("vscode-compatible conversation turns", () => {
  it("groups each user message with following agent entries", () => {
    const entries: MessageListEntry[] = [
      {
        kind: "item",
        item: {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "Inspect",
        },
      },
      {
        kind: "item",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command: rg",
          detail: "/repo",
          status: "completed",
          output: "",
        },
      },
      {
        kind: "item",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Done.",
        },
      },
      {
        kind: "item",
        item: {
          id: "user-2",
          kind: "message",
          role: "user",
          text: "Continue",
        },
      },
    ];

    const turns = buildVscodeConversationTurns(entries);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      id: "user:user-1",
      orphan: false,
      userEntry: entries[0],
      agentEntries: [entries[1], entries[2]],
    });
    expect(turns[1]).toMatchObject({
      id: "user:user-2",
      orphan: false,
      userEntry: entries[3],
      agentEntries: [],
    });
  });

  it("keeps leading agent entries in an orphan assistant turn", () => {
    const entries: MessageListEntry[] = [
      {
        kind: "item",
        item: {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Recovered message.",
        },
      },
    ];

    const turns = buildVscodeConversationTurns(entries);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "assistant:assistant-1",
      orphan: true,
      userEntry: null,
      agentEntries: [entries[0]],
    });
  });

  it("only treats steering user messages as persistent agent entries", () => {
    const entries: MessageListEntry[] = [
      {
        kind: "item",
        item: {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "Start",
        },
      },
      {
        kind: "item",
        item: {
          id: "status-user",
          kind: "message",
          role: "user",
          itemType: "user-message",
          messageStatus: "Queued",
          text: "Queued follow-up should start a user turn.",
        },
      },
      {
        kind: "item",
        item: {
          id: "steering-user",
          kind: "message",
          role: "user",
          itemType: "user-message",
          steeringStatus: "Steered conversation",
          text: "Steering stays with the active agent turn.",
        },
      },
    ];

    const turns = buildVscodeConversationTurns(entries);

    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      id: "user:status-user",
      userEntry: entries[1],
      agentEntries: [entries[2]],
    });
  });

  it("builds stable search metadata for assistant entries", () => {
    const assistantTurn: MessageListEntry = {
      kind: "assistantTurn",
      turn: {
        id: "turn-1",
        blocks: [],
        toolCount: 0,
        messageCount: 1,
        durationMs: null,
      },
    };
    const toolGroup: MessageListEntry = {
      kind: "toolGroup",
      group: {
        id: "group-1",
        items: [],
        toolCount: 0,
        messageCount: 0,
      },
    };

    expect(getVscodeEntrySearchUnitKey("user:user-1", assistantTurn, 0)).toBe(
      "user:user-1:turn-1:assistant",
    );
    expect(getVscodeEntrySearchUnitKey("user:user-1", toolGroup, 1)).toBe(
      "user:user-1:group-1:tools",
    );
    expect(getVscodeAssistantTurnSearchKey([assistantTurn])).toBe("assistant:turn-1");
    expect(getVscodeEntrySearchUnitKind(assistantTurn, () => "tool")).toBe("assistant-turn");
    expect(getVscodeEntrySearchUnitKind(toolGroup, () => "tool")).toBe("tool");
  });
});
