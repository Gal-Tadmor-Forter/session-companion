# Session Companion

> **Unofficial, community-built.** Not affiliated with, endorsed by, or
> sponsored by Anthropic. "Claude" and "Claude Code" are Anthropic's
> trademarks, referenced here only to describe compatibility.

A VS Code extension that reimplements the official Claude Code chat UI on top of
[`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk),
with one addition the official extension doesn't have: a **Sessions** view that
aggregates Claude Code session history across every repo on the machine, not
just the current workspace.

## Features

- Streaming chat, token-by-token, with markdown rendering and collapsible
  step cards — tool calls, extended-thinking blocks, and auto-injected IDE
  context notes (e.g. "opened file X") each collapse to a one-line summary
  once finished, so a response with many steps stays readable instead of
  dumping everything open. A Task tool call nests its subagent's own
  text/thinking/tool-use as flat lines under the same card
  (`Options.forwardSubagentText`), with a live present-tense progress
  summary while it's running (`Options.agentProgressSummaries`)
- Each response ends with a small stats line — duration, cost, and
  input/output tokens for that turn (`SDKResultMessage`), the same kind of
  info the terminal's `/cost` gives you, but inline per message instead of
  on demand. Live turns only — reopening a past session from the Sessions
  list doesn't retroactively show stats for its earlier turns. Investigated
  backfilling this from the stored session file and deliberately didn't:
  cost isn't persisted anywhere in it, and reconstructing tokens by summing
  each stored assistant message's own `usage` undercounted badly against
  the real live total for an equivalent turn (14 vs. 197 output tokens in
  one real test) — the stored transcript doesn't expose everything that
  counts toward a turn's real usage. Only duration is honestly
  reconstructable (via each message's undocumented-but-present
  `timestamp` field), and showing duration alone without cost/tokens was
  judged not worth the inconsistency. See `AGENTS.md`.
- A **Usage** icon in the Sessions screen header (top right, not tied to any
  particular chat) opens a dialog with the org/plan's spend-limit and
  rate-limit data — the same numbers Claude Desktop's Settings → Usage
  screen shows (`$X of $Y spent`, `% used`, plan rate-limit meters where
  available), plus the CLI's own "what's contributing to your usage" text
  breakdown. There's no dedicated SDK method for this (unlike context
  usage) — it's fetched by sending `/usage` on its own standalone, throwaway
  session (never the current chat, and deleted again once the probe has its
  answer — see `AGENTS.md` for why: reusing the current session created a
  real, visible "/usage"-titled entry in the Sessions list whenever the
  button was clicked with no chat open). No date-range picker: the SDK
  doesn't expose historical usage, only the current window.
- Model picker (with per-model descriptions and effort levels) and permission
  mode picker (Manual / Don't ask / Edit automatically / Plan / Auto),
  matching the official extension, plus a separate **Full bypass** entry
  (skips every permission check) that requires an explicit confirmation
  dialog before it takes effect, rather than being a plain one-click mode
- A suggested next prompt appears as a chip under the composer after a turn
  finishes — click it to send as-is (`Options.promptSuggestions`)
- File attachments (images and text) and `@`-mention autocomplete for files
  in the workspace. Results respect each workspace folder's root
  `.gitignore` (nested `.gitignore` files aren't combined in) plus a fixed
  `.git`/`node_modules`/`dist` exclude that applies regardless — matching
  the "don't suggest build output or dependencies" convention other coding
  agents follow. In a multi-root workspace, a result's repo name shows as a
  subtitle, and the path inserted is relative to the *current chat's*
  folder specifically (e.g. `../portal/src/index.ts` for a match in a
  sibling repo) rather than the matched file's own folder — inserting a
  path relative to the wrong folder would silently point at nothing (or the
  wrong file) once Claude tries to resolve it against `cwd`. Same fix
  applies to the drag-and-drop mention path below.
- Drag-and-drop: drop a file from your OS onto the composer to attach it
  (same as "Upload from computer"); drag a file from VS Code's own Explorer
  and it's mentioned by a cwd-relative path instead (same as "Add
  context"), since it's already in the workspace. Dragging from VS Code's own
  Explorer/tabs requires holding **⇧ Shift** — a VS Code webview restriction
  (see "Known scope limits"), not a bug here; OS-level drags (e.g. Finder)
  don't need it
- `/` command palette: Context (attach, mention, clear, rewind, fork),
  Model (switch model, effort, thinking toggle, account info), Customize
  (output styles, agents, MCP servers — with a reconnect action for a
  failed/needs-auth server, a per-server tighten-only permission override,
  and an "Add server..." form for stdio servers — skills, slash commands,
  memory, plugins), Settings, and Support — typing `/` followed by more
  characters narrows this to inline autocomplete over just the matching
  slash commands
- A "run in background" button on any still-running tool call
  (`Query.backgroundTasks`) — meaningful for Bash/subagent calls, a no-op
  otherwise — and a small tasks tray next to the context gauge listing
  everything currently backgrounded, with a stop button for each
  (`Query.stopTask`); the tray only appears once something is actually
  running in the background
- Rewind to a previous message's file state (`enableFileCheckpointing`);
  Fork conversation continues the same history under a brand-new session
  id, leaving the original untouched (`Options.forkSession`)
- Edit any past message (hover it for a pencil icon) and regenerate from
  there: restores file state to before it (same mechanism as Rewind), then
  forks the conversation up to (not including) it and sends your edited
  text as the next message — the original session is untouched, same as
  the explicit Fork action. Attachments on the edited message aren't
  resent (text-only edit).
- Message queue/steer: send a follow-up while Claude is still responding —
  **Stop and Send** (interrupt, then send), **Add to Queue** (`⌥Enter`, runs
  as its own turn once the current one finishes), or **Steer with Message**
  (`Enter`, folds into the turn that's currently running)
- Context window gauge in the composer: a small circular percentage ring
  (hover for a breakdown of token usage by category, plus cumulative session
  cost when available) with a one-click **Compact Conversation** action
- Settings cog (Sessions screen and open-chat header, between Help and
  Refresh/New) opens the extension's contributed settings directly in VS
  Code's Settings UI: `excludedFolders`, which hides sessions whose cwd
  falls under a configured folder from the cross-repo Sessions list
  (defaults to `/tmp`, since throwaway/scratch sessions tend to run there),
  `fallbackModel`, an automatic-failover model to retry with if the
  primary one is overloaded or unavailable, and `maxBudgetUsd`/`maxTurns`,
  optional caps that stop a chat automatically once it's spent past a
  dollar amount or turn count (0 disables either)
- Session rename, from either the Sessions list or the open chat's header
- Cross-repo **Sessions** home screen: every Claude Code session on the
  machine, grouped by date, with live status (responding / unread), search,
  rename, archive, and delete. Loads 50 at a time (`listSessions({limit})`)
  with a "Load 50 more" button rather than fetching every session up front —
  a 4s poll (for live status) re-requests whatever's currently loaded, not
  just the first page, so "Load more" isn't undone every few seconds
- Click any file/image attachment — on a message you just sent, or one from
  a past session you reopened — to preview it full-size. Past-session image
  attachments show under a generic name (`image.png`); the Anthropic API's
  image content block has no filename field, so it's genuinely not
  recoverable from a stored transcript
- Dark, orange-accented theme (Tailwind CSS v4) matching Claude's design
  language, with [lucide-react](https://lucide.dev/) icons throughout
- **Files changed** icon in the chat header (only appears once there's at
  least one in this chat) opens a dialog aggregating every Edit/Write tool
  call into a per-file diff — mirrors the official extension's "Diff" tab.
  There's no SDK-provided diff/code-review summary for this; it's built
  entirely from tool_use inputs already flowing through the transcript
  (`Edit`'s `old_string`/`new_string` line-diffed with the `diff` package; a
  `Write` shows its full written content, not a diff, since there's no
  prior file state to diff it against). Scoped to top-level tool calls — a
  subagent's own Edit/Write calls (forwarded as flat lines under its Task
  card) aren't included.
- **Find in conversation** (the search icon in the chat header): a filter
  bar over the current chat's own messages/tool calls, with a match
  counter and prev/next navigation that scrolls the match into view.
  Separate from the Sessions screen's own search, which searches across
  session titles instead.
- **Copy conversation** (markdown) from the chat header, or hover any
  assistant response for a per-message copy button — both go through
  `vscode.env.clipboard.writeText` host-side (more reliable in a webview
  than the browser clipboard API). Tool calls collapse to a one-line
  mention in the export; thinking/context-notes/permission-prompts/turn-
  stats are omitted as non-conversational chrome.
- **Add folder to this chat** (in the `/` palette's Context section) grants
  the current chat access beyond its own folder (`Options.
  additionalDirectories`). Only takes effect starting with your *next* new
  chat if this one's already running a live query — there's no live
  control-request equivalent for an arbitrary sibling folder (the closest
  one, `register_repo_root`, only accepts a strict subdirectory of an
  existing root, and isn't even exposed as a public `Query` method). The
  palette action still applies immediately when nothing's been sent yet;
  either way, a note appears in the transcript confirming which case
  happened.
- **Command Palette + keybinding**: "Session Companion: New Chat"
  (⌃⌥⇧N / ⌘⌥⇧N) and "Session Companion: Focus Chat" work from anywhere in VS
  Code, not just by clicking the sidebar icon — including bringing the
  view into focus first if it isn't already visible.
- Desktop notification when a turn finishes while you're not looking at
  the chat (the view isn't visible, or VS Code doesn't have OS focus) —
  same-window only; it can't (without a much bigger host-side poller)
  notify about a *different* VS Code window/repo's chat finishing.

## Architecture

- `src/` — extension host, entered via `extension.ts`.
  - `providers/webviewProvider.ts` — wires webview messages to the session
    layer; owns the `WebviewViewProvider`.
  - `session/` — `agentSession.ts` owns the live `query()` session
    (streaming-input mode) from the Agent SDK, `asyncQueue.ts` feeds it
    prompts, `heartbeat.ts` tracks which sessions are actively responding
    (for the cross-window "Responding…" indicator).
  - `state/` — persisted `globalState` (read/unread tracking, archived
    sessions).
  - `utils/` — attachments, file mentions, repo naming, session-history
    replay — pure helpers with no session lifecycle of their own.
  - `chatPanel/` — the skeleton `chatSessionsProvider` (proposed API)
    integration that surfaces this extension in VS Code's built-in Chat
    panel; independent of the sidebar webview.
- `webview/` — the React UI, bundled separately for the webview sandbox.
  - `composer/` — the message input and everything anchored to it: model
    and mode pickers, the attach menu, `@`-mention autocomplete, the `/`
    command palette.
  - `sessions/` — the cross-repo Sessions home screen.
  - `transcript/` — the chat message list.
  - `dialogs/` — modal dialogs (currently just Help).
  - `components/` — generic UI primitives (Button, Popover, Collapsible,
    MenuItem, ...) with no feature-specific logic. `Popover` wraps
    [`@radix-ui/react-popover`](https://www.radix-ui.com/primitives/docs/components/popover)
    (the same primitive shadcn/ui's own Popover wraps) rather than a
    hand-rolled absolutely-positioned box, so every dropdown/tooltip in the
    composer gets real collision detection (flips/shifts to stay inside the
    sidebar's narrow width instead of overflowing it or forcing horizontal
    scroll). `Collapsible` similarly wraps
    [`@radix-ui/react-collapsible`](https://www.radix-ui.com/primitives/docs/components/collapsible)
    for the transcript's collapsible step cards.
  - `lib/` — cross-cutting infra (`cn` class merging, the `vscodeApi`
    messaging wrapper).
  - `utils/` — pure helpers (relative time formatting, tool-use labels,
    replay-to-transcript conversion, token-count formatting).
- `shared/protocol.ts` — the typed message contract between host and webview
  (`HostToWebviewMessage` / `WebviewToHostMessage`).

Cross-repo session listing uses the SDK's `listSessions()` with no `dir`
filter, which already returns sessions from every repo on the machine — no
custom repo registry needed.

## Requirements

- VS Code with an existing Claude Code login (the extension reuses your
  `~/.claude` credentials; no separate auth flow)
- Node.js for building

## Development

```bash
npm install
npm run watch    # esbuild + Tailwind in watch mode
```

Press `F5` in VS Code to launch an Extension Development Host with the
extension loaded. The `chatSessionsProvider` proposed API requires running
inside the Extension Development Host — a normal ("Install from Location")
install will log a warning and fall back to the sidebar webview view only.

```bash
npm run build     # production build (dist/extension.js, dist/webview/*)
npx tsc --noEmit  # typecheck
npm test          # unit tests (vitest)
```

## Unit tests

Unit tests use [Vitest](https://vitest.dev/). Each file's tests live in a
`__tests__` subfolder right next to it (e.g. `src/utils/repoName.ts` /
`src/utils/__tests__/repoName.test.ts`), not beside the file itself.

```bash
npm test         # run once
npm run test:watch
```

They cover the parts of the codebase that are actually unit-testable in
isolation: pure helpers (`repoName`, `relativeTime`, `toolLabel`, `replay`,
`sessionHistory`, `cn`), `AsyncQueue`, `HeartbeatWriter`/heartbeat file
handling (against a real temp directory), the persisted-state classes
(`ArchiveState`/`ReadState`), and the webview's reducer (`App.tsx`'s
`reducer`/`initialState`, both exported for this purpose) — the single
largest piece of non-trivial logic in the UI. They intentionally don't try
to test `agentSession.ts` or `webviewProvider.ts` end-to-end; those are
better covered by actually driving the extension (see below) or by the
throwaway-script-against-the-real-SDK pattern described further down.

`vscode` isn't a real installed package — it only exists inside the VS Code
Extension Host — so `vitest.config.mts` aliases it to `test/mocks/vscode.ts`,
a minimal hand-written mock (extend it as tests need more of the API
surface). Production files still `import * as vscode from "vscode"` and
type-check against the real `@types/vscode`; the alias only swaps the
module at test runtime. One wrinkle: real `vscode.workspace.workspaceFolders`
is typed read-only, but tests need to set it as fixture data — in a test
that needs this, import the mock by its relative path
(`../../../test/mocks/vscode` from a `__tests__` folder) instead of the
bare `"vscode"` specifier, so it type-checks against the mock's (mutable)
shape instead. Vitest resolves both specifiers to the same module
instance, so this doesn't change what runs — see
`src/utils/__tests__/fileMentions.test.ts` for the pattern.

Any webview module that transitively imports `lib/vscodeApi.ts` calls the
webview-only global `acquireVsCodeApi()` at import time; `test/setup.ts`
stubs it before tests run (wired via `test.setupFiles` in
`vitest.config.mts`).

## Testing locally

Unit tests cover pure logic, but this is still, at its core, a thin UI/
wiring layer over the Agent SDK — the useful signal for everything else
comes from actually driving it:

1. `npm run watch`, then `F5` to launch the Extension Development Host.
2. Open the "Session Companion" activity bar icon. The **Sessions** screen should
   list existing sessions from *any* repo you've used Claude Code in, not
   just the one currently open.
3. Start a chat, confirm streaming text, tool-call cards, and the model /
   mode pickers in the composer all work; hit back and confirm the session
   shows up (and its "Responding…" status clears) in the Sessions list.
4. Try `@file` mentions, the `/` command palette (and typing `/` plus more
   characters to narrow it to inline slash-command autocomplete), attaching
   a file/image, and archiving/deleting a session.
5. Drag-and-drop can't be scripted from here — it needs a real OS drag
   gesture — so give it a manual pass: drag a file from Finder/Explorer
   onto the composer (should attach it, same as "Upload from computer"),
   and drag a file from VS Code's own Explorer onto the composer (should
   insert an `@relativePath` mention instead, since it's already in the
   workspace).
5. After any non-trivial change: `npx tsc --noEmit` (typechecks both the
   extension host and the webview from one `tsconfig.json`), `npm test`,
   then `npm run build`.

If you're changing how `agentSession.ts` calls a `Query` control method
(`rewindFiles`, `mcpServerStatus`, `supportedAgents`, etc.), don't trust the
`.d.ts` alone — verify against the real CLI first. Drop a throwaway script
importing `@anthropic-ai/claude-agent-sdk` directly, run it with plain
`node` from the repo root (needed for module resolution), and delete it once
confirmed. This caught real bugs during development that types alone didn't:

- `rewindFiles` needs the sent message to carry a `uuid` — undocumented in
  the public type — or its `user_message_uuid` never echoes back and Rewind
  silently never has anything to rewind to.
- `SDKUserMessage.priority` (`'now' | 'next' | 'later'`, also undocumented)
  is what the queue/steer feature runs on. Empirically: `'later'` waits for
  the in-flight turn's `result` before running as its own turn (Add to
  Queue); `'now'` (and, it turns out, the default with no `priority` at
  all) folds the message into the currently-running turn instead of queuing
  it (Steer with Message) — so a plain send while a turn is in progress
  already steers by default; you have to opt into `'later'` to actually
  queue instead.
- There's no public `compact()` method on `Query`. Compaction is triggered by
  sending the literal string `"/compact"` as a normal user message through
  the same `sendMessage()` pipeline as everything else — confirmed by the
  resulting `system` messages (`status: 'compacting'` → `compact_result:
  'success'` → a `compact_boundary` with token-count metadata).
- `SDKResultMessage.total_cost_usd` is the running cumulative total for the
  session, not a per-turn delta — read the latest value rather than summing
  across turns. `duration_ms` and `usage` (input/output tokens), by
  contrast, confirmed empirically to be per-turn already (checked across two
  turns of a real streaming-input session — each reset rather than grew) —
  the per-message stats line under each response (duration · cost · tokens)
  diffs `total_cost_usd` against the previous result to get a per-turn cost,
  but reads `duration_ms`/`usage` straight off the same message.
- `Query.getContextUsage({ detail: 'full' })` returns the category breakdown
  used for the context-window gauge; its category names come straight from
  the SDK, so they won't exactly match another tool's own taxonomy (e.g.
  GitHub Copilot's "System Instructions" / "Tool Definitions" labels).

## Known scope limits

A few "Customize"/"Settings" actions in the `/` palette don't have a
corresponding live SDK control and instead open the relevant file directly:

- **Hooks**, **Permissions**, **General config**, **Remote Control** → open
  `~/.claude/settings.json`
- **Memory** / **Instructions** → open the workspace's `CLAUDE.md`
- **Manage plugins** → reloads plugins (no list/add/remove API)
- **Switch account** → shows current account info; use `/login` in a
  terminal to actually switch accounts
- The context window gauge needs a live `Query`; the host pre-warms one
  (`AgentSession.warmStart()`) as soon as a chat becomes current — on
  opening a past session (which already has real history to report) and on
  starting a new chat — rather than waiting for the first message, so the
  gauge is available immediately in both cases
- Dragging a file from VS Code's own Explorer or an open editor tab onto the
  composer requires holding **Shift**: VS Code intercepts that drag by
  default to move/open the tab instead of forwarding it to the webview
  (documented VS Code webview behavior; the official Claude Code extension
  has the same restriction). OS-level drags (Finder/File Explorer) aren't
  affected. There's no way to detect or announce this from inside the
  webview when Shift isn't held — VS Code never delivers the drag event to
  us at all in that case — so this is called out in the Attach menu and
  Help dialog instead of at the moment of the failed drag.
- Collapsible step cards (tool calls, thinking, IDE context notes) default
  to open while running/streaming and collapsed once finished; clicking any
  one of them overrides the smart default for that card until the page is
  reloaded (there's no per-card "always expand this kind" preference).
- Thinking cards only appear if the account/model plan actually returns
  extended-thinking content for a turn — the thinking toggle in the `/`
  palette only controls whether it's *requested*
  (`thinking: {type: 'adaptive'}` vs. `{type: 'disabled'}`); Claude may
  still summarize or omit it depending on the request.
- Servers added via "Add server..." don't persist across a New Chat or
  reopening a past session — each is a fresh SDK connection, and dynamically
  added MCP servers are tied to the connection they were added to. Re-add
  them per chat, or add them to `.mcp.json` instead if you want them
  available everywhere.
- No inline file preview on Read/Edit tool cards: `Query.readFile()` looked
  like the right API for this but returned `null` in every real-CLI test we
  ran (in-scope and out-of-scope files, relative and absolute paths) — its
  own doc comment suggests it may only work in VS Code's own remote/web
  sidebar, not a third-party extension session. Deferred rather than
  shipped non-functional.
- The chat's `cwd` starts out as `vscode.workspace.workspaceFolders[0]` —
  the *first* root folder of the VS Code window, single-folder or
  multi-root. Sessions are saved exactly where the official CLI would save
  them for that same directory
  (`~/.claude/projects/<cwd-with-slashes-as-dashes>/`), confirmed by
  inspecting a real session file on disk — so `claude --resume` from a
  terminal **does** find them, as long as you run it from that exact
  folder (not a subdirectory, which the CLI treats as a different project
  key). Opening a past session tied to a *different* folder that's also
  open in this same multi-root workspace repoints the live session there
  (disposing and rebuilding it) instead of always spawning a new window.
  For a folder that isn't open anywhere on this machine, the
  `sessionCompanion.crossRepoOpenBehavior` setting decides what
  happens: `addToWorkspace` (default) adds it to this window's workspace via
  `vscode.workspace.updateWorkspaceFolders` and opens inline, staying in one
  window; `newWindow` opens a separate VS Code window for it instead (and
  that new window still lands directly on the right chat, via a small
  cross-window handoff — `PendingSessionOpenState`/`requestPendingSessionOpen`
  — instead of a blank Sessions screen).

Voice input is not implemented: VS Code's webview runs in Electron/Chromium,
and the browser `SpeechRecognition` API requires Google's proprietary cloud
speech backend, which isn't available outside actual Google Chrome.
