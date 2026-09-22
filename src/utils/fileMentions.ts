import * as vscode from "vscode";
import * as path from "node:path";
import ignore from "ignore";
import type { FileMentionResult } from "../../shared/protocol";

type Ignore = ReturnType<typeof ignore>;

const MAX_RESULTS = 20;
/** Over-fetched before `.gitignore` filtering, then capped back down to `MAX_RESULTS` —
 * `findFiles`'s own `maxResults` caps the pre-filter candidate set, so filtering
 * afterward needs headroom or a heavily-gitignored repo could return fewer than
 * `MAX_RESULTS` real matches even when more exist. */
const CANDIDATE_POOL_SIZE = 500;
/** Always excluded regardless of `.gitignore` — `.git` itself is never tracked (so
 * never gitignored either), and a repo with no `.gitignore` at all would otherwise
 * dump every `node_modules`/`dist` file into results. */
const ALWAYS_EXCLUDED = "{**/.git/**,**/node_modules/**,**/dist/**}";

/** Root-level `.gitignore` only, one per workspace folder — covers the overwhelming
 * majority of real repos. Nested `.gitignore` files (rules that only apply under a
 * subdirectory) aren't combined in; a file excluded only by one of those still shows
 * up here. Missing/unreadable `.gitignore` isn't an error — just nothing extra to
 * filter beyond `ALWAYS_EXCLUDED`. */
async function loadGitignore(folder: vscode.WorkspaceFolder): Promise<Ignore | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ".gitignore"));
    return ignore().add(Buffer.from(bytes).toString("utf-8"));
  } catch {
    return undefined;
  }
}

/** `cwd` is the current chat's own working directory — used so a result from a
 * *different* workspace folder (multi-root) gets a `relativePath` that's still
 * correct to insert as-is (e.g. "../portal/src/index.ts"), since the model resolves
 * "@path" mentions relative to the session's `cwd`, not to whichever folder happened
 * to contain the match. A plain `path.relative(ownFolder, file)` would silently point
 * at the wrong file (or nothing) once inserted into a chat whose `cwd` is elsewhere. */
export async function searchWorkspaceFiles(query: string, cwd: string): Promise<FileMentionResult[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return [];
  }
  const pattern = query.trim() ? `**/*${query.trim()}*` : "**/*";
  const uris = await vscode.workspace.findFiles(pattern, ALWAYS_EXCLUDED, CANDIDATE_POOL_SIZE);

  const gitignoreByFolder = new Map<string, Ignore | undefined>(
    await Promise.all(folders.map(async (folder) => [folder.uri.fsPath, await loadGitignore(folder)] as const))
  );

  const results: FileMentionResult[] = [];
  for (const uri of uris) {
    const ownFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!ownFolder) continue;
    const relativeToOwnFolder = path.relative(ownFolder.uri.fsPath, uri.fsPath);
    if (gitignoreByFolder.get(ownFolder.uri.fsPath)?.ignores(relativeToOwnFolder)) {
      continue;
    }
    results.push({
      relativePath: path.relative(cwd, uri.fsPath),
      absolutePath: uri.fsPath,
      // Display-only hint for which repo a result comes from — only meaningful (and
      // only shown) once there's more than one workspace folder to disambiguate.
      repoName: folders.length > 1 ? ownFolder.name : undefined,
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}
