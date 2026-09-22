export function describeToolUse(name: string, input: Record<string, unknown>): string {
  const filePath = typeof input.file_path === "string" ? input.file_path : undefined;

  switch (name) {
    case "Read": {
      const offset = typeof input.offset === "number" ? input.offset : undefined;
      const limit = typeof input.limit === "number" ? input.limit : undefined;
      if (filePath && offset !== undefined && limit !== undefined) {
        return `Read ${filePath}, lines ${offset} to ${offset + limit}`;
      }
      return filePath ? `Read ${filePath}` : "Read file";
    }
    case "Edit":
      return filePath ? `Edited ${filePath}` : "Edited file";
    case "Write":
      return filePath ? `Created ${filePath}` : "Created file";
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : undefined;
      return command ? `Executed \`${command}\`` : "Executed command";
    }
    case "Grep":
      return typeof input.pattern === "string" ? `Searched for "${input.pattern}"` : "Searched";
    case "Glob":
      return typeof input.pattern === "string" ? `Listed files matching "${input.pattern}"` : "Listed files";
    default:
      return `Used ${name}`;
  }
}

/** Every recognized tool above already folds its key args into the one-line label
 * (file path, command, pattern...), so this is mainly for the unrecognized/MCP-tool
 * default case above ("Used <name>") — its label carries no argument detail at all,
 * so the expanded card needs to show the raw input for that to mean anything. */
export function formatToolInputEntries(input: Record<string, unknown>): [string, string][] {
  return Object.entries(input).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  ]);
}
