import type { Dispatch, RefObject, SetStateAction } from "react";
import Paperclip from "lucide-react/dist/esm/icons/paperclip";
import Plus from "lucide-react/dist/esm/icons/plus";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";

type ComposerMobileActionsMenuProps = {
  disabled: boolean;
  handleMobileAttachClick: () => void;
  mobileActionsOpen: boolean;
  mobileActionsRef: RefObject<HTMLDivElement | null>;
  onAddAttachment?: () => void;
  setMobileActionsOpen: Dispatch<SetStateAction<boolean>>;
};

export function ComposerMobileActionsMenu({
  disabled,
  handleMobileAttachClick,
  mobileActionsOpen,
  mobileActionsRef,
  onAddAttachment,
  setMobileActionsOpen,
}: ComposerMobileActionsMenuProps) {
  return (
    <div
      className={`composer-mobile-menu${mobileActionsOpen ? " is-open" : ""}`}
      ref={mobileActionsRef}
    >
      <button
        type="button"
        className="composer-action composer-action--mobile-menu"
        onClick={() => setMobileActionsOpen((prev) => !prev)}
        disabled={disabled}
        aria-expanded={mobileActionsOpen}
        aria-haspopup="menu"
        aria-label="More actions"
        title="More actions"
      >
        <Plus size={14} aria-hidden />
      </button>
      {mobileActionsOpen && (
        <PopoverSurface className="composer-mobile-actions-popover" role="menu">
          <PopoverMenuItem
            onClick={handleMobileAttachClick}
            disabled={disabled || !onAddAttachment}
            icon={<Paperclip size={14} />}
          >
            Add file
          </PopoverMenuItem>
        </PopoverSurface>
      )}
    </div>
  );
}
