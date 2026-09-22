/** Case-insensitive substring match against an item's name and description. Used by the
 * "/" palette's root-view search to surface real slash commands/agents/skills (not just
 * the ~20 static category rows) — see `SlashPalette.tsx`. Returns everything when `query`
 * is blank/whitespace-only isn't the desired root-view behavior (that would dump the full
 * list into the default menu), so callers gate on a non-empty query themselves; this
 * function alone just decides "does this one item match".
 */
export function matchesNameOrDescription(item: { name: string; description: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
}

/** Same idea, name-only — for MCP servers, whose `description`-equivalent field
 * (`status`) isn't something a user would search by. */
export function matchesName(item: { name: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return item.name.toLowerCase().includes(q);
}
