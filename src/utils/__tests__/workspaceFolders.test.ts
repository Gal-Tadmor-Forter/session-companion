import { describe, expect, it } from "vitest";
import { isOpenWorkspaceFolder } from "../workspaceFolders";

describe("isOpenWorkspaceFolder", () => {
  it("returns true when the target cwd is the only open folder", () => {
    expect(isOpenWorkspaceFolder("/repo/platform-hub", ["/repo/platform-hub"])).toBe(true);
  });

  it("returns true when the target cwd is a later folder in a multi-root workspace", () => {
    expect(
      isOpenWorkspaceFolder("/repo/other-app", ["/repo/platform-hub", "/repo/other-app", "/repo/portal"])
    ).toBe(true);
  });

  it("returns false when the target cwd isn't open in this window at all", () => {
    expect(isOpenWorkspaceFolder("/repo/not-open", ["/repo/platform-hub", "/repo/other-app"])).toBe(false);
  });

  it("returns false for an empty workspace (no folders open)", () => {
    expect(isOpenWorkspaceFolder("/repo/platform-hub", [])).toBe(false);
  });

  it("does not treat a nested subdirectory as a match — exact path only", () => {
    expect(isOpenWorkspaceFolder("/repo/platform-hub/apps/portal-ops", ["/repo/platform-hub"])).toBe(false);
  });
});
