import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { AgentSession } from "../session/agentSession";
import { AttachmentStore } from "../utils/attachments";
import { buildReplayItems, lastMessageTimestamp } from "../utils/sessionHistory";
import { repoNameFromCwd } from "../utils/repoName";
import { isSessionActive } from "../session/heartbeat";
import { ReadState } from "../state/readState";
import { ArchiveState } from "../state/archiveState";
import { PendingSessionOpenState } from "../state/pendingSessionOpen";
import { LastActivityOverride } from "../state/lastActivityOverride";
import { PermissionModeState } from "../state/permissionModeState";
import { searchWorkspaceFiles } from "../utils/fileMentions";
import { isPathExcluded } from "../utils/excludedFolders";
import { isOpenWorkspaceFolder } from "../utils/workspaceFolders";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../../shared/protocol";

const EXTENSION_CONFIG_SECTION = "sessionCompanion";

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "sessionCompanion.chat";

  private session: AgentSession | undefined;
  private webviewView: vscode.WebviewView | undefined;
  private readonly heartbeatDir: string;
  private readonly readState: ReadState;
  private readonly archiveState: ArchiveState;
  private readonly pendingSessionOpen: PendingSessionOpenState;
  private readonly lastActivityOverride: LastActivityOverride;
  private readonly permissionModeState: PermissionModeState;
  // Keyed by session id so re-clicking "Resume in Terminal" for an already-open
  // resume focuses the existing terminal instead of spawning a duplicate `claude
  // --resume` process for the same session.
  private readonly resumeTerminals = new Map<string, vscode.Terminal>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.heartbeatDir = path.join(context.globalStorageUri.fsPath, "active-sessions");
    this.readState = new ReadState(context);
    this.archiveState = new ArchiveState(context);
    this.pendingSessionOpen = new PendingSessionOpenState(context);
    this.lastActivityOverride = new LastActivityOverride(context);
    this.permissionModeState = new PermissionModeState(context);
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [sessionId, terminal] of this.resumeTerminals) {
          if (terminal === closed) {
            this.resumeTerminals.delete(sessionId);
            break;
          }
        }
      })
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const extensionUri = this.context.extensionUri;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview")],
    };
    this.webviewView = webviewView;
    webviewView.onDidDispose(() => {
      if (this.webviewView === webviewView) {
        this.webviewView = undefined;
      }
    });

    const extensionConfig = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);

    // Holds a session that was still generating a response when the webview's focus
    // switched away from it (see `ensureFocusSession`) — kept alive to finish naturally
    // instead of being killed mid-turn, and disposed once its own `turnComplete`/
    // `agentError` fires (see `buildSession`'s event callback below). Also disposed
    // wholesale if the webview itself closes first (see `onDidDispose`).
    const backgroundedSessions = new Set<AgentSession>();

    // Factored out so `openSession`/`ensureFocusSession` can rebuild the live session
    // pointed at a different folder — one already open in this same multi-root
    // workspace — instead of always treating "not the current cwd" as "spawn a whole
    // new window".
    const buildSession = (forCwd: string): AgentSession => {
      const agent: AgentSession = new AgentSession(
        forCwd,
        (event) => {
          if (agent !== session) {
            // Superseded by a focus switch — if it's here because it was still busy
            // (see `ensureFocusSession`), let it finish naturally and clean itself up
            // once its turn ends, rather than leaking its events into whichever
            // session the webview is actually showing right now.
            if (event.type === "turnComplete" || event.type === "agentError") {
              backgroundedSessions.delete(agent);
              agent.dispose();
            }
            return;
          }
          this.post(webviewView.webview, event);
          this.notifyIfBackgrounded(webviewView, event);
          if (event.type === "mcpAuthUrlOpened") {
            void vscode.env.openExternal(vscode.Uri.parse(event.url));
          }
        },
        this.heartbeatDir,
        (sessionId) => void this.readState.markViewed(sessionId),
        {
          fallbackModel: extensionConfig.get<string>("fallbackModel", ""),
          maxBudgetUsd: extensionConfig.get<number>("maxBudgetUsd", 0),
          maxTurns: extensionConfig.get<number>("maxTurns", 0),
        }
      );
      return agent;
    };

    let cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let session = buildSession(cwd);
    const attachmentStore = new AttachmentStore();
    this.session = session;

    /** Returns the AgentSession the webview should now focus/drive for `forCwd` —
     * reuses `session` in place when it's idle (cheap, no extra process), but when it's
     * still generating a response, leaves it completely alone to finish in the
     * background (see `backgroundedSessions` above) and hands back a fresh instance
     * instead of killing it. This is the fix for a real bug report: navigating
     * back-and-forth between two chats that were both actively responding used to cut
     * one of them off, because switching focus unconditionally reset()/disposed()
     * whatever was currently live. */
    const ensureFocusSession = (forCwd: string): AgentSession => {
      const busy = session.isBusy();
      if (!busy && forCwd === cwd) {
        return session;
      }
      if (busy) {
        backgroundedSessions.add(session);
      } else {
        session.dispose();
      }
      cwd = forCwd;
      session = buildSession(cwd);
      this.session = session;
      void applyPermissionDefaults(session, cwd);
      return session;
    };
    // Read from `requestBypassPermissions`'s guard below — kept in sync with whatever
    // `applyPermissionDefaults` most recently resolved for the *current* `session`.
    let bypassPermissionsDisabled = false;

    // Resolves Claude Code's own `permissions.defaultMode`/`disableBypassPermissionsMode`
    // (~/.claude/settings.json, a project .claude/settings.json, or a managed/MDM policy)
    // so a brand-new or resumed session actually starts in the mode the user already
    // configured there (e.g. "auto"), instead of always hardcoding "default". Falls back to
    // this extension's own remembered last pick when nothing configures a default mode.
    // Async and fire-and-forget: `ensureStarted()` doesn't run until the user's first
    // message/warmStart, so this has ample time to land first; `setPermissionDefaults()`
    // still applies correctly even if it doesn't (see its doc comment).
    const applyPermissionDefaults = async (forSession: AgentSession, forCwd: string): Promise<void> => {
      const { resolveSettings, filterEscalatingDefaultMode } = await import("@anthropic-ai/claude-agent-sdk");
      const resolved = await resolveSettings({ cwd: forCwd });
      const filtered = filterEscalatingDefaultMode(resolved);
      const disabled = filtered.permissions?.disableBypassPermissionsMode === "disable";
      const configuredMode = filtered.permissions?.defaultMode;
      const mode = configuredMode ?? this.permissionModeState.get() ?? "default";
      if (forSession !== session) {
        return; // stale — the user switched folders again before this resolved
      }
      bypassPermissionsDisabled = disabled;
      await forSession.setPermissionDefaults(mode, disabled);
      this.post(webviewView.webview, { type: "permissionModeChanged", mode, bypassPermissionsDisabled: disabled });
    };
    void applyPermissionDefaults(session, cwd);

    // Posts the replay for a session that's already been reset() onto whichever
    // AgentSession is now current — split out from `openSessionInline` so
    // `reloadStaleChat` can force a hard reset on the CURRENT session (bypassing
    // `ensureFocusSession`'s busy-check on purpose — see that case below) while still
    // sharing this replay logic.
    const postSessionReplay = async (sessionId: string, title: string) => {
      const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
      const history = await getSessionMessages(sessionId, { dir: cwd });
      // Snapshot the real last-activity time from the (system-message-free) history
      // before warmStart() below resumes the session — resuming makes the CLI append
      // its own hook bookkeeping to the file, which would otherwise make merely
      // opening a session (never sending anything) bump it to "just now" in the list.
      const lastActivity = lastMessageTimestamp(history);
      if (lastActivity !== undefined) {
        await this.lastActivityOverride.set(sessionId, lastActivity);
      }
      await this.readState.markViewed(sessionId);
      this.post(webviewView.webview, {
        type: "sessionOpened",
        sessionId,
        title,
        replay: buildReplayItems(history),
      });
      // Fire-and-forget: this resumed session already has real history, so the context
      // gauge should have something to show without waiting for a new message.
      void session.warmStart();
    };

    const openSessionInline = async (sessionId: string, title: string, forCwd: string = cwd) => {
      session = ensureFocusSession(forCwd);
      session.reset(sessionId);
      await postSessionReplay(sessionId, title);
    };

    webviewView.onDidDispose(() => {
      session.dispose();
      for (const backgrounded of backgroundedSessions) {
        backgrounded.dispose();
      }
      backgroundedSessions.clear();
      if (this.session === session) {
        this.session = undefined;
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      try {
        switch (message.type) {
          case "sendMessage": {
            if (message.startNewChat) {
              session = ensureFocusSession(cwd);
              session.reset();
            }
            await session.sendMessage(
              message.text,
              attachmentStore.take(message.attachmentIds),
              message.deliveryMode,
              message.uuid
            );
            // A real message just went through, so the file's mtime now genuinely
            // reflects new content — stop overriding it (see openSessionInline above).
            const sentToSessionId = session.getSessionId();
            if (sentToSessionId) {
              await this.lastActivityOverride.clear(sentToSessionId);
            }
            break;
          }
          case "interruptSession":
            await session.interrupt();
            break;
          case "cancelQueuedMessage":
            session.cancelQueuedMessage(message.uuid);
            break;
          case "editQueuedMessage":
            session.editQueuedMessage(message.uuid, message.newText);
            break;
          case "renameSession": {
            const { renameSession } = await import("@anthropic-ai/claude-agent-sdk");
            await renameSession(message.sessionId, message.title, { dir: message.cwd ?? cwd });
            this.post(webviewView.webview, {
              type: "sessionRenamed",
              sessionId: message.sessionId,
              title: message.title,
            });
            break;
          }
          case "attachFiles": {
            const result = await attachmentStore.pickAndStage();
            if ("error" in result) {
              this.post(webviewView.webview, { type: "attachmentError", message: result.error });
            } else {
              this.post(webviewView.webview, { type: "attachmentAdded", attachment: result.summary });
            }
            break;
          }
          case "attachDroppedFile": {
            const result = attachmentStore.stageFromBase64(message.fileName, message.base64Data);
            if ("error" in result) {
              this.post(webviewView.webview, { type: "attachmentError", message: result.error });
            } else {
              this.post(webviewView.webview, { type: "attachmentAdded", attachment: result.summary });
            }
            break;
          }
          case "resolveWorkspacePath": {
            // Relative to the current chat's cwd, not the dropped file's own folder —
            // same reasoning as searchWorkspaceFiles() (see fileMentions.ts): a file
            // dragged in from a different multi-root workspace folder than `cwd` needs
            // a path that still resolves correctly once inserted as "@relativePath".
            const relativePath = path.relative(cwd, message.absolutePath);
            const ownFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(message.absolutePath));
            const openFolders = vscode.workspace.workspaceFolders ?? [];
            this.post(webviewView.webview, {
              type: "workspacePathResolved",
              result: {
                relativePath,
                absolutePath: message.absolutePath,
                repoName: openFolders.length > 1 ? ownFolder?.name : undefined,
              },
            });
            break;
          }
          case "removeAttachment":
            attachmentStore.remove(message.id);
            break;
          case "permissionDecision":
            session.resolvePermission(message.requestId, message.approve, message.updatedInput);
            break;
          case "setPermissionMode":
            await session.setPermissionMode(message.mode);
            await this.permissionModeState.set(message.mode);
            break;
          case "requestBypassPermissions": {
            if (bypassPermissionsDisabled) {
              await vscode.window.showErrorMessage(
                "Full bypass is disabled by your organization's Claude Code settings (permissions.disableBypassPermissionsMode)."
              );
              break;
            }
            const confirmed = await vscode.window.showWarningMessage(
              "Bypass all permission checks for this chat? Claude will run tools — including edits and shell commands — without asking, until you switch modes again.",
              { modal: true },
              "Enable Bypass"
            );
            if (confirmed === "Enable Bypass") {
              await session.setPermissionMode("bypassPermissions");
              await this.permissionModeState.set("bypassPermissions");
              this.post(webviewView.webview, { type: "permissionModeChanged", mode: "bypassPermissions" });
            }
            break;
          }
          case "setModel":
            await session.setModel(message.model);
            break;
          case "setEffort":
            await session.setEffort(message.effort);
            break;
          case "requestModels":
            await session.loadModels();
            break;
          case "requestSessionList": {
            const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
            const excludedFolders = vscode.workspace
              .getConfiguration(EXTENSION_CONFIG_SECTION)
              .get<string[]>("excludedFolders", ["/tmp"]);
            // Fetch one extra so we can tell "exactly `limit` sessions exist" apart
            // from "there's at least one more page" without a separate count call.
            const raw = await listSessions({ limit: message.limit + 1 });
            const hasMore = raw.length > message.limit;
            const sessions = raw
              .slice(0, message.limit)
              .filter((s) => !isPathExcluded(s.cwd ?? cwd, excludedFolders));
            const entries = await Promise.all(
              sessions.map(async (s) => {
                // Prefer the real-last-activity override over the SDK's raw
                // lastModified — see openSessionInline/LastActivityOverride.
                const lastModified = this.lastActivityOverride.get(s.sessionId) ?? s.lastModified;
                return {
                  sessionId: s.sessionId,
                  title: s.summary,
                  repoName: repoNameFromCwd(s.cwd ?? cwd),
                  cwd: s.cwd ?? cwd,
                  lastModified,
                  createdAt: s.createdAt,
                  unread: lastModified > this.readState.getLastViewedAt(s.sessionId),
                  active: await isSessionActive(this.heartbeatDir, s.sessionId),
                  archived: this.archiveState.isArchived(s.sessionId),
                };
              })
            );
            this.post(webviewView.webview, { type: "sessionListLoaded", sessions: entries, hasMore });
            break;
          }
          case "openSession": {
            const openFolderPaths = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
            // Repoints the live AgentSession at `targetCwd` and opens the session
            // inline — used both when that folder is already part of this window's
            // workspace, and when it's just been added to it (see below), so a whole
            // new window is only ever spawned as a last resort. `openSessionInline`'s
            // `ensureFocusSession` call handles the actual repointing (and the
            // busy-check that decides whether the outgoing session gets killed or
            // backgrounded), so this just forwards the target cwd to it.
            const repointAndOpen = async (targetCwd: string) => {
              await openSessionInline(message.sessionId, message.title, targetCwd);
            };
            // `message.cwd` comes from `listSessions()`, which reports whatever cwd was
            // stored in the session file at write time — it never self-corrects, so a
            // session predating a folder rename/move still reports the OLD, now-gone
            // path forever (confirmed empirically). Before treating that as a genuinely
            // different/foreign folder, check every folder already open in *this*
            // window — not just the active `cwd` (index 0): in a multi-root workspace,
            // the renamed folder can sit at any index, and checking only `cwd` missed
            // that case (confirmed by a real user report — a session opened fine right
            // after a folder rename, but broke on the next restart once the active
            // window's `cwd` was a *different* already-open root than the renamed one,
            // sending it down the "genuinely foreign folder" path below with a dead
            // `message.cwd`, which then tried to spawn the CLI with a nonexistent cwd).
            const resolveSessionFolder = async (): Promise<string | undefined> => {
              if (message.cwd === cwd) return cwd;
              const { getSessionInfo } = await import("@anthropic-ai/claude-agent-sdk");
              for (const candidate of [cwd, ...openFolderPaths]) {
                const info = await getSessionInfo(message.sessionId, { dir: candidate }).catch(() => undefined);
                if (info) return candidate;
              }
              return undefined;
            };
            const resolvedFolder = await resolveSessionFolder();
            if (resolvedFolder === cwd) {
              await openSessionInline(message.sessionId, message.title);
            } else if (resolvedFolder) {
              await repointAndOpen(resolvedFolder);
            } else if (isOpenWorkspaceFolder(message.cwd, openFolderPaths)) {
              await repointAndOpen(message.cwd);
            } else {
              // A folder that isn't open in this window (or any window) at all — the
              // whole AgentSession is scoped to one cwd, and there's no view of it to
              // repoint to here as-is.
              const behavior = vscode.workspace
                .getConfiguration(EXTENSION_CONFIG_SECTION)
                .get<"addToWorkspace" | "newWindow">("crossRepoOpenBehavior", "addToWorkspace");
              // `updateWorkspaceFolders` returns false if the edit is rejected (e.g. a
              // concurrent workspace edit) — fall back to the new-window path below
              // rather than silently doing nothing.
              const addedToWorkspace =
                behavior === "addToWorkspace" &&
                vscode.workspace.updateWorkspaceFolders(openFolderPaths.length, 0, {
                  uri: vscode.Uri.file(message.cwd),
                });
              if (addedToWorkspace) {
                // `updateWorkspaceFolders` only reloads the extension host when going
                // from a single-folder window to multi-root — already-multi-root (this
                // user's actual reported case) keeps this exact webview instance alive,
                // so open inline immediately rather than waiting for a remount that may
                // never come. Still stash the pending-open as a safety net for the
                // single-folder-window case, which *does* reload (see
                // `requestPendingSessionOpen` — harmless no-op if this line below
                // already handled it and the extension host never restarts).
                await this.pendingSessionOpen.set({
                  cwd: message.cwd,
                  sessionId: message.sessionId,
                  title: message.title,
                });
                await repointAndOpen(message.cwd);
                await this.pendingSessionOpen.clear();
              } else {
                // Stash which session to resume so the new window's webview can pick it
                // back up (see requestPendingSessionOpen), instead of opening to a blank
                // Sessions screen.
                await this.pendingSessionOpen.set({
                  cwd: message.cwd,
                  sessionId: message.sessionId,
                  title: message.title,
                });
                await vscode.commands.executeCommand(
                  "vscode.openFolder",
                  vscode.Uri.file(message.cwd),
                  { forceNewWindow: true }
                );
              }
            }
            break;
          }
          case "requestPendingSessionOpen": {
            const pending = this.pendingSessionOpen.get();
            if (pending && pending.cwd === cwd) {
              await this.pendingSessionOpen.clear();
              await openSessionInline(pending.sessionId, pending.title);
            }
            break;
          }
          case "newChat":
            session = ensureFocusSession(cwd);
            session.reset();
            void session.warmStart();
            break;
          case "reloadStaleChat":
            // Force-resets the CURRENT session regardless of isBusy() — this is the
            // explicit "recover a stuck chat" action, and a hung session's heartbeat can
            // still look "running" (the interval keeps firing even if the underlying
            // process is wedged), so it must bypass ensureFocusSession's busy-check
            // rather than being parked like a normal focus switch would be.
            session.reset(message.sessionId);
            await postSessionReplay(message.sessionId, message.title);
            break;
          case "forkSession": {
            const currentId = session.getSessionId();
            if (currentId) {
              session.reset(currentId, { fork: true });
              void session.warmStart();
            }
            break;
          }
          case "editMessage": {
            const currentId = session.getSessionId();
            if (!currentId) {
              vscode.window.showWarningMessage("Nothing to edit yet.");
              break;
            }
            const { getSessionMessages, forkSession } = await import("@anthropic-ai/claude-agent-sdk");
            const history = await getSessionMessages(currentId, { dir: cwd });
            const index = history.findIndex((m) => m.uuid === message.uuid);
            if (index === -1) {
              vscode.window.showWarningMessage(
                "Couldn't find that message to edit — it may be from a different session."
              );
              break;
            }

            // Best-effort: restore file state to before the edited message, same as the
            // explicit Rewind action. Must happen on the ORIGINAL session's live query,
            // before reset() below swaps to the forked/blank one.
            const rewindResult = await session.rewindToMessage(message.uuid);
            if (!rewindResult.canRewind && rewindResult.error) {
              vscode.window.showWarningMessage(`Editing, but couldn't restore file state: ${rewindResult.error}`);
            }

            let slicedHistory: Awaited<ReturnType<typeof getSessionMessages>> = [];
            let newSessionId: string | undefined;
            if (index === 0) {
              // Nothing precedes the edited message — there's nothing to fork from, so
              // this is really just a fresh, not-yet-started chat (same as New Chat).
              session.reset();
            } else {
              const upToMessageId = history[index - 1].uuid;
              const forked = await forkSession(currentId, {
                upToMessageId,
                dir: cwd,
                title: message.currentTitle,
              });
              newSessionId = forked.sessionId;
              // Re-fetch rather than reusing our own pre-fork slice: forkSession
              // regenerates every message's uuid in the new session file (confirmed
              // empirically), so the original uuids wouldn't match if this forked
              // session is itself edited again later.
              slicedHistory = await getSessionMessages(newSessionId, { dir: cwd });
              session.reset(newSessionId, { titleKnown: false });
            }

            const editedUuid = randomUUID();
            this.post(webviewView.webview, {
              type: "sessionOpened",
              sessionId: newSessionId,
              title: newSessionId ? message.currentTitle : undefined,
              replay: [...buildReplayItems(slicedHistory), { kind: "user", text: message.newText, uuid: editedUuid }],
            });
            await session.sendMessage(message.newText, [], undefined, editedUuid);
            break;
          }
          case "deleteSession": {
            const { deleteSession } = await import("@anthropic-ai/claude-agent-sdk");
            await deleteSession(message.sessionId);
            this.post(webviewView.webview, { type: "sessionDeleted", sessionId: message.sessionId });
            break;
          }
          case "setSessionArchived":
            await this.archiveState.setArchived(message.sessionId, message.archived);
            break;
          case "requestFileMentions": {
            const results = await searchWorkspaceFiles(message.query, cwd);
            this.post(webviewView.webview, { type: "fileMentionResults", query: message.query, results });
            break;
          }
          case "setWebSearchEnabled":
            session.setWebSearchEnabled(message.enabled);
            this.post(webviewView.webview, { type: "webSearchToggled", enabled: message.enabled });
            break;
          case "rewindToLastUserMessage": {
            const result = await session.rewindToLastUserMessage();
            if (!result.canRewind) {
              vscode.window.showWarningMessage(
                `Rewind not available: ${result.error ?? "nothing to rewind yet."}`
              );
            }
            break;
          }
          case "requestMcpServers": {
            const servers = await session.listMcpServers();
            this.post(webviewView.webview, { type: "mcpServersLoaded", servers });
            break;
          }
          case "toggleMcpServer":
            await session.toggleMcpServer(message.name, message.enabled);
            break;
          case "setMcpPermissionModeOverride": {
            const result = await session.setMcpPermissionModeOverride(message.name, message.mode);
            if (result.warning) {
              vscode.window.showWarningMessage(result.warning);
            }
            break;
          }
          case "reconnectMcpServer": {
            await session.reconnectMcpServer(message.name);
            const servers = await session.listMcpServers();
            this.post(webviewView.webview, { type: "mcpServersLoaded", servers });
            break;
          }
          case "addMcpServer": {
            const result = await session.addMcpServer(message.name, message.config);
            if (result.errors[message.name]) {
              vscode.window.showWarningMessage(
                `Couldn't connect to "${message.name}": ${result.errors[message.name]}`
              );
            }
            const servers = await session.listMcpServers();
            this.post(webviewView.webview, { type: "mcpServersLoaded", servers });
            break;
          }
          case "backgroundTask": {
            const backgrounded = await session.backgroundTask(message.toolUseId);
            if (!backgrounded) {
              vscode.window.showInformationMessage("Nothing to background for this tool call.");
            }
            break;
          }
          case "stopTask":
            await session.stopTask(message.taskId);
            break;
          case "requestAgents": {
            const agents = await session.listAgents();
            this.post(webviewView.webview, { type: "agentsLoaded", agents });
            break;
          }
          case "requestSlashCommands": {
            const commands = await session.listSlashCommands();
            this.post(webviewView.webview, { type: "slashCommandsLoaded", commands });
            break;
          }
          case "requestSkills": {
            const skills = await session.listSkills();
            this.post(webviewView.webview, { type: "skillsLoaded", skills });
            break;
          }
          case "requestOutputStyles": {
            const styles = await session.listOutputStyles();
            this.post(webviewView.webview, { type: "outputStylesLoaded", styles });
            break;
          }
          case "setOutputStyle":
            await session.setOutputStyle(message.style);
            break;
          case "requestAccountInfo": {
            const account = await session.getAccountInfo();
            this.post(webviewView.webview, { type: "accountInfoLoaded", account });
            break;
          }
          case "requestUsage":
            // Replies asynchronously via the "usageLoaded" event once its hidden probe's
            // result arrives — see AgentSession.requestUsage()'s doc comment.
            await session.requestUsage();
            break;
          case "reloadPlugins":
            await session.reloadPlugins();
            break;
          case "openClaudeMd":
            await openOrCreateFile(path.join(cwd, "CLAUDE.md"), "# CLAUDE.md\n");
            break;
          case "openSettingsJson":
            await openOrCreateFile(path.join(os.homedir(), ".claude", "settings.json"), "{}\n");
            break;
          case "openSettings":
            // Filters the Settings UI to this extension's own contributed settings by
            // searching for its config section id, rather than by extension id (this is
            // an unpublished internal extension with no stable publisher.name id).
            await vscode.commands.executeCommand(
              "workbench.action.openSettings",
              EXTENSION_CONFIG_SECTION
            );
            break;
          case "openExternalUrl":
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;
          case "setThinkingEnabled":
            session.setThinkingEnabled(message.enabled);
            break;
          case "openClaudeInTerminal": {
            const terminal = vscode.window.createTerminal({ cwd });
            terminal.show();
            terminal.sendText("claude");
            break;
          }
          case "resumeSessionInTerminal": {
            const existing = this.resumeTerminals.get(message.sessionId);
            if (existing && existing.exitStatus === undefined) {
              existing.show();
              break;
            }
            // Session ids are SDK-generated UUIDs; this is a defensive guard against
            // ever interpolating an unexpected value into the shell command below,
            // not a real-world case this is expected to hit.
            if (!/^[a-zA-Z0-9-]+$/.test(message.sessionId)) {
              vscode.window.showErrorMessage("Can't resume this session: unexpected session id.");
              break;
            }
            const terminal = vscode.window.createTerminal({
              cwd: message.cwd ?? cwd,
              name: `Claude: ${message.title}`,
              iconPath: new vscode.ThemeIcon("comment-discussion"),
            });
            this.resumeTerminals.set(message.sessionId, terminal);
            terminal.show();
            terminal.sendText(`claude --resume ${message.sessionId}`);
            break;
          }
          case "copyToClipboard":
            await vscode.env.clipboard.writeText(message.text);
            vscode.window.setStatusBarMessage("Copied to clipboard", 2000);
            break;
          case "requestAddDirectory": {
            const picked = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: "Add to this chat",
            });
            const folder = picked?.[0];
            if (folder) {
              const appliedImmediately = session.addDirectory(folder.fsPath);
              this.post(webviewView.webview, {
                type: "directoryAdded",
                path: folder.fsPath,
                appliedImmediately,
              });
            }
            break;
          }
        }
      } catch (err) {
        const messageText = err instanceof Error ? err.message : String(err);
        this.post(webviewView.webview, { type: "agentError", message: messageText });
      }
    });

    // Assigned last, after the message listener above is already attached: setting
    // `.html` starts the webview's JS running (and, with `retainContextWhenHidden`,
    // this happens exactly once for the view's whole lifetime — no later reload to
    // self-heal a lost message). The webview's very first `postMessage` calls
    // (requestModels, requestSessionList, ...) fire as soon as its script loads, and
    // VS Code doesn't buffer messages sent before `onDidReceiveMessage` is listening —
    // assigning `.html` earlier risked those calls racing ahead of this handler and
    // being silently dropped, permanently starving the webview of its initial data.
    webviewView.webview.html = this.getHtml(webviewView.webview, extensionUri);
  }

  private post(webview: vscode.Webview, message: HostToWebviewMessage): void {
    webview.postMessage(message);
  }

  /** Desktop notification when a turn finishes while the user isn't looking at this
   * chat — `webviewView.visible` (the sidebar view isn't the one currently shown) or
   * `vscode.window.state.focused` (VS Code itself doesn't have OS focus). This is
   * same-window only: it doesn't (and can't, without a whole new host-side poller)
   * notify about a chat responding in a *different* VS Code window/repo — see
   * `AGENTS.md`. */
  private notifyIfBackgrounded(webviewView: vscode.WebviewView, event: HostToWebviewMessage): void {
    if (event.type !== "turnComplete") return;
    if (webviewView.visible && vscode.window.state.focused) return;
    void vscode.window.showInformationMessage("Claude finished responding.", "Open").then((choice) => {
      if (choice === "Open") {
        void vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
      }
    });
  }

  /** Command-palette entry point ("Claude Code: New Chat") — mirrors the webview's own
   * "+" button, but triggered with no webview interaction, so it also has to bring the
   * view into focus itself and push the reset to the webview (`forceNewChat`) rather
   * than relying on a local optimistic dispatch the way a real button click gets. */
  async newChat(): Promise<void> {
    await vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
    if (!this.webviewView || !this.session) return;
    this.session.reset();
    void this.session.warmStart();
    this.post(this.webviewView.webview, { type: "forceNewChat" });
  }

  private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.css"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function openOrCreateFile(filePath: string, starterContent: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, starterContent);
  }
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
