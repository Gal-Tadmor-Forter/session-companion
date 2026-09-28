/** Removes duplicate entries by `name`, keeping the first occurrence — used for the
 * SDK's `supportedAgents()`/`supportedCommands()`/`reloadSkills()` responses, which have
 * been observed to return the same entry more than once (confirmed empirically: repeated
 * `reloadSkills()` calls in one live session, e.g. every time the slash palette's Skills
 * subview is reopened, can return a growing, duplicate-laden list rather than a fresh
 * deduplicated snapshot — not something fixable from this side of the SDK boundary, so
 * we guard against it here instead). */
export function dedupeByName<T extends { name: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
}
