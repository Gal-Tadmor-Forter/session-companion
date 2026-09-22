import { describe, expect, it } from "vitest";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildReplayItems, lastMessageTimestamp } from "../sessionHistory";

function assistantMessage(content: unknown): SessionMessage {
  return { type: "assistant", message: { content } } as unknown as SessionMessage;
}

function userMessage(content: unknown): SessionMessage {
  return { type: "user", message: { content } } as unknown as SessionMessage;
}

function withTimestamp(message: SessionMessage, timestamp: string | undefined): SessionMessage {
  return { ...message, timestamp } as unknown as SessionMessage;
}

describe("buildReplayItems", () => {
  it("converts assistant text blocks", () => {
    const items = buildReplayItems([assistantMessage([{ type: "text", text: "hello" }])]);
    expect(items).toEqual([{ kind: "assistantText", text: "hello" }]);
  });

  it("converts assistant tool_use blocks", () => {
    const items = buildReplayItems([
      assistantMessage([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }]),
    ]);
    expect(items).toEqual([
      { kind: "toolUse", toolUseId: "t1", name: "Read", input: { file_path: "a.ts" } },
    ]);
  });

  it("defaults tool_use input to an empty object when missing", () => {
    const items = buildReplayItems([assistantMessage([{ type: "tool_use", id: "t1", name: "Read" }])]);
    expect(items).toEqual([{ kind: "toolUse", toolUseId: "t1", name: "Read", input: {} }]);
  });

  it("converts a plain-string user message", () => {
    const items = buildReplayItems([userMessage("What's next?")]);
    expect(items).toEqual([{ kind: "user", text: "What's next?" }]);
  });

  it("skips a blank plain-string user message", () => {
    expect(buildReplayItems([userMessage("   ")])).toEqual([]);
  });

  it("collapses an older-format slash-command message down to just the command", () => {
    const text = "<command-message>update-config</command-message>\n<command-name>/update-config</command-name>";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text: "/update-config" }]);
  });

  it("collapses a newer-format slash-command message (different tag order, empty args)", () => {
    const text =
      "<command-name>/reload-plugins</command-name>\n            <command-message>reload-plugins</command-message>\n            <command-args></command-args>";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text: "/reload-plugins" }]);
  });

  it("keeps non-empty command-args appended to the compact command", () => {
    const text = "<command-name>/model</command-name><command-args>sonnet</command-args>";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text: "/model sonnet" }]);
  });

  it("does not collapse ordinary text that merely mentions a command-name-like tag mid-sentence", () => {
    const text = "Can you explain what <command-name> means in the transcript format?";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text }]);
  });

  it("does not collapse a real command-name tag embedded in surrounding prose", () => {
    const text = "The <command-name>/foo</command-name> tag looks weird here.";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text }]);
  });

  it("converts user text blocks (array content)", () => {
    const items = buildReplayItems([userMessage([{ type: "text", text: "hi" }])]);
    expect(items).toEqual([{ kind: "user", text: "hi", attachments: [] }]);
  });

  it("reconstructs an image attachment with no recoverable file name", () => {
    const items = buildReplayItems([
      userMessage([
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "text", text: "what is this?" },
      ]),
    ]);
    expect(items).toEqual([
      {
        kind: "user",
        text: "what is this?",
        attachments: [{ fileName: "image.png", kind: "image", mediaType: "image/png", previewBase64: "AAAA" }],
      },
    ]);
  });

  it("reconstructs a text attachment from the Attached-file wrapper, stripping it from the message", () => {
    const items = buildReplayItems([
      userMessage([
        { type: "text", text: "Attached file: notes.txt\n```\nhello world\n```" },
        { type: "text", text: "what does this say?" },
      ]),
    ]);
    expect(items).toEqual([
      {
        kind: "user",
        text: "what does this say?",
        attachments: [{ fileName: "notes.txt", kind: "text", previewText: "hello world" }],
      },
    ]);
  });

  it("does not treat a tool_result message as also having attachments", () => {
    const items = buildReplayItems([
      userMessage([{ type: "tool_result", tool_use_id: "t1", content: "done", is_error: false }]),
    ]);
    expect(items).toEqual([{ kind: "toolResult", toolUseId: "t1", isError: false, summary: "done" }]);
  });

  it("converts assistant thinking blocks", () => {
    const items = buildReplayItems([assistantMessage([{ type: "thinking", thinking: "Let me check..." }])]);
    expect(items).toEqual([{ kind: "thinking", text: "Let me check..." }]);
  });

  it("treats a plain-string user message wrapped in a tag as a context note, not a chat bubble", () => {
    const text = "<ide_opened_file>The user opened filters.ts in the IDE.</ide_opened_file>";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "contextNote", text }]);
  });

  it("treats a user text block wrapped in a tag as a context note", () => {
    const text = "<ide_selection>Selected lines 1-10</ide_selection>";
    const items = buildReplayItems([userMessage([{ type: "text", text }])]);
    expect(items).toEqual([{ kind: "contextNote", text }]);
  });

  it("does not treat ordinary user text that merely contains angle brackets as a context note", () => {
    const text = "Can you fix the <Button> component?";
    expect(buildReplayItems([userMessage(text)])).toEqual([{ kind: "user", text }]);
  });

  it("converts a user tool_result block with string content", () => {
    const items = buildReplayItems([
      userMessage([{ type: "tool_result", tool_use_id: "t1", content: "done", is_error: false }]),
    ]);
    expect(items).toEqual([{ kind: "toolResult", toolUseId: "t1", isError: false, summary: "done" }]);
  });

  it("converts a user tool_result block with array content, joining text blocks", () => {
    const items = buildReplayItems([
      userMessage([
        {
          type: "tool_result",
          tool_use_id: "t1",
          is_error: true,
          content: [{ text: "line one" }, { text: "line two" }],
        },
      ]),
    ]);
    expect(items).toEqual([
      { kind: "toolResult", toolUseId: "t1", isError: true, summary: "line one\nline two" },
    ]);
  });

  it("summarizes unrecognized tool_result content as an empty string", () => {
    const items = buildReplayItems([
      userMessage([{ type: "tool_result", tool_use_id: "t1", content: 42, is_error: false }]),
    ]);
    expect(items).toEqual([{ kind: "toolResult", toolUseId: "t1", isError: false, summary: "" }]);
  });

  it("processes a realistic multi-message transcript in order", () => {
    const items = buildReplayItems([
      userMessage("Fix the bug"),
      assistantMessage([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      userMessage([{ type: "tool_result", tool_use_id: "t1", content: "file.ts", is_error: false }]),
      assistantMessage([{ type: "text", text: "Fixed it." }]),
    ]);
    expect(items).toEqual([
      { kind: "user", text: "Fix the bug" },
      { kind: "toolUse", toolUseId: "t1", name: "Bash", input: { command: "ls" } },
      { kind: "toolResult", toolUseId: "t1", isError: false, summary: "file.ts" },
      { kind: "assistantText", text: "Fixed it." },
    ]);
  });
});

describe("lastMessageTimestamp", () => {
  it("returns undefined for an empty list", () => {
    expect(lastMessageTimestamp([])).toBeUndefined();
  });

  it("returns the last message's timestamp in ms", () => {
    const messages = [
      withTimestamp(userMessage("hi"), "2026-09-18T06:46:00.000Z"),
      withTimestamp(assistantMessage([{ type: "text", text: "hello" }]), "2026-09-18T06:46:05.000Z"),
    ];
    expect(lastMessageTimestamp(messages)).toBe(new Date("2026-09-18T06:46:05.000Z").getTime());
  });

  it("walks backward past a trailing message with no timestamp", () => {
    const messages = [
      withTimestamp(userMessage("hi"), "2026-09-18T06:46:00.000Z"),
      withTimestamp(assistantMessage([{ type: "text", text: "hello" }]), undefined),
    ];
    expect(lastMessageTimestamp(messages)).toBe(new Date("2026-09-18T06:46:00.000Z").getTime());
  });

  it("returns undefined when no message has a valid timestamp", () => {
    const messages = [withTimestamp(userMessage("hi"), undefined), withTimestamp(userMessage("bye"), "not-a-date")];
    expect(lastMessageTimestamp(messages)).toBeUndefined();
  });
});
