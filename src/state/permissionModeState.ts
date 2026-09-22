import * as vscode from "vscode";
import type { PermissionModeId } from "../../shared/protocol";

const STORAGE_KEY = "lastPermissionMode";

/** Remembers the last permission mode the user explicitly picked in this extension.
 * Used only as a fallback initial mode for a brand-new/resumed session when Claude
 * Code's own `permissions.defaultMode` setting (`~/.claude/settings.json`, a managed
 * policy, etc. — see `resolveSettings()`/`filterEscalatingDefaultMode()` in
 * `webviewProvider.ts`) doesn't configure one. Global, not per-workspace or
 * per-session: the point is "what I last chose," which should carry across repos and
 * windows the same way `ReadState`/`ArchiveState`/`LastActivityOverride` do. */
export class PermissionModeState {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(): PermissionModeId | undefined {
    return this.context.globalState.get<PermissionModeId>(STORAGE_KEY);
  }

  async set(mode: PermissionModeId): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, mode);
  }
}
