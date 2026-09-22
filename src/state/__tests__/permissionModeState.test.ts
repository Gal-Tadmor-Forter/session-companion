import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { PermissionModeState } from "../permissionModeState";

function makeContext(initial: Record<string, unknown> = {}): vscode.ExtensionContext {
  const store = { ...initial };
  return {
    globalState: {
      get: vi.fn((key: string, defaultValue?: unknown) => store[key] ?? defaultValue),
      update: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
    },
  } as unknown as vscode.ExtensionContext;
}

describe("PermissionModeState", () => {
  it("returns undefined when nothing was ever picked", () => {
    const state = new PermissionModeState(makeContext());
    expect(state.get()).toBeUndefined();
  });

  it("sets and reads back the last-picked mode", async () => {
    const context = makeContext();
    const state = new PermissionModeState(context);
    await state.set("auto");
    expect(state.get()).toBe("auto");
  });

  it("overwrites a previously remembered mode with the latest pick", async () => {
    const context = makeContext({ lastPermissionMode: "acceptEdits" });
    const state = new PermissionModeState(context);
    expect(state.get()).toBe("acceptEdits");
    await state.set("bypassPermissions");
    expect(state.get()).toBe("bypassPermissions");
  });
});
