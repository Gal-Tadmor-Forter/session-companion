import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { ReadState } from "../readState";

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

describe("ReadState", () => {
  it("returns 0 for a session that was never viewed", () => {
    const state = new ReadState(makeContext());
    expect(state.getLastViewedAt("session-1")).toBe(0);
  });

  it("records the current time as last-viewed", async () => {
    const context = makeContext();
    const state = new ReadState(context);
    const before = Date.now();
    await state.markViewed("session-1");
    const after = Date.now();
    const viewedAt = state.getLastViewedAt("session-1");
    expect(viewedAt).toBeGreaterThanOrEqual(before);
    expect(viewedAt).toBeLessThanOrEqual(after);
  });

  it("tracks last-viewed independently per session", async () => {
    const context = makeContext({ sessionLastViewedAt: { "session-1": 100 } });
    const state = new ReadState(context);
    await state.markViewed("session-2");
    expect(state.getLastViewedAt("session-1")).toBe(100);
    expect(state.getLastViewedAt("session-2")).toBeGreaterThan(100);
  });
});
