import { useEffect } from "react";
import { X } from "lucide-react";
import type { AttachmentSummary } from "../../../shared/protocol";

interface AttachmentPreviewDialogProps {
  attachment: AttachmentSummary | undefined;
  onClose: () => void;
}

export function AttachmentPreviewDialog({ attachment, onClose }: AttachmentPreviewDialogProps) {
  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [attachment, onClose]);

  if (!attachment) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {attachment.fileName}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {attachment.kind === "image" && attachment.previewBase64 ? (
            <img
              src={`data:${attachment.mediaType ?? "image/png"};base64,${attachment.previewBase64}`}
              alt={attachment.fileName}
              className="mx-auto max-w-full rounded-md"
            />
          ) : (
            <pre className="overflow-x-auto rounded-md border border-border bg-black/30 p-2 font-mono text-xs text-foreground whitespace-pre-wrap break-words">
              {attachment.previewText ?? "No preview available."}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
