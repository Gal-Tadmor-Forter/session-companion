import * as vscode from "vscode";
import type { AttachmentSummary } from "../../shared/protocol";

// Verified against platform.claude.com/docs/en/build-with-claude/vision (checked at build time,
// not hardcoded from memory): images are capped at 10MB base64-encoded on the direct API, and
// only JPEG/PNG/GIF/WebP are supported. There's no equivalent official cap for plain-text
// attachments (that's our own guardrail, not a platform limit), so we keep it conservative.
const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 256 * 1024;

const IMAGE_MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface StagedImageAttachment {
  kind: "image";
  fileName: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  base64Data: string;
}

export interface StagedTextAttachment {
  kind: "text";
  fileName: string;
  textContent: string;
}

export type StagedAttachment = StagedImageAttachment | StagedTextAttachment;

/** `AttachmentSummary.id`/`sizeBytes` are optional on the wire type because a past
 * session's reconstructed attachments (`sessionHistory.ts`) have neither — but
 * anything this store produces always does. */
export type LiveAttachmentSummary = AttachmentSummary & { id: string; sizeBytes: number };

let nextAttachmentId = 0;

export class AttachmentStore {
  private readonly staged = new Map<string, StagedAttachment>();

  async pickAndStage(): Promise<
    { summary: LiveAttachmentSummary; attachment: StagedAttachment } | { error: string }
  > {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: false });
    if (!picked || picked.length === 0) {
      return { error: "No file selected." };
    }
    const uri = picked[0];
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
    const fileName = uri.path.split("/").pop() ?? uri.path;
    return this.classify(fileName, bytes);
  }

  /** Same classification/size-limit rules as `pickAndStage`, for content the webview
   * already has in hand (e.g. a drag-and-dropped file read via the browser File API). */
  stageFromBase64(
    fileName: string,
    base64Data: string
  ): { summary: LiveAttachmentSummary; attachment: StagedAttachment } | { error: string } {
    return this.classify(fileName, Buffer.from(base64Data, "base64"));
  }

  private classify(
    fileName: string,
    bytes: Buffer
  ): { summary: LiveAttachmentSummary; attachment: StagedAttachment } | { error: string } {
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";

    const mediaType = IMAGE_MEDIA_TYPES[ext];
    if (mediaType) {
      const base64Data = bytes.toString("base64");
      if (base64Data.length > MAX_IMAGE_BASE64_BYTES) {
        return {
          error: `${fileName} is too large: images must be under 10MB (base64-encoded) per the Claude API's image size limit.`,
        };
      }
      const attachment: StagedImageAttachment = { kind: "image", fileName, mediaType, base64Data };
      return this.store(attachment, bytes.byteLength, { mediaType, previewBase64: base64Data });
    }

    if (bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES) {
      return { error: `${fileName} is too large: text attachments are capped at 256KB.` };
    }
    const textContent = bytes.toString("utf-8");
    const attachment: StagedTextAttachment = { kind: "text", fileName, textContent };
    return this.store(attachment, bytes.byteLength, { previewText: textContent });
  }

  private store(
    attachment: StagedAttachment,
    sizeBytes: number,
    preview: Pick<AttachmentSummary, "mediaType" | "previewBase64" | "previewText">
  ): { summary: LiveAttachmentSummary; attachment: StagedAttachment } {
    nextAttachmentId += 1;
    const id = `att-${nextAttachmentId}`;
    this.staged.set(id, attachment);
    return {
      summary: { id, fileName: attachment.fileName, kind: attachment.kind, sizeBytes, ...preview },
      attachment,
    };
  }

  remove(id: string): void {
    this.staged.delete(id);
  }

  /** Resolves and consumes (removes) the given attachment ids. */
  take(ids: string[]): StagedAttachment[] {
    const result: StagedAttachment[] = [];
    for (const id of ids) {
      const attachment = this.staged.get(id);
      if (attachment) {
        result.push(attachment);
        this.staged.delete(id);
      }
    }
    return result;
  }
}
