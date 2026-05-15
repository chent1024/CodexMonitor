import { isValidElement } from "react";
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
  it("keys messages by thread identity so draft mode remounts stale transcript state", () => {
    const threadNodes = buildPrimaryNodes(buildOptions("thread-1"));
    const draftNodes = buildPrimaryNodes(buildOptions(null));

    expect(isValidElement(threadNodes.messagesNode)).toBe(true);
    expect(isValidElement(draftNodes.messagesNode)).toBe(true);
    expect(
      isValidElement(threadNodes.messagesNode) ? threadNodes.messagesNode.key : null,
    ).toBe("messages:ws-1:thread-1");
    expect(
      isValidElement(draftNodes.messagesNode) ? draftNodes.messagesNode.key : null,
    ).toBe("messages:ws-1:draft");
  });

  it("keeps the active working indicator in the message flow when composer exists", () => {
    const nodes = buildPrimaryNodes({
      ...buildOptions("thread-1"),
      messagesProps: {
        ...buildOptions("thread-1").messagesProps,
        isThinking: true,
      },
      composerProps: {},
    } as unknown as Parameters<typeof buildPrimaryNodes>[0]);

    expect(isValidElement(nodes.messagesNode)).toBe(true);
    expect(
      isValidElement<{ renderActiveWorkingIndicator?: boolean }>(nodes.messagesNode)
        ? nodes.messagesNode.props.renderActiveWorkingIndicator
        : undefined,
    ).toBeUndefined();
    expect(isValidElement(nodes.composerNode)).toBe(true);
    expect(
      isValidElement<{ className?: string }>(nodes.composerNode)
        ? nodes.composerNode.props.className
        : undefined,
    ).not.toBe("chat-pane-composer-status");
  });
});
