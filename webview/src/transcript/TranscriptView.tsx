import { useEffect, useState } from "react";
import { Image, FileText, Dot, Brain, Info, PictureInPicture2, MessageSquareText, Pencil, Check, Copy, X, Clock, Trash2 } from "lucide-react";
import { STEER_ABORT_WINDOW_MS, type AttachmentSummary } from "../../../shared/protocol";
import type { TranscriptItem } from "../types";
import { Button } from "../components/Button";
import { Collapsible } from "../components/Collapsible";
import { Markdown } from "../components/Markdown";
import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";
import { formatClockTime } from "../utils/relativeTime";
import { describeToolUse, formatToolInputEntries } from "../utils/toolLabel";
import { formatDuration, formatCost } from "../utils/formatTurnStats";
import { formatTokenCount } from "../utils/formatTokenCount";

interface TranscriptViewProps {
  items: TranscriptItem[];
  onPermissionDecision: (requestId: string, approve: boolean, updatedInput?: Record<string, unknown>) => void;
  onBackgroundTask: (toolUseId: string) => void;
  onPreviewAttachment: (attachment: AttachmentSummary) => void;
  onEditMessage: (uuid: string, newText: string) => void;
  /** Disallow starting an edit while a turn is already streaming — editing forks and
   * regenerates from that point, which doesn't make sense to kick off mid-turn. */
  editDisabled: boolean;
  onCopy: (text: string) => void;
  /** Edits the text of a still-pending "queue" message in place — no fork/regenerate,
   * since it hasn't been sent yet. */
  onEditQueuedMessage: (uuid: string, newText: string) => void;
  /** Cancels a still-pending "queue" message before it's sent. */
  onCancelQueuedMessage: (uuid: string) => void;
}

function summarize(text: string, maxLength = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}

interface AskUserQuestionOption {
  label: string;
  description: string;
}

interface AskUserQuestionEntry {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskUserQuestionOption[];
}

/** Defensively parses an AskUserQuestion tool call's `input.questions` — falls back to
 * `undefined` (plain Approve/Deny) on anything unexpected rather than risk rendering a
 * broken picker for a shape this hasn't seen before. */
function parseAskUserQuestions(input: Record<string, unknown>): AskUserQuestionEntry[] | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const parsed: AskUserQuestionEntry[] = [];
  for (const q of questions) {
    if (!q || typeof q !== "object") return undefined;
    const { question, header, multiSelect, options } = q as Record<string, unknown>;
    if (typeof question !== "string" || typeof header !== "string" || !Array.isArray(options)) return undefined;
    const parsedOptions: AskUserQuestionOption[] = [];
    for (const opt of options) {
      if (!opt || typeof opt !== "object") return undefined;
      const { label, description } = opt as Record<string, unknown>;
      if (typeof label !== "string" || typeof description !== "string") return undefined;
      parsedOptions.push({ label, description });
    }
    if (parsedOptions.length === 0) return undefined;
    parsed.push({ question, header, multiSelect: multiSelect === true, options: parsedOptions });
  }
  return parsed;
}

function AskUserQuestionCard({
  questions,
  onSubmit,
}: {
  questions: AskUserQuestionEntry[];
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const toggleOption = (entry: AskUserQuestionEntry, label: string) => {
    setSelections((prev) => {
      const current = prev[entry.question] ?? [];
      if (!entry.multiSelect) {
        return { ...prev, [entry.question]: [label] };
      }
      const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
      return { ...prev, [entry.question]: next };
    });
  };
  const allAnswered = questions.every((q) => (selections[q.question]?.length ?? 0) > 0);
  const submit = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.question] = (selections[q.question] ?? []).join(", ");
    }
    onSubmit(answers);
  };
  return (
    <div className="mt-2.5 flex flex-col gap-3">
      {questions.map((entry) => (
        <div key={entry.question} className="flex flex-col gap-1.5">
          <div className="text-xs font-medium text-foreground">{entry.question}</div>
          <div className="flex flex-wrap gap-1.5">
            {entry.options.map((opt) => {
              const selected = (selections[entry.question] ?? []).includes(opt.label);
              return (
                <Tooltip key={opt.label} label={opt.description}>
                  <button
                    onClick={() => toggleOption(entry, opt.label)}
                    className={cn(
                      "cursor-pointer rounded-md border px-2 py-1 text-xs",
                      selected
                        ? "border-accent bg-accent/20 text-accent"
                        : "border-border text-muted hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      ))}
      <Button size="sm" onClick={submit} disabled={!allAnswered} className="self-start">
        <Check size={13} /> Submit
      </Button>
    </div>
  );
}

export function TranscriptView({
  items,
  onPermissionDecision,
  onBackgroundTask,
  onPreviewAttachment,
  onEditMessage,
  editDisabled,
  onCopy,
  onEditQueuedMessage,
  onCancelQueuedMessage,
}: TranscriptViewProps) {
  // Steps (tool calls, thinking, context notes) default open while running/streaming and
  // collapsed once finished, so a response with many steps stays compact — but the user
  // can toggle any individual one; overrides here win over that smart default.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const setExpanded = (id: string, open: boolean) =>
    setExpandedOverrides((overrides) => ({ ...overrides, [id]: open }));

  const [editingItemId, setEditingItemId] = useState<string | undefined>(undefined);
  const [editDraft, setEditDraft] = useState("");
  const startEditing = (item: Extract<TranscriptItem, { kind: "user" }>) => {
    setEditingItemId(item.id);
    setEditDraft(item.text);
  };
  const commitEdit = (item: Extract<TranscriptItem, { kind: "user" }>) => {
    const text = editDraft.trim();
    setEditingItemId(undefined);
    if (!text) return;
    if (item.pending && (item.deliveryMode === "queue" || item.deliveryMode === "steer")) {
      onEditQueuedMessage(item.uuid, text);
    } else {
      onEditMessage(item.uuid, text);
    }
  };

  // Pending (queued/steered, not-yet-sent) messages are kept at the very bottom
  // regardless of when they were added, so a message queued mid-response never appears
  // to sit earlier in history than it really does — settled items keep their real order,
  // only the still-pending ones are pulled out and appended after them.
  const pendingItems = items.filter((item) => item.kind === "user" && item.pending);
  const settledItems = items.filter((item) => !(item.kind === "user" && item.pending));
  const orderedItems = [...settledItems, ...pendingItems];

  // Drives the "Steering in Xs…" countdown below — only ticks while a "steer" message
  // is actually pending, since it's the only pending state with a fixed deadline
  // ("queue" waits for the current turn to finish, which has no fixed duration to count
  // down).
  const hasPendingSteer = pendingItems.some(
    (item) => item.kind === "user" && item.deliveryMode === "steer"
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasPendingSteer) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [hasPendingSteer]);

  return (
    <div className="flex flex-col gap-3">
      {orderedItems.map((item) => {
        switch (item.kind) {
          case "user": {
            const editing = editingItemId === item.id;
            if (editing) {
              return (
                <div key={item.id} id={item.id} className="flex flex-col items-end gap-1.5">
                  <textarea
                    autoFocus
                    rows={Math.min(10, Math.max(2, item.text.split("\n").length))}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit(item);
                      else if (e.key === "Escape") setEditingItemId(undefined);
                    }}
                    className="max-w-[85%] min-w-0 resize-none rounded-2xl rounded-tr-sm border border-accent bg-accent px-3 py-2 text-sm text-accent-foreground focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" onClick={() => commitEdit(item)}>
                      <Check size={13} /> {item.pending ? "Save" : "Save & regenerate"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingItemId(undefined)}>
                      <X size={13} /> Cancel
                    </Button>
                  </div>
                </div>
              );
            }
            // A still-pending "queue"/"steer" message can always be cancelled/edited —
            // that's the whole point of the window it sits in before being sent —
            // regardless of `editDisabled` (which only governs re-editing an
            // already-sent message mid-turn).
            const canEditPending =
              item.pending && (item.deliveryMode === "queue" || item.deliveryMode === "steer");
            const showPencil = item.pending ? canEditPending : !editDisabled;
            const steerSecondsLeft =
              item.pending && item.deliveryMode === "steer" && item.timestamp
                ? Math.max(0, Math.ceil((STEER_ABORT_WINDOW_MS - (now - item.timestamp)) / 1000))
                : undefined;
            return (
              <div key={item.id} id={item.id} className="group flex flex-col items-end">
                <div className="flex max-w-[85%] min-w-0 items-start gap-1">
                  {canEditPending && (
                    <Tooltip
                      label={item.deliveryMode === "queue" ? "Cancel this queued message" : "Cancel steering"}
                    >
                      <button
                        onClick={() => onCancelQueuedMessage(item.uuid)}
                        className="mt-2 shrink-0 cursor-pointer rounded-md p-1 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  )}
                  {showPencil && (
                    <Tooltip
                      label={
                        item.pending
                          ? item.deliveryMode === "queue"
                            ? "Edit queued message"
                            : "Edit steered message"
                          : "Edit and regenerate from here"
                      }
                    >
                      <button
                        onClick={() => startEditing(item)}
                        className="mt-2 shrink-0 cursor-pointer rounded-md p-1 text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil size={13} />
                      </button>
                    </Tooltip>
                  )}
                  <div
                    className={cn(
                      "min-w-0 rounded-2xl rounded-tr-sm px-3 py-2 text-accent-foreground",
                      item.pending ? "border border-dashed border-accent/60 bg-accent/40" : "bg-accent"
                    )}
                  >
                    {item.attachments.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1 text-xs">
                        {item.attachments.map((att, i) => (
                          <Tooltip key={att.id ?? i} label="Click to view">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onPreviewAttachment(att);
                              }}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-black/20 px-1.5 py-0.5 opacity-80 hover:bg-black/30 hover:opacity-100"
                            >
                              {att.kind === "image" ? <Image size={12} /> : <FileText size={12} />} {att.fileName}
                            </button>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                    <Markdown text={item.text} onAccent />
                  </div>
                </div>
                {item.pending ? (
                  <span className="mt-0.5 mr-1 flex items-center gap-1 text-[10px] italic text-muted">
                    <Clock size={10} />
                    {item.deliveryMode === "queue"
                      ? "Queued — sends after this response"
                      : `Steering in ${steerSecondsLeft ?? 0}s…`}
                  </span>
                ) : (
                  item.timestamp && (
                    <span className="mt-0.5 mr-1 text-[10px] text-muted">{formatClockTime(item.timestamp)}</span>
                  )
                )}
              </div>
            );
          }
          case "assistantText":
            return (
              <div key={item.id} id={item.id} className="group flex flex-col items-start">
                <div className="flex max-w-[90%] min-w-0 items-start gap-1">
                  <div className="min-w-0 rounded-2xl rounded-tl-sm bg-surface px-3 py-2 text-foreground">
                    <Markdown text={item.text} />
                    {item.streaming && <span className="animate-pulse text-accent">▍</span>}
                  </div>
                  {!item.streaming && item.text.trim().length > 0 && (
                    <Tooltip label="Copy">
                      <button
                        onClick={() => onCopy(item.text)}
                        className="mt-2 shrink-0 cursor-pointer rounded-md p-1 text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
                      >
                        <Copy size={13} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {item.timestamp && !item.streaming && (
                  <span className="mt-0.5 ml-1 text-[10px] text-muted">{formatClockTime(item.timestamp)}</span>
                )}
              </div>
            );
          case "thinking": {
            const hasContent = item.text.trim().length > 0;
            const open = expandedOverrides[item.id] ?? item.streaming;
            const trigger = (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Brain size={13} className="shrink-0" />
                <span className="truncate italic">
                  {item.streaming ? "Thinking…" : summarize(item.text, 60) || "Thinking (no visible content)"}
                </span>
              </div>
            );
            return (
              <div
                key={item.id} id={item.id}
                className="rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted"
              >
                {hasContent || item.streaming ? (
                  <Collapsible open={open} onOpenChange={(next) => setExpanded(item.id, next)} trigger={trigger}>
                    <div className="mt-1.5 min-w-0 break-words whitespace-pre-wrap border-t border-border pt-1.5 italic">
                      {item.text}
                    </div>
                  </Collapsible>
                ) : (
                  trigger
                )}
              </div>
            );
          }
          case "toolUse": {
            const running = !item.result;
            const argEntries = formatToolInputEntries(item.input);
            const hasSubagentSteps = (item.subagentSteps?.length ?? 0) > 0;
            const hasDetails = argEntries.length > 0 || Boolean(item.result) || hasSubagentSteps;
            const open = expandedOverrides[item.id] ?? !item.result;
            const trigger = (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Dot size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate">{item.progressSummary ?? item.label}</span>
              </div>
            );
            const details = (
              <>
                {argEntries.length > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1 border-t border-border pt-1.5 text-muted">
                    {argEntries.map(([key, value]) => (
                      <div key={key} className="min-w-0 break-words whitespace-pre-wrap">
                        <span className="text-accent">{key}:</span> {value}
                      </div>
                    ))}
                  </div>
                )}
                {item.result && (
                  <div
                    className={cn(
                      "mt-1.5 min-w-0 break-words whitespace-pre-wrap border-t border-border pt-1.5",
                      item.result.isError ? "text-danger" : "text-muted"
                    )}
                  >
                    {item.result.summary}
                  </div>
                )}
                {hasSubagentSteps && (
                  <div className="mt-1.5 flex flex-col gap-1 border-t border-border pt-1.5 text-muted">
                    {item.subagentSteps!.map((entry) => (
                      <div key={entry.id} className="flex min-w-0 items-start gap-1.5">
                        {entry.step.kind === "toolUse" ? (
                          <>
                            <Dot size={14} className="mt-px shrink-0 text-accent" />
                            <span className="min-w-0 break-words">
                              {describeToolUse(entry.step.name, entry.step.input)}
                            </span>
                          </>
                        ) : (
                          <>
                            <MessageSquareText size={12} className="mt-0.5 shrink-0" />
                            <span className={cn("min-w-0 break-words", entry.step.kind === "thinking" && "italic")}>
                              {entry.step.text}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
            return (
              <div
                key={item.id} id={item.id}
                className="rounded-lg border border-border bg-surface/60 px-3 py-2 font-mono text-xs text-foreground"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {hasDetails ? (
                    <Collapsible
                      open={open}
                      onOpenChange={(next) => setExpanded(item.id, next)}
                      className="min-w-0 flex-1"
                      trigger={trigger}
                    >
                      {details}
                    </Collapsible>
                  ) : (
                    <div className="min-w-0 flex-1">{trigger}</div>
                  )}
                  {running && (
                    <Tooltip label="Run in background">
                      <button
                        onClick={() => onBackgroundTask(item.toolUseId)}
                        className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
                      >
                        <PictureInPicture2 size={12} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          }
          case "contextNote": {
            const open = expandedOverrides[item.id] ?? false;
            return (
              <div
                key={item.id} id={item.id}
                className="rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted"
              >
                <Collapsible
                  open={open}
                  onOpenChange={(next) => setExpanded(item.id, next)}
                  trigger={
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Info size={13} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{summarize(item.text)}</span>
                    </div>
                  }
                >
                  <div className="mt-1.5 min-w-0 break-words whitespace-pre-wrap border-t border-border pt-1.5">
                    {item.text}
                  </div>
                </Collapsible>
              </div>
            );
          }
          case "turnStats":
            return (
              <div key={item.id} id={item.id} className="ml-1 flex items-center gap-1 text-[10px] text-muted">
                <span>{formatDuration(item.durationMs)}</span>
                <span>·</span>
                <span>{formatCost(item.costUsd)}</span>
                <span>·</span>
                <span>
                  {formatTokenCount(item.inputTokens)} in / {formatTokenCount(item.outputTokens)} out
                </span>
              </div>
            );
          case "permission": {
            // AskUserQuestion needs its answer fed back through the same permission
            // gate (see `resolvePermission`'s doc comment) rather than a bare
            // allow/deny, so it gets its own picker UI instead of the generic buttons.
            const questions =
              item.toolName === "AskUserQuestion" ? parseAskUserQuestions(item.input) : undefined;
            return (
              <div
                key={item.id} id={item.id}
                className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
              >
                <div className="font-medium text-foreground">{item.label}</div>
                {item.description && <div className="mt-1 text-xs text-muted">{item.description}</div>}
                {item.resolution ? (
                  item.answers ? (
                    <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                      {Object.entries(item.answers).map(([question, answer]) => (
                        <div key={question} className="italic">
                          {question} <span className="text-foreground not-italic">— {answer}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs italic text-muted">
                      {item.resolution === "approved" ? "Approved" : "Denied"}
                    </div>
                  )
                ) : questions ? (
                  <AskUserQuestionCard
                    questions={questions}
                    onSubmit={(answers) => onPermissionDecision(item.requestId, true, { answers })}
                  />
                ) : (
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" onClick={() => onPermissionDecision(item.requestId, true)}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => onPermissionDecision(item.requestId, false)}
                    >
                      Deny
                    </Button>
                  </div>
                )}
              </div>
            );
          }
          case "error":
            return (
              <div key={item.id} id={item.id} className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                {item.message}
              </div>
            );
        }
      })}
    </div>
  );
}
