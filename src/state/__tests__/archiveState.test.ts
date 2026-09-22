import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { ArchiveState } from "../archiveState";

function makeContext(initial: Record<string, unknown> = {}): vscode.ExtensionContext {
  const store = { ...initial };
  return {
    globalState: {
      get: vi.fn((key: string, defaultValue: unknown) => store[key] ?? defaultValue),
      update: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
    },
  } as unknown as vscode.ExtensionContext;
}

describe("ArchiveState", () => {
  it("reports nothing archived by default", () => {
    const state = new ArchiveState(makeContext());
    expect(state.isArchived("session-1")).toBe(false);
  });

  it("marks a session archived and persists it", async () => {
    const context = makeContext();
    const state = new ArchiveState(context);
    await state.setArchived("session-1", true);
    expect(state.isArchived("session-1")).toBe(true);
    expect(context.globalState.update).toHaveBeenCalledWith("archivedSessionIds", ["session-1"]);
  });

  it("unarchives a session", async () => {
    const context = makeContext({ archivedSessionIds: ["session-1", "session-2"] });
    const state = new ArchiveState(context);
    await state.setArchived("session-1", false);
    expect(state.isArchived("session-1")).toBe(false);
    expect(state.isArchived("session-2")).toBe(true);
  });

  it("does not duplicate an already-archived session", async () => {
    const context = makeContext({ archivedSessionIds: ["session-1"] });
    const state = new ArchiveState(context);
    await state.setArchived("session-1", true);
    expect(context.globalState.update).toHaveBeenCalledWith("archivedSessionIds", ["session-1"]);
  });
});
