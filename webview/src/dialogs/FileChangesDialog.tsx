import { useEffect } from "react";
import { X } from "lucide-react";
import { diffLines } from "diff";
import type { FileChangeGroup } from "../utils/fileChanges";

interface FileChangesDialogProps {
  open: boolean;
  groups: FileChangeGroup[];
  onClose: () => void;
}

interface DiffLine {
  text: string;
  type: "added" | "removed" | "context";
}

function toDiffLines(oldText: string, newText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const change of diffLines(oldText, newText)) {
    const type: DiffLine["type"] = change.added ? "added" : change.removed ? "removed" : "context";
    const valueLines = change.value.split("\n");
    // A line-diff chunk's value ends in "\n" unless it's the file's last line — split()
    // on that leaves one trailing empty string to drop, or none if there wasn't a
    // trailing newline (last chunk of the whole diff).
    if (valueLines[valueLines.length - 1] === "") {
      valueLines.pop();
    }
    for (const text of valueLines) {
      lines.push({ text, type });
    }
  }
  return lines;
}

function lineClassName(type: DiffLine["type"]): string {
  if (type === "added") return "bg-green-500/15 text-green-400";
  if (type === "removed") return "bg-red-500/15 text-red-400";
  return "text-muted";
}

function linePrefix(type: DiffLine["type"]): string {
  return type === "added" ? "+ " : type === "removed" ? "- " : "  ";
}

function DiffBlock({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = toDiffLines(oldText, newText);
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-black/30 p-2 font-mono text-xs whitespace-pre-wrap">
      {lines.map((line, i) => (
        <div key={i} className={lineClassName(line.type)}>
          {linePrefix(line.type)}
          {line.text}
        </div>
      ))}
    </pre>
  );
}

export function FileChangesDialog({ open, groups, onClose }: FileChangesDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-10" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-foreground">
            Files changed{groups.length > 0 ? ` (${groups.length})` : ""}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 ? (
            <p className="text-sm text-muted">No file edits or writes in this chat yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <div key={group.filePath} className="flex flex-col gap-2">
                  <h3 className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
                    {group.filePath}
                  </h3>
                  {group.changes.map((change, i) =>
                    change.kind === "write" ? (
                      <div key={`${change.toolUseId}-${i}`} className="flex flex-col gap-1">
                        <span className="text-xs text-muted">Written (full file content, not a diff against its prior state)</span>
                        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-black/30 p-2 font-mono text-xs whitespace-pre-wrap">
                          {change.newText}
                        </pre>
                      </div>
                    ) : (
                      <DiffBlock key={`${change.toolUseId}-${i}`} oldText={change.oldText} newText={change.newText} />
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
