import { describe, expect, it } from "vitest";
import type { ReplayItem } from "../../../../shared/protocol";
import { buildTranscriptFromReplay } from "../replay";

function makeIdFactory() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("buildTranscriptFromReplay", () => {
  it("converts a user replay item", () => {
    const replay: ReplayItem[] = [{ kind: "user", text: "hello", uuid: "u1" }];
    const items = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(items).toEqual([{ id: "id-1", kind: "user", text: "hello", attachments: [], uuid: "u1" }]);
  });

  it("converts an assistantText replay item as already-finished streaming", () => {
    const replay: ReplayItem[] = [{ kind: "assistantText", text: "hi there" }];
    const [item] = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(item).toMatchObject({ kind: "assistantText", text: "hi there", streaming: false });
  });

  it("converts a thinking replay item as already-finished streaming", () => {
    const replay: ReplayItem[] = [{ kind: "thinking", text: "Let me think..." }];
    const [item] = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(item).toMatchObject({ kind: "thinking", text: "Let me think...", streaming: false });
  });

  it("converts a contextNote replay item", () => {
    const replay: ReplayItem[] = [{ kind: "contextNote", text: "<ide_opened_file>foo</ide_opened_file>" }];
    const items = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(items).toEqual([
      { id: "id-1", kind: "contextNote", text: "<ide_opened_file>foo</ide_opened_file>" },
    ]);
  });

  it("converts a toolUse replay item using the shared label describer, carrying the raw input along", () => {
    const replay: ReplayItem[] = [
      { kind: "toolUse", toolUseId: "t1", name: "Bash", input: { command: "ls" } },
    ];
    const [item] = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(item).toMatchObject({
      kind: "toolUse",
      toolUseId: "t1",
      label: "Executed `ls`",
      input: { command: "ls" },
    });
  });

  it("carries attachments through on a user replay item", () => {
    const replay: ReplayItem[] = [
      {
        kind: "user",
        text: "what is this?",
        uuid: "u1",
        attachments: [{ fileName: "image.png", kind: "image", mediaType: "image/png", previewBase64: "AAAA" }],
      },
    ];
    const [item] = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(item).toMatchObject({
      kind: "user",
      attachments: [{ fileName: "image.png", kind: "image", mediaType: "image/png", previewBase64: "AAAA" }],
    });
  });

  it("attaches a matching toolResult onto its preceding toolUse item", () => {
    const replay: ReplayItem[] = [
      { kind: "toolUse", toolUseId: "t1", name: "Bash", input: { command: "ls" } },
      { kind: "toolResult", toolUseId: "t1", isError: false, summary: "file.ts" },
    ];
    const items = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "toolUse",
      toolUseId: "t1",
      result: { summary: "file.ts", isError: false },
    });
  });

  it("silently drops a toolResult with no matching toolUse", () => {
    const replay: ReplayItem[] = [{ kind: "toolResult", toolUseId: "missing", isError: true, summary: "x" }];
    expect(buildTranscriptFromReplay(replay, makeIdFactory())).toEqual([]);
  });

  it("preserves order across a mixed transcript", () => {
    const replay: ReplayItem[] = [
      { kind: "user", text: "do it", uuid: "u1" },
      { kind: "toolUse", toolUseId: "t1", name: "Read", input: { file_path: "a.ts" } },
      { kind: "toolResult", toolUseId: "t1", isError: false, summary: "contents" },
      { kind: "assistantText", text: "done" },
    ];
    const items = buildTranscriptFromReplay(replay, makeIdFactory());
    expect(items.map((i) => i.kind)).toEqual(["user", "toolUse", "assistantText"]);
  });
});
