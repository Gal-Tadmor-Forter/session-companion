import { describe, expect, it } from "vitest";
import { isPathExcluded } from "../excludedFolders";

describe("isPathExcluded", () => {
  it("excludes an exact match", () => {
    expect(isPathExcluded("/tmp", ["/tmp"])).toBe(true);
  });

  it("excludes a nested path", () => {
    expect(isPathExcluded("/tmp/foo/bar", ["/tmp"])).toBe(true);
  });

  it("does not exclude a sibling path that merely shares a prefix", () => {
    expect(isPathExcluded("/tmpfoo", ["/tmp"])).toBe(false);
  });

  it("does not exclude when no folder matches", () => {
    expect(isPathExcluded("/Users/gal/dev/repo", ["/tmp"])).toBe(false);
  });

  it("tolerates a trailing separator on the configured folder", () => {
    expect(isPathExcluded("/tmp/foo", ["/tmp/"])).toBe(true);
  });

  it("checks every configured folder", () => {
    expect(isPathExcluded("/private/var/scratch", ["/tmp", "/private/var"])).toBe(true);
  });

  it("returns false for an empty exclusion list", () => {
    expect(isPathExcluded("/tmp", [])).toBe(false);
  });
});
