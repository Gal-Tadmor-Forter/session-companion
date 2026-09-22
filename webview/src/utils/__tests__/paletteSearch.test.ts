import { describe, expect, it } from "vitest";
import { matchesName, matchesNameOrDescription } from "../paletteSearch";

describe("matchesNameOrDescription", () => {
  const command = { name: "forter-apps:forter-apps", description: "Manage Forter internal apps" };

  it("matches on a substring of the name, case-insensitively", () => {
    expect(matchesNameOrDescription(command, "Forter")).toBe(true);
    expect(matchesNameOrDescription(command, "APPS")).toBe(true);
  });

  it("matches on a substring of the description", () => {
    expect(matchesNameOrDescription(command, "internal")).toBe(true);
  });

  it("returns false when neither name nor description contains the query", () => {
    expect(matchesNameOrDescription(command, "portal-ops")).toBe(false);
  });

  it("returns false for a blank/whitespace-only query — never matches everything by default", () => {
    expect(matchesNameOrDescription(command, "")).toBe(false);
    expect(matchesNameOrDescription(command, "   ")).toBe(false);
  });

  it("trims surrounding whitespace on the query", () => {
    expect(matchesNameOrDescription(command, "  forter  ")).toBe(true);
  });
});

describe("matchesName", () => {
  const server = { name: "claude.ai Forter MCP - v1" };

  it("matches on a case-insensitive substring of the name", () => {
    expect(matchesName(server, "forter")).toBe(true);
    expect(matchesName(server, "FORTER")).toBe(true);
  });

  it("returns false when the name doesn't contain the query", () => {
    expect(matchesName(server, "gitnexus")).toBe(false);
  });

  it("returns false for a blank query", () => {
    expect(matchesName(server, "")).toBe(false);
  });
});
