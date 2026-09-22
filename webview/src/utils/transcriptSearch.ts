import type { TranscriptItem } from "../types";

function textOf(item: TranscriptItem): string | undefined {
  switch (item.kind) {
    case "user":
    case "assistantText":
      return item.text;
    case "toolUse":
      return item.label;
    case "error":
      return item.message;
    case "thinking":
    case "contextNote":
    case "permission":
    case "turnStats":
      return undefined;
  }
}

/** Returns the ids of every item whose visible text contains `query`
 * (case-insensitive), in transcript order — the data behind in-chat "find in
 * conversation." Thinking blocks, IDE context notes, permission prompts, and the
 * turn-stats line are excluded (same non-conversational chrome `transcriptToMarkdown`
 * skips), since searching them would surface matches with nothing findable on screen
 * to jump to. */
export function findMatchingItemIds(items: TranscriptItem[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ids: string[] = [];
  for (const item of items) {
    const text = textOf(item);
    if (text && text.toLowerCase().includes(q)) {
      ids.push(item.id);
    }
  }
  return ids;
}
