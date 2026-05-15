import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
  buildItemsFromThread,
  getThreadCreatedTimestamp,
  getThreadTimestamp,
  mergeThreadItems,
  normalizeItem,
  prepareThreadItems,
  upsertItem,
} from "./threadItems";
import { TOOL_OUTPUT_RECENT_ITEMS } from "./threadItems.shared";

describe("threadItems", () => {
  it("hydrates raw response function calls into command activity items", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "response_item",
              payload: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "分析当前前端代码" }],
              },
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "我先检查代码。" }],
            },
            {
              type: "function_call",
              name: "exec_command",
              call_id: "call_exec_1",
              arguments: JSON.stringify({
                cmd: "npm run typecheck",
                workdir: "/Users/xihe0000/workspace/coChat",
              }),
            },
            {
              type: "function_call_output",
              call_id: "call_exec_1",
              output:
                "Chunk ID: abc\nWall time: 1.001 seconds\nProcess running with session ID 42\nOutput:\n",
            },
            {
              type: "function_call",
              name: "write_stdin",
              call_id: "call_poll_1",
              arguments: JSON.stringify({ session_id: 42, chars: "" }),
            },
            {
              type: "function_call_output",
              call_id: "call_poll_1",
              output:
                "Chunk ID: def\nWall time: 2.500 seconds\nProcess exited with code 0\nOutput:\ntypecheck passed\n",
            },
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "验证完成。" }],
            },
          ],
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "tool",
      "message",
    ]);
    expect(items[0]).toMatchObject({
      id: "thread-item-0-0",
      kind: "message",
      role: "user",
      text: "分析当前前端代码",
      itemType: "user-message",
    });
    expect(items[1]).toMatchObject({
      id: "thread-item-0-1",
      kind: "message",
      role: "assistant",
      text: "我先检查代码。",
      itemType: "assistant-message",
    });
    expect(items[2]).toMatchObject({
      id: "call_exec_1",
      kind: "tool",
      toolType: "commandExecution",
      itemType: "exec",
      title: "Command: npm run typecheck",
      detail: "/Users/xihe0000/workspace/coChat",
      status: "completed",
      output: "typecheck passed\n",
      durationMs: 3501,
    });
    expect(items[3]).toMatchObject({
      id: "thread-item-0-6",
      kind: "message",
      role: "assistant",
      text: "验证完成。",
    });
  });

  it("hydrates raw response custom tools and web search calls", () => {
    const items = buildItemsFromThread({
      turns: [
        {
          items: [
            {
              type: "custom_tool_call",
              call_id: "call_patch_1",
              name: "apply_patch",
              input: "*** Begin Patch\n*** Add File: src/a.ts\n+export {}\n*** End Patch\n",
            },
            {
              type: "custom_tool_call_output",
              call_id: "call_patch_1",
              output: JSON.stringify({
                output: "Success. Updated the following files:\nA src/a.ts\n",
                metadata: { exit_code: 0 },
              }),
            },
            {
              type: "function_call",
              call_id: "call_plan_1",
              name: "update_plan",
              arguments: JSON.stringify({
                plan: [
                  { status: "completed", step: "Inspect adapter gaps" },
                  { status: "in_progress", step: "Patch converter" },
                ],
              }),
            },
            {
              type: "function_call",
              call_id: "call_image_1",
              name: "view_image",
              arguments: JSON.stringify({ path: "/tmp/screenshot.png" }),
            },
            {
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                query: "OpenAI Codex IDE extension",
              },
            },
            {
              type: "function_call",
              call_id: "call_input_1",
              name: "request_user_input",
              arguments: JSON.stringify({
                questions: [
                  {
                    header: "Scope",
                    id: "scope",
                    question: "Choose scope",
                    options: [{ label: "Full" }, { label: "Partial" }],
                  },
                ],
              }),
            },
            {
              type: "image_generation_call",
              id: "image-1",
              status: "completed",
              revised_prompt: "A clean UI screenshot",
              result: "AAA",
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({
      id: "call_patch_1",
      kind: "tool",
      toolType: "fileChange",
      itemType: "patch",
      status: "completed",
      output: expect.stringContaining("Success. Updated the following files"),
    });
    expect(items[1]).toMatchObject({
      id: "call_plan_1",
      kind: "tool",
      toolType: "plan",
      itemType: "plan-implementation",
      output: expect.stringContaining("completed: Inspect adapter gaps"),
    });
    expect(items[2]).toMatchObject({
      id: "call_image_1",
      kind: "tool",
      toolType: "imageView",
      detail: "/tmp/screenshot.png",
      generatedImage: "/tmp/screenshot.png",
    });
    expect(items[3]).toMatchObject({
      id: "thread-item-0-4",
      kind: "tool",
      toolType: "webSearch",
      itemType: "web-search",
      detail: "OpenAI Codex IDE extension",
      status: "completed",
    });
    expect(items[4]).toMatchObject({
      id: "call_input_1",
      kind: "tool",
      toolType: "requestUserInput",
      itemType: "userInput",
      title: "User input requested",
      detail: expect.stringContaining("Choose scope"),
    });
    expect(items[5]).toMatchObject({
      id: "image-1",
      kind: "tool",
      toolType: "generatedImage",
      itemType: "generated-image",
      generatedImage: "data:image/png;base64,AAA",
      output: "A clean UI screenshot",
    });
  });

  it("truncates long message text in normalizeItem", () => {
    const text = "a".repeat(21000);
    const item: ConversationItem = {
      id: "msg-1",
      kind: "message",
      role: "assistant",
      text,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).not.toBe(text);
      expect(normalized.text.endsWith("...")).toBe(true);
      expect(normalized.text.length).toBeLessThan(text.length);
    }
  });

  it("truncates extremely large tool output for fileChange and commandExecution", () => {
    const output = "x".repeat(250000);
    const item: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "fileChange",
      title: "File changes",
      detail: "",
      output,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.output).not.toBe(output);
      expect(normalized.output?.endsWith("...")).toBe(true);
      expect((normalized.output ?? "").length).toBeLessThan(output.length);
    }
  });

  it("truncates older tool output in prepareThreadItems", () => {
    const output = "y".repeat(21000);
    const items: ConversationItem[] = Array.from(
      { length: TOOL_OUTPUT_RECENT_ITEMS + 1 },
      (_, index) => ({
        id: `tool-${index}`,
        kind: "tool",
        toolType: "commandExecution",
        title: "Tool",
        detail: "",
        output,
      }),
    );
    const prepared = prepareThreadItems(items);
    const firstOutput = prepared[0].kind === "tool" ? prepared[0].output : undefined;
    const recentItem = prepared[prepared.length - 1];
    const recentOutput =
      recentItem.kind === "tool" ? recentItem.output : undefined;
    expect(firstOutput).not.toBe(output);
    expect(firstOutput?.endsWith("...")).toBe(true);
    expect(recentOutput).toBe(output);
  });

  it("respects custom max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: 3 });
    expect(prepared).toHaveLength(3);
    expect(prepared[0]?.id).toBe("msg-2");
    expect(prepared[2]?.id).toBe("msg-4");
  });

  it("supports unlimited max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: null });
    expect(prepared).toHaveLength(5);
  });

  it("drops assistant review summaries that duplicate completed review items", () => {
    const items: ConversationItem[] = [
      {
        id: "review-1",
        kind: "review",
        state: "completed",
        text: "Review summary",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Review summary",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("review");
  });

  it("summarizes explored reads and hides raw commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: sed -n '1,10p' src/bar.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Done reading",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].label).toContain("foo.ts");
      expect(prepared[0].entries[1].kind).toBe("read");
      expect(prepared[0].entries[1].label).toContain("bar.ts");
    }
    expect(prepared.filter((item) => item.kind === "tool")).toHaveLength(0);
  });

  it("treats inProgress command status as exploring", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg RouterDestination src",
        detail: "",
        status: "inProgress",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].status).toBe("exploring");
      expect(prepared[0].entries[0]?.kind).toBe("search");
    }
  });

  it("deduplicates explore entries when consecutive summaries merge", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].label).toContain("customPrompts.ts");
    }
  });

  it("preserves distinct read paths that share the same basename", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat tests/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/foo/index.ts");
      expect(details).toContain("tests/foo/index.ts");
    }
  });

  it("preserves multi-path read commands instead of collapsing to the last path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/a.ts src/b.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/a.ts");
      expect(details).toContain("src/b.ts");
    }
  });

  it("ignores glob patterns when summarizing rg --files commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("list");
      expect(prepared[0].entries[0].label).toBe("src");
    }
  });

  it("skips rg glob flag values and keeps the actual search path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg myQuery -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("myQuery in src");
    }
  });

  it("unwraps unquoted /bin/zsh -lc rg commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: /bin/zsh -lc rg -n "RouterDestination" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("RouterDestination in src");
    }
  });

  it("treats nl -ba as a read command", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("summarizes piped nl commands using the left-hand read", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts | sed -n '1,10p'",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("does not trim pipes that appear inside quoted arguments", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: rg "foo | bar" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("foo | bar in src");
    }
  });

  it("keeps raw commands when they are not recognized", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status",
        detail: "",
        status: "completed",
        output: "",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("keeps raw commands when they fail", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "failed",
        output: "No such file",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("builds file change items with summary details", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-1",
      status: "done",
      changes: [
        {
          path: "foo.txt",
          kind: "add",
          diff: "diff --git a/foo.txt b/foo.txt",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("File changes");
      expect(item.detail).toBe("A foo.txt");
      expect(item.output).toContain("diff --git a/foo.txt b/foo.txt");
      expect(item.changes?.[0]?.path).toBe("foo.txt");
    }
  });

  it("defaults web search items to completed status", () => {
    const item = buildConversationItem({
      type: "webSearch",
      id: "web-1",
      query: "codex monitor",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("webSearch");
      expect(item.status).toBe("completed");
      expect(item.detail).toBe("codex monitor");
    }
  });

  it("merges thread items preferring non-empty remote tool output", () => {
    const remote: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "ok",
      output: "short",
    };
    const local: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "much longer output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("short");
      expect(merged[0].status).toBe("ok");
    }
  });

  it("keeps local tool output when remote output is empty", () => {
    const remote: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: " ",
    };
    const local: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "streamed output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("streamed output");
      expect(merged[0].status).toBe("completed");
    }
  });

  it("keeps local tool status when remote status is empty", () => {
    const remote: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "",
      output: "",
    };
    const local: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].status).toBe("completed");
    }
  });

  it("preserves streamed plan output when completion item has empty output", () => {
    const existing: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "Generating plan...",
      status: "in_progress",
      output: "## Plan\n- Step 1\n- Step 2",
    };
    const completed: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "",
      status: "completed",
      output: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe(existing.output);
      expect(next[0].status).toBe("completed");
    }
  });

  it("uses incoming tool output even when shorter than existing output", () => {
    const existing: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "in_progress",
      output: "verbose streamed output that will be replaced",
    };
    const incoming: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "final",
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe("final");
      expect(next[0].status).toBe("completed");
    }
  });

  it("preserves streamed reasoning content when completion item is empty", () => {
    const existing: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "Thinking",
      content: "More detail",
    };
    const completed: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "",
      content: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("reasoning");
    if (next[0].kind === "reasoning") {
      expect(next[0].summary).toBe("Thinking");
      expect(next[0].content).toBe("More detail");
    }
  });

  it("preserves existing userInput answers when incoming payload has equal question count and no answers", () => {
    const existing: ConversationItem = {
      id: "user-input-1",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Confirm",
          question: "Proceed?",
          answers: ["Yes"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-1",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Confirm",
          question: "Proceed?",
          answers: [],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions[0]?.answers).toEqual(["Yes"]);
    }
  });

  it("preserves existing answers for questions that are empty in a partial userInput upsert", () => {
    const existing: ConversationItem = {
      id: "user-input-2",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Choose release mode",
          answers: ["Safe"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Choose deployment time",
          answers: ["Tonight"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-2",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Choose release mode",
          answers: ["Fast"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Choose deployment time",
          answers: [],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions).toHaveLength(2);
      expect(next[0].questions[0]?.answers).toEqual(["Fast"]);
      expect(next[0].questions[1]?.answers).toEqual(["Tonight"]);
    }
  });

  it("preserves answered questions missing from a partial userInput upsert", () => {
    const existing: ConversationItem = {
      id: "user-input-3",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Primary answer",
          answers: ["A"],
        },
        {
          id: "q2",
          header: "Question 2",
          question: "Secondary answer",
          answers: ["B"],
        },
      ],
    };
    const incoming: ConversationItem = {
      id: "user-input-3",
      kind: "userInput",
      status: "answered",
      questions: [
        {
          id: "q1",
          header: "Question 1",
          question: "Primary answer",
          answers: ["A2"],
        },
      ],
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("userInput");
    if (next[0].kind === "userInput") {
      expect(next[0].questions).toHaveLength(2);
      expect(next[0].questions[0]?.id).toBe("q1");
      expect(next[0].questions[0]?.answers).toEqual(["A2"]);
      expect(next[0].questions[1]?.id).toBe("q2");
      expect(next[0].questions[1]?.answers).toEqual(["B"]);
    }
  });

  it("builds user message text from mixed inputs", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "image", url: "https://example.com/image.png" },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review");
      expect(item.images).toEqual(["https://example.com/image.png"]);
    }
  });

  it("keeps image-only user messages without placeholder text", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-2",
      content: [{ type: "image", url: "https://example.com/only.png" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("");
      expect(item.images).toEqual(["https://example.com/only.png"]);
    }
  });

  it("formats collab tool calls with receivers and agent states", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-1",
      tool: "handoff",
      status: "ok",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      newThreadId: "thread-c",
      prompt: "Coordinate work",
      agentStatus: { "agent-1": { status: "running" } },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Collab: handoff");
      expect(item.detail).toContain("From thread-a");
      expect(item.detail).toContain("thread-b");
      expect(item.detail).toContain("thread-c");
      expect(item.output).toBe("Coordinate work\n\nagent-1: running");
    }
  });

  it("captures rich collab metadata from receiver_agents and agent_statuses", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-rich-1",
      tool: "wait",
      status: "completed",
      sender_thread_id: "thread-parent",
      receiver_agents: [
        {
          thread_id: "thread-child-1",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      agent_statuses: [
        {
          thread_id: "thread-child-1",
          status: "completed",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      prompt: "Wait for workers",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.collabSender).toEqual({ threadId: "thread-parent" });
      expect(item.collabReceiver).toEqual({
        threadId: "thread-child-1",
        nickname: "Robie",
        role: "explorer",
      });
      expect(item.collabReceivers).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
        },
      ]);
      expect(item.collabStatuses).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
          status: "completed",
        },
      ]);
      expect(item.detail).toContain("Robie [explorer]");
      expect(item.output).toContain("Robie [explorer]: completed");
    }
  });

  it("builds context compaction items", () => {
    const item = buildConversationItem({
      type: "contextCompaction",
      id: "compact-1",
      status: "inProgress",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("inProgress");
    }
  });

  it("builds context compaction items from thread history", () => {
    const item = buildConversationItemFromThreadItem({
      type: "context_compaction",
      id: "compact-2",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("completed");
    }
  });

  it("builds OpenAI conversation item type branches", () => {
    const assistant = buildConversationItem({
      type: "assistant-message",
      id: "assistant-openai-1",
      text: "Assistant branch",
    });
    expect(assistant).toMatchObject({
      kind: "message",
      role: "assistant",
      itemType: "assistant-message",
      text: "Assistant branch",
    });

    const user = buildConversationItem({
      type: "user-message",
      id: "user-openai-1",
      text: "User branch",
    });
    expect(user).toMatchObject({
      kind: "message",
      role: "user",
      itemType: "user-message",
      text: "User branch",
    });

    const steeringUser = buildConversationItem({
      type: "user-message",
      id: "user-steering-1",
      text: "Steer the next turn",
      steeringStatus: "Steered conversation",
      messageStatus: "Queued",
    });
    expect(steeringUser).toMatchObject({
      kind: "message",
      role: "user",
      itemType: "user-message",
      text: "Steer the next turn",
      steeringStatus: "Steered conversation",
      messageStatus: "Queued",
    });

    [
      "auto-review-interruption-warning",
      "automation-update",
      "autoApprovalReview",
      "automatic-approval-review",
      "dynamic-tool-call",
      "forked-from-conversation",
      "generated-image",
      "imageGeneration",
      "model-rerouted",
      "model_reroute",
      "multi-agent-action",
      "personality-changed",
      "plan-implementation",
      "proposed-plan",
      "steered",
      "turn-diff",
      "user-input-response",
      "worked-for",
    ].forEach((type) => {
      const expectedItemType =
        type === "autoApprovalReview"
          ? "automatic-approval-review"
          : type === "imageGeneration"
            ? "generated-image"
            : type === "model_reroute"
              ? "model-rerouted"
              : type;
      const item = buildConversationItem({
        type,
        id: `${type}-1`,
        title: type,
        detail: "detail",
        url: "data:image/png;base64,AAA",
      });
      expect(item).not.toBeNull();
      expect(item).toMatchObject({
        kind: "tool",
        itemType: expectedItemType,
      });
      if (item?.kind === "tool" && type === "generated-image") {
        expect(item.generatedImage).toBe("data:image/png;base64,AAA");
      }
      if (item?.kind === "tool" && type === "imageGeneration") {
        expect(item.itemType).toBe("generated-image");
        expect(item.generatedImage).toBe("data:image/png;base64,AAA");
      }
      if (item?.kind === "tool" && type === "autoApprovalReview") {
        expect(item.itemType).toBe("automatic-approval-review");
      }
      if (item?.kind === "tool" && type === "model_reroute") {
        expect(item.itemType).toBe("model-rerouted");
      }
    });
  });

  it("only adds MCP app descriptors when the item carries explicit app metadata", () => {
    const generic = buildConversationItem({
      type: "mcpToolCall",
      id: "mcp-generic-1",
      server: "filesystem",
      tool: "read_file",
      title: "Read file",
      detail: "package.json",
    });
    expect(generic).toMatchObject({
      kind: "tool",
      itemType: "mcp-tool-call",
    });
    if (generic?.kind === "tool") {
      expect(generic.mcpApp).toBeFalsy();
    }

    const app = buildConversationItem({
      type: "mcpToolCall",
      id: "mcp-app-1",
      server: "browser",
      tool: "open",
      title: "Open browser app",
      mcpApp: {
        id: "browser-app",
        title: "Browser",
        expanded: true,
        url: "https://mcp.example.test/app",
      },
    });
    expect(app).toMatchObject({
      kind: "tool",
      itemType: "mcp-tool-call",
      mcpApp: {
        id: "browser-app",
        title: "Browser",
        expanded: true,
        url: "https://mcp.example.test/app",
      },
    });
  });

  it("parses ISO timestamps for thread updates", () => {
    const timestamp = getThreadTimestamp({ updated_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

  it("returns 0 for invalid thread timestamps", () => {
    const timestamp = getThreadTimestamp({ updated_at: "not-a-date" });
    expect(timestamp).toBe(0);
  });

  it("parses created timestamps", () => {
    const timestamp = getThreadCreatedTimestamp({ created_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

});
