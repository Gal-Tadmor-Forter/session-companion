import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, Check, ChevronDown, ChevronUp, CircleHelp, Copy, FileDiff, Pencil, Plus, Search, Settings, X } from "lucide-react";
import { vscodeApi } from "./lib/vscodeApi";
import { TranscriptView } from "./transcript/TranscriptView";
import { SessionsView } from "./sessions/SessionsView";
import { Composer } from "./composer/Composer";
import { Spinner } from "./components/Spinner";
import { HelpDialog } from "./dialogs/HelpDialog";
import { AttachmentPreviewDialog } from "./dialogs/AttachmentPreviewDialog";
import { UsageDialog } from "./dialogs/UsageDialog";
import { FileChangesDialog } from "./dialogs/FileChangesDialog";
import { extractFileChanges } from "./utils/fileChanges";
import { Tooltip, TooltipProvider } from "./components/Tooltip";
import { describeToolUse } from "./utils/toolLabel";
import { buildTranscriptFromReplay } from "./utils/replay";
import { transcriptToMarkdown } from "./utils/exportTranscript";
import { findMatchingItemIds } from "./utils/transcriptSearch";
import { useThinkingVerb } from "./utils/thinkingVerbs";
import type { TranscriptItem } from "./types";
import type {
  AccountInfoResult,
  AgentInfoEntry,
  AttachmentSummary,
  BackgroundTaskEntry,
  ContextUsageInfo,
  EffortLevelId,
  FileMentionResult,
  HostToWebviewMessage,
  McpServerStatusEntry,
  MessageDeliveryMode,
  ModelOption,
  NewMcpServerConfig,
  PermissionModeId,
  SessionListEntry,
  SlashCommandEntry,
  UsageReportInfo,
  WebviewToHostMessage,
} from "../../shared/protocol";

type Screen = "sessions" | "chat";

interface State {
  screen: Screen;
  items: TranscriptItem[];
  sending: boolean;
  waitingForFirstEvent: boolean;
  models: ModelOption[];
  selectedModel: string;
  permissionMode: PermissionModeId;
  /** Whether the org's `permissions.disableBypassPermissionsMode` policy blocks Full
   * Bypass — resolved host-side once at startup/session-switch (see `permissionModeChanged`
   * in webviewProvider.ts), not something the webview can determine on its own. */
  bypassPermissionsDisabled: boolean;
  effort: EffortLevelId;
  pendingAttachments: AttachmentSummary[];
  sessions: SessionListEntry[];
  /** How many sessions to ask for on the next `requestSessionList` — grows by 50 each
   * time "Load more" is clicked. Not itself the page size of what's currently shown;
   * `sessions.length` already reflects however many the host actually returned. */
  sessionsLimit: number;
  hasMoreSessions: boolean;
  currentSessionId: string | undefined;
  currentSessionTitle: string | undefined;
  webSearchEnabled: boolean;
  thinkingEnabled: boolean;
  mentionResults: FileMentionResult[];
  mcpServers: McpServerStatusEntry[];
  agents: AgentInfoEntry[];
  slashCommands: SlashCommandEntry[];
  outputStyles: string[];
  account: AccountInfoResult | undefined;
  focusView: boolean;
  pendingMentionInserts: FileMentionResult[];
  contextUsage: ContextUsageInfo | undefined;
  skills: SlashCommandEntry[];
  promptSuggestion: string | undefined;
  backgroundTasks: BackgroundTaskEntry[];
  usageLoading: boolean;
  usageReport: UsageReportInfo | undefined;
}

type Action =
  | {
      kind: "userSubmitted";
      text: string;
      attachments: AttachmentSummary[];
      startNewChat: boolean;
      uuid: string;
      deliveryMode?: MessageDeliveryMode;
    }
  | { kind: "queuedMessageEdited"; uuid: string; newText: string }
  | { kind: "queuedMessageCancelled"; uuid: string }
  | { kind: "hostMessage"; message: HostToWebviewMessage }
  | { kind: "permissionDecided"; requestId: string; approve: boolean; answers?: Record<string, string> }
  | { kind: "modelSelected"; model: string }
  | { kind: "permissionModeSelected"; mode: PermissionModeId }
  | { kind: "effortSelected"; effort: EffortLevelId }
  | { kind: "attachmentRemoved"; id: string }
  | { kind: "backToSessions" }
  | { kind: "returnedToChat" }
  | { kind: "newChatStarted" }
  | { kind: "webSearchToggled" }
  | { kind: "thinkingToggled" }
  | { kind: "focusViewToggled" }
  | { kind: "sessionRemovedLocally"; sessionId: string }
  | { kind: "sessionArchivedLocally"; sessionId: string; archived: boolean }
  | { kind: "sessionRenamedLocally"; sessionId: string; title: string }
  | { kind: "sessionsLimitIncreased"; limit: number }
  | { kind: "mentionInsertsConsumed" }
  | { kind: "sessionForked" }
  | { kind: "editMessageStarted" }
  | { kind: "usageRequested" };

export const initialState: State = {
  screen: "sessions",
  items: [],
  sending: false,
  waitingForFirstEvent: false,
  models: [],
  selectedModel: "",
  permissionMode: "default",
  bypassPermissionsDisabled: false,
  effort: "high",
  pendingAttachments: [],
  sessions: [],
  sessionsLimit: 50,
  hasMoreSessions: false,
  currentSessionId: undefined,
  currentSessionTitle: undefined,
  webSearchEnabled: false,
  thinkingEnabled: true,
  mentionResults: [],
  mcpServers: [],
  agents: [],
  slashCommands: [],
  outputStyles: [],
  account: undefined,
  focusView: false,
  pendingMentionInserts: [],
  contextUsage: undefined,
  skills: [],
  promptSuggestion: undefined,
  backgroundTasks: [],
  usageLoading: false,
  usageReport: undefined,
};

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `item-${nextId}`;
}

function applySessionRename(state: State, sessionId: string, title: string): State {
  return {
    ...state,
    sessions: state.sessions.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)),
    currentSessionTitle: state.currentSessionId === sessionId ? title : state.currentSessionTitle,
  };
}

export function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case "userSubmitted": {
      const newItem: TranscriptItem = {
        id: makeId(),
        kind: "user",
        text: action.text,
        attachments: action.attachments,
        timestamp: Date.now(),
        uuid: action.uuid,
        // "queue"/"steer" are held back (see `AgentSession.sendMessage`/
        // `flushNextQueued`) until the host confirms with `queuedMessageSent`.
        pending:
          action.deliveryMode === "queue" || action.deliveryMode === "steer" ? true : undefined,
        deliveryMode: action.deliveryMode,
      };
      return {
        ...state,
        screen: "chat",
        sending: true,
        // If a turn is already streaming (queue/steer/stopAndSend), don't show a
        // second "waiting for first event" indicator on top of the live one.
        waitingForFirstEvent: !state.sending,
        pendingAttachments: [],
        currentSessionId: action.startNewChat ? undefined : state.currentSessionId,
        currentSessionTitle: action.startNewChat ? undefined : state.currentSessionTitle,
        items: action.startNewChat ? [newItem] : [...state.items, newItem],
        promptSuggestion: undefined,
      };
    }
    case "backToSessions":
      return { ...state, screen: "sessions" };
    // Switching back to "chat" locally, with no host round-trip — used only when
    // the session clicked is the one already live in this exact webview (see
    // `handleOpenSession`). `state.items`/`sending` have been kept correct the
    // whole time regardless of which screen was visible, since this webview never
    // stopped receiving host events while showing the Sessions screen.
    case "returnedToChat":
      return { ...state, screen: "chat" };
    case "newChatStarted":
      return {
        ...state,
        screen: "chat",
        items: [],
        sending: false,
        waitingForFirstEvent: false,
        currentSessionId: undefined,
        currentSessionTitle: undefined,
        contextUsage: undefined,
        promptSuggestion: undefined,
      };
    case "sessionForked":
      return {
        ...state,
        currentSessionId: undefined,
        currentSessionTitle: undefined,
        contextUsage: undefined,
        promptSuggestion: undefined,
      };
    case "queuedMessageEdited":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "user" && item.uuid === action.uuid ? { ...item, text: action.newText } : item
        ),
      };
    case "queuedMessageCancelled":
      return {
        ...state,
        items: state.items.filter((item) => !(item.kind === "user" && item.uuid === action.uuid)),
      };
    case "editMessageStarted":
      // Items aren't touched here — the host replaces the whole transcript wholesale
      // via the "sessionOpened" response once the fork/rewind round trip finishes
      // (same as opening any past session), rather than optimistically editing in place.
      return { ...state, sending: true, waitingForFirstEvent: true, promptSuggestion: undefined };
    case "usageRequested":
      // Clears any previous report so a stale one can't flash before the fresh one
      // (or a genuine "not available" undefined) arrives.
      return { ...state, usageLoading: true, usageReport: undefined };
    case "attachmentRemoved":
      return {
        ...state,
        pendingAttachments: state.pendingAttachments.filter((a) => a.id !== action.id),
      };
    case "modelSelected":
      return { ...state, selectedModel: action.model };
    case "permissionModeSelected":
      return { ...state, permissionMode: action.mode };
    case "effortSelected":
      return { ...state, effort: action.effort };
    case "webSearchToggled":
      return { ...state, webSearchEnabled: !state.webSearchEnabled };
    case "thinkingToggled":
      return { ...state, thinkingEnabled: !state.thinkingEnabled };
    case "focusViewToggled":
      return { ...state, focusView: !state.focusView };
    case "sessionRemovedLocally":
      return { ...state, sessions: state.sessions.filter((s) => s.sessionId !== action.sessionId) };
    case "sessionArchivedLocally":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.sessionId === action.sessionId ? { ...s, archived: action.archived } : s
        ),
      };
    case "sessionRenamedLocally":
      return applySessionRename(state, action.sessionId, action.title);
    case "sessionsLimitIncreased":
      return { ...state, sessionsLimit: action.limit };
    case "mentionInsertsConsumed":
      return { ...state, pendingMentionInserts: [] };
    case "permissionDecided":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "permission" && item.requestId === action.requestId
            ? { ...item, resolution: action.approve ? "approved" : "denied", answers: action.answers }
            : item
        ),
      };
    case "hostMessage": {
      const message = action.message;
      switch (message.type) {
        case "textDeltaStart":
          return {
            ...state,
            sending: true,
            waitingForFirstEvent: false,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "assistantText",
                blockId: message.blockId,
                text: "",
                streaming: true,
                timestamp: Date.now(),
              },
            ],
          };
        case "textDelta":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "assistantText" && item.blockId === message.blockId
                ? { ...item, text: item.text + message.text }
                : item
            ),
          };
        case "textDeltaEnd":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "assistantText" && item.blockId === message.blockId
                ? { ...item, streaming: false }
                : item
            ),
          };
        case "thinkingDeltaStart":
          return {
            ...state,
            sending: true,
            waitingForFirstEvent: false,
            items: [
              ...state.items,
              { id: makeId(), kind: "thinking", blockId: message.blockId, text: "", streaming: true },
            ],
          };
        case "thinkingDelta":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "thinking" && item.blockId === message.blockId
                ? { ...item, text: item.text + message.text }
                : item
            ),
          };
        case "thinkingDeltaEnd":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "thinking" && item.blockId === message.blockId
                ? { ...item, streaming: false }
                : item
            ),
          };
        case "toolUse":
          return {
            ...state,
            sending: true,
            waitingForFirstEvent: false,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "toolUse",
                toolUseId: message.toolUseId,
                name: message.name,
                label: describeToolUse(message.name, message.input),
                input: message.input,
              },
            ],
          };
        case "toolResult":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "toolUse" && item.toolUseId === message.toolUseId
                ? { ...item, result: { summary: message.summary, isError: message.isError } }
                : item
            ),
          };
        case "subagentStep":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "toolUse" && item.toolUseId === message.toolUseId
                ? {
                    ...item,
                    subagentSteps: [...(item.subagentSteps ?? []), { id: makeId(), step: message.step }],
                  }
                : item
            ),
          };
        case "taskProgress":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "toolUse" && item.toolUseId === message.toolUseId
                ? { ...item, progressSummary: message.summary }
                : item
            ),
          };
        case "backgroundTasksChanged":
          return { ...state, backgroundTasks: message.tasks };
        case "permissionRequest":
          return {
            ...state,
            sending: true,
            waitingForFirstEvent: false,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "permission",
                requestId: message.requestId,
                toolName: message.toolName,
                label: message.title ?? `Allow ${message.toolName}?`,
                description: message.description,
                input: message.input,
              },
            ],
          };
        case "turnStats":
          return {
            ...state,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "turnStats",
                durationMs: message.durationMs,
                costUsd: message.costUsd,
                inputTokens: message.inputTokens,
                outputTokens: message.outputTokens,
              },
            ],
          };
        case "turnComplete":
          return {
            ...state,
            sending: false,
            waitingForFirstEvent: false,
            // Defensive: a stopAndSend-interrupted turn can leave a text/thinking block
            // that never got its DeltaEnd, which would otherwise blink forever.
            items: state.items.map((item) =>
              (item.kind === "assistantText" || item.kind === "thinking") && item.streaming
                ? { ...item, streaming: false }
                : item
            ),
          };
        case "agentError":
          return {
            ...state,
            sending: false,
            waitingForFirstEvent: false,
            items: [...state.items, { id: makeId(), kind: "error", message: message.message }],
          };
        case "modelsLoaded":
          return {
            ...state,
            models: message.models,
            selectedModel: state.selectedModel || message.models[0]?.value || "",
          };
        case "attachmentAdded":
          return {
            ...state,
            pendingAttachments: [...state.pendingAttachments, message.attachment],
          };
        case "attachmentError":
          return {
            ...state,
            items: [...state.items, { id: makeId(), kind: "error", message: message.message }],
          };
        case "sessionListLoaded":
          return { ...state, sessions: message.sessions, hasMoreSessions: message.hasMore };
        case "sessionDeleted":
          return { ...state, sessions: state.sessions.filter((s) => s.sessionId !== message.sessionId) };
        case "fileMentionResults":
          return { ...state, mentionResults: message.results };
        case "webSearchToggled":
          return { ...state, webSearchEnabled: message.enabled };
        case "mcpServersLoaded":
          return { ...state, mcpServers: message.servers };
        case "mcpAuthUrlOpened":
          return {
            ...state,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "contextNote",
                text: `Opened your browser to re-authenticate "${message.serverName}" — finish the login there, then retry.`,
              },
            ],
          };
        case "mcpReauthCompleted":
          return {
            ...state,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "contextNote",
                text: `Re-authenticated "${message.serverName}".`,
              },
            ],
          };
        case "agentsLoaded":
          return { ...state, agents: message.agents };
        case "slashCommandsLoaded":
          return { ...state, slashCommands: message.commands };
        case "skillsLoaded":
          return { ...state, skills: message.skills };
        case "promptSuggestion":
          return { ...state, promptSuggestion: message.text };
        case "permissionModeChanged":
          return {
            ...state,
            permissionMode: message.mode,
            bypassPermissionsDisabled: message.bypassPermissionsDisabled ?? state.bypassPermissionsDisabled,
          };
        case "outputStylesLoaded":
          return { ...state, outputStyles: message.styles };
        case "accountInfoLoaded":
          return { ...state, account: message.account };
        case "usageLoaded":
          return { ...state, usageLoading: false, usageReport: message.report };
        case "directoryAdded":
          return {
            ...state,
            items: [
              ...state.items,
              {
                id: makeId(),
                kind: "contextNote",
                text: message.appliedImmediately
                  ? `Added ${message.path} to this chat.`
                  : `Added ${message.path} — this chat is already running, so it'll take effect starting with your next new chat.`,
              },
            ],
          };
        case "forceNewChat":
          return {
            ...state,
            screen: "chat",
            items: [],
            sending: false,
            waitingForFirstEvent: false,
            currentSessionId: undefined,
            currentSessionTitle: undefined,
            contextUsage: undefined,
            promptSuggestion: undefined,
          };
        case "sessionIdAssigned":
          return { ...state, currentSessionId: message.sessionId };
        case "sessionRenamed":
          return applySessionRename(state, message.sessionId, message.title);
        case "workspacePathResolved":
          return { ...state, pendingMentionInserts: [...state.pendingMentionInserts, message.result] };
        case "contextUsageLoaded":
          return { ...state, contextUsage: message.usage };
        case "queuedMessageSent":
          return {
            ...state,
            items: state.items.map((item) =>
              item.kind === "user" && item.uuid === message.uuid ? { ...item, pending: false } : item
            ),
          };
        case "sessionOpened":
          return {
            ...state,
            screen: "chat",
            sending: false,
            waitingForFirstEvent: false,
            pendingAttachments: [],
            currentSessionId: message.sessionId,
            currentSessionTitle: message.title,
            items: buildTranscriptFromReplay(message.replay, makeId),
            contextUsage: undefined,
            promptSuggestion: undefined,
          };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

function post(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const thinkingVerb = useThinkingVerb(state.waitingForFirstEvent);
  const [helpOpen, setHelpOpen] = useState(false);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [filesChangedOpen, setFilesChangedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentSummary | undefined>(undefined);
  const [renamingChat, setRenamingChat] = useState(false);
  const [chatTitleDraft, setChatTitleDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the transcript should keep following new content (streaming deltas,
  // tool cards, etc.) automatically. Turns off the moment the user scrolls away from
  // the bottom, so reading back through history mid-stream doesn't keep getting
  // yanked back down — the exact complaint that motivated this.
  const [autoScroll, setAutoScroll] = useState(true);
  // Set once `sending` has been true for STALE_MS with no host message of any kind
  // arriving in between — the signal that the backing CLI process died without a
  // chance to report `agentError` (e.g. the extension host itself crashed/reloaded
  // mid-turn, taking the child process down with it), confirmed as a real scenario:
  // a user-reported chat stuck showing "Responding" with no live process left behind
  // it and no error ever posted. There's no way to detect that from a single missed
  // event, only from prolonged total silence.
  const [staleChat, setStaleChat] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const requestedInitialData = useRef(false);
  // Read inside the polling interval below instead of closing over `state.sessionsLimit`
  // directly, so a "Load more" click while already polling doesn't get silently
  // overwritten by the next 4s tick still using the limit captured when it started.
  const sessionsLimitRef = useRef(state.sessionsLimit);
  useEffect(() => {
    sessionsLimitRef.current = state.sessionsLimit;
  }, [state.sessionsLimit]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>) => {
      lastActivityRef.current = Date.now();
      setStaleChat(false);
      dispatch({ kind: "hostMessage", message: event.data });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Polls rather than a single setTimeout so a chat that goes quiet, then gets a
  // late event (e.g. a slow tool call) that resets the clock above, doesn't fire late.
  useEffect(() => {
    if (!state.sending) {
      setStaleChat(false);
      return;
    }
    lastActivityRef.current = Date.now();
    const STALE_MS = 3 * 60 * 1000;
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > STALE_MS) {
        setStaleChat(true);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [state.sending]);

  useEffect(() => {
    if (!requestedInitialData.current) {
      requestedInitialData.current = true;
      post({ type: "requestModels" });
      post({ type: "requestSessionList", limit: state.sessionsLimit });
      // Fetched eagerly (rather than on-demand when the "/" palette is opened) so
      // inline slash-command autocomplete has something to filter against as soon
      // as the user starts typing "/word".
      post({ type: "requestSlashCommands" });
      // If this window was just opened to resume a specific cross-repo session, the
      // host resolves this into a sessionOpened event; otherwise it's a silent no-op.
      post({ type: "requestPendingSessionOpen" });
    }
  }, []);

  useEffect(() => {
    if (autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [state.items, state.waitingForFirstEvent, autoScroll]);

  // A freshly opened chat (new or resumed) always starts pinned to the bottom,
  // regardless of whether a previous chat was left scrolled up.
  useEffect(() => {
    setAutoScroll(true);
  }, [state.currentSessionId, state.screen]);

  const handleTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 80);
  };

  useEffect(() => {
    if (state.screen !== "sessions") {
      return;
    }
    // Sessions list is a point-in-time snapshot (title/active/unread only change on
    // refetch) — poll while it's visible so "Responding..." and new sessions update
    // without the user having to hit refresh manually.
    const interval = setInterval(
      () => post({ type: "requestSessionList", limit: sessionsLimitRef.current }),
      4000
    );
    return () => clearInterval(interval);
  }, [state.screen]);

  const handleSend = (text: string, deliveryMode?: MessageDeliveryMode) => {
    // Pending attachments are always live-staged (never replay-reconstructed, which is
    // the only case `AttachmentSummary.id` can be missing), so this is never empty here.
    const attachmentIds = state.pendingAttachments
      .map((a) => a.id)
      .filter((id): id is string => id !== undefined);
    const startNewChat = state.screen === "sessions";
    const uuid = crypto.randomUUID();
    dispatch({ kind: "userSubmitted", text, attachments: state.pendingAttachments, startNewChat, uuid, deliveryMode });
    post({ type: "sendMessage", text, attachmentIds, startNewChat, deliveryMode, uuid });
  };

  const handleEditQueuedMessage = (uuid: string, newText: string) => {
    dispatch({ kind: "queuedMessageEdited", uuid, newText });
    post({ type: "editQueuedMessage", uuid, newText });
  };

  const handleCancelQueuedMessage = (uuid: string) => {
    dispatch({ kind: "queuedMessageCancelled", uuid });
    post({ type: "cancelQueuedMessage", uuid });
  };

  const handleStop = () => {
    post({ type: "interruptSession" });
  };

  const handleCompact = () => {
    handleSend("/compact");
  };

  const handleEditMessage = (uuid: string, newText: string) => {
    dispatch({ kind: "editMessageStarted" });
    post({ type: "editMessage", uuid, newText, currentTitle: state.currentSessionTitle });
  };

  const handleRenameSession = (sessionId: string, cwd: string | undefined, title: string) => {
    dispatch({ kind: "sessionRenamedLocally", sessionId, title });
    post({ type: "renameSession", sessionId, cwd, title });
  };

  const commitChatRename = () => {
    const title = chatTitleDraft.trim();
    if (state.currentSessionId && title && title !== state.currentSessionTitle) {
      handleRenameSession(state.currentSessionId, undefined, title);
    }
    setRenamingChat(false);
  };

  const handleAttachFiles = () => {
    post({ type: "attachFiles" });
  };

  const handleAttachDroppedFile = (fileName: string, base64Data: string) => {
    post({ type: "attachDroppedFile", fileName, base64Data });
  };

  const handleResolveWorkspacePath = (absolutePath: string) => {
    post({ type: "resolveWorkspacePath", absolutePath });
  };

  const handleMentionInsertsConsumed = () => {
    dispatch({ kind: "mentionInsertsConsumed" });
  };

  const handleRemoveAttachment = (id: string) => {
    dispatch({ kind: "attachmentRemoved", id });
    post({ type: "removeAttachment", id });
  };

  const handlePermissionDecision = (
    requestId: string,
    approve: boolean,
    updatedInput?: Record<string, unknown>
  ) => {
    const answers =
      updatedInput && typeof updatedInput.answers === "object" && updatedInput.answers !== null
        ? (updatedInput.answers as Record<string, string>)
        : undefined;
    dispatch({ kind: "permissionDecided", requestId, approve, answers });
    post({ type: "permissionDecision", requestId, approve, updatedInput });
  };

  const handleModelChange = (model: string) => {
    dispatch({ kind: "modelSelected", model });
    post({ type: "setModel", model });
  };

  const handlePermissionModeChange = (mode: PermissionModeId) => {
    dispatch({ kind: "permissionModeSelected", mode });
    post({ type: "setPermissionMode", mode });
  };

  // Deliberately no optimistic dispatch here — bypassPermissions needs a host-side
  // confirmation first; the picker only reflects it once "permissionModeChanged" comes
  // back, so a cancelled confirmation can't leave it showing a mode that was never applied.
  const handleRequestBypassPermissions = () => post({ type: "requestBypassPermissions" });

  const handleEffortChange = (effort: EffortLevelId) => {
    dispatch({ kind: "effortSelected", effort });
    post({ type: "setEffort", effort });
  };

  const handleBackToSessions = () => {
    dispatch({ kind: "backToSessions" });
    post({ type: "requestSessionList", limit: state.sessionsLimit });
  };

  const handleNewChat = () => {
    dispatch({ kind: "newChatStarted" });
    post({ type: "newChat" });
  };

  const handleReloadStaleChat = () => {
    setStaleChat(false);
    if (state.currentSessionId) {
      post({ type: "reloadStaleChat", sessionId: state.currentSessionId, title: state.currentSessionTitle ?? "Chat" });
    } else {
      // A brand-new chat that went stale before it ever got a session id has
      // nothing on disk to resume — same as a fresh "New chat".
      handleNewChat();
    }
  };

  const handleOpenSession = (session: SessionListEntry) => {
    // Clicking the chat that's already live in this exact webview (the common
    // "Back to Sessions, then back into the same chat" flow) must not round-trip
    // through the host's `openSession` handler — that always called
    // `AgentSession.reset()`, which tears down the live query (`Query.return()`)
    // and kills an in-flight turn. Confirmed as a real user report: going Back
    // mid-response and reopening the same chat left it permanently stuck, because
    // the turn that was still running got interrupted by the reopen itself. Just
    // switch screens locally instead — this webview never stopped receiving live
    // events for it while the Sessions screen was showing.
    if (session.sessionId === state.currentSessionId) {
      dispatch({ kind: "returnedToChat" });
      return;
    }
    post({ type: "openSession", sessionId: session.sessionId, cwd: session.cwd, title: session.title });
  };

  const handleResumeInTerminal = (session: SessionListEntry) => {
    post({ type: "resumeSessionInTerminal", sessionId: session.sessionId, cwd: session.cwd, title: session.title });
  };

  const handleRefreshSessions = () => {
    post({ type: "requestSessionList", limit: state.sessionsLimit });
  };

  const handleLoadMoreSessions = () => {
    const limit = state.sessionsLimit + 50;
    dispatch({ kind: "sessionsLimitIncreased", limit });
    post({ type: "requestSessionList", limit });
  };

  const handleDeleteSession = (sessionId: string) => {
    dispatch({ kind: "sessionRemovedLocally", sessionId });
    post({ type: "deleteSession", sessionId });
  };

  const handleSetArchived = (sessionId: string, archived: boolean) => {
    dispatch({ kind: "sessionArchivedLocally", sessionId, archived });
    post({ type: "setSessionArchived", sessionId, archived });
  };

  const handleToggleWebSearch = () => {
    dispatch({ kind: "webSearchToggled" });
    post({ type: "setWebSearchEnabled", enabled: !state.webSearchEnabled });
  };

  const handleToggleThinking = () => {
    dispatch({ kind: "thinkingToggled" });
    post({ type: "setThinkingEnabled", enabled: !state.thinkingEnabled });
  };

  const handleRequestMentions = (query: string) => {
    post({ type: "requestFileMentions", query });
  };

  const handleClearConversation = () => {
    dispatch({ kind: "newChatStarted" });
    post({ type: "newChat" });
  };

  const handleRewind = () => {
    post({ type: "rewindToLastUserMessage" });
  };

  const handleAddDirectory = () => post({ type: "requestAddDirectory" });

  const handleRequestMcpServers = () => post({ type: "requestMcpServers" });
  const handleToggleMcpServer = (name: string, enabled: boolean) =>
    post({ type: "toggleMcpServer", name, enabled });
  const handleReconnectMcpServer = (name: string) => post({ type: "reconnectMcpServer", name });
  const handleSetMcpPermissionModeOverride = (name: string, mode: "default" | "auto" | null) =>
    post({ type: "setMcpPermissionModeOverride", name, mode });
  const handleAddMcpServer = (name: string, config: NewMcpServerConfig) =>
    post({ type: "addMcpServer", name, config });
  const handleBackgroundTask = (toolUseId: string) => post({ type: "backgroundTask", toolUseId });
  const handleStopTask = (taskId: string) => post({ type: "stopTask", taskId });
  const handleRequestAgents = () => post({ type: "requestAgents" });
  const handleRequestSlashCommands = () => post({ type: "requestSlashCommands" });
  const handleRequestSkills = () => post({ type: "requestSkills" });
  const handleForkSession = () => {
    dispatch({ kind: "sessionForked" });
    post({ type: "forkSession" });
  };
  const handleRequestOutputStyles = () => post({ type: "requestOutputStyles" });
  const handleSetOutputStyle = (style: string) => post({ type: "setOutputStyle", style });
  const handleRequestAccountInfo = () => post({ type: "requestAccountInfo" });
  const handleToggleFocusView = () => dispatch({ kind: "focusViewToggled" });
  const handleOpenClaudeMd = () => post({ type: "openClaudeMd" });
  const handleOpenSettingsJson = () => post({ type: "openSettingsJson" });
  const handleOpenSettings = () => post({ type: "openSettings" });
  const handleReloadPlugins = () => post({ type: "reloadPlugins" });
  const handleOpenClaudeInTerminal = () => post({ type: "openClaudeInTerminal" });
  const handleOpenExternalUrl = (url: string) => post({ type: "openExternalUrl", url });
  const handleOpenUsage = () => {
    setUsageDialogOpen(true);
    dispatch({ kind: "usageRequested" });
    post({ type: "requestUsage" });
  };
  const handleCopyText = (text: string) => post({ type: "copyToClipboard", text });
  const handleCopyConversation = () => handleCopyText(transcriptToMarkdown(state.items));
  const fileChangeGroups = useMemo(() => extractFileChanges(state.items), [state.items]);

  const searchMatchIds = useMemo(() => findMatchingItemIds(state.items, searchQuery), [state.items, searchQuery]);
  const scrollToItem = (id: string | undefined) => {
    document.getElementById(id ?? "")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  useEffect(() => {
    // Deliberately not reacting to `state.items` changing on its own (e.g. a response
    // still streaming in) — re-scrolling every time new tokens arrive while search is
    // open would be disruptive. Only a new query, or opening search, jumps to the
    // first match; matches[0] here is still whatever the latest transcript produces.
    setActiveMatchIndex(0);
    scrollToItem(searchMatchIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpen]);
  const goToMatch = (delta: number) => {
    if (searchMatchIds.length === 0) return;
    const next = (activeMatchIndex + delta + searchMatchIds.length) % searchMatchIds.length;
    setActiveMatchIndex(next);
    scrollToItem(searchMatchIds[next]);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  return (
    <TooltipProvider>
    <div className="flex h-screen flex-col gap-2 p-2 font-sans">
      {state.screen === "chat" && (
        <div className="flex flex-col gap-1.5 border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <Tooltip label="Back to sessions">
              <button onClick={handleBackToSessions} className="shrink-0 cursor-pointer text-muted hover:text-foreground" aria-label="Back">
                <ArrowLeft size={16} />
              </button>
            </Tooltip>
            {renamingChat ? (
              <>
                <input
                  autoFocus
                  value={chatTitleDraft}
                  onChange={(e) => setChatTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitChatRename();
                    } else if (e.key === "Escape") {
                      setRenamingChat(false);
                    }
                  }}
                  onBlur={commitChatRename}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-sm text-foreground focus:outline-none"
                />
                <Tooltip label="Confirm rename">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitChatRename}
                    className="shrink-0 cursor-pointer text-muted hover:text-foreground"
                    aria-label="Confirm rename"
                  >
                    <Check size={14} />
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  {state.currentSessionTitle ?? "New chat"}
                </span>
                {state.currentSessionId && (
                  <Tooltip label="Rename session">
                    <button
                      onClick={() => {
                        setChatTitleDraft(state.currentSessionTitle ?? "");
                        setRenamingChat(true);
                      }}
                      className="shrink-0 cursor-pointer text-muted hover:text-foreground"
                      aria-label="Rename session"
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {fileChangeGroups.length > 0 && (
              <Tooltip label="Files changed in this chat">
                <button
                  onClick={() => setFilesChangedOpen(true)}
                  className="cursor-pointer text-muted hover:text-foreground"
                  aria-label="Files changed"
                >
                  <FileDiff size={15} />
                </button>
              </Tooltip>
            )}
            {state.items.length > 0 && (
              <Tooltip label="Find in conversation">
                <button
                  onClick={() => setSearchOpen((open) => !open)}
                  className="cursor-pointer text-muted hover:text-foreground"
                  aria-label="Find in conversation"
                >
                  <Search size={15} />
                </button>
              </Tooltip>
            )}
            {state.items.length > 0 && (
              <Tooltip label="Copy conversation as markdown">
                <button
                  onClick={handleCopyConversation}
                  className="cursor-pointer text-muted hover:text-foreground"
                  aria-label="Copy conversation"
                >
                  <Copy size={15} />
                </button>
              </Tooltip>
            )}
            <Tooltip label="About this extension">
              <button
                onClick={() => setHelpOpen(true)}
                className="ml-auto cursor-pointer text-muted hover:text-foreground"
                aria-label="Help"
              >
                <CircleHelp size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Extension settings">
              <button
                onClick={handleOpenSettings}
                className="cursor-pointer text-muted hover:text-foreground"
                aria-label="Settings"
              >
                <Settings size={16} />
              </button>
            </Tooltip>
            <Tooltip label="New chat">
              <button onClick={handleNewChat} className="cursor-pointer text-muted hover:text-foreground" aria-label="New chat">
                <Plus size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      {state.screen === "chat" && searchOpen && (
        <div className="flex items-center gap-1.5 border-b border-border pb-2">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              else if (e.key === "Enter") goToMatch(e.shiftKey ? -1 : 1);
            }}
            placeholder="Find in conversation"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          <span className="shrink-0 text-xs text-muted">
            {searchMatchIds.length > 0 ? `${activeMatchIndex + 1}/${searchMatchIds.length}` : "0/0"}
          </span>
          <button
            onClick={() => goToMatch(-1)}
            disabled={searchMatchIds.length === 0}
            className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-default disabled:opacity-40"
            aria-label="Previous match"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => goToMatch(1)}
            disabled={searchMatchIds.length === 0}
            className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-default disabled:opacity-40"
            aria-label="Next match"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={closeSearch}
            className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="relative min-w-0 flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={handleTranscriptScroll} className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-1">
        {state.screen === "sessions" ? (
          <SessionsView
            sessions={state.sessions}
            hasMore={state.hasMoreSessions}
            onLoadMore={handleLoadMoreSessions}
            onOpenSession={handleOpenSession}
            onResumeInTerminal={handleResumeInTerminal}
            onRefresh={handleRefreshSessions}
            onDeleteSession={handleDeleteSession}
            onSetArchived={handleSetArchived}
            onRenameSession={handleRenameSession}
            onOpenHelp={() => setHelpOpen(true)}
            onOpenSettings={handleOpenSettings}
            onOpenUsage={handleOpenUsage}
          />
        ) : (
          <>
            <TranscriptView
              items={state.items}
              onPermissionDecision={handlePermissionDecision}
              onBackgroundTask={handleBackgroundTask}
              onPreviewAttachment={setPreviewAttachment}
              onEditMessage={handleEditMessage}
              editDisabled={state.sending}
              onCopy={handleCopyText}
              onEditQueuedMessage={handleEditQueuedMessage}
              onCancelQueuedMessage={handleCancelQueuedMessage}
            />
            {state.waitingForFirstEvent && (
              <div className="mt-3 flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-surface px-3 py-2.5 text-sm text-muted">
                  <Spinner />
                  <span>{thinkingVerb}…</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {state.screen === "chat" && !autoScroll && (
        <button
          onClick={() => setAutoScroll(true)}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground shadow-md hover:bg-surface-hover"
        >
          Jump to bottom <ArrowDown size={12} />
        </button>
      )}
      </div>
      {state.screen === "chat" && staleChat && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
          <span className="flex-1">
            No response for a few minutes — this chat may have lost its connection.
          </span>
          <button
            onClick={handleReloadStaleChat}
            className="shrink-0 cursor-pointer rounded-md border border-border bg-surface px-2 py-1 font-medium text-foreground hover:bg-surface-hover"
          >
            Reload chat
          </button>
        </div>
      )}
      {state.screen === "chat" && state.promptSuggestion && !state.sending && (
        <button
          onClick={() => handleSend(state.promptSuggestion!)}
          className="max-w-full min-w-0 shrink-0 cursor-pointer self-start truncate rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          {state.promptSuggestion}
        </button>
      )}
      <Composer
        // Forced false outside the chat screen so the stop/steer/queue controls (meant
        // for the chat currently being viewed) never show on the Sessions list — but the
        // Composer itself must stay mounted there regardless, since typing into it is
        // the only way to start a new chat from the main screen (confirmed as a real
        // regression: wrapping the whole Composer in this same condition silently
        // removed that entry point).
        sending={state.screen === "chat" && state.sending}
        models={state.models}
        selectedModel={state.selectedModel}
        permissionMode={state.permissionMode}
        bypassPermissionsDisabled={state.bypassPermissionsDisabled}
        effort={state.effort}
        attachments={state.pendingAttachments}
        webSearchEnabled={state.webSearchEnabled}
        thinkingEnabled={state.thinkingEnabled}
        mentionResults={state.mentionResults}
        mcpServers={state.mcpServers}
        agents={state.agents}
        slashCommands={state.slashCommands}
        outputStyles={state.outputStyles}
        account={state.account}
        focusView={state.focusView}
        pendingMentionInserts={state.pendingMentionInserts}
        onMentionInsertsConsumed={handleMentionInsertsConsumed}
        onSend={handleSend}
        onStop={handleStop}
        onModelChange={handleModelChange}
        onPermissionModeChange={handlePermissionModeChange}
        onRequestBypassPermissions={handleRequestBypassPermissions}
        onEffortChange={handleEffortChange}
        onAttachFiles={handleAttachFiles}
        onAttachDroppedFile={handleAttachDroppedFile}
        onResolveWorkspacePath={handleResolveWorkspacePath}
        onRemoveAttachment={handleRemoveAttachment}
        onPreviewAttachment={setPreviewAttachment}
        onToggleWebSearch={handleToggleWebSearch}
        onToggleThinking={handleToggleThinking}
        onRequestMentions={handleRequestMentions}
        onClearConversation={handleClearConversation}
        onRewind={handleRewind}
        onAddDirectory={handleAddDirectory}
        onRequestMcpServers={handleRequestMcpServers}
        onToggleMcpServer={handleToggleMcpServer}
        onReconnectMcpServer={handleReconnectMcpServer}
        onSetMcpPermissionModeOverride={handleSetMcpPermissionModeOverride}
        onAddMcpServer={handleAddMcpServer}
        backgroundTasks={state.backgroundTasks}
        onStopTask={handleStopTask}
        onRequestAgents={handleRequestAgents}
        onRequestSlashCommands={handleRequestSlashCommands}
        skills={state.skills}
        onRequestSkills={handleRequestSkills}
        canFork={Boolean(state.currentSessionId)}
        onForkSession={handleForkSession}
        onRequestOutputStyles={handleRequestOutputStyles}
        onSetOutputStyle={handleSetOutputStyle}
        onRequestAccountInfo={handleRequestAccountInfo}
        onToggleFocusView={handleToggleFocusView}
        onOpenClaudeMd={handleOpenClaudeMd}
        onOpenSettingsJson={handleOpenSettingsJson}
        onReloadPlugins={handleReloadPlugins}
        onOpenClaudeInTerminal={handleOpenClaudeInTerminal}
        onOpenExternalUrl={handleOpenExternalUrl}
        contextUsage={state.screen === "chat" ? state.contextUsage : undefined}
        onCompact={handleCompact}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onOpenExternalUrl={handleOpenExternalUrl} />
      <AttachmentPreviewDialog attachment={previewAttachment} onClose={() => setPreviewAttachment(undefined)} />
      <UsageDialog
        open={usageDialogOpen}
        loading={state.usageLoading}
        report={state.usageReport}
        onClose={() => setUsageDialogOpen(false)}
      />
      <FileChangesDialog
        open={filesChangedOpen}
        groups={fileChangeGroups}
        onClose={() => setFilesChangedOpen(false)}
      />
    </div>
    </TooltipProvider>
  );
}
