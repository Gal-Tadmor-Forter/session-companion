import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AttachmentSummary, ReplayItem } from "../../shared/protocol";

function summarizeToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

interface AssistantLikeMessage {
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
}

/** Claude Code's IDE integration auto-injects context as ordinary "user" messages
 * wrapped in a tag like `<ide_opened_file>...</ide_opened_file>` — not something the
 * person actually typed. Detected structurally (whole message wrapped in one matching
 * tag pair) rather than by an allowlist of known tag names, so new tag types the IDE
 * integration adds later are still caught. */
const SYSTEM_CONTEXT_TAG = /^<([a-z][a-z0-9_-]*)>[\s\S]*<\/\1>$/i;

function isSystemContextTag(text: string): boolean {
  return SYSTEM_CONTEXT_TAG.test(text.trim());
}

/** The CLI expands a typed slash command (e.g. "/update-config") into this tag-wrapped
 * form before it's ever persisted as the user message's content — `<command-name>`
 * (already includes the leading "/"), a redundant `<command-message>` (the name minus
 * the slash), and `<command-args>` (empty when no args were given). Tag order and
 * surrounding whitespace differ across CLI versions — confirmed against two real stored
 * formats — so this is detected structurally (every known tag stripped out, confirm
 * nothing but whitespace remains) rather than one fixed-order regex. Without this, replay
 * dumps the raw wrapper into the bubble instead of the compact "/update-config" the
 * terminal and official extension both show. */
function parseSlashCommandMessage(text: string): string | undefined {
  const nameMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (!nameMatch) return undefined;
  const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const remainder = text
    .replace(/<command-message>[\s\S]*?<\/command-message>/, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/, "")
    .trim();
  if (remainder.length > 0) return undefined;
  const name = nameMatch[1].trim();
  const args = argsMatch?.[1].trim();
  return args ? `${name} ${args}` : name;
}

interface UserLikeMessage {
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        tool_use_id?: string;
        content?: unknown;
        is_error?: boolean;
        source?: { type?: string; media_type?: string; data?: string };
      }>;
}

/** Matches the exact wrapper `AgentSession.sendMessage()` uses for non-image
 * attachments (`` `Attached file: ${fileName}\n\`\`\`\n${textContent}\n\`\`\`` ``), so a
 * past session's stored text attachment renders as a clickable chip instead of a
 * giant fenced code block inline in the message text. */
const ATTACHED_TEXT_FILE = /^Attached file: (.+)\n```\n([\s\S]*)\n```$/;

/** The Anthropic API's image content block has no filename field — it's never sent to
 * the model in the first place, so a past session's stored transcript has no way to
 * recover the original one. A generic name (by extension) is all replay can show. */
const IMAGE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** `SessionMessage`'s public type has no `timestamp` field (and `message: unknown`),
 * but both are genuinely present at runtime — confirmed empirically, same
 * undocumented-but-real pattern as `rewindFiles`' `uuid` requirement elsewhere in this
 * repo. `messages` is expected to come from `getSessionMessages()` with its default
 * options (system messages excluded), so the last entry here is the last real
 * user/assistant activity, not `SessionStart:resume` hook bookkeeping. */
export function lastMessageTimestamp(messages: SessionMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const ts = (messages[i] as SessionMessage & { timestamp?: string }).timestamp;
    if (ts) {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return undefined;
}

/** Converts a session's stored transcript into the same item shape the live chat pipeline emits. */
export function buildReplayItems(messages: SessionMessage[]): ReplayItem[] {
  const items: ReplayItem[] = [];

  for (const entry of messages) {
    if (entry.type === "assistant") {
      const message = entry.message as AssistantLikeMessage;
      for (const block of message.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          items.push({ kind: "assistantText", text: block.text });
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          items.push({ kind: "thinking", text: block.thinking });
        } else if (block.type === "tool_use" && block.id && block.name) {
          items.push({
            kind: "toolUse",
            toolUseId: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
    } else if (entry.type === "user") {
      const message = entry.message as UserLikeMessage;
      if (typeof message.content === "string") {
        const text = message.content;
        if (text.trim().length > 0) {
          const slashCommand = parseSlashCommandMessage(text);
          items.push(
            slashCommand !== undefined
              ? { kind: "user", text: slashCommand, uuid: entry.uuid }
              : isSystemContextTag(text)
                ? { kind: "contextNote", text }
                : { kind: "user", text, uuid: entry.uuid }
          );
        }
        continue;
      }
      if (Array.isArray(message.content)) {
        // A real human send and a tool-result continuation never mix in one message
        // (the CLI never constructs one that way) — treat any tool_result here as
        // proof this whole entry is machinery, not something to render as a bubble.
        if (message.content.some((block) => block.type === "tool_result")) {
          for (const block of message.content) {
            if (block.type === "tool_result" && block.tool_use_id) {
              items.push({
                kind: "toolResult",
                toolUseId: block.tool_use_id,
                isError: Boolean(block.is_error),
                summary: summarizeToolResultContent(block.content),
              });
            }
          }
          continue;
        }

        // Otherwise: a genuine human send, potentially with attachments. Per
        // `AgentSession.sendMessage()`'s block order, attachments (image blocks, or
        // text blocks wrapped as `Attached file: ...`) always come first and the
        // person's own typed text is always the last block — combine them into one
        // item instead of one-bubble-per-block, matching the live chat's shape.
        const attachments: AttachmentSummary[] = [];
        let mainText: string | undefined;
        let contextNoteText: string | undefined;

        for (const block of message.content) {
          if (block.type === "image" && block.source?.data) {
            const mediaType = block.source.media_type ?? "image/png";
            const ext = IMAGE_EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "png";
            attachments.push({
              fileName: `image.${ext}`,
              kind: "image",
              mediaType,
              previewBase64: block.source.data,
            });
          } else if (block.type === "text" && typeof block.text === "string") {
            const attachedFile = block.text.match(ATTACHED_TEXT_FILE);
            if (attachedFile) {
              attachments.push({ fileName: attachedFile[1], kind: "text", previewText: attachedFile[2] });
            } else if (isSystemContextTag(block.text)) {
              contextNoteText = block.text;
            } else {
              mainText = block.text;
            }
          }
        }

        if (mainText !== undefined || attachments.length > 0) {
          items.push({ kind: "user", text: mainText ?? "", attachments, uuid: entry.uuid });
        } else if (contextNoteText !== undefined) {
          items.push({ kind: "contextNote", text: contextNoteText });
        }
      }
    }
  }

  return items;
}
