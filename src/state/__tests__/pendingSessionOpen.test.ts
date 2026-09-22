import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { PendingSessionOpenState } from "../pendingSessionOpen";

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

describe("PendingSessionOpenState", () => {
  it("returns undefined when nothing is pending", () => {
    const state = new PendingSessionOpenState(makeContext());
    expect(state.get()).toBeUndefined();
  });

  it("stores and returns a pending session", async () => {
    const context = makeContext();
    const state = new PendingSessionOpenState(context);
    await state.set({ cwd: "/repo", sessionId: "s1", title: "Fix bug" });
    expect(state.get()).toEqual({ cwd: "/repo", sessionId: "s1", title: "Fix bug" });
  });

  it("overwrites a previously pending session with a new one", async () => {
    const context = makeContext();
    const state = new PendingSessionOpenState(context);
    await state.set({ cwd: "/repo-a", sessionId: "s1", title: "First" });
    await state.set({ cwd: "/repo-b", sessionId: "s2", title: "Second" });
    expect(state.get()).toEqual({ cwd: "/repo-b", sessionId: "s2", title: "Second" });
  });

  it("clears the pending session", async () => {
    const context = makeContext();
    const state = new PendingSessionOpenState(context);
    await state.set({ cwd: "/repo", sessionId: "s1", title: "Fix bug" });
    await state.clear();
    expect(state.get()).toBeUndefined();
  });
});
