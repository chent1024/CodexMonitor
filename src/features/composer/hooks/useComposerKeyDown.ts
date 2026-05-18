import { useCallback, type KeyboardEvent, type RefObject } from "react";
import type { ComposerSendIntent } from "../../../types";
import { getListContinuation } from "../../../utils/composerText";
import { isComposingEvent } from "../../../utils/keys";
import { isMobilePlatform } from "../../../utils/platformPaths";

type ReviewPromptKeyEvent = {
  key: string;
  shiftKey?: boolean;
  preventDefault: () => void;
};

type UseComposerKeyDownArgs = {
  applyTextInsertion: (nextText: string, nextCursor: number) => void;
  canSend: boolean;
  canStop: boolean;
  continueListOnShiftEnter: boolean;
  defaultSubmitIntent: ComposerSendIntent;
  expandFenceOnEnter: boolean;
  expandFenceOnSpace: boolean;
  handleHistoryKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: (submitIntent?: ComposerSendIntent) => void;
  onStop: () => void;
  isMac: boolean;
  onReviewPromptKeyDown?: (event: ReviewPromptKeyEvent) => boolean;
  oppositeSubmitIntent: ComposerSendIntent;
  reviewPromptOpen: boolean;
  suggestionsOpen: boolean;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  tryExpandFence: (start: number, end: number) => boolean;
};

export function useComposerKeyDown({
  applyTextInsertion,
  canSend,
  canStop,
  continueListOnShiftEnter,
  defaultSubmitIntent,
  expandFenceOnEnter,
  expandFenceOnSpace,
  handleHistoryKeyDown,
  handleInputKeyDown,
  handleSend,
  onStop,
  isMac,
  onReviewPromptKeyDown,
  oppositeSubmitIntent,
  reviewPromptOpen,
  suggestionsOpen,
  text,
  textareaRef,
  tryExpandFence,
}: UseComposerKeyDownArgs) {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingEvent(event)) {
        return;
      }
      const currentTextarea = textareaRef.current;
      const currentText = currentTextarea?.value ?? text;
      const currentCanSend = canSend || currentText.trim().length > 0;
      handleHistoryKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      const isOppositeFollowUpShortcut =
        event.key === "Enter" &&
        event.shiftKey &&
        (isMac ? event.metaKey : event.ctrlKey);
      if (isOppositeFollowUpShortcut && !suggestionsOpen) {
        event.preventDefault();
        const dismissKeyboardAfterSend = currentCanSend && isMobilePlatform();
        handleSend(oppositeSubmitIntent);
        if (dismissKeyboardAfterSend) {
          textareaRef.current?.blur();
        }
        return;
      }
      if (
        expandFenceOnSpace &&
        event.key === " " &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const start = textarea.selectionStart ?? currentText.length;
        const end = textarea.selectionEnd ?? start;
        if (tryExpandFence(start, end)) {
          event.preventDefault();
          return;
        }
      }
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (continueListOnShiftEnter && !suggestionsOpen) {
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart ?? currentText.length;
            const end = textarea.selectionEnd ?? start;
            if (start === end) {
              const marker = getListContinuation(currentText, start);
              if (marker) {
                event.preventDefault();
                const before = currentText.slice(0, start);
                const after = currentText.slice(end);
                const nextText = `${before}\n${marker}${after}`;
                const nextCursor = before.length + 1 + marker.length;
                applyTextInsertion(nextText, nextCursor);
                return;
              }
            }
          }
        }
        event.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const start = textarea.selectionStart ?? currentText.length;
        const end = textarea.selectionEnd ?? start;
        const nextText = `${currentText.slice(0, start)}\n${currentText.slice(end)}`;
        const nextCursor = start + 1;
        applyTextInsertion(nextText, nextCursor);
        return;
      }
      if (reviewPromptOpen && onReviewPromptKeyDown) {
        const handled = onReviewPromptKeyDown(event);
        if (handled) {
          return;
        }
      }
      handleInputKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape" && canStop) {
        event.preventDefault();
        event.stopPropagation();
        onStop();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        if (expandFenceOnEnter) {
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart ?? currentText.length;
            const end = textarea.selectionEnd ?? start;
            if (tryExpandFence(start, end)) {
              event.preventDefault();
              return;
            }
          }
        }
        event.preventDefault();
        const dismissKeyboardAfterSend = currentCanSend && isMobilePlatform();
        handleSend(defaultSubmitIntent);
        if (dismissKeyboardAfterSend) {
          textareaRef.current?.blur();
        }
      }
    },
    [
      applyTextInsertion,
      canSend,
      canStop,
      continueListOnShiftEnter,
      defaultSubmitIntent,
      expandFenceOnEnter,
      expandFenceOnSpace,
      handleHistoryKeyDown,
      handleInputKeyDown,
      handleSend,
      isMac,
      onStop,
      onReviewPromptKeyDown,
      oppositeSubmitIntent,
      reviewPromptOpen,
      suggestionsOpen,
      text,
      textareaRef,
      tryExpandFence,
    ],
  );
}
