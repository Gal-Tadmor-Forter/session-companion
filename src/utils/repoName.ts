export function repoNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop();
  return base && base.length > 0 ? base : cwd;
}
