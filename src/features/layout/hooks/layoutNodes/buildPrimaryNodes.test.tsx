import { Children, isValidElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { buildPrimaryNodes } from "./buildPrimaryNodes";

function buildOptions(threadId: string | null) {
  return {
    sidebarProps: {},
    messagesProps: {
      items: [],
      threadId,
      workspaceId: "ws-1",
      isThinking: false,
      openTargets: [],
      selectedOpenAppId: "",
    },
    composerProps: null,
    approvalToastsProps: {},
    errorToastsProps: {},
    homeProps: {},
    mainHeaderProps: null,
    desktopTopbarProps: {
      showBackToChat: false,
      onExitDiff: () => {},
    },
    tabletNavProps: {},
    tabBarProps: {},
  } as unknown as Parameters<typeof buildPrimaryNodes>[0];
}

describe("buildPrimaryNodes", () => {
  it("passes thread identity without forcing the messages pane to remount", () => {
    const threadNodes = buildPrimaryNodes(buildOptions("thread-1"));
    const draftNodes = buildPrimaryNodes(buildOptions(null));

    expect(isValidElement(threadNodes.messagesNode)).toBe(true);
    expect(isValidElement(draftNodes.messagesNode)).toBe(true);
    expect(
      isValidElement(threadNodes.messagesNode) ? threadNodes.messagesNode.key : null,
    ).toBe(null);
    expect(
      isValidElement(draftNodes.messagesNode) ? draftNodes.messagesNode.key : null,
    ).toBe(null);
    expect(
      isValidElement<{ threadId?: string | null }>(threadNodes.messagesNode)
        ? threadNodes.messagesNode.props.threadId
        : undefined,
    ).toBe("thread-1");
    expect(
      isValidElement<{ threadId?: string | null }>(draftNodes.messagesNode)
        ? draftNodes.messagesNode.props.threadId
        : undefined,
    ).toBe(null);
  });

  it("places the active working indicator above the composer when composer exists", () => {
    const nodes = buildPrimaryNodes({
      ...buildOptions("thread-1"),
      messagesProps: {
        ...buildOptions("thread-1").messagesProps,
        items: [
          {
            id: "reasoning-1",
            kind: "reasoning",
            summary: "Scanning repository",
            content: "",
          },
        ],
        isThinking: true,
        processingStartedAt: Date.now() - 1000,
      },
      composerProps: {},
    } as unknown as Parameters<typeof buildPrimaryNodes>[0]);

    expect(isValidElement(nodes.messagesNode)).toBe(true);
    expect(
      isValidElement<{ renderActiveWorkingIndicator?: boolean }>(nodes.messagesNode)
        ? nodes.messagesNode.props.renderActiveWorkingIndicator
        : undefined,
    ).toBe(false);
    expect(isValidElement(nodes.composerNode)).toBe(true);
    const composerChildren = isValidElement<{ children?: ReactNode }>(nodes.composerNode)
      ? Children.toArray(nodes.composerNode.props.children)
      : [];
    const statusNode = composerChildren.find(
      (child) =>
        isValidElement<{ className?: string }>(child) &&
        child.props.className === "chat-pane-composer-status",
    );
    expect(statusNode).toBeTruthy();
    const statusChild = isValidElement<{ children?: ReactNode }>(statusNode)
      ? Children.only(statusNode.props.children)
      : null;
    expect(
      isValidElement<{ reasoningLabel?: string | null }>(statusChild)
        ? statusChild.props.reasoningLabel
        : null,
    ).toBe("Scanning repository");
  });
});
