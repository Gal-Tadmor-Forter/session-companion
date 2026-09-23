export type PermissionModeId = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
export type EffortLevelId = "low" | "medium" | "high" | "xhigh" | "max";
/** How a message is delivered when sent while a turn is already in progress:
 * "queue" runs it as its own turn after the current one fully finishes,
 * "steer" folds it into the currently-running turn, "stopAndSend" aborts
 * the current turn first. Omitted when nothing is in progress. */
export type MessageDeliveryMode = "queue" | "steer" | "stopAndSend";

/** How long a "steer" message sits cancellable/editable (see `AgentSession.sendMessage`)
 * before it's auto-flushed to the model — shared so the webview's countdown badge
 * (TranscriptView) can't drift from the host's actual deadline. A "queue" message has no
 * fixed window instead: it's held until the currently-running turn finishes. */
export const STEER_ABORT_WINDOW_MS = 3000;

export interface ModelOption {
  value: string;
  displayName: string;
  description: string;
  supportsEffort: boolean;
  supportedEffortLevels: EffortLevelId[];
}

export interface AttachmentSummary {
  /** Absent for attachments reconstructed from a past session's stored transcript —
   * there's nothing to remove/take in that context, only to preview. */
  id?: string;
  fileName: string;
  kind: "image" | "text";
  sizeBytes?: number;
  /** Preview content, for the "click to view" affordance on a sent/replayed
   * attachment chip. Images: the same base64 payload/media type sent to the model
   * (bounded by the existing 10MB image cap). Text: the raw file content (bounded by
   * the existing 256KB text cap). Past-session image attachments have no recoverable
   * file name (the Anthropic API's image content block never carries one), so
   * `fileName` for those is a generic placeholder — see `sessionHistory.ts`. */
  mediaType?: string;
  previewBase64?: string;
  previewText?: string;
}

export interface SessionListEntry {
  sessionId: string;
  title: string;
  repoName: string;
  cwd: string;
  lastModified: number;
  createdAt?: number;
  unread: boolean;
  active: boolean;
  archived: boolean;
}

export type ReplayItem =
  | { kind: "user"; text: string; attachments?: AttachmentSummary[]; uuid: string }
  | { kind: "assistantText"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolUse"; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: "toolResult"; toolUseId: string; isError: boolean; summary: string }
  /** A "user" message that's actually auto-injected IDE context (e.g. `<ide_opened_file>`),
   * not something the person typed — rendered as a compact note instead of a chat bubble. */
  | { kind: "contextNote"; text: string };

/** One piece of a subagent's own conversation, forwarded under the Task tool call that
 * spawned it (`Options.forwardSubagentText`). Rendered as a flat nested line rather than
 * a fully recursive sub-transcript — enough to see what the subagent did without a deep
 * collapsible tree. */
export type SubagentStep =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolUse"; name: string; input: Record<string, unknown> };

export interface BackgroundTaskEntry {
  taskId: string;
  taskType: string;
  description: string;
}

/** Minimal server config accepted by the "Add MCP server" form — stdio only for now
 * (the common case: a local command). */
export interface NewMcpServerConfig {
  type: "stdio";
  command: string;
  args: string[];
}

export interface FileMentionResult {
  /** Relative to the *current chat's* cwd (not necessarily the folder the file lives
   * in) — safe to insert as "@relativePath" as-is even for a file in a different
   * multi-root workspace folder (e.g. "../portal/src/index.ts"), since that's the
   * frame the model actually resolves "@path" mentions against. */
  relativePath: string;
  absolutePath: string;
  /** The owning workspace folder's display name, for a "which repo is this from"
   * subtitle — only set when more than one workspace folder is open. */
  repoName?: string;
}

export interface McpServerStatusEntry {
  name: string;
  status: string;
  enabled: boolean;
}

export interface AgentInfoEntry {
  name: string;
  description: string;
}

export interface SlashCommandEntry {
  name: string;
  description: string;
}

export interface AccountInfoResult {
  email?: string;
  organization?: string;
}

/** Mirrors the SDK's `SDKUsageReport` (the structured twin of a `/usage` result,
 * attached to the synthetic assistant message that delivers it — see
 * `AgentSession.requestUsage()`), converted to display-ready units. `undefined` means
 * the probe resolved with nothing usable (non-subscriber/API-key session, or an older
 * CLI that doesn't attach the structured report) — not the same as still loading. */
export interface UsageReportInfo {
  /** The org/plan's monthly spend cap (Enterprise-style "extra usage" credits), if this
   * account has one. No reset timestamp is available from the SDK for this one —
   * unlike `limits` below, `extra_usage` doesn't carry a `resets_at`. */
  extraUsage?: {
    isEnabled: boolean;
    monthlyLimitUsd: number | null;
    usedUsd: number | null;
    utilizationPercent: number | null;
    currency: string | null;
  };
  /** The plan's own rate-limit meters (e.g. weekly windows), server-labeled and
   * server-ordered — rendered verbatim, not reclassified client-side. */
  limits: Array<{
    kind: string;
    group: string;
    percent: number;
    resetsAt: string | null;
    scopeLabel?: string;
    severity?: string | null;
    isActive?: boolean | null;
  }>;
  /** The plain-text "/usage" body (a "what's contributing to your limits usage"
   * breakdown, when the account has one) — the SDK only exposes this as markdown, not
   * as structured data, so it's rendered as-is via the existing Markdown component. */
  detailsMarkdown: string;
}

export interface ContextUsageCategory {
  name: string;
  tokens: number;
  /** Classification the SDK itself uses: 'used' occupies the window, 'free' is
   * remaining space, 'buffer' is the reserve held back for the response,
   * 'deferred' is out-of-window tool schemas not currently loaded. */
  kind: "used" | "free" | "buffer" | "deferred";
}

export interface ContextUsageInfo {
  categories: ContextUsageCategory[];
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  /** Cumulative estimated session cost in USD, when available (absent for
   * providers where the SDK doesn't report cost, e.g. some non-API-key auth). */
  costUsd: number | undefined;
}

export type HostToWebviewMessage =
  | { type: "attachmentAdded"; attachment: AttachmentSummary }
  | { type: "attachmentError"; message: string }
  /** `hasMore` is based on the raw pre-exclusion-filter fetch, so it's a slight
   * over-estimate when a lot of the next page turns out to live under an excluded
   * folder — acceptable; the next "Load more" just returns a smaller-than-expected
   * page in that rare case rather than under-reporting whether more exist at all. */
  | { type: "sessionListLoaded"; sessions: SessionListEntry[]; hasMore: boolean }
  /** `sessionId`/`title` are omitted specifically for the "edit the very first message"
   * case — there's nothing to fork from (no preceding message), so it's really just a
   * fresh, not-yet-started chat, same as "New Chat" (which likewise has no id/title
   * until the SDK reports one on the first result). */
  | { type: "sessionOpened"; sessionId?: string; title?: string; replay: ReplayItem[] }
  | { type: "sessionDeleted"; sessionId: string }
  | { type: "textDeltaStart"; blockId: string }
  | { type: "textDelta"; blockId: string; text: string }
  | { type: "textDeltaEnd"; blockId: string }
  | { type: "thinkingDeltaStart"; blockId: string }
  | { type: "thinkingDelta"; blockId: string; text: string }
  | { type: "thinkingDeltaEnd"; blockId: string }
  | { type: "toolUse"; toolUseId: string; name: string; input: Record<string, unknown> }
  | {
      type: "toolResult";
      toolUseId: string;
      isError: boolean;
      summary: string;
    }
  | {
      type: "permissionRequest";
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
      description?: string;
    }
  | { type: "turnComplete" }
  /** Stats for the turn that just finished (`result` message), mirroring what the CLI
   * shows in the terminal. `costUsd` is this turn's share, not the session's running
   * total — `SDKResultMessage.total_cost_usd` is cumulative, so the host tracks the
   * delta since the previous result. */
  | { type: "turnStats"; durationMs: number; costUsd: number; inputTokens: number; outputTokens: number }
  | { type: "agentError"; message: string }
  | { type: "modelsLoaded"; models: ModelOption[] }
  | { type: "fileMentionResults"; query: string; results: FileMentionResult[] }
  | { type: "webSearchToggled"; enabled: boolean }
  | { type: "mcpServersLoaded"; servers: McpServerStatusEntry[] }
  /** A "needs-auth" MCP server started a browser-based (OAuth-style) re-login —
   * the host already opened `url` externally by the time this arrives; shown as a
   * heads-up so the user knows to finish the login in their browser. */
  | { type: "mcpAuthUrlOpened"; serverName: string; url: string }
  /** The server confirmed the browser-based re-login above finished. Followed by a
   * fresh `mcpServersLoaded` so an open MCP servers panel reflects the new status. */
  | { type: "mcpReauthCompleted"; serverName: string }
  | { type: "agentsLoaded"; agents: AgentInfoEntry[] }
  | { type: "slashCommandsLoaded"; commands: SlashCommandEntry[] }
  | { type: "outputStylesLoaded"; styles: string[]; active?: string }
  | { type: "accountInfoLoaded"; account: AccountInfoResult }
  /** Reply to `requestUsage`. `report` is `undefined` when the probe resolved but had
   * nothing usable to show (see `UsageReportInfo`'s doc comment) — the dialog should
   * show a "not available" state, not keep spinning. */
  | { type: "usageLoaded"; report: UsageReportInfo | undefined }
  /** The "Claude Code: New Chat" command was run — mirrors what a real click on the
   * webview's own "+" button does locally (see `newChatStarted`'s reducer case), sent
   * from the host since a command has no webview interaction to dispatch that
   * optimistically from. */
  | { type: "forceNewChat" }
  /** Reply to `requestAddDirectory`, only sent when the user actually picked a folder
   * (cancelling the dialog sends nothing). `appliedImmediately: false` means a query is
   * already running for this chat — see `AgentSession.addDirectory()` — so the webview
   * shows this as a heads-up (rendered as a `contextNote`, the same as an IDE-injected
   * one) rather than claiming it's already in effect. */
  | { type: "directoryAdded"; path: string; appliedImmediately: boolean }
  | { type: "sessionRenamed"; sessionId: string; title: string }
  /** Fires once, the first time a brand-new (or forked) chat's real session id becomes
   * known — before that, `currentSessionId` in the webview is `undefined` since there's
   * nothing to resume yet. Without this, a fresh chat never learns its own id until the
   * user leaves and reopens it, which also silently drops the later `sessionRenamed`
   * (title) event since it's matched against `currentSessionId`. */
  | { type: "sessionIdAssigned"; sessionId: string }
  | { type: "workspacePathResolved"; result: FileMentionResult }
  | { type: "contextUsageLoaded"; usage: ContextUsageInfo }
  | { type: "skillsLoaded"; skills: SlashCommandEntry[] }
  /** A piece of a subagent's conversation, forwarded under the Task tool call
   * (`toolUseId`) that spawned it. */
  | { type: "subagentStep"; toolUseId: string; step: SubagentStep }
  /** Live one-line status for a running Task tool call, from the SDK's own
   * `task_progress` event — either an AI-generated summary (`agentProgressSummaries`)
   * or the task's own description. Updates the card's label while it's running. */
  | { type: "taskProgress"; toolUseId: string; summary: string }
  /** REPLACE semantics, matching the SDK's own `background_tasks_changed` event —
   * always the full current set of live background tasks, not a delta. */
  | { type: "backgroundTasksChanged"; tasks: BackgroundTaskEntry[] }
  /** At most one per turn, arrives after the turn's result. Predicted next
   * user message — piggybacks on the prompt cache, so it's near-free. */
  | { type: "promptSuggestion"; text: string }
  /** Fired the moment a message is actually handed off to the SDK's input queue —
   * immediately for a plain/steer/stopAndSend send, but only once the previously-running
   * turn finishes for a "queue" send (see `AgentSession.flushNextQueued()`). Lets the
   * webview know exactly when a message stops being "pending" (see `cancelQueuedMessage`/
   * `editQueuedMessage` below), rather than guessing from turn-boundary events. */
  | { type: "queuedMessageSent"; uuid: string }
  /** Echoes back the SDK-effective permission mode after a change that needs host-side
   * confirmation first (currently just bypassPermissions) — decoupled from the optimistic
   * local update the webview does for every other mode, so a cancelled confirmation
   * can't leave the picker showing a mode that was never actually applied. Also sent once
   * at startup/session-switch with the mode resolved from Claude Code's own
   * `permissions.defaultMode` setting (or this extension's remembered last pick, if none is
   * configured) — `bypassPermissionsDisabled` is only included on that startup send, to
   * report whether the org's `permissions.disableBypassPermissionsMode` policy blocks
   * "Full bypass" entirely. */
  | { type: "permissionModeChanged"; mode: PermissionModeId; bypassPermissionsDisabled?: boolean };

export type WebviewToHostMessage =
  | {
      type: "sendMessage";
      text: string;
      attachmentIds: string[];
      startNewChat: boolean;
      deliveryMode?: MessageDeliveryMode;
      /** Generated by the webview (not the host) specifically so the just-sent bubble
       * can carry it immediately, without waiting on a round trip — needed for the
       * "edit this message" action to later identify it. Must be a real UUID: the SDK
       * rejects a non-UUID `uuid` on `rewindFiles`/`forkSession`'s `upToMessageId` with
       * "Invalid upToMessageId" — confirmed empirically. */
      uuid: string;
    }
  | { type: "interruptSession" }
  /** Edits a past user message and regenerates from there. Mechanically a rewind (best
   * effort — restores file state to before the edited message) plus a fork (slices the
   * session to everything strictly before it — SDK-regenerated message uuids, confirmed
   * empirically, so don't try to reuse this uuid afterward) plus a normal send of
   * `newText` as the next message. The original session is left untouched, same as the
   * explicit Fork action. Text-only: an edited message's original attachments (if any)
   * aren't resent. */
  | { type: "editMessage"; uuid: string; newText: string; currentTitle?: string }
  /** Cancels a message sent with `deliveryMode: "queue"` while it's still held back
   * (i.e. before the currently-running turn finishes and it's actually handed to the
   * model) — a no-op if it's already been sent (`queuedMessageSent` already fired for
   * it). Only meaningful for "queue": "steer"/"stopAndSend" are pushed to the model
   * immediately, so there's no window to cancel them from. */
  | { type: "cancelQueuedMessage"; uuid: string }
  /** Edits the text of a still-held-back "queue" message in place — same no-op-if-
   * already-sent caveat as `cancelQueuedMessage`. Unlike `editMessage`, this never
   * forks/regenerates: the message hasn't been sent yet, so there's nothing to rewind. */
  | { type: "editQueuedMessage"; uuid: string; newText: string }
  | { type: "renameSession"; sessionId: string; cwd?: string; title: string }
  | { type: "attachFiles" }
  | { type: "attachDroppedFile"; fileName: string; base64Data: string }
  | { type: "resolveWorkspacePath"; absolutePath: string }
  | { type: "removeAttachment"; id: string }
  | {
      type: "permissionDecision";
      requestId: string;
      approve: boolean;
      /** For a tool like AskUserQuestion that reads its answer back from
       * `PermissionResult.updatedInput` (its own schema documents `answers` as
       * "collected by the permission component") — ignored for `approve: false`, and
       * for any tool that doesn't read anything back from it. */
      updatedInput?: Record<string, unknown>;
    }
  | { type: "setPermissionMode"; mode: PermissionModeId }
  /** Requests switching to bypassPermissions specifically — routed through a host-side
   * confirmation dialog (see webviewProvider.ts) rather than applied optimistically like
   * setPermissionMode, since it's a fail-open mode that skips permission checks entirely. */
  | { type: "requestBypassPermissions" }
  | { type: "setModel"; model: string }
  | { type: "setEffort"; effort: EffortLevelId }
  | { type: "requestModels" }
  | { type: "requestSessionList"; limit: number }
  | { type: "openSession"; sessionId: string; cwd: string; title: string }
  /** Sent when the webview decides a chat has gone stale — no event arrived for a
   * while despite `sending` still being true, which happens if the backing CLI
   * process died without a chance to report `agentError` (e.g. the extension host
   * itself crashed/reloaded mid-turn, taking the child process down with it). Same
   * cwd as the live session, so this just re-resumes `sessionId` from disk rather
   * than rebuilding the whole AgentSession like a cross-repo `openSession` does. */
  | { type: "reloadStaleChat"; sessionId: string; title: string }
  | { type: "requestPendingSessionOpen" }
  | { type: "newChat" }
  | { type: "deleteSession"; sessionId: string }
  | { type: "setSessionArchived"; sessionId: string; archived: boolean }
  | { type: "requestFileMentions"; query: string }
  | { type: "setWebSearchEnabled"; enabled: boolean }
  | { type: "rewindToLastUserMessage" }
  | { type: "requestMcpServers" }
  | { type: "toggleMcpServer"; name: string; enabled: boolean }
  | { type: "setMcpPermissionModeOverride"; name: string; mode: "default" | "auto" | null }
  | { type: "requestAgents" }
  | { type: "requestSlashCommands" }
  | { type: "requestSkills" }
  | { type: "reconnectMcpServer"; name: string }
  /** Additive from the caller's perspective — the host tracks previously-added dynamic
   * servers itself and always resends the full accumulated set, since the underlying
   * `setMcpServers` control request has REPLACE semantics. */
  | { type: "addMcpServer"; name: string; config: NewMcpServerConfig }
  /** Backgrounds the in-flight tool call `toolUseId` is currently blocking on (only
   * meaningful for Bash/subagent calls — a no-op, reported via a VS Code notification,
   * for anything else). */
  | { type: "backgroundTask"; toolUseId: string }
  | { type: "stopTask"; taskId: string }
  /** Continues the currently-open session's history under a new session id,
   * leaving the original untouched — "try a different approach from here"
   * without losing the original thread. */
  | { type: "forkSession" }
  | { type: "requestOutputStyles" }
  | { type: "setOutputStyle"; style: string }
  | { type: "requestAccountInfo" }
  /** Runs "/usage" as a hidden probe on the current session (see
   * `AgentSession.requestUsage()`) and replies with `usageLoaded` — never appears in the
   * visible transcript, unlike the `/compact` button, since this is meant to be a quick
   * stats peek rather than a conversation turn. */
  | { type: "requestUsage" }
  | { type: "openClaudeMd" }
  | { type: "openSettingsJson" }
  | { type: "openSettings" }
  | { type: "reloadPlugins" }
  | { type: "openExternalUrl"; url: string }
  | { type: "setThinkingEnabled"; enabled: boolean }
  | { type: "openClaudeInTerminal" }
  /** Opens (or, if one's already running for this session, focuses) an integrated
   * terminal in the session's own folder and resumes it there via `claude --resume
   * <sessionId>` — the "continue this chat outside the extension" escape hatch from
   * the Sessions list. `title` is display-only, for the terminal's tab name. */
  | { type: "resumeSessionInTerminal"; sessionId: string; cwd: string; title: string }
  | { type: "copyToClipboard"; text: string }
  /** Opens a native folder picker and, if the user picks one, grants this chat access
   * to it (`Options.additionalDirectories` — see `AgentSession.addDirectory()`). No
   * payload: the host owns the picker dialog since a webview can't show a native OS
   * file dialog itself. */
  | { type: "requestAddDirectory" };
