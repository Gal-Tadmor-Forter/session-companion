import * as path from "node:path";
import * as vscode from "vscode";
import { ChatWebviewProvider } from "./providers/webviewProvider";
import { registerChatSession } from "./chatPanel/chatSession";
import { sweepStaleHeartbeats } from "./session/heartbeat";
import { PendingSessionOpenState } from "./state/pendingSessionOpen";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatWebviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("sessionCompanion.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("sessionCompanion.focusChat", () =>
      vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`)
    )
  );

  void sweepStaleHeartbeats(path.join(context.globalStorageUri.fsPath, "active-sessions"));

  // If this window was just opened to resume a specific cross-repo session (see
  // PendingSessionOpenState), bring the chat view to the front so it's immediately
  // visible instead of leaving the user on whatever view VS Code defaulted to.
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const pending = new PendingSessionOpenState(context).get();
  if (cwd && pending?.cwd === cwd) {
    void vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
  }

  try {
    registerChatSession(context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(
      `Session Companion: chat panel integration failed to register (proposed API mismatch?): ${message}`
    );
  }
}

export function deactivate(): void {}
