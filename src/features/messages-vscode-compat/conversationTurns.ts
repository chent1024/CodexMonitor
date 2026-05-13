import type {
  AssistantTurnActivityBlock,
  MessageListEntry,
} from "../messages/utils/messageRenderUtils";

export type VscodeConversationTurn = {
  id: string;
  userEntry: Extract<MessageListEntry, { kind: "item" }> | null;
  agentEntries: MessageListEntry[];
  orphan: boolean;
};

export function buildVscodeConversationTurns(groupedItems: MessageListEntry[]) {
  const turns: VscodeConversationTurn[] = [];
  let activeTurn: VscodeConversationTurn | null = null;

  const flushTurn = () => {
    if (!activeTurn) {
      return;
    }
    turns.push(activeTurn);
    activeTurn = null;
  };

  const ensureAgentTurn = (id: string) => {
    if (!activeTurn) {
      activeTurn = {
        id: `assistant:${id}`,
        userEntry: null,
        agentEntries: [],
        orphan: true,
      };
    }
    return activeTurn;
  };

  groupedItems.forEach((entry) => {
    if (
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "user" &&
      entry.item.itemType === "user-message" &&
      entry.item.steeringStatus != null
    ) {
      const entryId = entry.item.id;
      ensureAgentTurn(entryId).agentEntries.push(entry);
      return;
    }

    if (entry.kind === "item" && entry.item.kind === "message" && entry.item.role === "user") {
      flushTurn();
      activeTurn = {
        id: `user:${entry.item.id}`,
        userEntry: entry,
        agentEntries: [],
        orphan: false,
      };
      return;
    }

    const entryId =
      entry.kind === "assistantTurn"
        ? entry.turn.id
        : entry.kind === "toolGroup"
          ? entry.group.id
          : entry.item.id;
    ensureAgentTurn(entryId).agentEntries.push(entry);
  });

  flushTurn();
  return turns;
}

export function getVscodeEntrySearchUnitKey(
  turnId: string,
  entry: MessageListEntry,
  index: number,
) {
  if (entry.kind === "assistantTurn") {
    return `${turnId}:${entry.turn.id}:assistant`;
  }
  if (entry.kind === "toolGroup") {
    return `${turnId}:${entry.group.id}:tools`;
  }
  return `${turnId}:${entry.item.id}:${entry.item.kind}-${index}`;
}

export function getVscodeEntrySearchUnitKind(
  entry: MessageListEntry,
  getActivityBlockKind: (block: AssistantTurnActivityBlock) => string,
) {
  if (entry.kind === "assistantTurn") {
    return "assistant-turn";
  }
  if (entry.kind === "toolGroup") {
    return getActivityBlockKind({
      kind: "activity",
      id: entry.group.id,
      summary: "",
      items: entry.group.items,
      toolCount: entry.group.toolCount,
      messageCount: entry.group.messageCount,
      durationMs: null,
    });
  }
  return entry.item.kind;
}

export function getVscodeAssistantTurnSearchKey(entries: MessageListEntry[]) {
  const firstAssistantTurn = entries.find(
    (entry): entry is Extract<MessageListEntry, { kind: "assistantTurn" }> =>
      entry.kind === "assistantTurn",
  );
  if (firstAssistantTurn) {
    return `assistant:${firstAssistantTurn.turn.id}`;
  }

  const firstAssistantMessage = entries.find(
    (entry): entry is Extract<MessageListEntry, { kind: "item" }> =>
      entry.kind === "item" &&
      entry.item.kind === "message" &&
      entry.item.role === "assistant",
  );
  if (firstAssistantMessage) {
    return `assistant:${firstAssistantMessage.item.id}`;
  }
  return undefined;
}
