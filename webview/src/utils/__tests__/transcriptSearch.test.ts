import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../types";
import { findMatchingItemIds } from "../transcriptSearch";

function user(id: string, text: string): TranscriptItem {
  return { id, kind: "user", text, attachments: [], uuid: id };
}

function assistantText(id: string, text: string): TranscriptItem {
  return { id, kind: "assistantText", blockId: id, text, streaming: false };
}

describe("findMatchingItemIds", () => {
  it("returns nothing for a blank query", () => {
    expect(findMatchingItemIds([user("u1", "hello world")], "   ")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(findMatchingItemIds([user("u1", "Hello World")], "world")).toEqual(["u1"]);
  });

  it("matches across user and assistant text, in transcript order", () => {
    const items = [user("u1", "fix the bug"), assistantText("a1", "found the bug in auth.ts")];
    expect(findMatchingItemIds(items, "bug")).toEqual(["u1", "a1"]);
  });

  it("matches a tool call's formatted label", () => {
    const item: TranscriptItem = { id: "t1", kind: "toolUse", toolUseId: "x", name: "Read", label: "Read auth.ts", input: {} };
    expect(findMatchingItemIds([item], "auth.ts")).toEqual(["t1"]);
  });

  it("matches an error message", () => {
    const item: TranscriptItem = { id: "e1", kind: "error", message: "rate limited" };
    expect(findMatchingItemIds([item], "rate")).toEqual(["e1"]);
  });

  it("never matches thinking, context notes, permission prompts, or turn-stats", () => {
    const items: TranscriptItem[] = [
      { id: "th1", kind: "thinking", blockId: "b", text: "bug bug bug", streaming: false },
      { id: "cn1", kind: "contextNote", text: "bug context" },
      { id: "p1", kind: "permission", requestId: "r", toolName: "Bash", label: "bug command", input: {} },
      { id: "ts1", kind: "turnStats", durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0 },
    ];
    expect(findMatchingItemIds(items, "bug")).toEqual([]);
  });

  it("skips items with no match", () => {
    expect(findMatchingItemIds([user("u1", "hello")], "goodbye")).toEqual([]);
  });
});
