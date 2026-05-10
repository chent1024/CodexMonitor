import { useEffect } from "react";
import type { AppMention, QueuedMessage } from "../../../types";
import type { AppMentionBinding } from "../../apps/utils/appMentions";

type UseComposerDraftEffectsArgs = {
  draftText: string;
  historyKey: string | null;
  prefillDraft: QueuedMessage | null;
  onPrefillHandled?: (id: string) => void;
  insertText: QueuedMessage | null;
  onInsertHandled?: (id: string) => void;
  syncDraftText: (next: string) => void;
  setComposerText: (next: string) => void;
  setAppMentionBindings: (next: AppMentionBinding[]) => void;
  bindingsFromMentions: (mentions?: AppMention[]) => AppMentionBinding[];
  resetHistoryNavigation: () => void;
};

function applyQueuedMessage({
  message,
  handled,
  setComposerText,
  setAppMentionBindings,
  bindingsFromMentions,
  resetHistoryNavigation,
}: {
  message: QueuedMessage;
  handled?: (id: string) => void;
  setComposerText: (next: string) => void;
  setAppMentionBindings: (next: AppMentionBinding[]) => void;
  bindingsFromMentions: (mentions?: AppMention[]) => AppMentionBinding[];
  resetHistoryNavigation: () => void;
}) {
  setComposerText(message.text);
  setAppMentionBindings(bindingsFromMentions(message.appMentions));
  resetHistoryNavigation();
  handled?.(message.id);
}

export function useComposerDraftEffects({
  draftText,
  historyKey,
  prefillDraft,
  onPrefillHandled,
  insertText,
  onInsertHandled,
  syncDraftText,
  setComposerText,
  setAppMentionBindings,
  bindingsFromMentions,
  resetHistoryNavigation,
}: UseComposerDraftEffectsArgs) {
  useEffect(() => {
    syncDraftText(draftText);
  }, [draftText, syncDraftText]);

  useEffect(() => {
    setAppMentionBindings([]);
  }, [historyKey, setAppMentionBindings]);

  useEffect(() => {
    if (!prefillDraft) {
      return;
    }
    applyQueuedMessage({
      message: prefillDraft,
      handled: onPrefillHandled,
      setComposerText,
      setAppMentionBindings,
      bindingsFromMentions,
      resetHistoryNavigation,
    });
  }, [
    bindingsFromMentions,
    onPrefillHandled,
    prefillDraft,
    resetHistoryNavigation,
    setAppMentionBindings,
    setComposerText,
  ]);

  useEffect(() => {
    if (!insertText) {
      return;
    }
    applyQueuedMessage({
      message: insertText,
      handled: onInsertHandled,
      setComposerText,
      setAppMentionBindings,
      bindingsFromMentions,
      resetHistoryNavigation,
    });
  }, [
    bindingsFromMentions,
    insertText,
    onInsertHandled,
    resetHistoryNavigation,
    setAppMentionBindings,
    setComposerText,
  ]);
}
