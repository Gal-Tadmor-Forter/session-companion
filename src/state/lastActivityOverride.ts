import * as vscode from "vscode";

const STORAGE_KEY = "sessionLastActivityOverride";

/** Resuming a session to pre-warm the context gauge (`AgentSession.warmStart()`) makes
 * the CLI append its own `SessionStart:resume` hook bookkeeping to the session file —
 * confirmed empirically to bump the file's mtime even when the user never actually
 * sends a message. `listSessions()`'s `lastModified` would then read "just now" and
 * reorder the Sessions list for a session the user only opened to look at.
 *
 * This overrides that per session: set to the real last-message timestamp (from the
 * already-filtered, system-messages-excluded `getSessionMessages()` history) right
 * before `warmStart()` gets a chance to pollute the file's mtime, and cleared the
 * moment a real message is actually sent — see `webviewProvider.ts`. Global (not
 * per-workspace), like `ReadState`/`ArchiveState`, since sessions span repos. */
export class LastActivityOverride {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private readAll(): Record<string, number> {
    return this.context.globalState.get<Record<string, number>>(STORAGE_KEY, {});
  }

  get(sessionId: string): number | undefined {
    return this.readAll()[sessionId];
  }

  async set(sessionId: string, timestamp: number): Promise<void> {
    const all = this.readAll();
    all[sessionId] = timestamp;
    await this.context.globalState.update(STORAGE_KEY, all);
  }

  async clear(sessionId: string): Promise<void> {
    const all = this.readAll();
    if (sessionId in all) {
      delete all[sessionId];
      await this.context.globalState.update(STORAGE_KEY, all);
    }
  }
}
