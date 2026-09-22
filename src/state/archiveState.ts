import * as vscode from "vscode";

const STORAGE_KEY = "archivedSessionIds";

/** Tracks which sessions the user has archived. Local-only concept — the SDK has no
 * archive mutation, only delete, so this is our own lightweight state (global, like
 * ReadState, since sessions span repos). */
export class ArchiveState {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private readAll(): string[] {
    return this.context.globalState.get<string[]>(STORAGE_KEY, []);
  }

  isArchived(sessionId: string): boolean {
    return this.readAll().includes(sessionId);
  }

  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    const all = new Set(this.readAll());
    if (archived) {
      all.add(sessionId);
    } else {
      all.delete(sessionId);
    }
    await this.context.globalState.update(STORAGE_KEY, [...all]);
  }
}
