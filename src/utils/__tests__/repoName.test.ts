import { describe, expect, it } from "vitest";
import { repoNameFromCwd } from "../repoName";

describe("repoNameFromCwd", () => {
  it("returns the last path segment", () => {
    expect(repoNameFromCwd("/Users/gal/dev/better-claude-code")).toBe("better-claude-code");
  });

  it("strips trailing slashes before taking the last segment", () => {
    expect(repoNameFromCwd("/Users/gal/dev/better-claude-code/")).toBe("better-claude-code");
    expect(repoNameFromCwd("/Users/gal/dev/better-claude-code///")).toBe("better-claude-code");
  });

  it("falls back to the original string when there is no segment", () => {
    expect(repoNameFromCwd("/")).toBe("/");
    expect(repoNameFromCwd("")).toBe("");
  });

  it("handles a bare repo name with no slashes", () => {
    expect(repoNameFromCwd("better-claude-code")).toBe("better-claude-code");
  });
});
