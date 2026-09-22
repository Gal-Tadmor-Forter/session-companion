import * as vscode from "vscode";

const STORAGE_KEY = "pendingSessionOpen";

interface PendingSessionOpen {
  cwd: string;
  sessionId: string;
  title: string;
}

/** Cross-window handoff: opening a session from a different repo has to launch a new
 * VS Code window (this webview can only ever represent one cwd's live session), which
 * would otherwise drop the user back at a blank Sessions screen with no memory of which
 * chat they meant to open. Global (not workspace) state, since it's written by the window
 * that's closing/backgrounding and read by the new window that opens. */
export class PendingSessionOpenState {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): PendingSessionOpen | undefined {
    return this.context.globalState.get<PendingSessionOpen>(STORAGE_KEY);
  }

  async set(value: PendingSessionOpen): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, value);
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, undefined);
  }
}
