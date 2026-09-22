import type { TranscriptItem } from "../types";

export interface FileChangeEntry {
  toolUseId: string;
  kind: "edit" | "write";
  oldText: string;
  newText: string;
}

export interface FileChangeGroup {
  filePath: string;
  changes: FileChangeEntry[];
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

/** Aggregates every Edit/Write tool call in a transcript into a per-file list of
 * changes, in chronological order — the data behind the "Files changed" dialog. There's
 * no SDK-provided diff/code-review summary for this (checked `sdk.d.ts` — nothing), so
 * it's built entirely from tool_use inputs already flowing through the transcript.
 * Scoped to top-level tool calls only: a subagent's own Edit/Write calls are forwarded
 * as flat lines under its Task card (`subagentSteps`), not as their own `toolUse`
 * items, so they aren't picked up here. */
export function extractFileChanges(items: TranscriptItem[]): FileChangeGroup[] {
  const byFile = new Map<string, FileChangeEntry[]>();
  for (const item of items) {
    if (item.kind !== "toolUse") continue;
    if (item.name !== "Edit" && item.name !== "Write") continue;
    const filePath = stringField(item.input, "file_path");
    if (!filePath) continue;
    const entry: FileChangeEntry =
      item.name === "Edit"
        ? {
            toolUseId: item.toolUseId,
            kind: "edit",
            oldText: stringField(item.input, "old_string"),
            newText: stringField(item.input, "new_string"),
          }
        : {
            toolUseId: item.toolUseId,
            kind: "write",
            oldText: "",
            newText: stringField(item.input, "content"),
          };
    const list = byFile.get(filePath) ?? [];
    list.push(entry);
    byFile.set(filePath, list);
  }
  return Array.from(byFile.entries()).map(([filePath, changes]) => ({ filePath, changes }));
}
