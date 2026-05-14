import { describe, expect, it } from "vitest";
import type { ConversationItem, ThreadSummary } from "../types";
import { enrichConversationItemsWithThreads } from "./threadItems.collab";

describe("enrichConversationItemsWithThreads", () => {
  it("returns the original items when there are no collab tool calls", () => {
    const items: ConversationItem[] = [
      { id: "user-1", kind: "message", role: "user", text: "hello" },
    ];
    const threads: ThreadSummary[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `thread-${index}`,
      name: `Thread ${index}`,
      updatedAt: index,
      subagentNickname: `agent-${index}`,
    }));

    expect(enrichConversationItemsWithThreads(items, threads)).toBe(items);
  });

  it("enriches collab tool metadata from thread summaries", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolType: "collabToolCall",
        title: "Collab: delegate",
        detail: "",
        output: "prompt",
        collabReceiver: { threadId: "child-1" },
      },
    ];
    const threads: ThreadSummary[] = [
      {
        id: "child-1",
        name: "Child",
        updatedAt: 1,
        subagentNickname: "Reviewer",
        subagentRole: "reviewer",
      },
    ];

    const enriched = enrichConversationItemsWithThreads(items, threads);

    expect(enriched).not.toBe(items);
    expect(enriched[0]).toMatchObject({
      detail: "→ Reviewer [reviewer]",
      collabReceiver: {
        threadId: "child-1",
        nickname: "Reviewer",
        role: "reviewer",
      },
    });
  });
});
