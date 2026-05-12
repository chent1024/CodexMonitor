import { useEffect, useMemo, useState } from "react";
import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import { OaiInlineFreeform } from "./OaiInlineFreeform";

type RequestUserInputMessageProps = {
  requests: RequestUserInputRequest[];
  activeThreadId: string | null;
  activeWorkspaceId?: string | null;
  onSubmit: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
};

type SelectionState = Record<string, number | null>;
type NotesState = Record<string, string>;

export function RequestUserInputMessage({
  requests,
  activeThreadId,
  activeWorkspaceId,
  onSubmit,
}: RequestUserInputMessageProps) {
  const activeRequests = useMemo(
    () =>
      requests.filter((request) => {
        if (!activeThreadId) {
          return false;
        }
        if (request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return true;
      }),
    [requests, activeThreadId, activeWorkspaceId],
  );
  const activeRequest = activeRequests[0];
  const [selections, setSelections] = useState<SelectionState>({});
  const [notes, setNotes] = useState<NotesState>({});
  const [dismissedRequestId, setDismissedRequestId] = useState<string | number | null>(null);

  useEffect(() => {
    if (!activeRequest) {
      setSelections({});
      setNotes({});
      return;
    }
    const nextSelections: SelectionState = {};
    const nextNotes: NotesState = {};
    activeRequest.params.questions.forEach((question, index) => {
      const key = question.id || `question-${index}`;
      nextSelections[key] = null;
      nextNotes[key] = "";
    });
    setSelections(nextSelections);
    setNotes(nextNotes);
  }, [activeRequest]);

  if (!activeRequest) {
    return null;
  }
  if (dismissedRequestId === activeRequest.request_id) {
    return null;
  }

  const { questions } = activeRequest.params;
  const totalRequests = activeRequests.length;

  const buildAnswers = () => {
    const answers: RequestUserInputResponse["answers"] = {};
    questions.forEach((question, index) => {
      if (!question.id) {
        return;
      }
      const answerList: string[] = [];
      const key = question.id || `question-${index}`;
      const selectedIndex = selections[key];
      const options = question.options ?? [];
      const hasOptions = options.length > 0;
      if (hasOptions && selectedIndex !== null) {
        const selected = options[selectedIndex];
        const selectedValue =
          selected?.label?.trim() || selected?.description?.trim() || "";
        if (selectedValue) {
          answerList.push(selectedValue);
        }
      }
      const note = (notes[key] ?? "").trim();
      if (note) {
        if (hasOptions) {
          answerList.push(`user_note: ${note}`);
        } else {
          answerList.push(note);
        }
      }
      answers[question.id] = { answers: answerList };
    });
    return answers;
  };

  const handleSelect = (questionId: string, optionIndex: number) => {
    setSelections((current) => ({ ...current, [questionId]: optionIndex }));
  };

  const handleNotesChange = (questionId: string, value: string) => {
    setNotes((current) => ({ ...current, [questionId]: value }));
  };

  const handleSubmit = () => {
    onSubmit(activeRequest, { answers: buildAnswers() });
  };
  const handleDismiss = () => {
    setDismissedRequestId(activeRequest.request_id);
  };

  return (
    <div
      className="flex w-full min-w-0 flex-col oai-followup-message oai-request-input-message"
      data-oai-followup-message
      data-oai-request-input-message
    >
      <div
        className="oai-followup-card oai-request-input-panel"
        role="group"
        aria-label="User input requested"
        data-oai-request-input-panel
      >
        <div className="oai-request-input-panel__header">
          <div className="oai-request-input-panel__title">Input requested</div>
          {totalRequests > 1 ? (
            <div className="oai-request-input-panel__queue">
              {`Request 1 of ${totalRequests}`}
            </div>
          ) : null}
        </div>
        <div className="oai-request-input-panel__body">
          {questions.length ? (
            questions.map((question, index) => {
              const questionId = question.id || `question-${index}`;
              const selectedIndex = selections[questionId];
              const options = question.options ?? [];
              const notePlaceholder = question.isOther
                ? "Type your answer (optional)"
                : options.length
                ? "Add notes (optional)"
                : "Type your answer (optional)";
              return (
                <section key={questionId} className="oai-request-input-panel__question">
                  {question.header ? (
                    <div className="oai-request-input-panel__question-header">
                      {question.header}
                    </div>
                  ) : null}
                  <div className="oai-request-input-panel__question-text">
                    {question.question}
                  </div>
                  {options.length ? (
                    <div className="oai-request-input-panel__options">
                      {options.map((option, optionIndex) => (
                        <button
                          key={`${questionId}-${optionIndex}`}
                          type="button"
                          className={`oai-request-input-panel__option${
                            selectedIndex === optionIndex ? " is-selected" : ""
                          }`}
                          onClick={() => handleSelect(questionId, optionIndex)}
                        >
                          <span className="oai-request-input-panel__option-index">
                            <span hidden>requestInputPanel.optionIndex</span>
                            {optionIndex + 1}.
                          </span>
                          <div className="oai-request-input-panel__option-label">
                            {option.label}
                          </div>
                          {option.description ? (
                            <div className="oai-request-input-panel__option-description">
                              {option.description}
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <OaiInlineFreeform
                    placeholder={notePlaceholder}
                    value={notes[questionId] ?? ""}
                    onChange={(value) => handleNotesChange(questionId, value)}
                    leading={
                      options.length ? (
                        <span
                          data-request-input-option-index
                          data-i18n-id="requestInputPanel.optionIndex"
                        >
                          {options.length + 1}.
                        </span>
                      ) : null
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        handleDismiss();
                      }
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                </section>
              );
            })
          ) : (
            <div className="oai-request-input-panel__empty">
              No questions provided.
            </div>
          )}
        </div>
        <div className="oai-request-input-panel__actions">
          <button
            type="button"
            className="oai-request-input-panel__dismiss"
            data-request-input-dismiss
            data-i18n-id="requestInputPanel.dismiss"
            onClick={handleDismiss}
          >
            <span>Dismiss</span>
            <kbd data-i18n-id="requestInputPanel.escapeKey">ESC</kbd>
          </button>
          <button
            type="button"
            className="oai-request-input-panel__skip"
            data-request-input-skip
            data-i18n-id="requestInputPanel.skip"
            onClick={handleSubmit}
          >
            Skip
          </button>
          <button className="primary" onClick={handleSubmit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
