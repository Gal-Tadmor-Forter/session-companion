import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../types";
import { transcriptToMarkdown } from "../exportTranscript";

function user(text: string): TranscriptItem {
  return { id: "u1", kind: "user", text, attachments: [], uuid: "uuid-1" };
}

function assistantText(text: string, streaming = false): TranscriptItem {
  return { id: "a1", kind: "assistantText", blockId: "0-0", text, streaming };
}

describe("transcriptToMarkdown", () => {
  it("renders a user message with a bolded speaker label", () => {
    expect(transcriptToMarkdown([user("hello")])).toBe("**You:**\n\nhello");
  });

  it("renders assistant text as-is, with no speaker label", () => {
    expect(transcriptToMarkdown([assistantText("hi there")])).toBe("hi there");
  });

  it("skips a blank assistant text block (e.g. a still-streaming placeholder)", () => {
    expect(transcriptToMarkdown([assistantText("   ")])).toBe("");
  });

  it("collapses a tool call to a one-line mention", () => {
    const item: TranscriptItem = {
      id: "t1",
      kind: "toolUse",
      toolUseId: "x",
      name: "Read",
      label: "Read package.json",
      input: {},
    };
    expect(transcriptToMarkdown([item])).toBe("_Ran Read package.json_");
  });

  it("renders an error item", () => {
    const item: TranscriptItem = { id: "e1", kind: "error", message: "Something broke" };
    expect(transcriptToMarkdown([item])).toBe("**Error:** Something broke");
  });

  it("omits thinking, context notes, permission prompts, and turn-stats lines entirely", () => {
    const items: TranscriptItem[] = [
      { id: "th1", kind: "thinking", blockId: "0-1", text: "pondering", streaming: false },
      { id: "cn1", kind: "contextNote", text: "<ide_opened_file>x</ide_opened_file>" },
      { id: "p1", kind: "permission", requestId: "r1", toolName: "Bash", label: "Run ls" },
      { id: "ts1", kind: "turnStats", durationMs: 100, costUsd: 0.01, inputTokens: 1, outputTokens: 1 },
    ];
    expect(transcriptToMarkdown(items)).toBe("");
  });

  it("joins multiple items with a blank line between each", () => {
    const items = [user("hi"), assistantText("hello back")];
    expect(transcriptToMarkdown(items)).toBe("**You:**\n\nhi\n\nhello back");
  });
});
