import type { FileMentionResult } from "../../../shared/protocol";

interface MentionAutocompleteProps {
  results: FileMentionResult[];
  onSelect: (result: FileMentionResult) => void;
}

export function MentionAutocomplete({ results, onSelect }: MentionAutocompleteProps) {
  if (results.length === 0) {
    return null;
  }
  return (
    <div className="mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
      {results.map((result) => (
        <button
          key={result.absolutePath}
          onClick={() => onSelect(result)}
          className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{result.relativePath}</span>
          {result.repoName && <span className="shrink-0 text-xs text-muted">{result.repoName}</span>}
        </button>
      ))}
    </div>
  );
}
