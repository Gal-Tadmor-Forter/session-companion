import type { ReplayItem } from "../../../shared/protocol";
import { describeToolUse } from "./toolLabel";
import type { TranscriptItem } from "../types";

export function buildTranscriptFromReplay(replay: ReplayItem[], makeId: () => string): TranscriptItem[] {
  const items: TranscriptItem[] = [];

  for (const entry of replay) {
    switch (entry.kind) {
      case "user":
        items.push({
          id: makeId(),
          kind: "user",
          text: entry.text,
          attachments: entry.attachments ?? [],
          uuid: entry.uuid,
        });
        break;
      case "assistantText":
        items.push({ id: makeId(), kind: "assistantText", blockId: makeId(), text: entry.text, streaming: false });
        break;
      case "thinking":
        items.push({ id: makeId(), kind: "thinking", blockId: makeId(), text: entry.text, streaming: false });
        break;
      case "contextNote":
        items.push({ id: makeId(), kind: "contextNote", text: entry.text });
        break;
      case "toolUse":
        items.push({
          id: makeId(),
          kind: "toolUse",
          toolUseId: entry.toolUseId,
          name: entry.name,
          label: describeToolUse(entry.name, entry.input),
          input: entry.input,
        });
        break;
      case "toolResult": {
        const index = items.findIndex(
          (item) => item.kind === "toolUse" && item.toolUseId === entry.toolUseId
        );
        if (index !== -1) {
          const toolItem = items[index];
          if (toolItem.kind === "toolUse") {
            items[index] = {
              ...toolItem,
              result: { summary: entry.summary, isError: entry.isError },
            };
          }
        }
        break;
      }
    }
  }

  return items;
}
