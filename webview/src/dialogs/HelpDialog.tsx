import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenExternalUrl: (url: string) => void;
}

const FEATURES: { title: string; description: string }[] = [
  {
    title: "Cross-repo Sessions",
    description:
      "The home screen lists every Claude Code session on this machine, across all repos, grouped by date, with live status (responding / unread), search, archive, and delete.",
  },
  {
    title: "Streaming chat",
    description: "Token-by-token responses, markdown rendering, and tool-call cards for every tool the agent runs.",
  },
  {
    title: "Model & mode pickers",
    description:
      "Switch model (with effort level) and permission mode (Manual / Don't ask / Edit automatically / Plan / Auto) from the composer. A separate Full bypass mode skips every permission check entirely — selecting it asks for confirmation first, since there's no undo mid-turn.",
  },
  {
    title: "Attachments & mentions",
    description:
      "Attach images or files, or type @ to mention a file from the current workspace. Dragging a file in from Finder/Explorer works too — for VS Code's own Explorer or open tabs, hold ⇧ while dragging (a VS Code restriction: without it, VS Code opens the file as a tab instead of forwarding the drop).",
  },
  {
    title: "/ command palette",
    description:
      "Context (attach, mention, clear, rewind, fork), Model (switch, effort, thinking), Customize (output styles, agents, MCP servers, skills, slash commands, memory, plugins), Settings, and Support.",
  },
  {
    title: "Rewind & Fork",
    description:
      "Rewind restores files to their state before a given message, using file checkpointing. Fork continues the same conversation under a brand-new session, leaving the current one untouched — a way to try a different approach without losing it.",
  },
  {
    title: "Edit a message",
    description:
      "Hover any message you sent for a pencil icon. Editing restores file state to before it and regenerates from there under a new session, leaving the original untouched — same idea as Fork, aimed at fixing an earlier message instead of the latest one.",
  },
  {
    title: "Attachment previews",
    description: "Click a file or image attachment on any message — active or from a past session — to view its full content.",
  },
  {
    title: "Suggested next prompt",
    description: "After a response finishes, a predicted follow-up may appear as a chip under the composer — click it to send as-is.",
  },
  {
    title: "Subagent transcripts & background tasks",
    description:
      "A Task tool call nests its subagent's own steps as lines under the same card, with a live progress summary while it's running. Any running tool call can be sent to the background — a small tray next to the context gauge lists what's still running, with a stop button for each.",
  },
  {
    title: "Files changed",
    description:
      "The diff icon in the chat header (once this chat has made at least one edit) opens a per-file diff of every change made in this chat — a Write shows its full content instead of a diff, since there's no prior file state to compare it against.",
  },
  {
    title: "Find in conversation & Copy",
    description:
      "The search icon filters this chat's own messages and tool calls with prev/next navigation. The copy icon exports the whole conversation as markdown; hovering any response also gets its own copy button.",
  },
  {
    title: "Add folder to this chat",
    description:
      "In the / palette's Context section — grants this chat access to a folder beyond its own. Applies immediately for a chat that hasn't sent anything yet; otherwise it takes effect starting with your next new chat.",
  },
  {
    title: "Command Palette & notifications",
    description:
      '"Session Companion: New Chat" and "Session Companion: Focus Chat" work from anywhere in VS Code. You also get a desktop notification if a response finishes while this view isn\'t visible or VS Code doesn\'t have focus.',
  },
];

export function HelpDialog({ open, onClose, onOpenExternalUrl }: HelpDialogProps) {
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
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-10"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Session Companion</h2>
          <button
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-sm text-muted">
            An unofficial chat client for Claude Code sessions, built on the public Claude Agent SDK, with
            cross-repo session history — the one thing the official extension doesn't have. Not affiliated
            with, endorsed by, or sponsored by Anthropic.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="text-sm font-medium text-foreground">{f.title}</div>
                <div className="text-xs text-muted">{f.description}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border px-4 py-3">
          <button
            onClick={() => onOpenExternalUrl("https://docs.claude.com/en/docs/claude-code")}
            className="flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
          >
            View Claude Code docs <ExternalLink size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
