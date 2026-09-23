import { useMemo, useState } from "react";
import { RefreshCw, Archive, ArchiveRestore, CircleHelp, Gauge, Pencil, Settings, Trash2 } from "lucide-react";
import type { SessionListEntry } from "../../../shared/protocol";
import { DATE_GROUP_ORDER, dateGroupFor, formatRelativeTime, type DateGroup } from "../utils/relativeTime";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";
import { Tooltip } from "../components/Tooltip";
import { useThinkingVerb } from "../utils/thinkingVerbs";

// A separate component (rather than calling the hook inline in the sessions .map below)
// so each active session gets its own independently-ticking verb without breaking the
// Rules of Hooks — only ever mounted while `session.active`, so `active` is always true.
function RespondingBadge() {
  const verb = useThinkingVerb(true);
  return (
    <span className="flex shrink-0 items-center gap-1 text-accent">
      <Spinner />
      {verb}…
    </span>
  );
}

interface SessionsViewProps {
  sessions: SessionListEntry[];
  hasMore: boolean;
  onLoadMore: () => void;
  onOpenSession: (session: SessionListEntry) => void;
  onRefresh: () => void;
  onDeleteSession: (sessionId: string) => void;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onRenameSession: (sessionId: string, cwd: string, title: string) => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
}

export function SessionsView({
  sessions,
  hasMore,
  onLoadMore,
  onOpenSession,
  onRefresh,
  onDeleteSession,
  onSetArchived,
  onRenameSession,
  onOpenHelp,
  onOpenSettings,
  onOpenUsage,
}: SessionsViewProps) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const commitRename = (session: SessionListEntry) => {
    const title = renameDraft.trim();
    if (title && title !== session.title) {
      onRenameSession(session.sessionId, session.cwd, title);
    }
    setRenamingId(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = sessions.filter((s) => {
      if (s.archived !== showArchived) return false;
      if (!q) return true;
      return s.title.toLowerCase().includes(q) || s.repoName.toLowerCase().includes(q);
    });
    return [...base].sort((a, b) => b.lastModified - a.lastModified);
  }, [sessions, query, showArchived]);

  const groups = useMemo(() => {
    const byGroup = new Map<DateGroup, SessionListEntry[]>();
    for (const session of filtered) {
      const group = dateGroupFor(session.lastModified);
      const list = byGroup.get(group) ?? [];
      list.push(session);
      byGroup.set(group, list);
    }
    return DATE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      sessions: byGroup.get(g)!,
    }));
  }, [filtered]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-0.5">
        <h2 className="mr-auto text-sm font-semibold text-foreground">Sessions</h2>
        <Tooltip label={showArchived ? "Show active sessions" : "Show archived sessions"}>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={
              showArchived
                ? "cursor-pointer rounded-md p-1.5 text-accent hover:bg-surface-hover"
                : "cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
            }
            aria-label={showArchived ? "Show active sessions" : "Show archived sessions"}
          >
            {showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
        </Tooltip>
        <Tooltip label="Usage & spend limits">
          <button
            onClick={onOpenUsage}
            className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Usage"
          >
            <Gauge size={16} />
          </button>
        </Tooltip>
        <Tooltip label="About this extension">
          <button
            onClick={onOpenHelp}
            className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Help"
          >
            <CircleHelp size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Extension settings">
          <button
            onClick={onOpenSettings}
            className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>
        </Tooltip>
        <Tooltip label="Refresh sessions">
          <button
            onClick={onRefresh}
            className="cursor-pointer rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Refresh sessions"
          >
            <RefreshCw size={16} />
          </button>
        </Tooltip>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search sessions"
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {sessions.length === 0 && (
        <div className="px-1 text-sm text-muted">
          {showArchived ? "No archived sessions." : "No sessions yet. Start a chat below."}
        </div>
      )}
      {groups.map(({ group, sessions: groupSessions }) => (
        <div key={group} className="flex flex-col gap-1">
          <div className="px-1 text-xs font-medium text-muted">{group}</div>
          {groupSessions.map((session) => (
            <div
              key={session.sessionId}
              className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-hover"
            >
              {renamingId === session.sessionId ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(session);
                    else if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => commitRename(session)}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-foreground focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => onOpenSession(session)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <div className="flex w-full items-center gap-1.5">
                    <span
                      className={
                        session.active
                          ? "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
                          : session.unread
                            ? "h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                            : "h-1.5 w-1.5 shrink-0 rounded-full bg-muted"
                      }
                    />
                    <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 pl-3 text-xs text-muted">
                    <span className="truncate">
                      {session.repoName} · {formatRelativeTime(session.lastModified)}
                    </span>
                    {session.active && <RespondingBadge />}
                  </div>
                </button>
              )}
              {renamingId !== session.sessionId && (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <Tooltip label="Rename">
                    <button
                      onClick={() => {
                        setRenameDraft(session.title);
                        setRenamingId(session.sessionId);
                      }}
                      className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label={session.archived ? "Unarchive" : "Archive"}>
                    <button
                      onClick={() => onSetArchived(session.sessionId, !session.archived)}
                      className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
                    >
                      {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    </button>
                  </Tooltip>
                  <Tooltip label="Delete">
                    <button
                      onClick={() => onDeleteSession(session.sessionId)}
                      className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {hasMore && (
        <Button variant="ghost" size="sm" onClick={onLoadMore}>
          Load 50 more
        </Button>
      )}
    </div>
  );
}
