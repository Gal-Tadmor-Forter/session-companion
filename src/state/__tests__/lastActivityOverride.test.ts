import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { LastActivityOverride } from "../lastActivityOverride";

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

describe("LastActivityOverride", () => {
  it("returns undefined for a session with no override", () => {
    const state = new LastActivityOverride(makeContext());
    expect(state.get("session-1")).toBeUndefined();
  });

  it("sets and reads back an override", async () => {
    const context = makeContext();
    const state = new LastActivityOverride(context);
    await state.set("session-1", 12345);
    expect(state.get("session-1")).toBe(12345);
  });

  it("tracks overrides independently per session", async () => {
    const context = makeContext({ sessionLastActivityOverride: { "session-1": 100 } });
    const state = new LastActivityOverride(context);
    await state.set("session-2", 200);
    expect(state.get("session-1")).toBe(100);
    expect(state.get("session-2")).toBe(200);
  });

  it("clears an override, leaving others untouched", async () => {
    const context = makeContext({
      sessionLastActivityOverride: { "session-1": 100, "session-2": 200 },
    });
    const state = new LastActivityOverride(context);
    await state.clear("session-1");
    expect(state.get("session-1")).toBeUndefined();
    expect(state.get("session-2")).toBe(200);
  });

  it("clearing a session with no override is a no-op (no write)", async () => {
    const context = makeContext();
    const state = new LastActivityOverride(context);
    await state.clear("session-1");
    expect(context.globalState.update).not.toHaveBeenCalled();
  });
});
