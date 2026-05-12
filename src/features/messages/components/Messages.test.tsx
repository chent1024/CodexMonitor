// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { expectOpenedFileTarget } from "../test/fileLinkAssertions";
import { FileChangeSummaryCard } from "./MessageRows";
import { Messages } from "./Messages";

const useFileLinkOpenerMock = vi.fn(
  (_workspacePath: string | null, _openTargets: unknown[], _selectedOpenAppId: string) => ({
    openFileLink: openFileLinkMock,
    showFileLinkMenu: showFileLinkMenuMock,
  }),
);
const openFileLinkMock = vi.fn();
const showFileLinkMenuMock = vi.fn();
const { exportMarkdownFileMock } = vi.hoisted(() => ({
  exportMarkdownFileMock: vi.fn(),
}));

vi.mock("../hooks/useFileLinkOpener", () => ({
  useFileLinkOpener: (
    workspacePath: string | null,
    openTargets: unknown[],
    selectedOpenAppId: string,
  ) => useFileLinkOpenerMock(workspacePath, openTargets, selectedOpenAppId),
}));

vi.mock("@services/tauri", async () => {
  const actual = await vi.importActual<typeof import("@services/tauri")>(
    "@services/tauri",
  );
  return {
    ...actual,
    exportMarkdownFile: exportMarkdownFileMock,
  };
});

vi.mock("../../git/components/PierreDiffBlock", () => ({
  PierreDiffBlock: ({ diff, displayPath }: { diff: string; displayPath: string }) => (
    <pre data-testid="mock-pierre-diff-block">
      {displayPath}
      {"\n"}
      {diff}
    </pre>
  ),
}));

describe("Messages", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useFileLinkOpenerMock.mockClear();
    openFileLinkMock.mockReset();
    showFileLinkMenuMock.mockReset();
    exportMarkdownFileMock.mockReset();
  });

  it("renders user attachments above the bubble and opens image lightbox", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-1",
        kind: "message",
        role: "user",
        text: "Hello",
        images: ["data:image/png;base64,AAA"],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const attachments = container.querySelector("[data-user-message-attachments]");
    const bubble = container.querySelector('[data-message-author-role="user"] > [data-message-part="content"]');
    const grid = container.querySelector(".oai-message-image-grid");
    const markdown = container.querySelector(".markdown");
    expect(attachments).toBeTruthy();
    expect(bubble).toBeTruthy();
    expect(grid).toBeTruthy();
    expect(markdown).toBeTruthy();
    expect(attachments?.contains(grid)).toBe(true);
    expect(bubble?.contains(grid)).toBe(false);
    expect(bubble?.querySelector(".oai-message-content")?.contains(markdown)).toBe(true);
    const openButton = screen.getByRole("button", { name: "Open image 1" });
    fireEvent.click(openButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("groups user prompt and agent response into conversation turn slots", () => {
    const items: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Inspect the renderer",
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg renderer",
        detail: "/repo",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "Renderer inspected.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const turn = container.querySelector("[data-turn-key]");
    expect(turn).toBeTruthy();
    expect(container.querySelectorAll("[data-turn-key]").length).toBe(1);
    expect(container.querySelector(".conversation-turn")).toBeNull();
    expect(container.querySelector(".message.user")).toBeNull();
    expect(container.querySelector(".message.assistant")).toBeNull();
    expect(container.querySelector('[data-thread-find-target="conversation"]')).toBeTruthy();
    expect(container.querySelector(".oai-conversation-thread")).toBeTruthy();
    expect(turn?.getAttribute("data-turn-key")).toBe("user:user-1");
    expect(turn?.getAttribute("data-content-search-turn-key")).toBe("user:user-1");
    expect(turn?.getAttribute("data-content-search-assistant-turn-key")).toBe(
      "assistant:assistant-turn-tool-1-assistant-1",
    );
    expect(turn?.getAttribute("data-turn-orphan")).toBe("false");
    expect(
      turn?.querySelector('[data-turn-slot="user"].oai-user-turn-slot[data-content-search-unit-key] [data-message-author-role="user"]'),
    ).toBeTruthy();
    expect(
      turn?.querySelector('[data-turn-slot="agent"].oai-agent-turn-slot [data-content-search-unit-key].oai-content-search-unit [data-assistant-turn]'),
    ).toBeTruthy();
    expect(
      turn?.querySelectorAll("[data-content-search-unit-key]").length,
    ).toBeGreaterThanOrEqual(2);
    const userMessage = turn?.querySelector('[data-turn-slot="user"] [data-message-author-role="user"]');
    expect(userMessage?.classList.contains("oai-user-message-group")).toBe(true);
    expect(userMessage?.classList.contains("group")).toBe(true);
    expect(userMessage?.classList.contains("items-end")).toBe(true);
    expect(userMessage?.classList.contains("justify-end")).toBe(true);
    const userMetadata = userMessage?.children.item(0);
    const userBubble = userMessage?.children.item(1);
    const userActions = userMessage?.children.item(2);
    expect(userMetadata?.getAttribute("data-user-message-metadata")).toBe("");
    expect(userMetadata?.classList.contains("ms-1")).toBe(true);
    expect(userMetadata?.classList.contains("mr-1")).toBe(true);
    expect(userBubble?.getAttribute("data-message-part")).toBe("content");
    expect(userBubble?.classList.contains("max-w-[77%]")).toBe(true);
    expect(userBubble?.classList.contains("rounded-2xl")).toBe(true);
    expect(userBubble?.classList.contains("message-bubble")).toBe(false);
    expect(
      userMessage?.querySelector(".oai-message-content")?.classList.contains("contain-inline-size"),
    ).toBe(true);
    expect(userActions?.getAttribute("data-message-part")).toBe("actions");
    expect(userActions?.classList.contains("flex-row-reverse")).toBe(true);
    expect(userMessage?.querySelector("[data-message-actions-controls]")).toBeTruthy();
    expect(userActions?.classList.contains("message-actions")).toBe(false);
    const userActionRow = userMessage?.querySelector("[data-message-actions-row]");
    expect(userActionRow?.classList.contains("mr-1")).toBe(true);
    expect(userActionRow?.classList.contains("ms-1")).toBe(true);
    expect(userMessage?.querySelector('[data-message-action="copy"]')).toBeTruthy();
    const assistantTurn = turn?.querySelector('[data-turn-slot="agent"] [data-assistant-turn]');
    expect(assistantTurn?.classList.contains("oai-assistant-turn")).toBe(true);
    expect(assistantTurn?.querySelector("[data-assistant-turn-body]")).toBeTruthy();
    const assistantMessage = assistantTurn?.querySelector('[data-message-author-role="assistant"]');
    expect(assistantMessage?.querySelector('[data-message-part="actions"]')).toBeNull();
    const assistantBody = assistantTurn?.querySelector("[data-assistant-turn-body]");
    expect(assistantBody?.querySelector("[data-assistant-turn-body-motion]")).toBeTruthy();
    expect(assistantBody?.querySelector("[data-assistant-turn-body-stack]")).toBeTruthy();
    const assistantFooter = assistantTurn?.querySelector("[data-assistant-turn-footer]");
    expect(assistantFooter).toBeTruthy();
    expect(
      assistantFooter?.children.item(0)?.classList.contains("oai-assistant-actions"),
    ).toBe(true);
    expect(
      assistantFooter?.children.item(0)?.classList.contains("message-actions"),
    ).toBe(false);
    const assistantActionRow = assistantFooter?.querySelector("[data-message-actions-row]");
    expect(assistantActionRow?.classList.contains("mr-1")).toBe(true);
    expect(assistantActionRow?.classList.contains("ms-1")).toBe(true);
    expect(assistantActionRow?.querySelector("[data-message-action-metadata]")).toBeTruthy();
    expect(assistantActionRow?.querySelector('[data-message-action="copy"]')).toBeTruthy();
    expect(turn?.getAttribute("data-content-search-turn-index")).toBe("0");
    expect(turn?.getAttribute("data-scroll-to-key")).toBe("user:user-1");
    expect(
      turn
        ?.querySelector('[data-content-search-unit-kind="assistant-turn"]')
        ?.getAttribute("data-scroll-to-key"),
    ).toContain("assistant");
    expect(turn?.querySelector('[data-message-role="user"]')?.textContent ?? "").toContain(
      "Inspect the renderer",
    );
    expect(turn?.querySelector('[data-message-role="assistant"]')?.textContent ?? "").toContain(
      "Renderer inspected.",
    );
  });

  it("renders empty user messages with the OpenAI no-content fallback", () => {
    const items: ConversationItem[] = [
      {
        id: "empty-user",
        kind: "message",
        role: "user",
        text: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const fallback = container.querySelector("[data-message-empty-content]");
    expect(fallback?.textContent).toBe("(No content)");
    expect(fallback?.classList.contains("text-size-chat")).toBe(true);
    expect(fallback?.classList.contains("mb-px")).toBe(true);
    expect(
      fallback?.classList.contains("text-token-description-foreground"),
    ).toBe(true);
  });

  it("renders assistant sibling turn selector contract when alternates exist", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-sibling",
        kind: "message",
        role: "assistant",
        text: "Alternative response.",
        siblingTurnCount: 3,
        selectedTurnIndex: 1,
        selectedTurnId: "assistant-turn-selected",
        hasAppliedCodeLocally: true,
        forkTurnId: "turn-fork-1",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const selector = container.querySelector("[data-assistant-turn-selector]");
    expect(selector).toBeTruthy();
    expect(selector?.getAttribute("data-selected-turn")).toBe("1");
    expect(selector?.getAttribute("data-selected-turn-id")).toBe("assistant-turn-selected");
    expect(selector?.getAttribute("data-has-applied-code-locally")).toBe("true");
    expect(selector?.getAttribute("data-sibling-turn-count")).toBe("3");
    expect(selector?.getAttribute("data-on-fork-turn")).toBe("turn-fork-1");
    expect(selector?.textContent ?? "").toContain("2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous assistant response" }));
    expect(selector?.getAttribute("data-selected-turn")).toBe("0");
    expect(screen.getByRole("button", { name: "Fork assistant response" })).toBeTruthy();
  });

  it("renders the OpenAI user metadata slot and derived chips", () => {
    const items: ConversationItem[] = [
      {
        id: "metadata-user",
        kind: "message",
        role: "user",
        text: "Use prior conversation context and review mode.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const metadata = container.querySelector("[data-user-message-metadata]");
    expect(metadata?.classList.contains("ms-1")).toBe(true);
    expect(metadata?.classList.contains("mr-1")).toBe(true);
    expect(container.querySelectorAll("[data-user-message-metadata-chip]").length).toBe(2);
    expect(
      container.querySelector('[data-user-message-metadata-kind="prior-conversation"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-user-message-metadata-kind="review-mode"]'),
    ).toBeTruthy();
    expect(metadata?.textContent ?? "").toContain("References prior conversation");
    expect(metadata?.textContent ?? "").toContain("Review mode");
  });

  it("renders explicit OpenAI user metadata and file attachment structure", () => {
    const items: ConversationItem[] = [
      {
        id: "rich-user",
        kind: "message",
        role: "user",
        text: "Review this patch",
        attachments: [{ path: "/repo/src/App.tsx", kind: "file" }],
        codexDelegation: { sourceThreadId: "thread-source" },
        heartbeatTrigger: { automationId: "automation-1" },
        forkedFromConversation: { sourceConversationId: "fork-source" },
        referencesPriorConversation: true,
        reviewMode: true,
        pullRequestFixMode: true,
        autoResolveSync: true,
        commentCount: 2,
        browserCommentCount: 3,
        diffCommentCount: 4,
        selectedTextAttachmentCount: 5,
        pullRequestCheckCount: 1,
        messageStatus: "Steered conversation",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const attachments = container.querySelector("[data-user-message-attachments]");
    expect(attachments).toBeTruthy();
    expect(attachments?.textContent ?? "").toContain("App.tsx");
    expect(
      attachments?.querySelector('[data-user-message-attachment][data-attachment-kind="file"]'),
    ).toBeTruthy();
    expect(attachments?.querySelector('[class~="group/file-attachment"]')).toBeTruthy();
    expect(attachments?.querySelector('[data-attachment-kind="codexDelegation"]')).toBeTruthy();
    expect(attachments?.querySelector('[data-attachment-kind="heartbeatTrigger"]')).toBeTruthy();
    expect(attachments?.querySelector('[data-attachment-kind="forkedFromConversation"]')).toBeTruthy();
    expect(attachments?.querySelector('[data-attachment-kind="browserCommentCount"]')?.textContent).toContain("3 browser comments");
    expect(attachments?.querySelector('[data-attachment-kind="diffCommentCount"]')?.textContent).toContain("4 diff comments");
    expect(attachments?.querySelector('[data-attachment-kind="selectedTextAttachmentCount"]')?.textContent).toContain("5 selected text");
    expect(container.querySelector('[data-user-message-metadata-kind="pull-request-fix"]')).toBeTruthy();
    expect(container.querySelector('[data-user-message-metadata-kind="auto-resolve-sync"]')).toBeTruthy();
    expect(container.querySelector('[data-user-message-metadata-kind="comments"]')?.textContent).toContain("2 comments");
    expect(container.querySelector('[data-user-message-metadata-kind="browser-comments"]')?.textContent).toContain("3 browser comments");
    expect(container.querySelector('[data-user-message-metadata-kind="diff-comments"]')?.textContent).toContain("4 diff comments");
    expect(container.querySelector('[data-user-message-metadata-kind="selected-text-attachments"]')?.textContent).toContain("5 selected text attachments");
    expect(container.querySelector('[data-user-message-metadata-kind="pull-request-checks"]')?.textContent).toContain("1 PR check");
    expect(container.querySelector('[data-user-message-metadata-kind="message-status"]')?.textContent).toContain("Steered conversation");
    expect(
      container
        .querySelector('[data-message-author-role="user"] > [data-message-part="content"]')
        ?.getAttribute("data-message-has-attachments"),
    ).toBe("true");
  });

  it("renders OpenAI parent context, user collapse, and edit structure", () => {
    const items: ConversationItem[] = [
      {
        id: "rich-user-openai-contract",
        kind: "message",
        role: "user",
        text: Array.from({ length: 6 }, (_, index) => `Line ${index + 1}`).join("\n"),
        collapsedLineCount: 2,
        canEdit: true,
        parentContext: {
          sourceConversationId: "parent-thread-1",
          label: "Parent chat",
          kind: "parent-context",
        },
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const parentContext = container.querySelector("[data-parent-context]");
    expect(parentContext).toBeTruthy();
    expect(parentContext?.getAttribute("data-source-conversation-id")).toBe("parent-thread-1");
    expect(parentContext?.getAttribute("data-attachment-kind")).toBe("parent-context");
    const userText = container.querySelector("[data-user-message-text]");
    expect(userText?.getAttribute("data-user-message-collapsed")).toBe("true");
    const collapseToggle = screen.getByRole("button", { name: "Show more" });
    fireEvent.click(collapseToggle);
    expect(container.querySelector("[data-user-message-text]")?.getAttribute("data-user-message-collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    expect(container.querySelector("[data-user-message-edit-form]")).toBeTruthy();
    expect(container.querySelector("[data-user-message-edit-textarea]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(container.querySelector(".oai-user-message-edit-submit")?.getAttribute("data-send-edited-message")).toBe("sendEditedMessage");
    expect(container.querySelector(".oai-user-message-edit-cancel")?.getAttribute("data-cancel-edit-message")).toBe("cancelEditMessage");
    expect(
      container.querySelector('[data-message-author-role="user"] [data-editing-message-id]')?.getAttribute("data-editing-message-id"),
    ).toBe("rich-user-openai-contract");
    fireEvent.change(container.querySelector("[data-user-message-edit-textarea]")!, {
      target: { value: "Edited OpenAI-style user message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByText("Edited OpenAI-style user message")).toBeTruthy();
  });

  it("preserves newlines when images are attached", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-2",
        kind: "message",
        role: "user",
        text: "Line 1\n\n- item 1\n- item 2",
        images: ["data:image/png;base64,AAA"],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdown = container.querySelector(".markdown");
    expect(markdown).toBeTruthy();
    expect(markdown?.textContent ?? "").toContain("Line 1");
    expect(markdown?.textContent ?? "").toContain("item 1");
    expect(markdown?.textContent ?? "").toContain("item 2");
  });

  it("keeps literal [image] text when images are attached", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-3",
        kind: "message",
        role: "user",
        text: "Literal [image] token",
        images: ["data:image/png;base64,AAA"],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const markdown = container.querySelector(".markdown");
    expect(markdown?.textContent ?? "").toContain("Literal [image] token");
  });

  it("uses the table container as the visual bubble for assistant table-only messages", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-table-1",
        kind: "message",
        role: "assistant",
        text: [
          "src/features/app/hooks/useMainAppLayoutSurfaces.ts | category=clarity | Layout assembly is still too broad. | Split surface assembly by domain. | high",
          "",
          "src/features/threads/hooks/threadMessagingHelpers.ts | category=clarity | Helper responsibilities are too broad. | Split helpers by concern. | medium",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".oai-assistant-table-only")).toBeTruthy();
    expect(container.querySelector(".message-bubble-table-only")).toBeNull();
    expect(container.querySelector(".markdown-table-wrap")).toBeTruthy();
  });

  it("quotes a message into composer using markdown blockquote format", () => {
    const onQuoteMessage = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "msg-quote-1",
        kind: "message",
        role: "assistant",
        text: "First line\nSecond line",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onQuoteMessage={onQuoteMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Quote message" }));
    expect(onQuoteMessage).toHaveBeenCalledWith("> First line\n> Second line\n\n");
  });

  it("quotes selected message fragment when text is highlighted", () => {
    const onQuoteMessage = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "msg-quote-selection-1",
        kind: "message",
        role: "assistant",
        text: "Alpha beta gamma",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onQuoteMessage={onQuoteMessage}
      />,
    );

    const textNode = screen.getByText("Alpha beta gamma").firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error("Expected message text node");
    }
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const quoteButton = screen.getByRole("button", { name: "Quote message" });
    fireEvent.mouseDown(quoteButton);
    fireEvent.click(quoteButton);

    expect(onQuoteMessage).toHaveBeenCalledWith("> beta\n\n");
    selection?.removeAllRanges();
  });

  it("opens linked review thread when clicking thread link", () => {
    const onOpenThreadLink = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "msg-thread-link",
        kind: "message",
        role: "assistant",
        text: "Detached review completed. [Open review thread](/thread/thread-review-1)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-parent"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onOpenThreadLink={onOpenThreadLink}
      />,
    );

    fireEvent.click(screen.getByText("Open review thread"));
    expect(onOpenThreadLink).toHaveBeenCalledWith("thread-review-1", "ws-1");
  });

  it("renders file references as compact links and opens them", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-file-link",
        kind: "message",
        role: "assistant",
        text: "Refactor candidate: `iosApp/src/views/DocumentsList/DocumentListView.swift:111`",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const fileLinkName = screen.getByText("DocumentListView.swift");
    const fileLinkLine = screen.getByText("L111");
    const fileLinkPath = screen.getByText("iosApp/src/views/DocumentsList");
    const fileLink = container.querySelector(".oai-message-file-link");
    expect(fileLinkName).toBeTruthy();
    expect(fileLinkLine).toBeTruthy();
    expect(fileLinkPath).toBeTruthy();
    expect(fileLink).toBeTruthy();
    expect(fileLink?.classList.contains("group/inline-mention")).toBe(true);
    expect(fileLink?.classList.contains("group/file-diff")).toBe(true);

    fireEvent.click(fileLink as Element);
    expectOpenedFileTarget(
      openFileLinkMock,
      "iosApp/src/views/DocumentsList/DocumentListView.swift",
      111,
    );
  });

  it("routes markdown href file paths through the file opener", () => {
    const linkedPath =
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx:244";
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-link",
        kind: "message",
        role: "assistant",
        text: `Open [this file](${linkedPath})`,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("this file"));
    expectOpenedFileTarget(
      openFileLinkMock,
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx",
      244,
    );
  });

  it("routes absolute non-whitelisted file href paths through the file opener", () => {
    const linkedPath = "/custom/project/src/App.tsx:12";
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-absolute-non-whitelisted-link",
        kind: "message",
        role: "assistant",
        text: `Open [app file](${linkedPath})`,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("app file"));
    expectOpenedFileTarget(openFileLinkMock, "/custom/project/src/App.tsx", 12);
  });

  it("decodes percent-encoded href file paths before opening", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-encoded-link",
        kind: "message",
        role: "assistant",
        text: "Open [guide](./docs/My%20Guide.md)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("guide"));
    expectOpenedFileTarget(openFileLinkMock, "./docs/My Guide.md");
  });

  it("routes absolute href file paths with #L anchors through the file opener", () => {
    const linkedPath =
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx#L244";
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-anchor-link",
        kind: "message",
        role: "assistant",
        text: `Open [this file](${linkedPath})`,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("this file"));
    expectOpenedFileTarget(
      openFileLinkMock,
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx",
      244,
    );
  });

  it("routes Windows absolute href file paths with #L anchors through the file opener", () => {
    const linkedPath =
      "I:\\gpt-projects\\CodexMonitor\\src\\features\\settings\\components\\sections\\SettingsDisplaySection.tsx#L422";
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-windows-anchor-link",
        kind: "message",
        role: "assistant",
        text: `Open [settings display](${linkedPath})`,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("settings display"));
    expectOpenedFileTarget(
      openFileLinkMock,
      "I:\\gpt-projects\\CodexMonitor\\src\\features\\settings\\components\\sections\\SettingsDisplaySection.tsx",
      422,
    );
  });

  it("routes dotless workspace href file paths through the file opener", () => {
    const linkedPath = "/workspace/CodexMonitor/LICENSE";
    const items: ConversationItem[] = [
      {
        id: "msg-file-href-workspace-dotless-link",
        kind: "message",
        role: "assistant",
        text: `Open [license](${linkedPath})`,
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("license"));
    expectOpenedFileTarget(openFileLinkMock, linkedPath);
  });

  it("keeps non-file relative links as normal markdown links", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-help-href-link",
        kind: "message",
        role: "assistant",
        text: "See [Help](/help/getting-started)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const helpLink = screen.getByText("Help").closest("a");
    expect(helpLink?.getAttribute("href")).toBe("/help/getting-started");
    fireEvent.click(screen.getByText("Help"));
    expect(openFileLinkMock).not.toHaveBeenCalled();
  });

  it("keeps route-like absolute links as normal markdown links", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-help-workspace-route-link",
        kind: "message",
        role: "assistant",
        text: "See [Workspace Home](/workspace/settings)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const link = screen.getByText("Workspace Home").closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/settings");
    fireEvent.click(screen.getByText("Workspace Home"));
    expect(openFileLinkMock).not.toHaveBeenCalled();
  });

  it("keeps deep workspace route links as normal markdown links", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-help-workspace-route-link-deep",
        kind: "message",
        role: "assistant",
        text: "See [Profile](/workspace/settings/profile)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const link = screen.getByText("Profile").closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/settings/profile");
    fireEvent.click(screen.getByText("Profile"));
    expect(openFileLinkMock).not.toHaveBeenCalled();
  });

  it("keeps dot-relative non-file links as normal markdown links", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-help-dot-relative-href-link",
        kind: "message",
        role: "assistant",
        text: "See [Help](./help/getting-started)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const helpLink = screen.getByText("Help").closest("a");
    expect(helpLink?.getAttribute("href")).toBe("./help/getting-started");
    fireEvent.click(screen.getByText("Help"));
    expect(openFileLinkMock).not.toHaveBeenCalled();
  });

  it("does not crash or navigate on malformed codex-file links", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-malformed-file-link",
        kind: "message",
        role: "assistant",
        text: "Bad [path](codex-file:%E0%A4%A)",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    fireEvent.click(screen.getByText("path"));
    expect(openFileLinkMock).not.toHaveBeenCalled();
  });

  it("hides file parent paths when message file path display is disabled", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-file-link-hidden-path",
        kind: "message",
        role: "assistant",
        text: "Refactor candidate: `iosApp/src/views/DocumentsList/DocumentListView.swift:111`",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        showMessageFilePath={false}
      />,
    );

    const fileName = container.querySelector(".oai-message-file-link-name");
    const lineLabel = container.querySelector(".oai-message-file-link-line");
    expect(fileName?.textContent).toBe("DocumentListView.swift");
    expect(lineLabel?.textContent).toBe("L111");
    expect(container.querySelector(".oai-message-file-link-path")).toBeNull();
  });

  it("renders absolute file references as workspace-relative paths", () => {
    const workspacePath = "/Users/dimillian/Documents/Dev/CodexMonitor";
    const absolutePath =
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx:244";
    const items: ConversationItem[] = [
      {
        id: "msg-file-link-absolute-inside",
        kind: "message",
        role: "assistant",
        text: `Reference: \`${absolutePath}\``,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        workspacePath={workspacePath}
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Markdown.tsx")).toBeTruthy();
    expect(screen.getByText("L244")).toBeTruthy();
    expect(screen.getByText("src/features/messages/components")).toBeTruthy();

    const fileLink = container.querySelector(".oai-message-file-link");
    expect(fileLink).toBeTruthy();
    fireEvent.click(fileLink as Element);
    expectOpenedFileTarget(
      openFileLinkMock,
      "/Users/dimillian/Documents/Dev/CodexMonitor/src/features/messages/components/Markdown.tsx",
      244,
    );
  });

  it("renders absolute file references outside workspace using dotdot-relative paths", () => {
    const workspacePath = "/Users/dimillian/Documents/Dev/CodexMonitor";
    const absolutePath = "/Users/dimillian/Documents/Other/IceCubesApp/file.rs:123";
    const items: ConversationItem[] = [
      {
        id: "msg-file-link-absolute-outside",
        kind: "message",
        role: "assistant",
        text: `Reference: \`${absolutePath}\``,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        workspacePath={workspacePath}
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("file.rs")).toBeTruthy();
    expect(screen.getByText("L123")).toBeTruthy();
    expect(screen.getByText("../../Other/IceCubesApp")).toBeTruthy();

    const fileLink = container.querySelector(".oai-message-file-link");
    expect(fileLink).toBeTruthy();
    fireEvent.click(fileLink as Element);
    expectOpenedFileTarget(
      openFileLinkMock,
      "/Users/dimillian/Documents/Other/IceCubesApp/file.rs",
      123,
    );
  });

  it("does not re-render messages while typing when message props stay stable", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-stable-1",
        kind: "message",
        role: "assistant",
        text: "Stable content",
      },
    ];
    const openTargets: [] = [];
    function Harness() {
      const [draft, setDraft] = useState("");
      const handleOpenThreadLink = useCallback(() => {}, []);

      return (
        <div>
          <input
            aria-label="Draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Messages
            items={items}
            threadId="thread-stable"
            workspaceId="ws-1"
            isThinking={false}
            openTargets={openTargets}
            selectedOpenAppId=""
            onOpenThreadLink={handleOpenThreadLink}
          />
        </div>
      );
    }

    render(<Harness />);
    expect(useFileLinkOpenerMock).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText("Draft");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    expect(useFileLinkOpenerMock).toHaveBeenCalledTimes(1);
  });

  it("uses reasoning title for the working indicator and hides title-only reasoning rows", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "Scanning repository",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector("[data-oai-thinking-shimmer-label]");
    expect(workingText?.textContent ?? "").toContain("Scanning repository");
    expect(container.querySelector("[data-oai-reasoning-detail]")).toBeNull();
    expect(container.querySelector(".working-text")).toBeNull();
  });

  it("renders reasoning rows when there is reasoning body content", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-2",
        kind: "reasoning",
        summary: "Scanning repository\nLooking for entry points",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector("[data-oai-reasoning-detail]")).toBeTruthy();
    const reasoningDetail = container.querySelector(".oai-reasoning-detail-body");
    expect(reasoningDetail?.textContent ?? "").toContain("Looking for entry points");
    const workingText = container.querySelector("[data-oai-thinking-shimmer-label]");
    expect(workingText?.textContent ?? "").toContain("Scanning repository");
  });

  it("uses content for the reasoning title when summary is empty", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-content-title",
        kind: "reasoning",
        summary: "",
        content: "Plan from content\nMore detail here",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_500}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector("[data-oai-thinking-shimmer-label]");
    expect(workingText?.textContent ?? "").toContain("Plan from content");
    const reasoningDetail = container.querySelector(".oai-reasoning-detail-body");
    expect(reasoningDetail?.textContent ?? "").toContain("More detail here");
    expect(reasoningDetail?.textContent ?? "").not.toContain("Plan from content");
  });

  it("does not show a stale reasoning label from a previous turn", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-old",
        kind: "reasoning",
        summary: "Old reasoning title",
        content: "",
      },
      {
        id: "assistant-msg",
        kind: "message",
        role: "assistant",
        text: "Previous assistant response",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 800}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector("[data-oai-thinking-shimmer-label]");
    expect(workingText?.textContent ?? "").toContain("Working");
    expect(workingText?.textContent ?? "").not.toContain("Old reasoning title");
  });

  it("keeps the latest title-only reasoning label without rendering a reasoning row", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-title-only",
        kind: "reasoning",
        summary: "Indexing workspace",
        content: "",
      },
      {
        id: "tool-after-reasoning",
        kind: "tool",
        title: "Command: rg --files",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "",
        status: "running",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector("[data-oai-thinking-shimmer-label]");
    expect(workingText?.textContent ?? "").toContain("Indexing workspace");
    expect(container.querySelector("[data-oai-reasoning-detail]")).toBeNull();
  });

  it("shows polling fetch countdown text instead of done duration when requested", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        {
          id: "assistant-msg-done",
          kind: "message",
          role: "assistant",
          text: "Completed response",
        },
      ];

      render(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking={false}
          lastDurationMs={4_000}
          showPollingFetchStatus
          pollingIntervalMs={12_000}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(
        screen.getByText("New message will be fetched in 12 seconds"),
      ).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(
        screen.getByText("New message will be fetched in 11 seconds"),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps done duration text when polling fetch countdown is not requested", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-msg-done-default",
        kind: "message",
        role: "assistant",
        text: "Completed response",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        lastDurationMs={4_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Done in 0:04")).toBeTruthy();
  });

  it("renders answered user input items with preview and expandable details", () => {
    const items: ConversationItem[] = [
      {
        id: "user-input-1",
        kind: "userInput",
        status: "answered",
        questions: [
          {
            id: "q1",
            header: "Confirm",
            question: "Proceed with deployment?",
            answers: ["Yes", "user_note: after running tests"],
          },
        ],
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      screen.getByText(/Proceed with deployment\?: Yes \+1/),
    ).toBeTruthy();
    expect(screen.queryByText("user_note: after running tests")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle answered input details" }),
    );

    expect(screen.getByText("user_note: after running tests")).toBeTruthy();
  });

  it("merges consecutive explore items under a single explored block", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-1",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "search", label: "Find routes" }],
      },
      {
        id: "explore-2",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "routes.ts" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-oai-explore-detail]")).toBeTruthy();
    });
    expect(screen.queryByText(/tool calls/i)).toBeNull();
    const exploreItems = container.querySelectorAll(".oai-explore-item");
    expect(exploreItems.length).toBe(2);
    expect(container.querySelector(".explore-inline-title")).toBeNull();
    expect(container.querySelector(".explore-inline-item")).toBeNull();
    expect(screen.getByText("Find routes")).toBeTruthy();
    expect(screen.getByText("routes.ts")).toBeTruthy();
  });

  it("uses the latest explore status when merging a consecutive run", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-started",
        kind: "explore",
        status: "exploring",
        entries: [{ kind: "search", label: "starting" }],
      },
      {
        id: "explore-finished",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "finished" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-oai-explore-detail]").length).toBe(1);
    });
    expect(container.querySelector(".explore-inline-title")).toBeNull();
    expect(container.querySelector(".explore-inline-item")).toBeNull();
    expect(screen.getByText("starting")).toBeTruthy();
    expect(screen.getByText("finished")).toBeTruthy();
  });

  it("does not merge explore items across interleaved tools", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-a",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "search", label: "Find reducers" }],
      },
      {
        id: "tool-a",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg reducers",
        detail: "/repo",
        status: "completed",
        output: "",
      },
      {
        id: "explore-b",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "useThreadsReducer.ts" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      const exploreBlocks = container.querySelectorAll("[data-oai-explore-detail]");
      expect(exploreBlocks.length).toBe(2);
    });
    const exploreItems = container.querySelectorAll(".oai-explore-item");
    expect(exploreItems.length).toBe(2);
    expect(screen.getByText(/rg reducers/i)).toBeTruthy();
  });

  it("preserves chronology when reasoning with body appears between explore items", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-1",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "search", label: "first explore" }],
      },
      {
        id: "reasoning-body",
        kind: "reasoning",
        summary: "Reasoning title\nReasoning body",
        content: "",
      },
      {
        id: "explore-2",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "second explore" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-oai-explore-detail]").length).toBe(2);
    });
    const exploreBlocks = Array.from(container.querySelectorAll("[data-oai-explore-detail]"));
    const reasoningDetail = container.querySelector(".oai-reasoning-detail-body");
    expect(exploreBlocks.length).toBe(2);
    expect(reasoningDetail).toBeTruthy();
    const [firstExploreBlock, secondExploreBlock] = exploreBlocks;
    const firstBeforeReasoning =
      firstExploreBlock.compareDocumentPosition(reasoningDetail as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    const reasoningBeforeSecond =
      (reasoningDetail as Node).compareDocumentPosition(secondExploreBlock) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(firstBeforeReasoning).toBeTruthy();
    expect(reasoningBeforeSecond).toBeTruthy();
  });

  it("folds activity around an assistant message into a Codex-like processed turn", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-before",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "search", label: "before message" }],
      },
      {
        id: "assistant-msg",
        kind: "message",
        role: "assistant",
        text: "A message between explore blocks",
      },
      {
        id: "explore-after",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "after message" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("A message between explore blocks")).toBeTruthy();
    });
    expect(screen.getAllByRole("button", { name: /已处理/i }).length).toBe(1);
    expect(container.querySelectorAll("[data-oai-explore-detail]").length).toBe(0);

    container
      .querySelectorAll("[data-collapsed-tool-activity-summary]")
      .forEach((button) => fireEvent.click(button));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-collapsed-tool-activity-item]").length).toBe(2);
    });
    expect(screen.getByRole("button", { name: /已探索 1 次搜索/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /已探索 1 个文件/i })).toBeTruthy();
    expect(container.querySelectorAll(".oai-explore-item").length).toBe(0);
    expect(container.querySelectorAll(".explore-inline-item").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /已探索 1 次搜索/i }));
    fireEvent.click(screen.getByRole("button", { name: /已探索 1 个文件/i }));

    await waitFor(() => {
      expect(container.querySelectorAll(".oai-explore-item").length).toBe(2);
    });
    expect(screen.getByText("before message")).toBeTruthy();
    expect(screen.getByText("after message")).toBeTruthy();
  });

  it("keeps edited file details folded until each summary is expanded", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-file-change",
        kind: "message",
        role: "user",
        text: "Update the message renderer",
      },
      {
        id: "tool-file-change",
        kind: "tool",
        toolType: "fileChange",
        title: "File changes",
        detail: "",
        status: "completed",
        changes: [
          {
            path: "src/features/messages/components/Messages.tsx",
            repositorySource: "cloud",
            reviewSummarySource: "cloud-review",
            generatedPathsReady: true,
            diff: [
              "diff --git a/src/features/messages/components/Messages.tsx b/src/features/messages/components/Messages.tsx",
              "@@ -1,2 +1,3 @@",
              "-old line",
              "+new line",
              "+extra line",
            ].join("\n"),
          },
        ],
      },
      {
        id: "assistant-file-change",
        kind: "message",
        role: "assistant",
        text: "已改好。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /已处理 1 个操作/i })).toBeTruthy();
    });
    const activitySummary = screen.getByRole("button", { name: /已处理 1 个操作/i });
    const activityBlock = activitySummary.closest("[data-collapsed-tool-activity]");
    expect(activityBlock).toBeTruthy();
    expect(activityBlock?.getAttribute("data-collapsed-tool-activity-expanded")).toBe("false");
    expect(activityBlock?.getAttribute("data-collapsed-tool-activity-type")).toBe("patch");
    expect(activityBlock?.getAttribute("data-conversation-detail-level")).toBe("STEPS_PROSE");
    expect(activityBlock?.getAttribute("data-is-activity-slice-closed")).toBe("true");
    expect(activityBlock?.getAttribute("data-should-auto-expand-mcp-apps")).toBe("false");
    expect(activityBlock?.getAttribute("data-mcp-server-statuses")).toBe("{}");
    expect(activitySummary.closest("[data-collapsed-tool-activity-offset]")).toBeTruthy();
    expect(activitySummary.closest(".oai-collapsed-tool-activity-offset")).toBeTruthy();
    expect(activitySummary.closest(".oai-collapsed-tool-activity-stack")).toBeTruthy();
    const assistantBody = container.querySelector("[data-assistant-turn-body]");
    expect(container.querySelector("[data-conversation-tool-assistant-gap]")).toBeTruthy();
    expect(assistantBody?.getAttribute("data-assistant-turn-body-has-activity")).toBe("true");
    expect(assistantBody?.getAttribute("data-assistant-turn-body-expanded")).toBe("false");
    expect(container.querySelector("[data-assistant-turn-body-stack]")).toBeTruthy();
    expect(activitySummary.classList.contains("oai-collapsed-tool-activity-summary")).toBe(
      true,
    );
    expect(activitySummary.classList.contains("text-size-chat")).toBe(true);
    expect(activitySummary.classList.contains("hover:bg-token-bg-subtle")).toBe(true);
    const dividerShell = activitySummary.nextElementSibling;
    expect(dividerShell?.classList.contains("oai-collapsed-tool-activity-divider-shell")).toBe(
      true,
    );
    expect(dividerShell?.classList.contains("pt-1")).toBe(true);
    expect(
      dividerShell?.firstElementChild?.classList.contains("oai-collapsed-tool-activity-divider"),
    ).toBe(true);
    expect(dividerShell?.firstElementChild?.classList.contains("border-token-border-light")).toBe(true);
    expect(activitySummary.hasAttribute("data-collapsed-tool-activity-summary")).toBe(true);
    const activityText = activitySummary.querySelector(".oai-collapsed-tool-activity-text");
    expect(activityText?.classList.contains("shrink")).toBe(true);
    expect(activityText?.classList.contains("pr-1")).toBe(true);
    const activityChevron = activitySummary.querySelector(".oai-collapsed-tool-activity-chevron");
    expect(activityChevron).toBeTruthy();
    expect(activityChevron?.classList.contains("inline-chevron")).toBe(true);
    expect(activityChevron?.classList.contains("group-hover/summary:opacity-100")).toBe(true);
    expect(activityChevron?.classList.contains("rotate-0")).toBe(true);
    expect(container.querySelector("[data-codex-review-diff-summary]")).toBeTruthy();
    expect(container.querySelector(".oai-review-diff-summary-card")).toBeTruthy();
    expect(
      container.querySelector(
        '[data-assistant-turn-footer] [data-diffs][data-diffs-mode="summary"]',
      ),
    ).toBeTruthy();
    expect(container.querySelector('[data-diffs-header="summary"]')).toBeTruthy();
    expect(container.querySelector('[data-diffs-header="summary"]')?.classList.contains("group/custom-section-header")).toBe(true);
    expect(screen.getByRole("button", { name: /1 个文件已更改/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Messages\.tsx \+2 -1/i })).toBeTruthy();
    expect(container.querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)).toBeNull();
    expect(container.querySelector(".oai-file-diff-card")).toBeNull();

    fireEvent.click(activitySummary);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /已编辑 1 个文件/i })).toBeTruthy();
    });
    expect(activityBlock?.getAttribute("data-collapsed-tool-activity-expanded")).toBe("true");
    expect(assistantBody?.getAttribute("data-assistant-turn-body-expanded")).toBe("true");
    expect(container.querySelector("[data-collapsed-tool-activity-item].oai-tool-activity-row")).toBeTruthy();
    expect(
      container
        .querySelector("[data-collapsed-tool-activity-item].oai-tool-activity-row")
        ?.getAttribute("data-oai-tool-activity-kind"),
    ).toBe("patch");
    expect(
      container
        .querySelector("[data-collapsed-tool-activity-item].oai-tool-activity-row")
        ?.getAttribute("data-conversation-detail-level"),
    ).toBe("STEPS_PROSE");
    expect(container.querySelector("[data-oai-tool-activity-offset]")).toBeTruthy();
    expect(container.querySelector("[data-oai-tool-activity-summary]")).toBeTruthy();
    expect(container.querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)).toBeNull();
    expect(screen.queryByRole("button", { name: "Toggle tool details" })).toBeNull();
    expect(container.querySelector(".oai-file-diff-card")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /已编辑 1 个文件/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "edited: Messages.tsx +2 -1" }),
      ).toBeTruthy();
    });
    expect(container.querySelector("[data-collapsed-tool-activity-body]")).toBeTruthy();
    expect(container.querySelector("[data-oai-tool-activity-body]")).toBeTruthy();
    expect(container.querySelector(".oai-tool-activity-body-stack")).toBeTruthy();
    expect(container.querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)).toBeTruthy();
    expect(container.querySelector("[data-oai-activity-detail-offset]")).toBeTruthy();
    expect(container.querySelector("[data-oai-activity-detail-stack]")).toBeTruthy();
    expect(container.querySelector("[data-oai-activity-detail-content]")).toBeTruthy();
    expect(container.querySelector(".tool-inline")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "edited: Messages.tsx +2 -1" }));
    await waitFor(() => {
      expect(container.querySelector(".oai-file-diff-card")).toBeTruthy();
    });
    expect(container.querySelector("[data-oai-activity-detail-body]")).toBeTruthy();
    expect(container.querySelector(".codex-review-diff-card")).toBeTruthy();
    expect(container.querySelector("[data-codex-review-diff-card]")).toBeTruthy();
    expect(container.querySelector("[data-diffs-card]")).toBeTruthy();
    expect(
      container.querySelector('[data-diffs][data-diffs-mode="file"]'),
    ).toBeTruthy();
    expect(container.querySelector("[data-diffs-file-body-content]")).toBeTruthy();
    expect(container.querySelector("[data-file-body-content]")).toBeTruthy();
    expect(container.querySelector(".oai-file-diff-card[data-diff][data-file]")).toBeTruthy();
    expect(container.querySelector("[data-thread-diff-virtualized]")).toBeTruthy();
    expect(container.querySelector("[data-file-blame-gutter]")).toBeNull();
    expect(container.querySelector("[data-file-blame-trigger]")).toBeNull();
    expect(container.querySelector("[data-file-change-gutter]")).toBeNull();
    expect(container.querySelector("[data-file-change-gutter-marker]")).toBeNull();
    expect(container.querySelector(".oai-file-diff-card")?.getAttribute("data-review-path")).toBe(
      "src/features/messages/components/Messages.tsx",
    );
    expect(container.querySelector(".oai-file-diff-card")?.getAttribute("data-repository-source")).toBe("cloud");
    expect(container.querySelector(".oai-file-diff-card")?.getAttribute("data-review-summary-source")).toBe("cloud-review");
    expect(container.querySelector(".oai-file-diff-card")?.getAttribute("data-generated-paths-ready")).toBe("true");
    expect(container.querySelector("[data-app-action-review-file]")).toBeTruthy();
    expect(container.querySelector(".oai-file-diff-card [data-utility-button]")).toBeTruthy();
    expect(container.querySelector(".oai-file-diff-card [data-change-icon]")).toBeTruthy();
    expect(container.querySelector(".oai-file-diff-card [data-diffs-file-header-meta]")).toBeTruthy();
    expect(container.querySelector(".oai-file-diff-card [data-diffs-file-header-controls]")).toBeTruthy();
    expect(container.querySelector("[data-diffs-summary-meta]")).toBeTruthy();
    expect(container.querySelector("[data-diffs-file-meta]")).toBeTruthy();
    const fileDiffHeader = container.querySelector(
      '.oai-file-diff-card [data-diffs-header="file"]',
    );
    expect(fileDiffHeader?.textContent ?? "").toContain(
      "Messages.tsx",
    );
    expect(fileDiffHeader?.textContent ?? "").toContain(
      "+2",
    );
    expect(fileDiffHeader?.textContent ?? "").toContain(
      "-1",
    );
    expect(container.querySelector(".message-file-diff-card")).toBeNull();
    expect(container.querySelector(".message-file-diff-header")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /已处理 1 个操作/i }));
    await waitFor(() => {
      expect(container.querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)).toBeNull();
      expect(container.querySelector("[data-collapsed-tool-activity-item]")).toBeNull();
    });
  });

  it("deduplicates repeated file-change entries in the footer review summary", async () => {
    const { container } = render(
      <FileChangeSummaryCard
        workspacePath="/Users/xihe0000/workspace/coChat"
        changes={[
          {
            path: "/Users/xihe0000/workspace/coChat/src/features/messages/components/MessageRows.tsx",
            diff: ["@@ -1,1 +1,2 @@", " old", "+new"].join("\n"),
          },
          {
            path: "/Users/xihe0000/workspace/coChat/src/features/messages/components/MessageRows.tsx",
            diff: ["@@ -10,1 +11,1 @@", "-removed", "+added"].join("\n"),
          },
        ]}
      />,
    );

    await screen.findByRole("button", { name: /1 个文件已更改/i });

    await waitFor(() => {
      expect(container.querySelectorAll("[data-diffs-file-row]").length).toBe(1);
    });
    expect(container.querySelector("[data-diffs-file-row]")?.getAttribute("data-review-path")).toBe(
      "src/features/messages/components/MessageRows.tsx",
    );
    expect(container.querySelector("[data-diffs-file-row]")?.textContent ?? "").toContain(
      "src/features/messages/components/MessageRows.tsx",
    );
    expect(container.querySelector("[data-diffs-file-row]")?.textContent ?? "").toContain("+2");
    expect(container.querySelector("[data-diffs-file-row]")?.textContent ?? "").toContain("-1");
    fireEvent.click(screen.getByRole("button", { name: /MessageRows\.tsx \+2 -1/i }));
    await waitFor(() => {
      expect(container.querySelector("[data-diffs-file-panel]")).toBeTruthy();
    });
  });

  it("keeps one assistant reading flow when tools are interleaved between messages", async () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "First paragraph.",
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg content_id",
        detail: "/repo",
        status: "completed",
        output: "content_id",
        durationMs: 2_000,
      },
      {
        id: "assistant-2",
        kind: "message",
        role: "assistant",
        text: "Second paragraph.",
      },
      {
        id: "explore-1",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "routes.ts" }],
      },
      {
        id: "assistant-3",
        kind: "message",
        role: "assistant",
        text: "Final paragraph.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-assistant-turn]").length).toBe(1);
    });
    const turnBlocks = Array.from(
      container.querySelectorAll(
        "[data-assistant-turn] > [data-collapsed-tool-activity], [data-assistant-turn-body-stack] > [data-message-author-role='assistant'], [data-assistant-turn-body-stack] > [data-collapsed-tool-activity-item]",
      ),
    );
    expect(turnBlocks.length).toBe(4);
    expect(turnBlocks[0].textContent ?? "").toContain("已处理 2s");
    expect(turnBlocks[1].textContent ?? "").toContain("First paragraph.");
    expect(turnBlocks[2].textContent ?? "").toContain("Second paragraph.");
    expect(turnBlocks[3].textContent ?? "").toContain("Final paragraph.");
    expect(screen.getAllByRole("button", { name: /已处理/i }).length).toBe(1);
    expect(screen.queryByText(/rg content_id/i)).toBeNull();
    expect(screen.queryByText("routes.ts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /已处理 2s/i }));

    await waitFor(() => {
      expect(container.querySelectorAll("[data-collapsed-tool-activity-item]").length).toBe(2);
    });
    const expandedTurnBlocks = Array.from(
      container.querySelectorAll(
        "[data-assistant-turn] > [data-collapsed-tool-activity], [data-assistant-turn-body-stack] > [data-message-author-role='assistant'], [data-assistant-turn-body-stack] > [data-collapsed-tool-activity-item]",
      ),
    );
    expect(expandedTurnBlocks.length).toBe(6);
    expect(expandedTurnBlocks[0].textContent ?? "").toContain("已处理 2s");
    expect(expandedTurnBlocks[1].textContent ?? "").toContain("First paragraph.");
    expect(expandedTurnBlocks[2].textContent ?? "").toContain("已运行 1 条命令");
    expect(expandedTurnBlocks[3].textContent ?? "").toContain("Second paragraph.");
    expect(expandedTurnBlocks[4].textContent ?? "").toContain("已探索 1 个文件");
    expect(expandedTurnBlocks[5].textContent ?? "").toContain("Final paragraph.");
    expect(screen.queryByText(/rg content_id/i)).toBeNull();
    expect(screen.queryByText("routes.ts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /已运行 1 条命令/i }));
    fireEvent.click(screen.getByRole("button", { name: /已探索 1 个文件/i }));

    await waitFor(() => {
      expect(screen.getByText(/rg content_id/i)).toBeTruthy();
    });
    expect(container.querySelector("[data-oai-tool-terminal]")).toBeTruthy();
    expect(container.querySelector("[data-oai-tool-terminal-line]")).toBeTruthy();
    expect(container.querySelector(".tool-inline-terminal")).toBeNull();
    expect(screen.getByText("routes.ts")).toBeTruthy();
  });

  it("counts explore entry steps in the tool group summary", async () => {
    const items: ConversationItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status --porcelain=v1",
        detail: "/repo",
        status: "completed",
        output: "",
      },
      {
        id: "explore-steps-1",
        kind: "explore",
        status: "explored",
        entries: [
          { kind: "read", label: "Messages.tsx" },
          { kind: "search", label: "toolCount" },
        ],
      },
      {
        id: "explore-steps-2",
        kind: "explore",
        status: "explored",
        entries: [{ kind: "read", label: "types.ts" }],
      },
      {
        id: "tool-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git diff -- src/features/messages/components/Messages.tsx",
        detail: "/repo",
        status: "completed",
        output: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("5 tool calls")).toBeTruthy();
    });
    expect(container.querySelector("[data-oai-tool-group]")).toBeTruthy();
    expect(container.querySelector("[data-oai-tool-activity-stack]")).toBeTruthy();
    expect(container.querySelector(".tool-group")).toBeNull();
    expect(container.querySelector(".tool-group-body")).toBeNull();
  });

  it("re-pins to bottom on thread switch even when previous thread was scrolled up", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-shared",
        kind: "message",
        role: "assistant",
        text: "Shared tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const messagesNode = container.querySelector(".messages.messages-full");
    expect(messagesNode).toBeTruthy();
    const scrollNode = messagesNode as HTMLDivElement;

    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = 100;
    fireEvent.scroll(scrollNode);

    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });

    rerender(
      <Messages
        items={items}
        threadId="thread-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(900);
  });

  it("shows a plan-ready follow-up prompt after a completed plan tool item", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-1",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "- Step 1",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    const planReadyTitle = screen.getByText("Plan ready");
    expect(planReadyTitle).toBeTruthy();
    const followupMessage = planReadyTitle.closest("[data-oai-followup-message]");
    expect(followupMessage).toBeTruthy();
    expect(followupMessage?.hasAttribute("data-oai-request-input-message")).toBe(true);
    expect(followupMessage?.querySelector("[data-oai-request-input-panel]")).toBeTruthy();
    expect(followupMessage?.querySelector(".oai-request-input-panel__header")).toBeTruthy();
    expect(
      followupMessage?.querySelector("[data-oai-request-input-freeform-shell]"),
    ).toBeTruthy();
    expect(
      followupMessage?.querySelector("[data-oai-request-input-freeform]"),
    ).toBeTruthy();
    const planTextarea = followupMessage?.querySelector<HTMLTextAreaElement>(
      "[data-oai-request-input-freeform]",
    );
    expect(planTextarea?.getAttribute("data-autoresize")).toBe("");
    expect(planTextarea?.getAttribute("rows")).toBe("1");
    expect(planTextarea?.classList.contains("bg-transparent")).toBe(true);
    expect(planTextarea?.classList.contains("resize-none")).toBe(true);
    expect(followupMessage?.classList.contains("message")).toBe(false);
    expect(followupMessage?.querySelector(".bubble.request-user-input-card")).toBeNull();
    expect(followupMessage?.querySelector(".request-user-input-card")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Implement this plan" }),
    ).toBeTruthy();
  });

  it("exports plan tool-call output from the conversation view", async () => {
    exportMarkdownFileMock.mockResolvedValueOnce("/tmp/plan-7.md");
    const items: ConversationItem[] = [
      {
        id: "plan-7",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "## Steps\n- Step 1",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const exportButton = await screen.findByRole("button", {
      name: "Export .md",
    });
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(exportMarkdownFileMock).toHaveBeenCalledWith(
        "## Steps\n- Step 1",
        "plan-7.md",
      ),
    );
  });

  it("hides the plan-ready follow-up once the user has replied after the plan", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-2",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "Plan text",
      },
      {
        id: "user-after-plan",
        kind: "message",
        role: "user",
        text: "OK",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("hides the plan-ready follow-up when the plan tool item is still running", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-3",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "Generating plan...",
        status: "in_progress",
        output: "Partial plan",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={true}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("shows the plan-ready follow-up once the turn stops thinking even if the plan status stays in_progress", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-stuck-in-progress",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "Generating plan...",
        status: "in_progress",
        output: "Plan text",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    expect(screen.getByText("Plan ready")).toBeTruthy();
  });

  it("calls the plan follow-up callbacks", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-4",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "Plan text",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    const sendChangesButton = screen.getByRole("button", { name: "Send changes" });
    expect((sendChangesButton as HTMLButtonElement).disabled).toBe(true);

    const textarea = screen.getByPlaceholderText(
      "Describe what you want to change in the plan...",
    );
    fireEvent.change(textarea, { target: { value: "Add error handling" } });

    expect((sendChangesButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sendChangesButton);
    expect(onPlanSubmitChanges).toHaveBeenCalledWith("Add error handling");
    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("dismisses the plan-ready follow-up when the plan is accepted", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-accept",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "Plan text",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Implement this plan" }),
    );
    expect(onPlanAccept).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("does not render plan-ready tagged internal user messages", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-6",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "Plan text",
      },
      {
        id: "internal-user",
        kind: "message",
        role: "user",
        text: "[[cm_plan_ready:accept]] Implement this plan.",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    expect(screen.queryByText(/cm_plan_ready/)).toBeNull();
    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("hides the plan follow-up when an input-requested bubble is active", () => {
    const onPlanAccept = vi.fn();
    const onPlanSubmitChanges = vi.fn();
    const items: ConversationItem[] = [
      {
        id: "plan-5",
        kind: "tool",
        toolType: "plan",
        title: "Plan",
        detail: "completed",
        status: "completed",
        output: "Plan text",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        userInputRequests={[
          {
            workspace_id: "ws-1",
            request_id: 1,
            params: {
              thread_id: "thread-1",
              turn_id: "turn-1",
              item_id: "item-1",
              questions: [
                {
                  id: "q-1",
                  header: "Details",
                  question: "Need anything else?",
                  options: [],
                },
              ],
            },
          },
        ]}
        onUserInputSubmit={vi.fn()}
        onPlanAccept={onPlanAccept}
        onPlanSubmitChanges={onPlanSubmitChanges}
      />,
    );

    expect(screen.getByText("Input requested")).toBeTruthy();
    expect(
      screen.getByText("Input requested").closest("[data-oai-request-input-panel]"),
    ).toBeTruthy();
    expect(
      screen
        .getByText("Input requested")
        .closest("[data-oai-request-input-message]")
        ?.querySelector("[data-oai-request-input-freeform-shell]"),
    ).toBeTruthy();
    const requestTextarea = screen
      .getByText("Input requested")
      .closest("[data-oai-request-input-message]")
      ?.querySelector<HTMLTextAreaElement>("[data-oai-request-input-freeform]");
    expect(requestTextarea?.getAttribute("data-autoresize")).toBe("");
    expect(requestTextarea?.getAttribute("rows")).toBe("1");
    expect(screen.getByRole("button", { name: /Dismiss\s*ESC/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.queryByText("Plan ready")).toBeNull();
  });

  it("renders OpenAI request input option index and escape dismiss behavior", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        userInputRequests={[
          {
            workspace_id: "ws-1",
            request_id: 2,
            params: {
              thread_id: "thread-1",
              turn_id: "turn-1",
              item_id: "item-1",
              questions: [
                {
                  id: "q-1",
                  header: "Choice",
                  question: "Pick one",
                  options: [
                    { label: "First", description: "A" },
                    { label: "Second", description: "B" },
                  ],
                },
              ],
            },
          },
        ]}
        onUserInputSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("3.")).toBeTruthy();
    const textarea = screen.getByPlaceholderText("Add notes (optional)");
    expect(textarea.closest("[data-oai-request-input-freeform-shell]")).toBeTruthy();
    expect(textarea.closest("[data-oai-request-input-freeform-shell]")?.textContent).toContain("3.");
    expect(textarea.closest("[data-oai-request-input-freeform-shell]")?.querySelector("[data-i18n-id='requestInputPanel.optionIndex']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dismiss\s*ESC/i }).getAttribute("data-i18n-id")).toBe("requestInputPanel.dismiss");
    expect(screen.getByText("ESC").getAttribute("data-i18n-id")).toBe("requestInputPanel.escapeKey");
    expect(screen.getByRole("button", { name: "Skip" }).getAttribute("data-i18n-id")).toBe("requestInputPanel.skip");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText("Input requested")).toBeNull();
  });

  it("renders OpenAI activity item type branches and generated image artifacts", () => {
    const items: ConversationItem[] = [
      {
        id: "generated-image-tool",
        kind: "tool",
        toolType: "imageGeneration",
        itemType: "generated-image",
        title: "Generated image",
        detail: "done",
        status: "completed",
        generatedImage: "data:image/png;base64,AAA",
        artifact: {
          id: "artifact-1",
          title: "Image artifact",
          kind: "image",
          description: "Generated preview",
        },
      },
      {
        id: "permission-tool",
        kind: "tool",
        toolType: "permission",
        itemType: "permission-request",
        title: "Permission request",
        detail: "needs approval",
        status: "completed",
      },
      {
        id: "mcp-tool",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-server-elicitation",
        title: "MCP elicitation",
        detail: "input",
        status: "completed",
        mcpApp: {
          id: "mcp-app-1",
          title: "MCP app",
          expanded: true,
          url: "https://mcp.example.test",
        },
      },
      {
        id: "dynamic-tool",
        kind: "tool",
        toolType: "dynamic",
        itemType: "dynamic-tool-call",
        title: "Dynamic tool",
        detail: "call",
        status: "completed",
      },
      {
        id: "compact-tool",
        kind: "tool",
        toolType: "context",
        itemType: "context-compaction",
        title: "Context compaction",
        detail: "compact",
        status: "completed",
      },
      {
        id: "todo-tool",
        kind: "tool",
        toolType: "todo",
        itemType: "todo-list",
        title: "Todo list",
        detail: "todo",
        status: "completed",
      },
      {
        id: "stream-error-tool",
        kind: "tool",
        toolType: "error",
        itemType: "stream-error",
        title: "Stream error",
        detail: "error",
        status: "failed",
      },
      {
        id: "system-error-tool",
        kind: "tool",
        toolType: "error",
        itemType: "system-error",
        title: "System error",
        detail: "error",
        status: "failed",
      },
      {
        id: "remote-task-tool",
        kind: "tool",
        toolType: "remote",
        itemType: "remote-task-created",
        title: "Remote task",
        detail: "created",
        status: "completed",
      },
      {
        id: "model-changed-tool",
        kind: "tool",
        toolType: "model",
        itemType: "model-changed",
        title: "Model changed",
        detail: "changed",
        status: "completed",
      },
      {
        id: "auto-review-warning-tool",
        kind: "tool",
        toolType: "auto-review-interruption-warning",
        itemType: "auto-review-interruption-warning",
        title: "Auto-review interruption warning",
        detail: "interrupted",
        status: "completed",
      },
      {
        id: "automation-update-tool",
        kind: "tool",
        toolType: "automation-update",
        itemType: "automation-update",
        title: "Automation update",
        detail: "updated",
        status: "completed",
      },
      {
        id: "automatic-approval-review-tool",
        kind: "tool",
        toolType: "automatic-approval-review",
        itemType: "automatic-approval-review",
        title: "Automatic approval review",
        detail: "reviewed",
        status: "completed",
      },
      {
        id: "forked-from-conversation-tool",
        kind: "tool",
        toolType: "forked-from-conversation",
        itemType: "forked-from-conversation",
        title: "Forked from conversation",
        detail: "source conversation",
        status: "completed",
      },
      {
        id: "model-rerouted-tool",
        kind: "tool",
        toolType: "model-rerouted",
        itemType: "model-rerouted",
        title: "Model rerouted",
        detail: "rerouted",
        status: "completed",
      },
      {
        id: "multi-agent-action-tool",
        kind: "tool",
        toolType: "multi-agent-action",
        itemType: "multi-agent-action",
        title: "Multi-agent action",
        detail: "agent action",
        status: "completed",
        multiAgentRows: [
          {
            id: "agent-1",
            label: "Explorer",
            status: "completed",
            detail: "explorer",
          },
        ],
      },
      {
        id: "personality-changed-tool",
        kind: "tool",
        toolType: "personality-changed",
        itemType: "personality-changed",
        title: "Personality changed",
        detail: "changed",
        status: "completed",
      },
      {
        id: "plan-implementation-tool",
        kind: "tool",
        toolType: "plan-implementation",
        itemType: "plan-implementation",
        title: "Plan implementation",
        detail: "implemented",
        status: "completed",
      },
      {
        id: "proposed-plan-tool",
        kind: "tool",
        toolType: "proposed-plan",
        itemType: "proposed-plan",
        title: "Proposed plan",
        detail: "planned",
        status: "completed",
      },
      {
        id: "steered-tool",
        kind: "tool",
        toolType: "steered",
        itemType: "steered",
        title: "Steered",
        detail: "steered",
        status: "completed",
      },
      {
        id: "turn-diff-tool",
        kind: "tool",
        toolType: "turn-diff",
        itemType: "turn-diff",
        title: "Turn diff",
        detail: "diff",
        status: "completed",
        turnDiffRows: [
          {
            id: "diff-1",
            label: "src/messages.tsx",
            additions: 2,
            deletions: 1,
          },
        ],
      },
      {
        id: "user-input-response-tool",
        kind: "tool",
        toolType: "user-input-response",
        itemType: "user-input-response",
        title: "User input response",
        detail: "answered",
        status: "completed",
      },
      {
        id: "worked-for-tool",
        kind: "tool",
        toolType: "worked-for",
        itemType: "worked-for",
        title: "Worked for",
        detail: "elapsed",
        status: "completed",
      },
      {
        id: "assistant-message-contract",
        kind: "message",
        role: "assistant",
        itemType: "assistant-message",
        text: "Assistant message branch",
      },
      {
        id: "user-message-contract",
        kind: "message",
        role: "user",
        itemType: "user-message",
        text: "User message branch",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const openAIActivityItemTypes = [
      "permission-request",
      "mcp-server-elicitation",
      "dynamic-tool-call",
      "context-compaction",
      "todo-list",
      "generated-image",
      "stream-error",
      "system-error",
      "remote-task-created",
      "model-changed",
      "auto-review-interruption-warning",
      "automation-update",
      "automatic-approval-review",
      "forked-from-conversation",
      "model-rerouted",
      "multi-agent-action",
      "personality-changed",
      "plan-implementation",
      "proposed-plan",
      "steered",
      "turn-diff",
      "user-input-response",
      "worked-for",
    ];
    expect(
      openAIActivityItemTypes.filter(
        (kind) => !container.querySelector(`[data-openai-activity-item-type="${kind}"]`),
      ),
    ).toEqual([]);
    expect(container.querySelector("[data-oai-inline-group]")).toBeTruthy();
    expect(container.querySelector("[data-oai-section-toggle]")).toBeTruthy();
    fireEvent.click(container.querySelector("[data-collapsed-tool-activity-summary]") as Element);
    container.querySelectorAll("[data-oai-tool-activity-summary]").forEach((button) => {
      fireEvent.click(button);
    });
    expect(container.querySelector("[data-pending-mcp-tool-calls-body]")).toBeTruthy();
    expect(container.querySelector('[data-mcp-app][data-mcp-app-instance="mcp-app-1"]')).toBeTruthy();
    expect(container.querySelector('[data-mcp-app-expanded="true"]')).toBeTruthy();
    expect(container.querySelector('[data-mcp-app-frame="true"]')).toBeTruthy();
    expect(container.querySelector('[data-mcp-app-frame-loading="false"]')).toBeTruthy();
    expect(container.querySelector("[data-multi-agent-action-header]")).toBeTruthy();
    expect(container.querySelector("[data-multi-agent-action-rows]")).toBeTruthy();
    expect(container.querySelector("[data-turn-diff-row]")).toBeTruthy();
    expect(container.querySelector("[data-end-resource]")).toBeTruthy();
    expect(container.querySelector("[data-generated-image] img")).toBeTruthy();
    expect(container.querySelector('[data-message-artifact][data-artifact-id="artifact-1"]')).toBeTruthy();
    expect(container.querySelector('[data-openai-message-item-type="assistant-message"]')).toBeTruthy();
    expect(container.querySelector('[data-openai-message-item-type="user-message"]')).toBeTruthy();
  });

  it("renders OpenAI markdown behavior contract and assistant artifacts", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-markdown-contract",
        kind: "message",
        role: "assistant",
        text: "Here is code:\n\n```ts\nconst x = 1\n```",
        automationCitations: [{ automationId: "automation-1", index: 1 }],
        renderCodeBlocksAsWritingBlocks: true,
        forceCodeBlockWordWrap: true,
        hasArtifacts: true,
        artifacts: [{ id: "artifact-md", title: "Patch artifact", kind: "patch" }],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        onQuoteMessage={vi.fn()}
      />,
    );

    const content = container.querySelector(".oai-message-content");
    expect(content?.getAttribute("data-automation-citations")).toBe("true");
    expect(content?.getAttribute("data-render-code-blocks-as-writing-blocks")).toBe("true");
    expect(content?.getAttribute("data-force-code-block-word-wrap")).toBe("true");
    expect(content?.getAttribute("data-on-add-selected-text-to-chat-handler")).toBe("onAddSelectedTextToChat");
    expect(container.querySelector("[data-message-artifacts]")).toBeTruthy();
    expect(container.querySelector('[data-message-artifact][data-artifact-id="artifact-md"]')).toBeTruthy();
  });

  it("renders hook rows through the standard tool renderer", () => {
    const items: ConversationItem[] = [
      {
        id: "hook-hook-1",
        kind: "tool",
        toolType: "hook",
        title: "Hook: session-start",
        detail: "command • sync • thread • session-start.sh • Preparing",
        status: "failed",
        output: "[error] Missing config",
        durationMs: 3100,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("hook:")).toBeTruthy();
    expect(screen.getByText("session-start")).toBeTruthy();
    expect(screen.getByText("failed • 0:03")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle tool details" }));
    expect(
      screen.getByText("command • sync • thread • session-start.sh • Preparing"),
    ).toBeTruthy();
    expect(screen.getByText("[error] Missing config")).toBeTruthy();
    expect(container.querySelector(".oai-activity-detail-output")).toBeTruthy();
    expect(container.querySelector(".tool-inline-terminal")).toBeNull();
  });
});
