import * as vscode from "vscode";

const STORAGE_KEY = "sessionLastViewedAt";

/** Tracks when the user last looked at each session, for the "unread" indicator. Global
 * (not per-workspace) since sessions are aggregated across every repo on the machine. */
export class ReadState {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private readAll(): Record<string, number> {
    return this.context.globalState.get<Record<string, number>>(STORAGE_KEY, {});
  }

  getLastViewedAt(sessionId: string): number {
    return this.readAll()[sessionId] ?? 0;
  }

  async markViewed(sessionId: string): Promise<void> {
    const all = this.readAll();
    all[sessionId] = Date.now();
    await this.context.globalState.update(STORAGE_KEY, all);
  }
}
