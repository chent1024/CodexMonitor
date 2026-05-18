import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import File from "lucide-react/dist/esm/icons/file";
import X from "lucide-react/dist/esm/icons/x";
import { isImageAttachmentPath } from "../utils/attachmentPaths";

type ComposerAttachmentsProps = {
  attachments: string[];
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
};

function fileTitle(path: string) {
  if (path.startsWith("data:")) {
    return "Pasted image";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return "Image";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function attachmentPreviewSrc(path: string) {
  if (!isImageAttachmentPath(path)) {
    return "";
  }
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

function ComposerAttachmentLightbox({
  image,
  onClose,
}: {
  image: { src: string; title: string } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!image) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [image, onClose]);

  useEffect(() => {
    if (!image) {
      return undefined;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [image]);

  if (!image) {
    return null;
  }

  return createPortal(
    <div
      className="oai-message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="oai-message-image-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="oai-message-image-lightbox-close"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <X size={16} aria-hidden />
        </button>
        <img src={image.src} alt={image.title} />
      </div>
    </div>,
    document.body,
  );
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
}: ComposerAttachmentsProps) {
  const [activeImage, setActiveImage] = useState<{ src: string; title: string } | null>(
    null,
  );

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="composer-attachments">
        {attachments.map((path) => {
          const title = fileTitle(path);
          const previewSrc = attachmentPreviewSrc(path);
          const titleAttr = previewSrc
            ? undefined
            : path.startsWith("data:")
              ? "Pasted image"
              : path;
          return (
            <div
              key={path}
              className="composer-attachment"
              title={titleAttr}
            >
              {previewSrc && (
                <span className="composer-attachment-preview" aria-hidden>
                  <img src={previewSrc} alt="" />
                </span>
              )}
              {previewSrc ? (
                <button
                  type="button"
                  className="composer-attachment-thumb composer-attachment-open"
                  onClick={() => setActiveImage({ src: previewSrc, title })}
                  aria-label="Open image"
                >
                  <img src={previewSrc} alt="" />
                </button>
              ) : (
                <span className="composer-icon" aria-hidden>
                  <File size={14} />
                </span>
              )}
              {!previewSrc && (
                <span className="composer-attachment-name">{title}</span>
              )}
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => onRemoveAttachment?.(path)}
                aria-label={`Remove ${title}`}
                disabled={disabled}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <ComposerAttachmentLightbox
        image={activeImage}
        onClose={() => setActiveImage(null)}
      />
    </>
  );
}
