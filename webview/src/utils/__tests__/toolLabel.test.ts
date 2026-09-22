import { describe, expect, it } from "vitest";
import { describeToolUse, formatToolInputEntries } from "../toolLabel";

describe("describeToolUse", () => {
  it("describes a Read with offset and limit", () => {
    expect(describeToolUse("Read", { file_path: "a.ts", offset: 10, limit: 20 })).toBe(
      "Read a.ts, lines 10 to 30"
    );
  });

  it("describes a plain Read", () => {
    expect(describeToolUse("Read", { file_path: "a.ts" })).toBe("Read a.ts");
  });

  it("describes a Read with no file path at all", () => {
    expect(describeToolUse("Read", {})).toBe("Read file");
  });

  it("describes Edit and Write with and without a file path", () => {
    expect(describeToolUse("Edit", { file_path: "a.ts" })).toBe("Edited a.ts");
    expect(describeToolUse("Edit", {})).toBe("Edited file");
    expect(describeToolUse("Write", { file_path: "a.ts" })).toBe("Created a.ts");
    expect(describeToolUse("Write", {})).toBe("Created file");
  });

  it("describes Bash with and without a command", () => {
    expect(describeToolUse("Bash", { command: "ls -la" })).toBe("Executed `ls -la`");
    expect(describeToolUse("Bash", {})).toBe("Executed command");
  });

  it("describes Grep and Glob with and without a pattern", () => {
    expect(describeToolUse("Grep", { pattern: "TODO" })).toBe('Searched for "TODO"');
    expect(describeToolUse("Grep", {})).toBe("Searched");
    expect(describeToolUse("Glob", { pattern: "*.ts" })).toBe('Listed files matching "*.ts"');
    expect(describeToolUse("Glob", {})).toBe("Listed files");
  });

  it("falls back to a generic label for unknown tools", () => {
    expect(describeToolUse("SomeMcpTool", { anything: true })).toBe("Used SomeMcpTool");
  });
});

describe("formatToolInputEntries", () => {
  it("returns an empty array for an empty input", () => {
    expect(formatToolInputEntries({})).toEqual([]);
  });

  it("passes string values through unchanged", () => {
    expect(formatToolInputEntries({ query: "select:Foo" })).toEqual([["query", "select:Foo"]]);
  });

  it("JSON-stringifies non-string values", () => {
    expect(formatToolInputEntries({ max_results: 5, recursive: true })).toEqual([
      ["max_results", "5"],
      ["recursive", "true"],
    ]);
  });

  it("pretty-prints nested objects/arrays", () => {
    const [[, value]] = formatToolInputEntries({ filters: { status: "open", tags: ["a", "b"] } });
    expect(value).toBe(JSON.stringify({ status: "open", tags: ["a", "b"] }, null, 2));
  });

  it("preserves input key order", () => {
    const entries = formatToolInputEntries({ b: "1", a: "2", c: "3" });
    expect(entries.map(([key]) => key)).toEqual(["b", "a", "c"]);
  });
});
