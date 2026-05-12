import { useMemo, useState } from "react";
import { OaiInlineFreeform } from "./OaiInlineFreeform";

type PlanReadyFollowupMessageProps = {
  onAccept: () => void;
  onSubmitChanges: (changes: string) => void;
};

export function PlanReadyFollowupMessage({
  onAccept,
  onSubmitChanges,
}: PlanReadyFollowupMessageProps) {
  const [changes, setChanges] = useState("");
  const trimmed = useMemo(() => changes.trim(), [changes]);

  return (
    <div
      className="flex w-full min-w-0 flex-col oai-followup-message oai-request-input-message"
      data-oai-followup-message
      data-oai-request-input-message
    >
      <div
        className="oai-followup-card oai-request-input-panel"
        role="group"
        aria-label="Plan ready"
        data-oai-request-input-panel
      >
        <div className="oai-request-input-panel__header">
          <div className="oai-request-input-panel__title">Plan ready</div>
        </div>
        <div className="oai-request-input-panel__body">
          <section className="oai-request-input-panel__question">
            <div className="oai-request-input-panel__question-text">
              Start building from this plan, or describe changes to the plan.
            </div>
            <OaiInlineFreeform
              placeholder="Describe what you want to change in the plan..."
              value={changes}
              onChange={setChanges}
            />
          </section>
        </div>
        <div className="oai-request-input-panel__actions">
          <button
            type="button"
            className="oai-request-input-panel__secondary-action"
            onClick={() => {
              if (!trimmed) {
                return;
              }
              onSubmitChanges(trimmed);
              setChanges("");
            }}
            disabled={!trimmed}
          >
            Send changes
          </button>
          <button type="button" className="primary" onClick={onAccept}>
            Implement this plan
          </button>
        </div>
      </div>
    </div>
  );
}
