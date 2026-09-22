import type { SlashCommandEntry } from "../../../shared/protocol";

interface SlashCommandAutocompleteProps {
  commands: SlashCommandEntry[];
  onSelect: (command: SlashCommandEntry) => void;
}

export function SlashCommandAutocomplete({ commands, onSelect }: SlashCommandAutocompleteProps) {
  if (commands.length === 0) {
    return null;
  }
  return (
    <div className="mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
      {commands.map((command) => (
        <button
          key={command.name}
          onClick={() => onSelect(command)}
          className="flex w-full flex-col items-start gap-0 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
        >
          <span className="truncate text-sm text-foreground">/{command.name}</span>
          <span className="truncate text-xs text-muted">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
