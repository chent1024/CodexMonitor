// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT } from "../../layout/utils/composerOverlayEvents";
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

function clickFirst(container: HTMLElement, selector: string) {
  const element = container.querySelector(selector);
  expect(element).toBeTruthy();
  fireEvent.click(element as Element);
}

function clickAll(container: HTMLElement, selector: string) {
  const elements = Array.from(container.querySelectorAll(selector));
  expect(elements.length).toBeGreaterThan(0);
  elements.forEach((element) => fireEvent.click(element));
}

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
    expect(assistantFooter?.querySelector(".oai-assistant-actions")).toBeNull();
    expect(assistantFooter?.querySelector('[data-message-action="copy"]')).toBeNull();
    expect(assistantFooter?.querySelector('[data-message-action="quote"]')).toBeNull();
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

  it("virtualizes conversation turns before long transcripts mount all history", () => {
    const items: ConversationItem[] = Array.from({ length: 13 }, (_, index) => ({
      id: `user-${index}`,
      kind: "message",
      role: "user",
      text: `Prompt ${index}`,
    }));

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

    const virtualizer = container.querySelector("[data-turn-virtualizer]");
    expect(virtualizer).toBeTruthy();
    expect(container.querySelectorAll("[data-turn-key]").length).toBeLessThan(
      items.length,
    );
    expect(Number(virtualizer?.getAttribute("data-initial-scroll-offset"))).toBeGreaterThan(0);
  });

  it("does not adjust scroll position when virtualized rows measure during manual upward scrolling", () => {
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const observedNodes: Element[] = [];
    const originalGlobalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe(node: Element) {
        observedNodes.push(node);
      }

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

    try {
      const items: ConversationItem[] = Array.from({ length: 13 }, (_, index) => ({
        id: `manual-scroll-user-${index}`,
        kind: "message",
        role: "user",
        text: `Prompt ${index}`,
      }));
      const { container } = render(
        <Messages
          items={items}
          threadId="thread-virtual-measure"
          workspaceId="ws-1"
          isThinking={false}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
      Object.defineProperty(scrollNode, "clientHeight", {
        configurable: true,
        value: 200,
      });
      Object.defineProperty(scrollNode, "scrollHeight", {
        configurable: true,
        value: 1200,
      });
      scrollNode.scrollTop = -300;
      fireEvent.scroll(scrollNode);

      const measuredNode = observedNodes.find((node) =>
        (node as HTMLElement).hasAttribute("data-turn-virtualizer-item"),
      ) as HTMLElement | undefined;
      expect(measuredNode).toBeTruthy();
      const measuredElement = measuredNode as HTMLElement;
      rectSpy.mockImplementation(function getRect(this: HTMLElement) {
        return {
          bottom: 0,
          height: this === measuredElement ? 420 : 0,
          left: 0,
          right: 240,
          top: 0,
          width: 240,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

      act(() => {
        resizeCallbacks.forEach((callback) => {
          callback(
            [{ target: measuredElement } as unknown as ResizeObserverEntry],
            {} as ResizeObserver,
          );
        });
      });

      expect(scrollNode.scrollTop).toBe(-300);
    } finally {
      rectSpy.mockRestore();
      if (originalGlobalResizeObserver) {
        vi.stubGlobal("ResizeObserver", originalGlobalResizeObserver);
      } else {
        vi.unstubAllGlobals();
      }
    }
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

  it("uses ResizeObserver measurement before the user-message collapse heuristic", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 240,
      top: 0,
      width: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "13px",
      lineHeight: "20px",
    } as CSSStyleDeclaration);
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-user-message-text") ? 41 : 0;
      },
    });

    try {
      const items: ConversationItem[] = [
        {
          id: "measured-long-user",
          kind: "message",
          role: "user",
          text: Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join("\n"),
          collapsedLineCount: 2,
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
        expect(container.querySelector("[data-user-message-text]")?.getAttribute("data-user-message-measured")).toBe("true");
      });
      expect(container.querySelector("[data-user-message-text]")?.getAttribute("data-user-message-collapse-state")).toBe("uncollapsible");
      expect(container.querySelector("[data-user-message-collapse-toggle]")).toBeNull();
    } finally {
      rectSpy.mockRestore();
      styleSpy.mockRestore();
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("shows user-message collapse when measured height exceeds collapsed height", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 180,
      top: 0,
      width: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "13px",
      lineHeight: "20px",
    } as CSSStyleDeclaration);
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.hasAttribute("data-user-message-text") ? 42 : 0;
      },
    });

    try {
      const items: ConversationItem[] = [
        {
          id: "measured-markdown-user",
          kind: "message",
          role: "user",
          text: "Short markdown with `aVeryLongUnbrokenIdentifierThatWrapsInTheBubble`",
          collapsedLineCount: 2,
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
        expect(container.querySelector("[data-user-message-collapse-toggle]")?.textContent).toBe("Show more");
      });
      expect(container.querySelector("[data-user-message-text]")?.getAttribute("data-user-message-collapse-state")).toBe("collapsed");
      fireEvent.click(container.querySelector("[data-user-message-collapse-toggle]") as Element);
      expect(container.querySelector("[data-user-message-text]")?.getAttribute("data-user-message-collapse-state")).toBe("expanded");
    } finally {
      rectSpy.mockRestore();
      styleSpy.mockRestore();
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
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

  it("does not render quote or copy actions for assistant output messages", () => {
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

    expect(screen.queryByRole("button", { name: "Quote message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(onQuoteMessage).not.toHaveBeenCalled();
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

  it("can suppress the in-thread active working indicator for composer placement", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-placed-by-composer",
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
        lastDurationMs={31_000}
        openTargets={[]}
        selectedOpenAppId=""
        renderActiveWorkingIndicator={false}
      />,
    );

    expect(container.querySelector("[data-oai-thinking-shimmer]")).toBeNull();
    expect(screen.queryByText("Done in 0:31")).toBeNull();
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

    expect(
      screen.getByText(/Proceed with deployment\?: Yes \+1/),
    ).toBeTruthy();
    expect(screen.queryByText("user_note: after running tests")).toBeNull();
    expect(
      container
        .querySelector("[data-oai-user-input-detail]")
        ?.getAttribute("data-oai-activity-detail-expanded"),
    ).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle answered input details" }),
    );

    expect(screen.getByText("user_note: after running tests")).toBeTruthy();
    expect(
      container
        .querySelector("[data-oai-user-input-detail]")
        ?.getAttribute("data-oai-activity-detail-expanded"),
    ).toBe("true");
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

    clickFirst(container, "[data-oai-tool-group] [data-oai-section-toggle]");
    await waitFor(() => {
      const exploreBlocks = container.querySelectorAll("[data-oai-explore-detail]");
      expect(exploreBlocks.length).toBe(2);
    });
    const exploreItems = container.querySelectorAll(".oai-explore-item");
    expect(exploreItems.length).toBe(2);
    expect(screen.getAllByText(/rg reducers/i).length).toBeGreaterThan(0);
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

    clickFirst(container, "[data-oai-tool-group] [data-oai-section-toggle]");
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
    expect(container.querySelectorAll("[data-collapsed-tool-activity-summary]").length).toBe(0);
    expect(container.querySelectorAll("[data-collapsed-tool-activity-item]").length).toBe(2);
    expect(screen.getByRole("button", { name: /已探索 1 次搜索/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /已探索 1 个文件/i })).toBeTruthy();
    expect(container.querySelectorAll(".oai-explore-item").length).toBe(0);
    clickAll(container, "[data-oai-tool-activity-summary]");
    await waitFor(() => {
      expect(container.querySelectorAll(".oai-explore-item").length).toBe(2);
    });
    expect(container.querySelectorAll(".oai-explore-item").length).toBe(2);
    expect(container.querySelectorAll(".explore-inline-item").length).toBe(0);
    expect(screen.getByText("before message")).toBeTruthy();
    expect(screen.getByText("after message")).toBeTruthy();
  });

  it("renders memory citations at the end of the assistant turn", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-memory-citation",
        kind: "message",
        role: "user",
        text: "Explain the window state behavior",
      },
      {
        id: "assistant-memory-citation",
        kind: "message",
        role: "assistant",
        text: [
          "这个像是之前保存的窗口状态。",
          "",
          "<oai-mem-citation>",
          "<citation_entries>",
          "MEMORY.md:289-317|note=[used coChat launch and runtime context guidance]",
          "</citation_entries>",
          "<rollout_ids>",
          "019e1fcc-9fd1-7e60-89a1-7b5dc6669e4b",
          "</rollout_ids>",
          "</oai-mem-citation>",
        ].join("\n"),
      },
      {
        id: "assistant-after-memory-citation",
        kind: "message",
        role: "assistant",
        text: "要从代码上改默认启动尺寸。",
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
      expect(container.textContent ?? "").toContain("要从代码上改默认启动尺寸。");
    });
    expect(container.textContent ?? "").not.toContain("<oai-mem-citation>");

    const assistantTurn = container.querySelector("[data-assistant-turn]");
    const footer = assistantTurn?.querySelector("[data-assistant-turn-footer]");
    const citation = footer?.querySelector("[data-memory-citation]");
    const assistantParagraph = Array.from(
      assistantTurn?.querySelectorAll("[data-assistant-turn-body] .markdown p") ?? [],
    ).find((node) => node.textContent?.includes("要从代码上改默认启动尺寸。"));

    expect(citation).toBeTruthy();
    expect(assistantParagraph).toBeTruthy();
    expect(citation?.textContent ?? "").toContain("1 条记忆引用");
    expect(citation?.textContent ?? "").toContain("MEMORY.md:289-317");
    expect(
      (assistantParagraph as Node).compareDocumentPosition(citation as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps inline memory citation examples while rendering footer citations", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-memory-citation-inline-example",
        kind: "message",
        role: "user",
        text: "Show the memory citation footer",
      },
      {
        id: "assistant-memory-citation-inline-example",
        kind: "message",
        role: "assistant",
        text: [
          "你看这条 assistant 回复的底部：我会放一个真实的 raw `<oai-mem-citation>` 块。",
          "正常效果是正文里看不到 XML，消息底部会出现 `2 条记忆引用` 的折叠 footer。",
          "",
          "<oai-mem-citation>",
          "<citation_entries>",
          "MEMORY.md:165-177|note=[coChat message renderer compatibility context]",
          "MEMORY.md:239-244|note=[compat renderer boundary and validation context]",
          "</citation_entries>",
          "<rollout_ids>",
          "019e1cde-bd15-7312-bb69-ce529b93ce48",
          "</rollout_ids>",
          "</oai-mem-citation>",
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

    await waitFor(() => {
      expect(container.textContent ?? "").toContain("折叠 footer。");
    });

    const assistantTurn = container.querySelector("[data-assistant-turn]");
    const citation = assistantTurn?.querySelector("[data-memory-citation]");

    expect(container.querySelector("code")?.textContent).toBe("<oai-mem-citation>");
    expect(container.textContent ?? "").not.toContain("</oai-mem-citation>");
    expect(citation).toBeTruthy();
    expect(citation?.textContent ?? "").toContain("2 条记忆引用");
    expect(citation?.textContent ?? "").toContain("MEMORY.md:165-177");
    expect(citation?.textContent ?? "").toContain("019e1cde-bd15-7312-bb69-ce529b93ce48");
  });

  it("keeps active explore activity expanded so live read and search progress is visible", async () => {
    const items: ConversationItem[] = [
      {
        id: "explore-live",
        kind: "explore",
        status: "exploring",
        entries: [
          {
            kind: "read",
            label: "threadItems.conversion.ts",
            detail: "src/utils/threadItems.conversion.ts",
          },
          {
            kind: "search",
            label: "thread/turns in src",
          },
        ],
      },
      {
        id: "assistant-live",
        kind: "message",
        role: "assistant",
        text: "我正在检查历史恢复链路。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={true}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /正在探索 1 个文件,1 次搜索/i })).toBeTruthy();
    });
    const activityRow = container.querySelector("[data-collapsed-tool-activity-item]");
    expect(activityRow?.getAttribute("data-collapsed-tool-activity-item-expanded")).toBe("true");
    expect(screen.getByText("threadItems.conversion.ts")).toBeTruthy();
    expect(screen.getByText("src/utils/threadItems.conversion.ts")).toBeTruthy();
    expect(screen.getByText("thread/turns in src")).toBeTruthy();
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
      expect(container.querySelector("[data-collapsed-tool-activity-item]")).toBeTruthy();
    });
    expect(container.querySelector("[data-collapsed-tool-activity-summary]")).toBeNull();
    expect(container.querySelector("[data-collapsed-tool-activity]")).toBeNull();
    const assistantBody = container.querySelector("[data-assistant-turn-body]");
    expect(container.querySelector("[data-conversation-tool-assistant-gap]")).toBeNull();
    expect(assistantBody?.getAttribute("data-assistant-turn-body-has-activity")).toBe("true");
    expect(assistantBody?.getAttribute("data-assistant-turn-body-expanded")).toBe("true");
    expect(container.querySelector("[data-assistant-turn-body-stack]")).toBeTruthy();
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
    expect(container.querySelector(".oai-file-change-detail")).toBeNull();
    const fileChangeGroupButton = screen.getByRole("button", { name: /已编辑 1 个文件/i });
    expect(fileChangeGroupButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fileChangeGroupButton);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Messages\.tsx \+2 -1/i }).length).toBeGreaterThan(0);
    });
    expect(
      container
        .querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)
        ?.getAttribute("data-oai-activity-detail-expanded"),
    ).toBe("false");
    expect(container.querySelector(".oai-file-diff-card")).toBeNull();
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
    expect(
      container
        .querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)
        ?.getAttribute("data-oai-activity-detail-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: "Toggle tool details" })).toBeNull();
    expect(container.querySelector(".oai-file-diff-card")).toBeNull();

    let fileChangeSummaryButton: HTMLButtonElement | null = null;
    await waitFor(() => {
      fileChangeSummaryButton = container.querySelector(
        '.oai-vscode-activity-summary[aria-label="Messages.tsx +2 -1"]',
      );
      expect(fileChangeSummaryButton).toBeTruthy();
    });
    expect(container.querySelector("[data-collapsed-tool-activity-body]")).toBeTruthy();
    expect(container.querySelector("[data-oai-tool-activity-body]")).toBeTruthy();
    expect(container.querySelector(".oai-tool-activity-body-stack")).toBeTruthy();
    expect(
      container
        .querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)
        ?.getAttribute("data-oai-activity-detail-expanded"),
    ).toBe("false");
    expect(container.querySelector("[data-oai-activity-detail-offset]")).toBeTruthy();
    expect(container.querySelector("[data-oai-activity-detail-stack]")).toBeTruthy();
    expect(container.querySelector("[data-oai-activity-detail-content]")).toBeTruthy();
    expect(container.querySelector(".tool-inline")).toBeNull();

    if (!fileChangeSummaryButton) {
      throw new Error("Missing file change summary button");
    }
    fireEvent.click(fileChangeSummaryButton);
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

    fireEvent.click(fileChangeSummaryButton);
    await waitFor(() => {
      expect(
        container
          .querySelector(`[data-oai-tool-detail][data-tool-type="fileChange"]`)
          ?.getAttribute("data-oai-activity-detail-expanded"),
      ).toBe("false");
      expect(container.querySelector("[data-collapsed-tool-activity-item]")).toBeTruthy();
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

  it("keeps the clicked file row anchored when expanding a footer diff", async () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    let scrollTop = 0;
    let rowTop = 240;

    try {
      const { container } = render(
        <div className="messages messages-full" data-thread-reverse-scroll="true">
          <FileChangeSummaryCard
            workspacePath="/repo"
            changes={[
              {
                path: "/repo/src/features/messages/components/MessageRows.tsx",
                diff: ["@@ -1,1 +1,2 @@", " old", "+new"].join("\n"),
              },
            ]}
          />
        </div>,
      );
      const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
      Object.defineProperty(scrollNode, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      });
      const fileRow = await screen.findByRole("button", {
        name: /MessageRows\.tsx \+1/i,
      });
      vi.spyOn(fileRow, "getBoundingClientRect").mockImplementation(
        () =>
          ({
            bottom: rowTop - scrollTop + 40,
            height: 40,
            left: 0,
            right: 400,
            top: rowTop - scrollTop,
            width: 400,
            x: 0,
            y: rowTop - scrollTop,
            toJSON: () => ({}),
          }) as DOMRect,
      );

      fireEvent.click(fileRow);
      rowTop = 120;

      act(() => {
        while (requestAnimationFrameCallbacks.length > 0) {
          requestAnimationFrameCallbacks.shift()?.(0);
        }
      });

      expect(scrollNode.scrollTop).toBe(-120);
      expect(container.querySelector("[data-diffs-file-panel]")).toBeTruthy();
    } finally {
      requestAnimationFrameSpy.mockRestore();
    }
  });

  it("shows the latest turn file-change summary only after the turn completes", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-file-change",
        kind: "message",
        role: "user",
        text: "Tune the scrollbar",
      },
      {
        id: "tool-live-file-change",
        kind: "tool",
        toolType: "fileChange",
        title: "File changes",
        detail: "",
        status: "completed",
        changes: [
          {
            path: "src/styles/messages.css",
            diff: [
              "diff --git a/src/styles/messages.css b/src/styles/messages.css",
              "@@ -1,2 +1,3 @@",
              "-old line",
              "+new line",
              "+extra line",
            ].join("\n"),
          },
        ],
      },
      {
        id: "assistant-live-file-change",
        kind: "message",
        role: "assistant",
        text: "Adjusting the scrollbar.",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-live-file-change"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-assistant-turn-footer]")).toBeTruthy();
    });
    expect(
      container.querySelector(
        '[data-assistant-turn-footer] [data-diffs][data-diffs-mode="summary"]',
      ),
    ).toBeNull();

    rerender(
      <Messages
        items={items}
        threadId="thread-live-file-change"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-assistant-turn-footer] [data-diffs][data-diffs-mode="summary"]',
        ),
      ).toBeTruthy();
    });
  });

  it("counts raw added-file content in the footer review summary", async () => {
    const { container } = render(
      <FileChangeSummaryCard
        workspacePath="/repo"
        changes={[
          {
            path: "/repo/.codex-run/cargo.cmd",
            kind: "add",
            diff: [
              "@echo off",
              "\"%USERPROFILE%\\.cargo\\bin\\rustup.exe\" run stable cargo %*",
            ].join("\n"),
          },
        ]}
      />,
    );

    await waitFor(() => {
      const rowText = container.querySelector("[data-diffs-file-row]")?.textContent ?? "";
      expect(rowText).toContain("cargo.cmd");
      expect(rowText).toContain("+2");
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
    fireEvent.click(container.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement);
    await waitFor(() => {
      expect(container.querySelector("[data-assistant-turn]")?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    const turnBlocks = Array.from(
      container.querySelectorAll(
        "[data-assistant-turn] > [data-collapsed-tool-activity], [data-assistant-turn-body-stack] > [data-message-author-role='assistant'], [data-assistant-turn-body-stack] > [data-collapsed-tool-activity-item]",
      ),
    );
    expect(turnBlocks.length).toBe(5);
    expect(turnBlocks[0].textContent ?? "").toContain("First paragraph.");
    expect(turnBlocks[1].textContent ?? "").toContain("已运行 1 条命令");
    expect(turnBlocks[2].textContent ?? "").toContain("Second paragraph.");
    expect(turnBlocks[3].textContent ?? "").toContain("已探索 1 个文件");
    expect(turnBlocks[4].textContent ?? "").toContain("Final paragraph.");
    expect(container.querySelectorAll("[data-collapsed-tool-activity-summary]").length).toBe(0);
    expect(screen.queryByText(/rg content_id/i)).toBeNull();
    expect(container.querySelector("[data-oai-tool-terminal]")).toBeNull();
    clickAll(container, "[data-oai-tool-activity-summary]");
    await waitFor(() => {
      expect(screen.getAllByText(/rg content_id/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/rg content_id/i).length).toBeGreaterThan(0);
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
    expect(container.querySelector("[data-oai-tool-activity-stack]")).toBeNull();
    clickFirst(container, "[data-oai-tool-group] [data-oai-section-toggle]");
    await waitFor(() => {
      expect(container.querySelector("[data-oai-tool-activity-stack]")).toBeTruthy();
    });
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

    expect(scrollNode.scrollTop).toBe(0);
  });

  it("restores the previous scroll position when returning to a thread", () => {
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
        threadId="thread-restore-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    scrollNode.scrollTop = -580;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-restore-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    expect(scrollNode.scrollTop).toBe(0);

    scrollNode.scrollTop = -460;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-restore-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(-580);
  });

  it("saves the latest user scroll position when switching threads", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-dom-save",
        kind: "message",
        role: "assistant",
        text: "DOM save tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-dom-save-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    scrollNode.scrollTop = -580;
    fireEvent.scroll(scrollNode);
    scrollNode.scrollTop = -420;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-dom-save-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    rerender(
      <Messages
        items={items}
        threadId="thread-dom-save-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(-420);
  });

  it("does not measure turn layout on every scroll event", () => {
    const items: ConversationItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `msg-scroll-layout-${index}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `Scroll layout ${index}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-scroll-layout"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }));

    try {
      scrollNode.scrollTop = -320;
      fireEvent.scroll(scrollNode);

      expect(rectSpy).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("keeps a pending thread scroll restore until returning thread content is loaded", () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const items: ConversationItem[] = [
      {
        id: "msg-delayed-restore-tail",
        kind: "message",
        role: "assistant",
        text: "Delayed restore tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-delayed-restore-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    let clientHeight = 200;
    let scrollHeight = 900;
    let scrollTop = 0;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(scrollNode, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        const maxDistance = Math.max(0, scrollHeight - clientHeight);
        const nextScrollTop = Math.max(-maxDistance, Math.min(maxDistance, value));
        scrollTop = Object.is(nextScrollTop, -0) ? 0 : nextScrollTop;
      },
    });

    scrollNode.scrollTop = -580;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-delayed-restore-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    expect(scrollNode.scrollTop).toBe(0);

    scrollHeight = 200;
    rerender(
      <Messages
        items={[]}
        threadId="thread-delayed-restore-1"
        workspaceId="ws-1"
        isThinking={false}
        isLoadingMessages
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    act(() => {
      while (requestAnimationFrameCallbacks.length > 0) {
        requestAnimationFrameCallbacks.shift()?.(0);
      }
    });
    expect(scrollNode.scrollTop).toBe(0);

    scrollHeight = 900;
    rerender(
      <Messages
        items={items}
        threadId="thread-delayed-restore-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(-580);
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("keeps a restored non-bottom position through programmatic restore scroll events", () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const items: ConversationItem[] = [
      {
        id: "msg-restored-scroll",
        kind: "message",
        role: "assistant",
        text: "Shared tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-restore-programmatic-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    scrollNode.scrollTop = -580;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-restore-programmatic-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    rerender(
      <Messages
        items={items}
        threadId="thread-restore-programmatic-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(-580);
    scrollNode.scrollTop = 0;
    fireEvent.scroll(scrollNode);

    while (requestAnimationFrameCallbacks.length > 0) {
      requestAnimationFrameCallbacks.shift()?.(0);
    }

    expect(scrollNode.scrollTop).toBe(-580);
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("keeps a thread pinned to bottom when returning after it was left at bottom", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-pinned-tail",
        kind: "message",
        role: "assistant",
        text: "Pinned tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-pinned-return-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    scrollNode.scrollTop = 0;
    fireEvent.scroll(scrollNode);

    rerender(
      <Messages
        items={items}
        threadId="thread-pinned-return-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 1200,
    });

    rerender(
      <Messages
        items={items}
        threadId="thread-pinned-return-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollNode.scrollTop).toBe(0);
  });

  it("restores bottom pinning after remount when message height is measured later", () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    let scrollHeight = 900;
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    const items: ConversationItem[] = [
      {
        id: "msg-delayed-height",
        kind: "message",
        role: "assistant",
        text: "Delayed height",
      },
    ];
    const renderThread = (threadId: string) => (
      <Messages
        key={`messages:${threadId}`}
        items={items}
        threadId={threadId}
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );

    const { container, rerender } = render(renderThread("thread-delayed-1"));
    let scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    scrollNode.scrollTop = 0;
    fireEvent.scroll(scrollNode);

    rerender(renderThread("thread-delayed-2"));

    scrollHeight = 0;
    rerender(renderThread("thread-delayed-1"));
    scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    expect(scrollNode.scrollTop).toBe(0);

    scrollHeight = 1200;
    while (requestAnimationFrameCallbacks.length > 0) {
      const callback = requestAnimationFrameCallbacks.shift();
      callback?.(0);
    }

    expect(scrollNode.scrollTop).toBe(0);

    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("keeps streamed output pinned above composer overlay height changes", () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const items: ConversationItem[] = [
      {
        id: "msg-tail",
        kind: "message",
        role: "assistant",
        text: "Current tail",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = 0;
    fireEvent.scroll(scrollNode);

    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    window.dispatchEvent(new Event(COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT));

    expect(scrollNode.scrollTop).toBe(0);
    requestAnimationFrameSpy.mockRestore();
  });

  it("does not force streamed output to bottom after the user scrolls up", () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const items: ConversationItem[] = [
      {
        id: "msg-tail",
        kind: "message",
        role: "assistant",
        text: "Current tail",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = -300;
    fireEvent.scroll(scrollNode);

    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    window.dispatchEvent(new Event(COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT));

    expect(scrollNode.scrollTop).toBe(-300);
    requestAnimationFrameSpy.mockRestore();
  });

  it("does not use stale bottom pinning when the composer changes while scrolled up", () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const items: ConversationItem[] = [
      {
        id: "msg-tail-stale-pin",
        kind: "message",
        role: "assistant",
        text: "Current tail",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-stale-pin"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = -300;

    window.dispatchEvent(new Event(COMPOSER_OVERLAY_HEIGHT_CHANGE_EVENT));

    expect(scrollNode.scrollTop).toBe(-300);
    requestAnimationFrameSpy.mockRestore();
  });

  it("restores non-bottom position when browser scrolls the focused footer input into view", () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const items: ConversationItem[] = [
      {
        id: "msg-footer-input-scroll",
        kind: "message",
        role: "assistant",
        text: "Current tail",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-footer-input-scroll"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        footerNode={<textarea aria-label="Composer input" />}
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = -300;
    fireEvent.scroll(scrollNode);

    const textarea = screen.getByLabelText("Composer input");
    fireEvent(textarea, new Event("beforeinput", { bubbles: true, cancelable: true }));
    scrollNode.scrollTop = 0;
    fireEvent.input(textarea, { target: { value: "a" } });

    while (requestAnimationFrameCallbacks.length > 0) {
      requestAnimationFrameCallbacks.shift()?.(0);
    }

    expect(scrollNode.scrollTop).toBe(-300);
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("loads older turns when scrolled near the top and preserves viewport position", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const onLoadOlderTurns = vi.fn(async () => {});
    const items: ConversationItem[] = [
      {
        id: "msg-tail",
        kind: "message",
        role: "assistant",
        text: "Current tail",
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
        hasOlderTurns
        onLoadOlderTurns={onLoadOlderTurns}
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    scrollNode.scrollTop = -340;
    onLoadOlderTurns.mockImplementation(async () => {
      Object.defineProperty(scrollNode, "scrollHeight", {
        configurable: true,
        value: 900,
      });
    });

    fireEvent.scroll(scrollNode);

    await waitFor(() => {
      expect(onLoadOlderTurns).toHaveBeenCalledTimes(1);
    });
    expect(scrollNode.scrollTop).toBe(-340);
    requestAnimationFrameSpy.mockRestore();
  });

  it("restores older-turn pagination before the next paint when items prepend", async () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });
    let resolveLoadOlder: (() => void) | null = null;
    let scrollHeight = 600;

    function Harness() {
      const [items, setItems] = useState<ConversationItem[]>([
        {
          id: "msg-tail",
          kind: "message",
          role: "assistant",
          text: "Current tail",
        },
      ]);
      const handleLoadOlderTurns = useCallback(
        () =>
          new Promise<void>((resolve) => {
            resolveLoadOlder = resolve;
            scrollHeight = 900;
            setItems((current) => [
              {
                id: "msg-older",
                kind: "message",
                role: "assistant",
                text: "Older turn",
              },
              ...current,
            ]);
          }),
        [],
      );

      return (
        <Messages
          items={items}
          threadId="thread-layout-restore"
          workspaceId="ws-1"
          isThinking={false}
          openTargets={[]}
          selectedOpenAppId=""
          hasOlderTurns
          onLoadOlderTurns={handleLoadOlderTurns}
        />
      );
    }

    const { container } = render(<Harness />);
    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    scrollNode.scrollTop = -340;

    await act(async () => {
      fireEvent.scroll(scrollNode);
    });
    await waitFor(() => {
      expect(container.textContent ?? "").toContain("Older turn");
    });

    expect(scrollNode.scrollTop).toBe(-340);

    await act(async () => {
      resolveLoadOlder?.();
    });
    while (requestAnimationFrameCallbacks.length > 0) {
      requestAnimationFrameCallbacks.shift()?.(0);
    }
    requestAnimationFrameSpy.mockRestore();
  });

  it("loads older turns when the current page is too short to scroll", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const onLoadOlderTurns = vi.fn(async () => {});
    const items: ConversationItem[] = [
      {
        id: "msg-short-page-tail",
        kind: "message",
        role: "assistant",
        text: "Current short tail",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-short-page"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        hasOlderTurns={false}
        onLoadOlderTurns={onLoadOlderTurns}
      />,
    );

    const scrollNode = container.querySelector(".messages.messages-full") as HTMLDivElement;
    Object.defineProperty(scrollNode, "clientHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(scrollNode, "scrollHeight", {
      configurable: true,
      value: 180,
    });

    rerender(
      <Messages
        items={items}
        threadId="thread-short-page"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        hasOlderTurns
        onLoadOlderTurns={onLoadOlderTurns}
      />,
    );

    await waitFor(() => {
      expect(onLoadOlderTurns).toHaveBeenCalledTimes(1);
    });
    requestAnimationFrameSpy.mockRestore();
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

  it("matches VS Code collapse state machines for turns, activity, reasoning, command output, and MCP apps", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-start",
        kind: "message",
        role: "user",
        text: "Run checks",
      },
      {
        id: "cmd-state",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run test -- src/features/messages/components/Messages.test.tsx",
        detail: "/repo",
        status: "completed",
        output: "line one\nline two",
        durationMs: 1400,
      },
      {
        id: "reasoning-state",
        kind: "reasoning",
        summary: "Checked renderer behavior",
        content: "**Checked renderer behavior**\nCompared collapse states and animation.",
      },
      {
        id: "mcp-state",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "MCP app",
        detail: "mcp app",
        status: "completed",
        mcpApp: {
          id: "mcp-app-state",
          title: "MCP state app",
          expanded: true,
          url: "https://mcp.example.test/state",
        },
      },
      {
        id: "assistant-state",
        kind: "message",
        role: "assistant",
        text: "Done.",
      },
      {
        id: "user-follow-up",
        kind: "message",
        role: "user",
        text: "Next request",
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

    const collapsedTurn = container.querySelector("[data-assistant-turn]");
    expect(collapsedTurn?.getAttribute("data-turn-collapse-allowed")).toBe("true");
    expect(collapsedTurn?.getAttribute("data-turn-collapsed")).toBe("true");
    const turnSummary = container.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement;
    expect(turnSummary?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(turnSummary);
    await waitFor(() => {
      expect(collapsedTurn?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    expect(turnSummary.getAttribute("aria-expanded")).toBe("true");

    expect(
      container.querySelector(
        "[data-collapsed-tool-activity] [data-collapsed-tool-activity-summary]",
      ),
    ).toBeNull();

    const groupSummaries = Array.from(container.querySelectorAll("[data-oai-tool-activity-summary]"));
    expect(groupSummaries.length).toBeGreaterThanOrEqual(3);
    groupSummaries.forEach((summary) => {
      expect(summary.getAttribute("aria-expanded")).toBe("false");
    });
    expect(container.querySelector("[data-vscode-reasoning-body]")).toBeNull();
    expect(container.querySelector("[data-vscode-command-output]")).toBeNull();
    clickAll(container, "[data-oai-tool-activity-summary]");

    await waitFor(() => {
      expect(container.querySelector("[data-vscode-reasoning-body]")).toBeTruthy();
      expect(container.querySelector("[data-vscode-command-output]")).toBeTruthy();
      expect(container.querySelector('[data-mcp-app-instance="mcp-app-state"]')).toBeTruthy();
    });

    const reasoningRow = container.querySelector("[data-oai-reasoning-detail]");
    const reasoningButton = reasoningRow?.querySelector("button") as HTMLButtonElement;
    expect(reasoningRow?.getAttribute("data-vscode-reasoning-state")).toBe("preview");
    expect(
      (container.querySelector("[data-vscode-reasoning-body]") as HTMLElement).style.maxHeight,
    ).toBe("7rem");
    fireEvent.click(reasoningButton);
    expect(reasoningRow?.getAttribute("data-vscode-reasoning-state")).toBe("expanded");
    expect(
      (container.querySelector("[data-vscode-reasoning-body]") as HTMLElement).style.maxHeight,
    ).toBe("20rem");
    fireEvent.click(reasoningButton);
    expect(reasoningRow?.getAttribute("data-vscode-reasoning-state")).toBe("collapsed");
    expect(
      (container.querySelector("[data-vscode-reasoning-body]") as HTMLElement).style.maxHeight,
    ).toBe("0px");

    const commandPanel = container.querySelector("[data-vscode-command-output]");
    const execSummary = container.querySelector("[data-vscode-exec-summary]");
    expect(execSummary?.querySelector(".oai-vscode-activity-icon")).toBeNull();
    expect(execSummary?.querySelector(".oai-vscode-activity-status")).toBeNull();
    expect(execSummary?.querySelector("[data-vscode-command-chevron]")).toBeTruthy();
    expect(commandPanel?.querySelector("[data-vscode-shell-header]")?.textContent).toBe("Shell");
    expect(commandPanel?.querySelector("[data-vscode-command-text]")?.getAttribute("data-command-line-clamp")).toBe("2");
    expect(
      (commandPanel?.querySelector("[data-vscode-command-output-lines]") as HTMLElement).style.maxHeight,
    ).toBe("140px");
    expect(commandPanel?.querySelector("[data-vscode-command-footer-status]")?.textContent).toContain("成功");
    expect(commandPanel?.querySelector("[data-vscode-copy-command]")).toBeTruthy();
    expect(commandPanel?.querySelector("[data-vscode-copy-output]")).toBeTruthy();
    expect(commandPanel?.querySelector("[data-vscode-toggle-output]")).toBeNull();
    expect(commandPanel?.getAttribute("data-output-expanded")).toBe("true");

    const mcpApp = container.querySelector('[data-mcp-app-instance="mcp-app-state"]');
    expect(mcpApp?.getAttribute("data-mcp-app-expanded")).toBe("true");
    fireEvent.click(container.querySelector("[data-mcp-app-toggle-fullscreen]") as Element);
    expect(container.querySelector('[data-mcp-app-instance="mcp-app-state"]')?.getAttribute("data-mcp-app-fullscreen")).toBe("true");
    fireEvent.click(container.querySelector("[data-mcp-app-toggle-expanded]") as Element);
    expect(container.querySelector('[data-mcp-app-instance="mcp-app-state"]')?.getAttribute("data-mcp-app-expanded")).toBe("false");
  });

  it("collapses only turn activity while keeping the final assistant message visible", async () => {
    const items: ConversationItem[] = [
      {
        id: "turn-user",
        kind: "message",
        role: "user",
        text: "Summarize recent edits",
      },
      {
        id: "worked-for-item",
        kind: "tool",
        toolType: "status",
        itemType: "worked-for",
        title: "Worked on renderer parity",
        detail: "hidden worked-for detail",
        output: "worked output should not render as an activity row",
        status: "completed",
        durationMs: 3_000,
      },
      {
        id: "turn-intermediate-assistant",
        kind: "message",
        role: "assistant",
        text: "Intermediate renderer note should collapse.",
      },
      {
        id: "hidden-command",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run hidden-check",
        detail: "/repo",
        output: "hidden command output",
        status: "completed",
      },
      {
        id: "turn-assistant",
        kind: "message",
        role: "assistant",
        text: "Final assistant response remains readable.",
      },
      {
        id: "turn-next-user",
        kind: "message",
        role: "user",
        text: "Next turn starts",
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

    const assistantTurn = container.querySelector("[data-assistant-turn]");
    expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("true");
    expect(assistantTurn?.getAttribute("data-turn-worked-for-item-id")).toBe("worked-for-item");
    expect(screen.queryByText("Intermediate renderer note should collapse.")).toBeNull();
    expect(screen.getByText("Final assistant response remains readable.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /1 条前序内容/i })).toBeNull();
    expect(screen.queryByText(/npm run hidden-check/i)).toBeNull();
    expect(screen.queryByText("worked output should not render as an activity row")).toBeNull();
    const turnSummary = container.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement;
    expect(turnSummary).toBeTruthy();
    expect(turnSummary.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(turnSummary);
    await waitFor(() => {
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    expect(screen.getByText("Intermediate renderer note should collapse.")).toBeTruthy();
    expect(screen.getByText("Final assistant response remains readable.")).toBeTruthy();
    expect(screen.queryByText(/npm run hidden-check/i)).toBeNull();

    fireEvent.click(turnSummary);
    await waitFor(() => {
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("true");
    });
    expect(screen.queryByText("Intermediate renderer note should collapse.")).toBeNull();

    fireEvent.click(turnSummary);
    await waitFor(() => {
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    clickFirst(container, "[data-oai-tool-activity-summary]");
    await waitFor(() => {
      expect(screen.getAllByText(/npm run hidden-check/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText("hidden command output")).toBeTruthy();
  });

  it("keeps the active most recent turn expanded and updates its elapsed summary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-14T00:00:13.000Z"));
      const items: ConversationItem[] = [
        {
          id: "active-user",
          kind: "message",
          role: "user",
          text: "Run checks",
        },
        {
          id: "active-command",
          kind: "tool",
          toolType: "commandExecution",
          itemType: "exec",
          title: "Command: npm run test",
          detail: "/repo",
          output: "still running",
          status: "running",
        },
        {
          id: "active-assistant",
          kind: "message",
          role: "assistant",
          text: "I am checking the result.",
        },
      ];

      const { container } = render(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking={true}
          processingStartedAt={Date.now() - 13_000}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const assistantTurn = container.querySelector("[data-assistant-turn]");
      const turnSummary = container.querySelector("[data-turn-collapse-summary]");
      expect(assistantTurn?.getAttribute("data-turn-collapse-allowed")).toBe("true");
      expect(assistantTurn?.getAttribute("data-turn-prevent-auto-collapse")).toBe("true");
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("false");
      expect(turnSummary?.getAttribute("aria-expanded")).toBe("true");
      expect(turnSummary?.textContent ?? "").toContain("已处理 13 秒");
      expect(screen.getByText("I am checking the result.")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(turnSummary?.textContent ?? "").toContain("已处理 14 秒");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps steering user messages persistent when a turn is collapsed", async () => {
    const items: ConversationItem[] = [
      {
        id: "steer-user-start",
        kind: "message",
        role: "user",
        text: "Inspect parity",
      },
      {
        id: "steering-user-message",
        kind: "message",
        role: "user",
        itemType: "user-message",
        steeringStatus: "Steered conversation",
        text: "Keep this steering instruction visible.",
      },
      {
        id: "steer-command",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run steer-hidden",
        detail: "/repo",
        output: "steer hidden output",
        status: "completed",
      },
      {
        id: "steer-assistant",
        kind: "message",
        role: "assistant",
        text: "Steered response.",
      },
      {
        id: "steer-next-user",
        kind: "message",
        role: "user",
        text: "Next request",
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

    const firstTurn = container.querySelector("[data-turn-key='user:steer-user-start']");
    const assistantTurn = firstTurn?.querySelector("[data-assistant-turn]");
    expect(assistantTurn?.getAttribute("data-turn-persistent-entry-count")).toBe("1");
    fireEvent.click(firstTurn?.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement);
    await waitFor(() => {
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("true");
    });
    expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("true");
    expect(firstTurn?.textContent ?? "").toContain("Keep this steering instruction visible.");
    expect(firstTurn?.textContent ?? "").toContain("Steered response.");
    expect(screen.queryByText(/npm run steer-hidden/i)).toBeNull();
    fireEvent.click(firstTurn?.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement);
    await waitFor(() => {
      expect(assistantTurn?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    clickFirst(container, "[data-oai-tool-activity-summary]");
    expect(screen.getAllByText(/npm run steer-hidden/i).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-turn-key]").length).toBe(2);
  });

  it("does not render the same prompt twice when a steering user message repeats it", () => {
    const items: ConversationItem[] = [
      {
        id: "prompt-user",
        kind: "message",
        role: "user",
        text: "Does Amazon marketplace have listing APIs?",
      },
      {
        id: "prompt-steering-duplicate",
        kind: "message",
        role: "user",
        itemType: "user-message",
        steeringStatus: "Steered conversation",
        text: "Does Amazon marketplace have listing APIs?",
      },
      {
        id: "prompt-assistant",
        kind: "message",
        role: "assistant",
        text: "I will verify the official docs first.",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={true}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll('[data-message-author-role="user"]')).toHaveLength(1);
    expect(screen.getAllByText("Does Amazon marketplace have listing APIs?")).toHaveLength(1);
    expect(screen.getByText("I will verify the official docs first.")).toBeTruthy();
  });

  it("uses staged disclosure and pending MCP body attributes for top-level tool groups", async () => {
    const items: ConversationItem[] = [
      {
        id: "top-mcp-1",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "filesystem read",
        detail: JSON.stringify({ server: "filesystem", tool: "read_file" }),
        status: "completed",
        output: "file text",
      },
      {
        id: "top-mcp-2",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "filesystem list",
        detail: JSON.stringify({ server: "filesystem", tool: "list_directory" }),
        status: "completed",
        output: "src",
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

    const group = container.querySelector("[data-oai-tool-group]");
    expect(group?.getAttribute("data-oai-tool-group-kind")).toBe("pending-mcp-tool-calls");
    const toggle = group?.querySelector("[data-oai-section-toggle]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("#tool-group-top-mcp-1")).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelector("#tool-group-top-mcp-1")).toBeTruthy();
    });
    let body = container.querySelector("#tool-group-top-mcp-1") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body.getAttribute("aria-expanded")).toBe("true");
    expect(body.getAttribute("data-pending-mcp-tool-calls-body")).toBe("true");
    expect(body.getAttribute("data-pending-mcp-tool-calls-view-state")).toBe("expanded");
    expect(body.getAttribute("data-disclosure-body-mounted")).toBe("true");
    expect(container.querySelector("[data-mcp-app]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Expand app|Collapse app/i })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    body = container.querySelector("#tool-group-top-mcp-1") as HTMLElement;
    expect(body.getAttribute("data-pending-mcp-tool-calls-view-state")).toBe("collapsed");
    await waitFor(() => {
      expect(container.querySelector("#tool-group-top-mcp-1")).toBeNull();
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelector("#tool-group-top-mcp-1")).toBeTruthy();
    });
    body = container.querySelector("#tool-group-top-mcp-1") as HTMLElement;
    expect(body.getAttribute("data-pending-mcp-tool-calls-view-state")).toBe("expanded");
  });

  it("applies pending MCP grouping exceptions for computer-use, node_repl, and auto-expanded MCP apps", async () => {
    const mcpDetail = (server: string, tool: string) => JSON.stringify({ server, tool });
    const items: ConversationItem[] = [
      {
        id: "mcp-user",
        kind: "message",
        role: "user",
        text: "Run MCP calls",
      },
      {
        id: "mcp-normal-1",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "filesystem read",
        detail: mcpDetail("filesystem", "read_file"),
        status: "completed",
      },
      {
        id: "mcp-normal-2",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "filesystem list",
        detail: mcpDetail("filesystem", "list_directory"),
        status: "completed",
      },
      {
        id: "mcp-computer-use",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "computer-use click",
        detail: mcpDetail("computer-use", "click"),
        status: "completed",
      },
      {
        id: "mcp-node-repl",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "node_repl js",
        detail: mcpDetail("node_repl", "js"),
        status: "completed",
      },
      {
        id: "mcp-auto-app",
        kind: "tool",
        toolType: "mcp",
        itemType: "mcp-tool-call",
        title: "browser app",
        detail: mcpDetail("browser", "open"),
        status: "completed",
        mcpApp: {
          id: "auto-expanded-mcp-app",
          title: "Auto expanded MCP app",
          expanded: true,
          url: "https://mcp.example.test/app",
        },
      },
      {
        id: "mcp-assistant",
        kind: "message",
        role: "assistant",
        text: "MCP calls complete.",
      },
      {
        id: "mcp-next-user",
        kind: "message",
        role: "user",
        text: "Next request",
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
      expect(container.querySelectorAll('[data-oai-tool-activity-kind="pending-mcp-tool-calls"]').length).toBe(4);
    });
    container.querySelectorAll('[data-oai-tool-activity-kind="pending-mcp-tool-calls"]').forEach((row) => {
      expect(row.getAttribute("data-collapsed-tool-activity-item-expanded")).toBe("false");
    });
    clickAll(container, '[data-oai-tool-activity-kind="pending-mcp-tool-calls"] [data-oai-tool-activity-summary]');
    await waitFor(() => {
      expect(
        container.querySelectorAll('[data-oai-tool-activity-body][data-testid="pending-mcp-tool-calls-body"]').length,
      ).toBe(4);
    });
    container.querySelectorAll('[data-oai-tool-activity-body][data-testid="pending-mcp-tool-calls-body"]').forEach((body) => {
      expect(body.getAttribute("aria-expanded")).toBe("true");
      expect(body.getAttribute("data-pending-mcp-tool-calls-view-state")).toBe("expanded");
    });
    expect(container.querySelector('[data-mcp-app-instance="mcp-normal-1"]')).toBeNull();
    expect(container.querySelector('[data-mcp-app-instance="filesystem"]')).toBeNull();
    expect(container.querySelector('[data-mcp-app-instance="auto-expanded-mcp-app"]')?.getAttribute("data-mcp-app-expanded")).toBe("true");
  });

  it("auto-expands live command activity groups until they finish", async () => {
    const userMessage: Extract<ConversationItem, { kind: "message" }> = {
      id: "live-command-user",
      kind: "message",
      role: "user",
      text: "Run tests",
    };
    const assistantMessage: Extract<ConversationItem, { kind: "message" }> = {
      id: "live-command-assistant",
      kind: "message",
      role: "assistant",
      text: "Running tests.",
    };
    const liveCommand: Extract<ConversationItem, { kind: "tool" }> = {
      id: "live-command",
      kind: "tool",
      toolType: "commandExecution",
      itemType: "exec",
      title: "Command: npm test",
      detail: "npm test",
      output: "live output",
      status: "running",
    };
    const items: ConversationItem[] = [userMessage, assistantMessage, liveCommand];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-collapsed-tool-activity-item]")).toBeTruthy();
    });
    const liveRow = container.querySelector("[data-collapsed-tool-activity-item]");
    if (!liveRow) {
      throw new Error("Expected live command activity row to render");
    }
    expect(liveRow.getAttribute("data-collapsed-tool-activity-item-expanded")).toBe("true");
    expect(screen.getByText(/live output/i)).toBeTruthy();

    rerender(
      <Messages
        items={[
          userMessage,
          assistantMessage,
          {
            ...liveCommand,
            status: "completed",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-collapsed-tool-activity-item]")
          ?.getAttribute("data-collapsed-tool-activity-item-expanded"),
      ).toBe("false");
    });
  });

  it("toggles a mixed command activity group from its summary", async () => {
    const items: ConversationItem[] = [
      {
        id: "mixed-command-user",
        kind: "message",
        role: "user",
        text: "Run commands",
      },
      {
        id: "mixed-command-assistant",
        kind: "message",
        role: "assistant",
        text: "Running commands.",
      },
      {
        id: "mixed-command-running",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run test",
        detail: "npm run test",
        output: "test output",
        status: "running",
      },
      {
        id: "mixed-command-completed",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: git diff -- src/features/messages",
        detail: "git diff -- src/features/messages",
        output: "diff output",
        status: "completed",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-vscode-command-output]").length).toBe(2);
    });

    const summary = container.querySelector("[data-oai-tool-activity-summary]") as HTMLButtonElement | null;
    expect(summary).toBeTruthy();
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
    expect(summary?.querySelector("[data-oai-tool-activity-chevron]")).toBeTruthy();

    fireEvent.click(summary as HTMLButtonElement);
    await waitFor(() => {
      expect(container.querySelectorAll("[data-vscode-command-output]").length).toBe(0);
    });
    expect(summary?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(summary as HTMLButtonElement);
    await waitFor(() => {
      expect(container.querySelectorAll("[data-vscode-command-output]").length).toBe(2);
    });
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders reasoning status labels, strips duplicate headings, and cycles preview heights", async () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-status-user",
        kind: "message",
        role: "user",
        text: "Think through parity",
      },
      {
        id: "reasoning-status",
        kind: "reasoning",
        status: "completed",
        durationMs: 1_500,
        summary: "Checked renderer behavior",
        content: "**Checked renderer behavior**\nCompared collapse states and animation.",
      },
      {
        id: "reasoning-running",
        kind: "reasoning",
        status: "in_progress",
        summary: "Scanning bundle\nStill reading qE",
        content: "",
      },
      {
        id: "reasoning-status-assistant",
        kind: "message",
        role: "assistant",
        text: "Reasoning done.",
      },
      {
        id: "reasoning-next-user",
        kind: "message",
        role: "user",
        text: "Next request",
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

    expect(
      container.querySelector("[data-collapsed-tool-activity] [data-collapsed-tool-activity-summary]"),
    ).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-oai-tool-activity-kind="reasoning"] [data-oai-tool-activity-summary]')).toBeTruthy();
    });
    expect(container.querySelector("[data-oai-reasoning-detail]")).toBeNull();
    fireEvent.click(
      container.querySelector(
        '[data-oai-tool-activity-kind="reasoning"] [data-oai-tool-activity-summary]',
      ) as Element,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-oai-reasoning-detail]")).toBeTruthy();
      expect(screen.getByText("Thought for 2s")).toBeTruthy();
      expect(screen.getByText("Thinking")).toBeTruthy();
    });
    const reasoningBody = container.querySelector("[data-vscode-reasoning-body]") as HTMLElement;
    expect(reasoningBody.style.maxHeight).toBe("7rem");
    expect(reasoningBody.textContent ?? "").toContain("Compared collapse states and animation.");
    expect(reasoningBody.textContent ?? "").not.toContain("**Checked renderer behavior**");
    const reasoningRow = container.querySelector("[data-oai-reasoning-detail]");
    const reasoningButton = reasoningRow?.querySelector("button") as HTMLButtonElement;
    fireEvent.click(reasoningButton);
    expect(reasoningBody.style.maxHeight).toBe("20rem");
    fireEvent.click(reasoningButton);
    expect(reasoningBody.style.maxHeight).toBe("0px");
  });

  it("renders command execution output with expandable command and No output state", async () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-no-output-user",
        kind: "message",
        role: "user",
        text: "Run empty command",
      },
      {
        id: "cmd-no-output",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run very-long-command -- --with-many-flags --and-extra-arguments",
        detail: "/repo",
        output: "",
        status: "completed",
        durationMs: 2_000,
      },
      {
        id: "cmd-no-output-assistant",
        kind: "message",
        role: "assistant",
        text: "Command finished.",
      },
      {
        id: "cmd-no-output-next-user",
        kind: "message",
        role: "user",
        text: "Next request",
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

    expect(container.querySelector("[data-turn-collapse-summary]")).toBeTruthy();
    fireEvent.click(container.querySelector("[data-turn-collapse-summary]") as HTMLButtonElement);
    await waitFor(() => {
      expect(container.querySelector("[data-assistant-turn]")?.getAttribute("data-turn-collapsed")).toBe("false");
    });
    expect(container.querySelector("[data-collapsed-tool-activity-summary]")).toBeNull();
    expect(container.querySelector("[data-vscode-command-output]")).toBeNull();
    fireEvent.click(
      container.querySelector(
        '[data-oai-tool-activity-kind="exec"] [data-oai-tool-activity-summary]',
      ) as Element,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-vscode-command-output]")).toBeTruthy();
    });
    const commandPanel = container.querySelector("[data-vscode-command-output]");
    const commandText = commandPanel?.querySelector("[data-vscode-command-text]") as HTMLButtonElement;
    expect(
      container.querySelector('[data-oai-tool-activity-kind="exec"] [data-oai-tool-activity-summary]')
        ?.textContent ?? "",
    ).toContain("已运行");
    const execSummary = container.querySelector("[data-vscode-exec-summary]");
    expect(execSummary?.querySelector(".oai-vscode-activity-icon")).toBeNull();
    expect(execSummary?.querySelector(".oai-vscode-activity-status")).toBeNull();
    expect(execSummary?.querySelector("[data-vscode-command-chevron]")).toBeTruthy();
    expect(commandPanel?.querySelector("[data-vscode-shell-header]")?.textContent).toBe("Shell");
    expect(commandText.getAttribute("data-command-line-clamp")).toBe("2");
    expect(commandPanel?.querySelector("[data-vscode-command-full]")).toBeNull();
    fireEvent.click(commandText);
    expect(commandText.getAttribute("data-command-line-clamp")).toBe("none");
    expect(commandPanel?.querySelector("[data-vscode-command-full]")).toBeNull();
    expect(commandText.textContent ?? "").toContain("npm run very-long-command");
    expect(commandPanel?.querySelector("[data-vscode-no-output]")?.textContent).toBe("No output");
    expect(commandPanel?.querySelector("[data-vscode-command-footer-status]")?.textContent).toContain("成功");
    expect(commandPanel?.textContent ?? "").not.toContain("cwd:");
    expect((commandPanel?.querySelector("[data-vscode-copy-output]") as HTMLButtonElement).disabled).toBe(false);
    expect(commandPanel?.querySelector("[data-vscode-toggle-output]")).toBeNull();
    expect(commandPanel?.getAttribute("data-output-expanded")).toBe("true");

    fireEvent.click(execSummary as Element);
    await waitFor(() => {
      expect(container.querySelector("[data-vscode-command-output]")).toBeNull();
    });
    expect(execSummary?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(execSummary as Element);
    await waitFor(() => {
      expect(container.querySelector("[data-vscode-command-output]")).toBeTruthy();
    });
    expect(execSummary?.getAttribute("aria-expanded")).toBe("true");
  });

  it("windows long command output while keeping the panel scrollable", async () => {
    const output = Array.from(
      { length: 360 },
      (_, index) => `line ${String(index + 1).padStart(4, "0")}`,
    ).join("\n");
    const items: ConversationItem[] = [
      {
        id: "cmd-scroll-user",
        kind: "message",
        role: "user",
        text: "Run verbose command",
      },
      {
        id: "cmd-scroll-output",
        kind: "tool",
        toolType: "commandExecution",
        itemType: "exec",
        title: "Command: npm run verbose",
        detail: "/repo",
        output,
        status: "completed",
      },
      {
        id: "cmd-scroll-assistant",
        kind: "message",
        role: "assistant",
        text: "Verbose command finished.",
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

    fireEvent.click(
      container.querySelector(
        '[data-oai-tool-activity-kind="exec"] [data-oai-tool-activity-summary]',
      ) as Element,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-vscode-command-output-lines]")).toBeTruthy();
    });
    const outputLines = container.querySelector("[data-vscode-command-output-lines]") as HTMLElement;
    const style = getComputedStyle(outputLines);
    expect(style.overflowX).toBe("auto");
    expect(style.overflowY).toBe("auto");
    expect(style.justifyContent).toBe("flex-start");
    expect(outputLines.textContent ?? "").not.toContain("line 0001");
    expect(outputLines.textContent ?? "").toContain("line 0360");
    expect(container.querySelector("[data-vscode-output-truncation]")?.textContent).toContain(
      "60 earlier lines hidden",
    );
    const toggle = container.querySelector("[data-vscode-toggle-output]") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(container.querySelector("[data-vscode-command-output]")?.getAttribute("data-output-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(container.querySelector("[data-vscode-command-output]")?.getAttribute("data-output-expanded")).toBe("true");
    expect(outputLines.textContent ?? "").toContain("line 0001");
    expect(outputLines.textContent ?? "").toContain("line 0360");
  });

  it("renders context compaction as standalone Codex-style divider status rows", async () => {
    const items: ConversationItem[] = [
      {
        id: "compact-running",
        kind: "tool",
        toolType: "contextCompaction",
        itemType: "context-compaction",
        title: "Context compaction",
        detail: "Compacting conversation context to fit token limits.",
        status: "inProgress",
      },
      {
        id: "compact-completed",
        kind: "tool",
        toolType: "contextCompaction",
        itemType: "context-compaction",
        title: "Context compaction",
        detail: "Compacting conversation context to fit token limits.",
        status: "completed",
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
      expect(container.querySelectorAll("[data-context-compaction='true']").length).toBe(2);
    });
    expect(container.querySelector("[data-oai-tool-group]")).toBeNull();
    expect(container.querySelector("[data-collapsed-tool-activity-item]")).toBeNull();
    expect(screen.getByText("上下文压缩中")).toBeTruthy();
    expect(screen.getByText("上下文已自动压缩")).toBeTruthy();
    expect(
      container
        .querySelector("[data-context-compaction-status='processing']")
        ?.classList.contains("oai-context-compaction-row"),
    ).toBe(true);
    expect(
      container
        .querySelector("[data-context-compaction-status='completed']")
        ?.querySelectorAll(".oai-context-compaction-divider").length,
    ).toBe(2);
    expect(screen.queryByText("Context compaction")).toBeNull();
    expect(screen.queryByText("Context compacted")).toBeNull();
  });

  it("keeps Codex stderr chunks out of the visible transcript", async () => {
    const items: ConversationItem[] = [
      {
        id: "stderr-1",
        kind: "tool",
        toolType: "error",
        itemType: "system-error",
        title: "Codex stderr",
        detail: "stderr",
        output: "Codex stderr: apply_patch verification failed",
        status: "failed",
      },
      {
        id: "stderr-2",
        kind: "tool",
        toolType: "error",
        itemType: "system-error",
        title: "Codex stderr",
        detail: "stderr",
        output: "Codex stderr: expected line",
        status: "failed",
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
      expect(container.querySelectorAll("[data-system-error='true']").length).toBe(0);
    });
    expect(screen.queryByText(/apply_patch verification failed/)).toBeNull();
    expect(screen.queryByText(/expected line/)).toBeNull();
  });

  it("renders OpenAI activity item type branches and generated image artifacts", async () => {
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
    ];
    expect(
      openAIActivityItemTypes.filter(
        (kind) => !container.querySelector(`[data-openai-activity-item-type="${kind}"]`),
      ),
    ).toEqual([]);
    expect(container.querySelector("[data-oai-inline-group]")).toBeTruthy();
    expect(container.querySelector("[data-oai-section-toggle]")).toBeTruthy();
    expect(
      container.querySelector("[data-collapsed-tool-activity] [data-collapsed-tool-activity-summary]"),
    ).toBeNull();
    await waitFor(() => {
      expect(container.querySelectorAll("[data-oai-tool-activity-summary]").length).toBeGreaterThan(0);
    });
    clickAll(container, "[data-oai-tool-activity-summary]");
    await waitFor(() => {
      expect(container.querySelector("[data-pending-mcp-tool-calls-body]")).toBeTruthy();
    });
    expect(container.querySelector('[data-mcp-app][data-mcp-app-instance="mcp-app-1"]')).toBeTruthy();
    expect(container.querySelector("[data-mcp-app-controls] + [data-mcp-app-frame='true']")).toBeTruthy();
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
    expect(content?.getAttribute("data-on-add-selected-text-to-chat-handler")).toBeNull();
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
    expect(
      screen.queryByText("command • sync • thread • session-start.sh • Preparing"),
    ).toBeNull();
    clickFirst(container, "[data-oai-activity-detail-summary]");

    expect(
      screen.getByText("command • sync • thread • session-start.sh • Preparing"),
    ).toBeTruthy();
    expect(screen.getByText("[error] Missing config")).toBeTruthy();
    expect(container.querySelector(".oai-activity-detail-output")).toBeTruthy();
    expect(container.querySelector(".tool-inline-terminal")).toBeNull();
  });
});
