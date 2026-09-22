import * as path from "node:path";

/** A session's cwd is excluded if it equals, or is nested inside, any configured
 * excluded folder. Nested-check requires a path-separator boundary so "/tmpfoo"
 * doesn't false-positive against an excluded "/tmp". */
export function isPathExcluded(cwd: string, excludedFolders: string[]): boolean {
  return excludedFolders.some((folder) => {
    const normalized = folder.endsWith(path.sep) ? folder.slice(0, -1) : folder;
    return cwd === normalized || cwd.startsWith(normalized + path.sep);
  });
}
