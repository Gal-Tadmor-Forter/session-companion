import type { TranscriptItem } from "../types";

/** Renders the same `TranscriptItem[]` the transcript view shows into a plain markdown
 * document — for the "Copy conversation" action. Tool calls collapse to a one-line
 * mention (their own output can be long/noisy and isn't reliably useful outside the
 * app's own collapsible cards); thinking blocks, IDE context notes, permission
 * prompts, and the turn-stats line are all omitted as non-conversational chrome. */
export function transcriptToMarkdown(items: TranscriptItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "user":
        parts.push(`**You:**\n\n${item.text}`);
        break;
      case "assistantText":
        if (item.text.trim().length > 0) {
          parts.push(item.text);
        }
        break;
      case "toolUse":
        parts.push(`_Ran ${item.label}_`);
        break;
      case "error":
        parts.push(`**Error:** ${item.message}`);
        break;
      case "thinking":
      case "contextNote":
      case "permission":
      case "turnStats":
        break;
    }
  }
  return parts.join("\n\n");
}
