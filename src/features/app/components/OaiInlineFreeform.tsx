import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type OaiInlineFreeformProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  leading?: ReactNode;
};

export function OaiInlineFreeform({
  value,
  placeholder,
  onChange,
  ariaLabel,
  onKeyDown,
  leading,
}: OaiInlineFreeformProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(20, textarea.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  return (
    <div
      className="oai-request-input-panel__inline-freeform-shell"
      data-oai-request-input-freeform-shell
    >
      {leading ? (
        <span className="oai-request-input-panel__inline-freeform-leading">
          {leading}
        </span>
      ) : null}
      <span
        className="relative min-w-0 flex-1 leading-5 oai-request-input-panel__inline-freeform-field"
        data-oai-request-input-freeform-field
      >
        {!value ? (
          <span
            className="pointer-events-none absolute inset-x-0 top-0 truncate text-sm leading-5 text-token-description-foreground oai-request-input-panel__inline-freeform-placeholder"
            data-oai-request-input-freeform-placeholder
          >
            {placeholder}
          </span>
        ) : null}
        <textarea
          ref={textareaRef}
          className="request-input-panel__inline-freeform block h-5 w-full min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm leading-5 text-token-foreground shadow-none outline-none placeholder:text-transparent focus:border-transparent focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none oai-request-input-panel__inline-freeform"
          data-autoresize=""
          data-oai-request-input-freeform
          aria-label={ariaLabel ?? placeholder}
          placeholder={placeholder}
          rows={1}
          value={value}
          onInput={resizeTextarea}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </span>
    </div>
  );
}
