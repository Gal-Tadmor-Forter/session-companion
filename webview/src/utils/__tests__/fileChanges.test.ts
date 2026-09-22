import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../types";
import { extractFileChanges } from "../fileChanges";

function toolUse(name: string, input: Record<string, unknown>, toolUseId = "t1"): TranscriptItem {
  return { id: toolUseId, kind: "toolUse", toolUseId, name, label: name, input };
}

describe("extractFileChanges", () => {
  it("returns nothing for a transcript with no Edit/Write calls", () => {
    expect(extractFileChanges([toolUse("Read", { file_path: "a.ts" })])).toEqual([]);
  });

  it("extracts an Edit call's old/new strings", () => {
    const items = [toolUse("Edit", { file_path: "a.ts", old_string: "foo", new_string: "bar" })];
    expect(extractFileChanges(items)).toEqual([
      { filePath: "a.ts", changes: [{ toolUseId: "t1", kind: "edit", oldText: "foo", newText: "bar" }] },
    ]);
  });

  it("extracts a Write call's content with an empty oldText", () => {
    const items = [toolUse("Write", { file_path: "a.ts", content: "whole file" })];
    expect(extractFileChanges(items)).toEqual([
      { filePath: "a.ts", changes: [{ toolUseId: "t1", kind: "write", oldText: "", newText: "whole file" }] },
    ]);
  });

  it("groups multiple changes to the same file together, in order", () => {
    const items = [
      toolUse("Edit", { file_path: "a.ts", old_string: "1", new_string: "2" }, "t1"),
      toolUse("Edit", { file_path: "a.ts", old_string: "2", new_string: "3" }, "t2"),
    ];
    const groups = extractFileChanges(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].changes.map((c) => c.toolUseId)).toEqual(["t1", "t2"]);
  });

  it("keeps changes to different files in separate groups", () => {
    const items = [
      toolUse("Edit", { file_path: "a.ts", old_string: "1", new_string: "2" }, "t1"),
      toolUse("Edit", { file_path: "b.ts", old_string: "3", new_string: "4" }, "t2"),
    ];
    expect(extractFileChanges(items).map((g) => g.filePath)).toEqual(["a.ts", "b.ts"]);
  });

  it("skips a tool call missing a usable file_path", () => {
    expect(extractFileChanges([toolUse("Edit", { old_string: "1", new_string: "2" })])).toEqual([]);
  });

  it("ignores non-tool-use items", () => {
    const items: TranscriptItem[] = [{ id: "u1", kind: "user", text: "hi", attachments: [], uuid: "u" }];
    expect(extractFileChanges(items)).toEqual([]);
  });
});
