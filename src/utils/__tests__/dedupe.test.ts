import { describe, expect, it } from "vitest";
import { dedupeByName } from "../dedupe";

describe("dedupeByName", () => {
  it("keeps the first occurrence and drops later ones with the same name", () => {
    const first = { name: "security-review", description: "first" };
    const second = { name: "security-review", description: "second" };
    expect(dedupeByName([first, second])).toEqual([first]);
  });

  it("leaves already-unique entries untouched", () => {
    const entries = [
      { name: "a", description: "" },
      { name: "b", description: "" },
    ];
    expect(dedupeByName(entries)).toEqual(entries);
  });

  it("handles repeated duplicates across a longer list", () => {
    const entries = Array.from({ length: 8 }, () => ({ name: "security-review", description: "" }));
    expect(dedupeByName(entries)).toHaveLength(1);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeByName([])).toEqual([]);
  });
});
