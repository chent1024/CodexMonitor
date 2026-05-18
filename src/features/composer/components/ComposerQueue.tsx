import { useCallback } from "react";
import CornerDownRight from "lucide-react/dist/esm/icons/corner-down-right";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { QueuedMessage } from "../../../types";

type ComposerQueueProps = {
  queuedMessages: QueuedMessage[];
  pausedReason?: string | null;
  onGuideQueued?: (item: QueuedMessage) => void | Promise<void>;
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
};

export function ComposerQueue({
  queuedMessages,
  pausedReason = null,
  onGuideQueued,
  onEditQueued,
  onDeleteQueued,
}: ComposerQueueProps) {
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="composer-queue">
      {pausedReason ? (
        <div className="composer-queue-hint">{pausedReason}</div>
      ) : null}
      {queuedMessages.map((item) => (
        <QueueItem
          key={item.id}
          item={item}
          onGuideQueued={onGuideQueued}
          onEditQueued={onEditQueued}
          onDeleteQueued={onDeleteQueued}
        />
      ))}
    </div>
  );
}

function getQueuedMessageLabel(item: QueuedMessage) {
  const fallback = item.images?.length
    ? item.images.length === 1
      ? "Attachment"
      : "Attachments"
    : "";
  const text = item.text || fallback;
  const imageSuffix = item.images?.length
    ? ` · ${item.images.length} attachment${item.images.length === 1 ? "" : "s"}`
    : "";
  return `${text}${imageSuffix}`;
}

function QueueItem({
  item,
  onGuideQueued,
  onEditQueued,
  onDeleteQueued,
}: QueueMenuButtonProps) {
  const handleGuide = useCallback(() => {
    void onGuideQueued?.(item);
  }, [item, onGuideQueued]);

  const handleDelete = useCallback(() => {
    onDeleteQueued?.(item.id);
  }, [item.id, onDeleteQueued]);

  const handleEdit = useCallback(() => {
    onEditQueued?.(item);
  }, [item, onEditQueued]);

  return (
    <div className="composer-queue-item">
      <CornerDownRight className="composer-queue-leading-icon" size={14} aria-hidden />
      <span className="composer-queue-text">{getQueuedMessageLabel(item)}</span>
      <div className="composer-queue-actions">
        {onGuideQueued ? (
          <button
            type="button"
            className="composer-queue-guide"
            onClick={handleGuide}
            aria-label="Guide queued message"
          >
            <CornerDownRight size={13} aria-hidden />
            <span>引导</span>
          </button>
        ) : null}
        {onEditQueued ? (
          <button
            type="button"
            className="composer-queue-action-icon"
            onClick={handleEdit}
            aria-label="Edit queued message"
          >
            <Pencil size={13} aria-hidden />
          </button>
        ) : null}
        {onDeleteQueued ? (
          <button
            type="button"
            className="composer-queue-action-icon"
            onClick={handleDelete}
            aria-label="Delete queued message"
          >
            <Trash2 size={13} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type QueueMenuButtonProps = {
  item: QueuedMessage;
  onGuideQueued?: (item: QueuedMessage) => void | Promise<void>;
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
};
