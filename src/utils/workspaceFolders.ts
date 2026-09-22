/** Whether `targetCwd` is one of the folders already open in this VS Code window (a
 * multi-root workspace can have several). If so, a session tied to it can be opened
 * right here by repointing the live `AgentSession` — no need to spawn a whole new
 * window the way a genuinely-unopened folder's session requires. */
export function isOpenWorkspaceFolder(targetCwd: string, openFolderPaths: readonly string[]): boolean {
  return openFolderPaths.includes(targetCwd);
}
