import type {
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUsageReport,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { randomUUID } from "node:crypto";
import { AsyncQueue } from "./asyncQueue";
import type { StagedAttachment } from "../utils/attachments";
import { HeartbeatWriter } from "./heartbeat";
import { toUsageReportInfo } from "../utils/usageReport";
import type {
  AccountInfoResult,
  AgentInfoEntry,
  BackgroundTaskEntry,
  ContextUsageInfo,
  EffortLevelId,
  HostToWebviewMessage,
  McpServerStatusEntry,
  MessageDeliveryMode,
  ModelOption,
  NewMcpServerConfig,
  PermissionModeId,
  SlashCommandEntry,
} from "../../shared/protocol";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

const WEB_TOOLS = ["WebSearch", "WebFetch"];

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
}

function summarizeToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export class AgentSession {
  private inputQueue = new AsyncQueue<SDKUserMessage>();
  private query: Query | undefined;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private permissionMode: PermissionMode = "default";
  /** True when the org's `permissions.disableBypassPermissionsMode` policy blocks Full
   * Bypass entirely — see `setPermissionDefaults()` and `webviewProvider.ts`'s
   * `resolveSettings()` call. Gates `allowDangerouslySkipPermissions` at spawn time. */
  private bypassPermissionsDisabled = false;
  private model: string | undefined;
  private resumeSessionId: string | undefined;
  private forkSession = false;
  private knownSessionId: string | undefined;
  /** Whether a title has ever been found for the current session — gates only the
   * fast startup poll (`startTitlePolling()`), not later re-checks (see the `result`
   * handler). Reset per `reset()` call — see there. */
  private titleKnown = false;
  /** The last title actually sent to the webview, so a per-turn re-check only fires
   * `sessionRenamed` when the CLI's auto-generated title genuinely changed (e.g. after
   * a topic shift mid-session) instead of re-announcing the same one every turn. */
  private lastKnownTitle: string | undefined;
  /** Polls for the auto-generated title while a fresh/forked chat's first turn is
   * still running — see `startTitlePolling()`. */
  private titlePollTimer: ReturnType<typeof setInterval> | undefined;
  private lastUserMessageUuid: string | undefined;
  private sessionCostUsd: number | undefined;
  private webSearchEnabled = false;
  private thinkingEnabled = true;
  private turnCounter = 0;
  private readonly textBlockIndices = new Set<number>();
  private readonly thinkingBlockIndices = new Set<number>();
  private dynamicMcpServers: Record<string, McpServerConfig> = {};
  private readonly heartbeat: HeartbeatWriter;
  /** Guards against a double-click spawning two concurrent probe processes — see
   * `requestUsage()`'s doc comment. */
  private usageProbeInFlight = false;
  /** `Options.additionalDirectories` — read once at `ensureStarted()`'s spawn, like
   * every other `Options` field here. Cleared on `reset()` so it's scoped to "this
   * particular chat," not silently carried into an unrelated new/resumed one. See
   * `addDirectory()`'s doc comment for why this can't be applied to an
   * already-running query. */
  private additionalDirectories: string[] = [];

  private readonly fallbackModel: string | undefined;
  private readonly maxBudgetUsd: number | undefined;
  private readonly maxTurns: number | undefined;

  constructor(
    private readonly cwd: string,
    private readonly onEvent: (event: HostToWebviewMessage) => void,
    heartbeatDir: string,
    private readonly onSessionIdKnown?: (id: string) => void,
    settings?: {
      /** From the `sessionCompanion.fallbackModel` setting; empty/undefined disables it. */
      fallbackModel?: string;
      /** From `sessionCompanion.maxBudgetUsd`; 0/undefined disables the cap. */
      maxBudgetUsd?: number;
      /** From `sessionCompanion.maxTurns`; 0/undefined disables the cap. */
      maxTurns?: number;
    }
  ) {
    this.heartbeat = new HeartbeatWriter(heartbeatDir, () => this.knownSessionId);
    this.fallbackModel = settings?.fallbackModel || undefined;
    this.maxBudgetUsd = settings?.maxBudgetUsd || undefined;
    this.maxTurns = settings?.maxTurns || undefined;
  }

  private noteSessionId(sessionId: string): void {
    if (this.knownSessionId !== sessionId) {
      this.knownSessionId = sessionId;
      this.onSessionIdKnown?.(sessionId);
      this.heartbeat.pulse();
      this.onEvent({ type: "sessionIdAssigned", sessionId });
      this.startTitlePolling();
    }
  }

  /** The CLI auto-generates a title well before a turn finishes — confirmed
   * empirically ready ~3.5s into a turn that didn't fire `result` until ~12.6s later
   * — so waiting for `result` (as `loadSessionTitle()`'s doc comment used to justify)
   * left a long tool-heavy turn stuck showing "New chat" the whole time. Poll every
   * 2s instead, starting as soon as the session id is known, and self-stop the
   * moment a title is found (or the turn ends without one). */
  private startTitlePolling(): void {
    if (this.titleKnown || this.titlePollTimer) return;
    this.titlePollTimer = setInterval(() => void this.loadSessionTitle(), 2000);
  }

  private stopTitlePolling(): void {
    if (this.titlePollTimer) {
      clearInterval(this.titlePollTimer);
      this.titlePollTimer = undefined;
    }
  }

  private async ensureStarted(): Promise<Query> {
    if (this.query) {
      return this.query;
    }
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const session = query({
      prompt: this.inputQueue,
      options: {
        cwd: this.cwd,
        permissionMode: this.permissionMode,
        // Gates *requesting* bypassPermissions at all (initially or via setPermissionMode
        // later) — confirmed empirically that the CLI throws "disabled by settings or
        // configuration" without it. Doesn't itself change behavior: the actual mode is
        // still 'default' unless the user explicitly picks Full Bypass (see ModePicker's
        // confirmation step in webviewProvider.ts's "requestBypassPermissions" handler).
        // Left false when `permissions.disableBypassPermissionsMode` (org policy) blocks
        // it — see `setPermissionDefaults()` — so a session under that policy can't even
        // request the mode, matching what the policy is meant to prevent.
        allowDangerouslySkipPermissions: !this.bypassPermissionsDisabled,
        model: this.model,
        fallbackModel: this.fallbackModel,
        maxBudgetUsd: this.maxBudgetUsd,
        maxTurns: this.maxTurns,
        resume: this.resumeSessionId,
        forkSession: this.forkSession,
        additionalDirectories: this.additionalDirectories.length > 0 ? this.additionalDirectories : undefined,
        includePartialMessages: true,
        // Needed for the Rewind action (Query.rewindFiles).
        enableFileCheckpointing: true,
        allowedTools: this.webSearchEnabled ? WEB_TOOLS : undefined,
        // `display` defaults to 'omitted' when unset — confirmed empirically (a throwaway
        // script against the real SDK) that without it, thinking_delta events always carry
        // an empty string regardless of prompt complexity or 'adaptive' vs 'enabled', so
        // every thinking block rendered as "(no visible content)". 'summarized' is what
        // actually makes the model stream real, readable thinking text.
        thinking: this.thinkingEnabled ? { type: "adaptive", display: "summarized" } : { type: "disabled" },
        // Predicted next user message, shown as a clickable chip. Piggybacks on the
        // prompt cache per the SDK's own doc comment, so it's near-free to leave on.
        promptSuggestions: true,
        // Renders subagent text/thinking as nested transcript entries under the Task
        // tool card, and enables the live "Analyzing X" progress summaries on it.
        forwardSubagentText: true,
        agentProgressSummaries: true,
        canUseTool: async (toolName, input, opts) => {
          return new Promise<PermissionResult>((resolve) => {
            this.pendingPermissions.set(opts.toolUseID, { resolve });
            this.onEvent({
              type: "permissionRequest",
              requestId: opts.toolUseID,
              toolName,
              input,
              title: opts.title,
              description: opts.description,
            });
          });
        },
        // Without this, every MCP elicitation (including a "needs-auth" server's
        // OAuth re-login) is auto-declined per the SDK's own fail-closed default —
        // confirmed as the actual cause of a real user report: sending "/mcp" as a
        // literal message can't drive the CLI's interactive re-auth UI (no TTY in an
        // SDK-hosted session), and until now nothing else in this codebase answered
        // the elicitation either, so a server stuck in "needs-auth" had no path back.
        // 'url' mode is the OAuth-style browser flow — open it host-side and accept;
        // completion arrives later as a `system`/`elicitation_complete` message (see
        // `handleMessage`). 'form' mode (arbitrary structured input) has no UI here
        // yet, so decline it explicitly — same net behavior as before for that case.
        onElicitation: async (request) => {
          if (request.mode === "url" && request.url) {
            this.onEvent({ type: "mcpAuthUrlOpened", serverName: request.serverName, url: request.url });
            return { action: "accept" };
          }
          return { action: "decline" };
        },
      },
    });
    this.query = session;
    void this.consume(session);
    // Populate the context-usage gauge as soon as a live Query exists, rather than only
    // after a turn completes — this is what makes it show up right away for a resumed
    // past session (which already has real conversation history) instead of only after
    // the user sends a new message.
    void this.loadContextUsage();
    return session;
  }

  /** Pre-warms a live Query immediately after a session becomes current (new chat or a
   * resumed one), instead of waiting for the user's first message, so the context-usage
   * gauge has something to show right away. */
  async warmStart(): Promise<void> {
    await this.ensureStarted();
  }

  private async consume(session: Query): Promise<void> {
    try {
      for await (const message of session) {
        this.handleMessage(message);
      }
    } catch (err) {
      void this.heartbeat.stop();
      const messageText = err instanceof Error ? err.message : String(err);
      this.onEvent({ type: "agentError", message: messageText });
    }
  }

  private blockId(index: number): string {
    return `${this.turnCounter}-${index}`;
  }

  private handleMessage(message: SDKMessage): void {
    if (message.type === "stream_event" && message.parent_tool_use_id) {
      // A subagent's own partial stream (forwardSubagentText can, in principle, surface
      // these too) would otherwise reuse the same per-index blockId scheme as the main
      // thread's — a real collision risk if a backgrounded subagent streams concurrently
      // with the main turn. Subagent content is rendered from the complete (non-partial)
      // assistant/user messages below instead, so partials for one are simply ignored.
      return;
    }
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "message_start") {
        this.turnCounter += 1;
        this.textBlockIndices.clear();
        this.thinkingBlockIndices.clear();
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "text") {
          this.textBlockIndices.add(event.index);
          this.onEvent({ type: "textDeltaStart", blockId: this.blockId(event.index) });
        } else if (event.content_block.type === "thinking") {
          this.thinkingBlockIndices.add(event.index);
          this.onEvent({ type: "thinkingDeltaStart", blockId: this.blockId(event.index) });
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta" && this.textBlockIndices.has(event.index)) {
          this.onEvent({ type: "textDelta", blockId: this.blockId(event.index), text: event.delta.text });
        } else if (event.delta.type === "thinking_delta" && this.thinkingBlockIndices.has(event.index)) {
          this.onEvent({ type: "thinkingDelta", blockId: this.blockId(event.index), text: event.delta.thinking });
        }
      } else if (event.type === "content_block_stop") {
        if (this.textBlockIndices.has(event.index)) {
          this.onEvent({ type: "textDeltaEnd", blockId: this.blockId(event.index) });
        } else if (this.thinkingBlockIndices.has(event.index)) {
          this.onEvent({ type: "thinkingDeltaEnd", blockId: this.blockId(event.index) });
        }
      }
    } else if (message.type === "assistant") {
      this.noteSessionId(message.session_id);
      if (message.parent_tool_use_id) {
        // A subagent's own content, forwarded under the Task tool call that spawned it —
        // rendered as flat nested lines under that card rather than a normal top-level
        // toolUse/text item, so its blocks don't also (mis)appear at the top level.
        for (const block of message.message.content) {
          if (block.type === "text") {
            this.onEvent({
              type: "subagentStep",
              toolUseId: message.parent_tool_use_id,
              step: { kind: "text", text: block.text },
            });
          } else if (block.type === "thinking") {
            this.onEvent({
              type: "subagentStep",
              toolUseId: message.parent_tool_use_id,
              step: { kind: "thinking", text: block.thinking },
            });
          } else if (block.type === "tool_use") {
            this.onEvent({
              type: "subagentStep",
              toolUseId: message.parent_tool_use_id,
              step: { kind: "toolUse", name: block.name, input: (block.input ?? {}) as Record<string, unknown> },
            });
          }
        }
        return;
      }
      if (message.user_message_uuid) {
        this.lastUserMessageUuid = message.user_message_uuid;
      }
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          this.onEvent({
            type: "toolUse",
            toolUseId: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
    } else if (message.type === "user") {
      // Subagent-forwarded tool_result frames (parent_tool_use_id set) are skipped: their
      // tool_use_id never matches a top-level card (subagent tool calls render as flat
      // nested lines, not cards — see the "assistant" branch above), so there's nothing
      // useful to attach them to.
      if (message.parent_tool_use_id) {
        return;
      }
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && "type" in block && block.type === "tool_result") {
            const toolResult = block as {
              tool_use_id: string;
              content?: unknown;
              is_error?: boolean;
            };
            this.onEvent({
              type: "toolResult",
              toolUseId: toolResult.tool_use_id,
              isError: Boolean(toolResult.is_error),
              summary: summarizeToolResultContent(toolResult.content),
            });
          }
        }
      }
    } else if (
      message.type === "system" &&
      message.subtype === "task_progress" &&
      message.tool_use_id &&
      (message.summary || message.description)
    ) {
      this.onEvent({
        type: "taskProgress",
        toolUseId: message.tool_use_id,
        summary: message.summary ?? message.description,
      });
    } else if (message.type === "system" && message.subtype === "background_tasks_changed") {
      const tasks: BackgroundTaskEntry[] = message.tasks
        .filter((t) => !t.ambient)
        .map((t) => ({ taskId: t.task_id, taskType: t.task_type, description: t.description }));
      this.onEvent({ type: "backgroundTasksChanged", tasks });
    } else if (message.type === "system" && message.subtype === "elicitation_complete") {
      this.onEvent({ type: "mcpReauthCompleted", serverName: message.mcp_server_name });
      // Best-effort refresh so an already-open MCP servers panel flips out of
      // "needs-auth" without the user having to close/reopen it.
      void this.listMcpServers()
        .then((servers) => this.onEvent({ type: "mcpServersLoaded", servers }))
        .catch(() => {});
    } else if (message.type === "result") {
      this.noteSessionId(message.session_id);
      void this.heartbeat.stop();
      // total_cost_usd is cumulative for the session, not per-turn (confirmed
      // empirically — it keeps growing across results) — diff against the previous
      // known total to get this turn's own share for display.
      const previousCost = this.sessionCostUsd ?? 0;
      this.sessionCostUsd = message.total_cost_usd;
      this.onEvent({
        type: "turnStats",
        durationMs: message.duration_ms,
        costUsd: Math.max(0, message.total_cost_usd - previousCost),
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      });
      if (message.subtype === "error_max_budget_usd") {
        this.onEvent({
          type: "agentError",
          message: `Stopped: this chat's cost (~$${message.total_cost_usd.toFixed(2)}) reached the configured budget cap. Raise or clear sessionCompanion.maxBudgetUsd to continue.`,
        });
      } else if (message.subtype === "error_max_turns") {
        this.onEvent({
          type: "agentError",
          message: `Stopped: this chat reached the configured turn limit (${message.num_turns} turns). Raise or clear sessionCompanion.maxTurns to continue.`,
        });
      }
      this.onEvent({ type: "turnComplete" });
      void this.loadContextUsage();
      // Re-checked every turn, not just until the first title is found — locking it
      // in after one successful fetch left a long session's title stale forever if
      // the CLI later regenerated it (e.g. after an early topic shift). Cheap (one
      // getSessionInfo() call) and `loadSessionTitle()` itself only emits an event
      // when the title actually changed.
      void this.loadSessionTitle().finally(() => this.stopTitlePolling());
    } else if (message.type === "prompt_suggestion") {
      this.onEvent({ type: "promptSuggestion", text: message.suggestion });
    }
  }

  /** Fetches the CLI's current auto-generated (or user-set) title and, if it differs
   * from the last one sent to the webview, announces it via `sessionRenamed`. Called
   * both by the fast startup poll and once per completed turn thereafter — cheap and
   * idempotent, so re-running it every turn just no-ops once the title stabilizes.
   * Best-effort, like `loadContextUsage()` below: a chat still works fine without a
   * title update. */
  private async loadSessionTitle(): Promise<void> {
    if (!this.knownSessionId) return;
    try {
      const { getSessionInfo } = await import("@anthropic-ai/claude-agent-sdk");
      const info = await getSessionInfo(this.knownSessionId, { dir: this.cwd });
      if (info?.summary) {
        this.titleKnown = true;
        this.stopTitlePolling();
        if (info.summary !== this.lastKnownTitle) {
          this.lastKnownTitle = info.summary;
          this.onEvent({ type: "sessionRenamed", sessionId: this.knownSessionId, title: info.summary });
        }
      }
    } catch {
      // best-effort
    }
  }

  /** Context usage is a nice-to-have indicator, not core functionality, so failures
   * (e.g. no live query yet) are swallowed rather than surfaced as agentError. */
  async loadContextUsage(): Promise<void> {
    if (!this.query) return;
    try {
      const usage = await this.query.getContextUsage({ detail: "full" });
      const info: ContextUsageInfo = {
        categories: usage.categories.map((c) => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
        totalTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        costUsd: this.sessionCostUsd,
      };
      this.onEvent({ type: "contextUsageLoaded", usage: info });
    } catch {
      // best-effort
    }
  }

  /** Runs "/usage" as a one-off, fully separate probe — the SDK only exposes org
   * spend-limit/rate-limit data (`SDKUsageReport`) as a field on the synthetic
   * assistant message that answers a literal "/usage" send; there's no dedicated
   * `Query` method for it (unlike `getContextUsage()`), confirmed against the SDK's
   * own `Query` interface.
   *
   * This deliberately does **not** reuse `this.query`/`this.inputQueue` (an earlier
   * version did, to avoid spawning an extra session file) — reusing the live session
   * means a probe fired from the Sessions screen, with no chat open yet, creates a
   * brand-new session whose auto-derived title is literally "/usage" and immediately
   * shows up in the cross-repo Sessions list (confirmed by a real user report: exactly
   * this happened). A separate `query()` call here still creates a session file of its
   * own, but since nothing else about it matters afterward, it's deleted once the probe
   * has its answer — `deleteSession()` best-effort, since failing to clean up a
   * scratch session shouldn't fail the whole probe. */
  async requestUsage(): Promise<void> {
    if (this.usageProbeInFlight) return;
    this.usageProbeInFlight = true;
    try {
      const { query, deleteSession } = await import("@anthropic-ai/claude-agent-sdk");
      async function* probePrompt(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: "user",
          message: { role: "user", content: "/usage" },
          parent_tool_use_id: null,
          uuid: randomUUID(),
        } as SDKUserMessage;
      }
      const probe = query({ prompt: probePrompt(), options: { cwd: this.cwd } });
      let probeSessionId: string | undefined;
      let report: SDKUsageReport | undefined;
      let detailsMarkdown = "";
      for await (const message of probe) {
        if ("session_id" in message && typeof message.session_id === "string") {
          probeSessionId = message.session_id;
        }
        if (message.type === "assistant" && !message.parent_tool_use_id) {
          const withReport = message as unknown as {
            usage_report?: SDKUsageReport;
            message: { content: Array<{ type: string; text?: string }> };
          };
          report = withReport.usage_report;
          detailsMarkdown = withReport.message.content
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text as string)
            .join("\n");
        } else if (message.type === "result") {
          break;
        }
      }
      probe.close();
      if (probeSessionId) {
        await deleteSession(probeSessionId).catch(() => {
          // best-effort — a leftover scratch session is a minor annoyance, not worth
          // failing the probe over.
        });
      }
      this.onEvent({ type: "usageLoaded", report: report ? toUsageReportInfo(report, detailsMarkdown) : undefined });
    } finally {
      this.usageProbeInFlight = false;
    }
  }

  /** Grants this chat access to a folder outside its own `cwd` (`Options.
   * additionalDirectories`). There's no live control-request equivalent to add one to
   * an *already-running* query — the closest thing, `register_repo_root`, only
   * accepts a strict subdirectory of an existing root (confirmed from its own doc
   * comment), not an arbitrary sibling folder, and isn't even exposed as a public
   * `Query` method anyway. So this only takes effect at the *next* `ensureStarted()` —
   * returns `false` when a query is already running for this chat, so the caller can
   * tell the user it'll apply starting with their next new chat instead of silently
   * doing nothing. */
  addDirectory(dir: string): boolean {
    if (!this.additionalDirectories.includes(dir)) {
      this.additionalDirectories.push(dir);
    }
    return !this.query;
  }

  /** Maps our delivery modes onto the SDK's undocumented (but verified) `priority`
   * field: 'later' defers the message to run as its own turn once the current one
   * fully finishes ("Add to Queue"), 'now' folds it into the currently-running turn
   * ("Steer with Message"). "stopAndSend" aborts the current turn first, then sends
   * normally — no priority needed since nothing is running by the time it's pushed. */
  private static priorityFor(deliveryMode: MessageDeliveryMode | undefined): "now" | "later" | undefined {
    if (deliveryMode === "queue") return "later";
    if (deliveryMode === "steer") return "now";
    return undefined;
  }

  async sendMessage(
    text: string,
    attachments: StagedAttachment[] = [],
    deliveryMode?: MessageDeliveryMode,
    /** The webview generates this itself (so the just-sent bubble can carry it
     * immediately, for the "edit this message" action) and passes it through — see
     * `WebviewToHostMessage`'s `sendMessage.uuid` doc comment. Falls back to
     * generating one here for other internal callers (there are none today, but
     * nothing should require every caller to supply one). */
    uuid: string = randomUUID()
  ): Promise<void> {
    await this.ensureStarted();
    this.heartbeat.start();
    if (deliveryMode === "stopAndSend") {
      await this.interrupt();
    }
    // The SDK only echoes `user_message_uuid` (needed for rewindFiles) back on the
    // assistant reply when the sent message itself carries a `uuid` — undocumented
    // in SDKUserMessage's public type but confirmed to work at runtime.
    this.lastUserMessageUuid = uuid;
    const priority = AgentSession.priorityFor(deliveryMode);
    if (attachments.length === 0) {
      this.inputQueue.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        uuid,
        priority,
      } as SDKUserMessage);
      return;
    }
    // Images before text performs better per platform.claude.com/docs/en/build-with-claude/vision.
    const content: MessageParam["content"] = [];
    for (const attachment of attachments) {
      if (attachment.kind === "image") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: attachment.mediaType, data: attachment.base64Data },
        });
      } else {
        content.push({
          type: "text",
          text: `Attached file: ${attachment.fileName}\n\`\`\`\n${attachment.textContent}\n\`\`\``,
        });
      }
    }
    content.push({ type: "text", text });
    this.inputQueue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid,
      priority,
    } as SDKUserMessage);
  }

  async interrupt(): Promise<void> {
    if (this.query) {
      await this.query.interrupt();
    }
  }

  resolvePermission(requestId: string, approve: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingPermissions.delete(requestId);
    pending.resolve(
      approve ? { behavior: "allow" } : { behavior: "deny", message: "User denied permission." }
    );
  }

  async setPermissionMode(mode: PermissionModeId): Promise<void> {
    this.permissionMode = mode;
    if (this.query) {
      await this.query.setPermissionMode(mode);
    }
  }

  /** Applies the mode/bypass-eligibility resolved from Claude Code's own settings
   * (`webviewProvider.ts`'s `resolveSettings()` call) — called once right after
   * construction, before the user has necessarily sent anything. Reuses
   * `setPermissionMode()` so it still takes effect correctly on the rare case where the
   * CLI process already started (e.g. a fast warmStart()) by the time settings resolve. */
  async setPermissionDefaults(mode: PermissionModeId, bypassPermissionsDisabled: boolean): Promise<void> {
    this.bypassPermissionsDisabled = bypassPermissionsDisabled;
    await this.setPermissionMode(mode);
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    if (this.query) {
      await this.query.setModel(model);
    }
  }

  async setEffort(effort: EffortLevelId): Promise<void> {
    const session = await this.ensureStarted();
    await session.applyFlagSettings({ effortLevel: effort });
  }

  async loadModels(): Promise<ModelOption[]> {
    const session = await this.ensureStarted();
    const models = await session.supportedModels();
    const options: ModelOption[] = models.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      supportsEffort: Boolean(m.supportsEffort),
      supportedEffortLevels: (m.supportedEffortLevels ?? []) as EffortLevelId[],
    }));
    this.onEvent({ type: "modelsLoaded", models: options });
    return options;
  }

  /** Toggles the WebSearch/WebFetch tools on for future turns. Only takes effect on the
   * next fresh session (streaming-input mode has no live "add a tool" control), so this
   * resets the current conversation, same as switching sessions. */
  setWebSearchEnabled(enabled: boolean): void {
    this.webSearchEnabled = enabled;
  }

  /** Only takes effect on the next fresh session, same caveat as setWebSearchEnabled. */
  setThinkingEnabled(enabled: boolean): void {
    this.thinkingEnabled = enabled;
  }

  async rewindToLastUserMessage(): Promise<{ canRewind: boolean; error?: string }> {
    if (!this.query || !this.lastUserMessageUuid) {
      return { canRewind: false, error: "Nothing to rewind yet." };
    }
    const result = await this.query.rewindFiles(this.lastUserMessageUuid);
    return { canRewind: result.canRewind, error: result.error };
  }

  /** Generalizes `rewindToLastUserMessage` to any past message uuid, for the "edit a
   * message" flow — restores file state to before it, prior to forking the
   * conversation away from everything after it. Must be called on the ORIGINAL
   * session's live query, before `reset()` swaps to the forked one. */
  async rewindToMessage(uuid: string): Promise<{ canRewind: boolean; error?: string }> {
    if (!this.query) {
      return { canRewind: false, error: "Nothing to rewind yet." };
    }
    const result = await this.query.rewindFiles(uuid);
    return { canRewind: result.canRewind, error: result.error };
  }

  async listMcpServers(): Promise<McpServerStatusEntry[]> {
    const session = await this.ensureStarted();
    const statuses = await session.mcpServerStatus();
    return statuses.map((s) => ({
      name: s.name,
      status: s.status,
      enabled: s.status !== "failed",
    }));
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    const session = await this.ensureStarted();
    await session.toggleMcpServer(name, enabled);
  }

  /** Tighten-only per-MCP-server permission override: only takes effect when the
   * session mode would already auto-allow, so it can never widen privilege. */
  async setMcpPermissionModeOverride(
    name: string,
    mode: "default" | "auto" | null
  ): Promise<{ warning?: string }> {
    const session = await this.ensureStarted();
    return session.setMcpPermissionModeOverride(name, mode);
  }

  async listAgents(): Promise<AgentInfoEntry[]> {
    const session = await this.ensureStarted();
    const agents = await session.supportedAgents();
    return agents.map((a) => ({ name: a.name, description: a.description }));
  }

  async listSlashCommands(): Promise<SlashCommandEntry[]> {
    const session = await this.ensureStarted();
    const commands = await session.supportedCommands();
    return commands.map((c) => ({ name: c.name, description: c.description }));
  }

  async listSkills(): Promise<SlashCommandEntry[]> {
    const session = await this.ensureStarted();
    const { skills } = await session.reloadSkills();
    return skills.map((s) => ({ name: s.name, description: s.description }));
  }

  async reconnectMcpServer(name: string): Promise<void> {
    const session = await this.ensureStarted();
    await session.reconnectMcpServer(name);
  }

  /** setMcpServers has REPLACE semantics for the dynamic server set, so adding a second
   * server without resending the first would silently drop it — the accumulated map is
   * kept here and resent in full on every call. */
  async addMcpServer(name: string, config: NewMcpServerConfig): Promise<{ added: string[]; errors: Record<string, string> }> {
    const session = await this.ensureStarted();
    this.dynamicMcpServers = { ...this.dynamicMcpServers, [name]: config as McpServerConfig };
    const result = await session.setMcpServers(this.dynamicMcpServers);
    return { added: result.added, errors: result.errors };
  }

  /** Backgrounds the in-flight tool call blocking on `toolUseId` (Bash/subagent only —
   * returns false for anything else, per the SDK's own contract). */
  async backgroundTask(toolUseId: string): Promise<boolean> {
    const session = await this.ensureStarted();
    return session.backgroundTasks(toolUseId);
  }

  async stopTask(taskId: string): Promise<void> {
    const session = await this.ensureStarted();
    await session.stopTask(taskId);
  }

  async listOutputStyles(): Promise<string[]> {
    const session = await this.ensureStarted();
    const result = await session.reloadOutputStyles();
    return result.available_output_styles;
  }

  async setOutputStyle(style: string): Promise<void> {
    const session = await this.ensureStarted();
    await session.updateSettings("localSettings", { outputStyle: style });
  }

  async getAccountInfo(): Promise<AccountInfoResult> {
    const session = await this.ensureStarted();
    const info = await session.accountInfo();
    return { email: info.email, organization: info.organization };
  }

  async reloadPlugins(): Promise<void> {
    const session = await this.ensureStarted();
    await session.reloadPlugins();
  }

  /** The current live/resumed session's real id, once known (undefined for a brand-new,
   * not-yet-sent chat, or right after a fork before the new id has come back). */
  getSessionId(): string | undefined {
    return this.knownSessionId;
  }

  /** Stops the current live conversation and starts a fresh one, optionally resuming a
   * past session. With `fork: true`, the resumed history continues under a brand-new
   * session id instead of the original — the original session's file is left untouched. */
  reset(resumeSessionId?: string, options?: { fork?: boolean; titleKnown?: boolean }): void {
    this.stopCurrent();
    this.inputQueue = new AsyncQueue<SDKUserMessage>();
    this.resumeSessionId = resumeSessionId;
    this.forkSession = Boolean(options?.fork);
    // A fork's real session id differs from the one it resumed from and isn't known
    // until the SDK reports it on the first message/result — don't seed it with the
    // old id, or heartbeat/read-state bookkeeping would target the wrong session.
    this.knownSessionId = this.forkSession ? undefined : resumeSessionId;
    // A resumed (non-forked) session already has a title, passed in when it was opened
    // from the Sessions list — skip only the fast startup poll for it (still gets the
    // normal once-per-turn re-check below, same as any other session). A brand-new
    // chat or a fork's new id has no title yet, so it does want the fast poll.
    // `options.titleKnown` overrides this for a resumed id that's actually brand new
    // to the webview — the standalone `forkSession()` used by the "edit message" flow
    // (distinct from the `fork` option above, which is `Options.forkSession` on a live
    // resume) produces a real, already-existing session id that nonetheless has no
    // title yet.
    this.titleKnown = options?.titleKnown ?? (Boolean(resumeSessionId) && !this.forkSession);
    this.lastKnownTitle = undefined;
    this.lastUserMessageUuid = undefined;
    this.sessionCostUsd = undefined;
    this.additionalDirectories = [];
  }

  dispose(): void {
    this.stopCurrent();
  }

  private stopCurrent(): void {
    this.inputQueue.close();
    void this.query?.return?.(undefined);
    void this.heartbeat.stop();
    this.stopTitlePolling();
    this.query = undefined;
    this.pendingPermissions.clear();
    this.turnCounter = 0;
    this.textBlockIndices.clear();
    this.thinkingBlockIndices.clear();
    // Dynamically-added MCP servers are tied to the Query connection they were added
    // to — a fresh query() call needs them re-added; not carried over automatically.
    this.dynamicMcpServers = {};
  }
}
