# AGENTS.md

Guidelines for any agent (or human) working on Session Companion.
See `README.md` for what this extension does and how to run it. A local,
gitignored `FEATURES_BACKLOG.md` may exist for candidate features not yet
built — see "Working the features backlog" below.

## Node & tooling

- Node version is pinned in `.nvmrc` (`24.5.0`) and `package.json`
  `engines.node`. Run `nvm use` before installing/building. Keep
  `@types/node`'s major version in sync with `.nvmrc`'s major version.
- Every entry in `dependencies`/`devDependencies` is pinned exact (no `^`
  or `~`) — this repo wants reproducible installs, not semver-range drift.
  `.npmrc` sets `save-exact=true` so `npm install <pkg>` / `npm install
  <pkg> --save-dev` already writes an exact version without needing
  `--save-exact` on the command line — don't undo that by hand-editing a
  range back in, and don't add a second `--save-exact` (redundant with
  `.npmrc`, harmless but noisy). After adding or bumping a package, grep
  `package.json` for `[\^~]` in the dependency sections to confirm nothing
  slipped in un-pinned. The `engines.vscode`/`engines.node` fields are
  compatibility ranges, not installed packages — leave those as ranges.
- Typecheck with `npx tsc --noEmit` — one `tsconfig.json` covers both
  `src/` (extension host) and `webview/src/` (React UI), so this is the
  single source of truth for "does everything compile."
- Build with `npm run build` (production) or `npm run watch` (dev, esbuild +
  Tailwind CLI in watch mode). Run `tsc --noEmit`, `npm test`, and a build
  after any non-trivial change, before calling it done.
- The Agent SDK (`@anthropic-ai/claude-agent-sdk`) is ESM-only. It's listed
  in esbuild's `external` array and imported with a dynamic
  `await import("@anthropic-ai/claude-agent-sdk")` inside functions, never a
  static top-level import — a static import bundled into the CJS extension
  host crashes at load time (`createRequire(import.meta.url)` becomes
  `undefined` under esbuild's CJS output). Don't "clean this up" into a
  static import.
- Hit npm's known optional-dependencies bug
  (https://github.com/npm/cli/issues/4828) after installing
  `@radix-ui/react-tooltip`: `npm install` reported success, but Vitest then
  failed at startup with `Cannot find native binding` /
  `Cannot find module '@rolldown/binding-wasm32-wasi'` — the platform-correct
  native binding silently didn't get installed. A plain `npm install` again
  did **not** fix it. The fix npm's own error message suggests is the real
  one: `rm -rf node_modules package-lock.json && npm install`. If a fresh
  dependency install leaves Vitest/esbuild unable to find a native binding,
  don't debug further — go straight to the full reinstall.

## Icons

- Use [lucide-react](https://lucide.dev/) for every icon in the webview.
  No emoji, no ASCII-art glyphs (`+`, `x`, `</>`, etc.) standing in for an
  icon. The one standing exception is keyboard-shortcut notation in text
  (e.g. `⇧+Tab`) — that's key notation, not an icon.
- Size convention: `14` inside menu items/rows, `16` for composer/toolbar
  trigger buttons, `18` for larger standalone icon buttons (e.g. session
  list refresh/help). Match whatever's already in the surrounding file
  before introducing a new size.
- All interactive elements (buttons, toggles, menu triggers) get
  `cursor-pointer` explicitly — VS Code's webview default cursor doesn't
  always signal clickability on its own.

## Folder structure

Both `src/` and `webview/src/` are organized by concern, not file type.
When adding a new file, put it in the folder matching what it *does*:

- `src/providers/` — webview host wiring (`WebviewViewProvider`)
- `src/session/` — the live SDK `query()` session, its input queue, and
  heartbeat/active-session tracking
- `src/state/` — persisted `globalState` (read/unread, archived sessions)
- `src/utils/` — pure helpers with no session lifecycle of their own
- `webview/src/composer/` — the message input and everything anchored to
  it (model/mode pickers, attach menu, mentions, slash palette)
- `webview/src/sessions/` — the cross-repo Sessions home screen
- `webview/src/transcript/` — the chat message list
- `webview/src/dialogs/` — modals
- `webview/src/components/` — generic UI primitives with zero
  feature-specific logic (Button, Popover, MenuItem, ...)
- `webview/src/lib/` — cross-cutting infra (`cn`, the `vscodeApi` wrapper)
- `webview/src/utils/` — pure helpers (formatting, transcript replay, token
  count formatting, ...)

`shared/protocol.ts` is the typed contract between host and webview
(`HostToWebviewMessage` / `WebviewToHostMessage`). Any new message needs a
case in both the webview reducer (`App.tsx`) and the host's
`onDidReceiveMessage` switch (`webviewProvider.ts`) — `tsc` will catch a
missing webview case (exhaustive union) but not a missing host case, so
check both by hand.

## Cross-repo session navigation

Opening a past session tied to a folder outside this window's own workspace
(`webviewProvider.ts`'s `openSession` case) has three tiers, checked in
order: same cwd → open inline; a different folder already in this window's
multi-root workspace → repoint the live `AgentSession` and open inline
(`repointAndOpen()`); genuinely not open anywhere → governed by the
`sessionCompanion.crossRepoOpenBehavior` setting (`addToWorkspace`
default, or `newWindow`).

- `vscode.workspace.updateWorkspaceFolders()` is synchronous and
  same-tick — per VS Code's own API contract, it only reloads the
  extension host when the change crosses the single-folder ↔ multi-root
  boundary (a bare single-folder window becoming multi-root). An
  already-multi-root window (the common case — this feature exists because
  a real user's window already had 3 folders) keeps this exact
  `webviewProvider` instance and webview alive across the call, so
  `addToWorkspace` calls `repointAndOpen()` immediately afterward rather
  than waiting for a remount that won't happen for that window shape. It
  also stashes the same `PendingSessionOpenState` entry as a safety net
  first, purely for the single-folder-window case that *does* reload — the
  reloaded extension host's fresh webview picks it up via
  `requestPendingSessionOpen` the normal way; harmless no-op otherwise
  (cleared right after `repointAndOpen()` succeeds).
- `updateWorkspaceFolders()` returns `false` if VS Code rejects the edit
  (e.g. a concurrent workspace edit) — treated as a signal to fall back to
  the `newWindow` path rather than silently doing nothing.
- The `newWindow` fallback (and `addToWorkspace`'s own single-folder-reload
  safety net above) both go through the pre-existing
  `PendingSessionOpenState` cross-window handoff: stash `{cwd, sessionId,
  title}` in `globalState` before `vscode.openFolder`, then the new
  window's webview posts `requestPendingSessionOpen` on mount and the host
  consumes/clears the stash if `pending.cwd` matches — so the new window
  lands directly on the right chat instead of a blank Sessions screen.

## File mentions

- `vscode.workspace.findFiles(include, exclude, maxResults)`'s `exclude`
  parameter takes exactly **one** glob pattern — a comma-separated string
  like `"**/node_modules/**,**/dist/**,**/.git/**"` (what `fileMentions.ts`
  originally had) is not brace-expanded automatically; minimatch only treats
  a literal comma as a literal comma unless it's wrapped in `{...}`. That
  string matches nothing, ever — a real, silent no-op exclude, not merely a
  weak one. Two compounding facts made this easy to ship unnoticed: (1) per
  `findFiles`'s own doc comment, passing *any* non-null `exclude` — even a
  broken one — replaces VS Code's own default excludes entirely rather than
  adding to them, so this bug didn't just fail to add filtering, it also
  disabled the user's own `files.exclude`/`search.exclude` settings for
  this call; (2) the existing unit test asserted the broken string as the
  *expected* call arg, so it silently encoded the bug as correct behavior
  instead of catching it. The fix is `"{**/.git/**,**/node_modules/**,**/dist/**}"`
  (brace-wrapped) — confirmed this is the actual required syntax by reading
  the shipped VS Code `vscode.d.ts` doc comment directly, not guessing.
- `findFiles` never respects `.gitignore` under any argument combination —
  confirmed from the same doc comment (`undefined` exclude → `files.exclude`
  only, explicitly *not* `search.exclude`; `null` → no excludes at all).
  Gitignore-awareness is Search-view/Quick-Open-only, not part of this API.
  `fileMentions.ts` gets it via the small `ignore` package (same one
  ESLint/Prettier's own ignore-parsing uses) reading each workspace folder's
  **root** `.gitignore` only — nested `.gitignore` files (rules scoped to a
  subdirectory) aren't combined in, a known, accepted gap for the common
  case. `ignore` is a CJS `export =` module with a merged
  function+namespace type (`declare namespace ignore { interface Ignore
  {...} }`) — import the value as `import ignore from "ignore"`
  (`esModuleInterop` handles the default-import shim) and get the instance
  type via `ReturnType<typeof ignore>`, not a named `{ Ignore }` import,
  which doesn't exist on this kind of declaration.
- A file-mention result's `relativePath` is computed relative to the
  **current chat's `cwd`**, not the matched file's own containing folder —
  this matters once there's more than one workspace folder open. The
  inserted `@relativePath` text is what the model resolves a file
  reference against, relative to the session's own `cwd`; a path relative
  to a *different* folder (e.g. a match living in a sibling repo) would
  silently resolve to the wrong file, or nothing, once inserted. Fixed by
  switching from `vscode.workspace.asRelativePath()` (relative to the
  match's own folder) to `path.relative(cwd, uri.fsPath)` (relative to the
  chat's folder — naturally produces a `../sibling-repo/...` path for a
  cross-folder match, which is exactly correct). The same fix applies to
  `resolveWorkspacePath` (the drag-and-drop mention path), which had the
  identical bug. `repoName` (the owning folder's display name, for the
  autocomplete's subtitle) is a separate, display-only field — it doesn't
  change what gets inserted into the composer.

## Files-changed view, in-chat search, and additional directories

- The `toolUse` `TranscriptItem` only carried a pre-formatted `label`
  (`describeToolUse(name, input)`'s output, e.g. "Edit foo.ts") until the
  Files-changed view needed to reliably tell tool *kinds* apart — the raw
  SDK tool name (`"Edit"`, `"Write"`, ...) was computed at both construction
  sites (`App.tsx`'s live "toolUse" case, `replay.ts`'s replay mapping) but
  discarded once `label` was built. Added `name: string` alongside `label`
  on the type rather than trying to parse it back out of the formatted
  label string. `extractFileChanges()` (`utils/fileChanges.ts`) is the
  first consumer; check `name` directly for any future feature that needs
  to distinguish tool kinds programmatically, not `label`.
- The Files-changed view (`FileChangesDialog.tsx`) is built entirely from
  `Edit`/`Write` `tool_use` inputs already flowing through the transcript —
  no SDK-provided diff/code-review summary exists (checked `sdk.d.ts` for
  `codeReview`/diff-summary types; nothing). An `Edit`'s `old_string`/
  `new_string` line-diffs correctly with the `diff` package's `diffLines()`
  since they're real before/after snippets; a `Write`'s `content` is the
  *whole* file with no prior state available to diff against, so it's
  shown as full content, explicitly labeled as not a diff — faking a diff
  against nothing (e.g. treating the old side as empty) would misleadingly
  imply the entire file is new/added. Scoped to top-level tool calls only:
  a subagent's own Edit/Write calls are forwarded as flat lines under its
  Task card (`subagentSteps`), a different shape not covered here.
- `Options.additionalDirectories` (the "Add folder to this chat" palette
  action) can only be set at `ensureStarted()`'s spawn — there's no live
  control-request equivalent for an arbitrary sibling folder. The closest
  thing, `register_repo_root`, explicitly requires (per its own doc
  comment) "a strict subdirectory of cwd, or of a directory passed... via
  the SDK additionalDirectories option" — it flatly rejects a sibling
  folder like a neighboring repo, which is exactly the cross-repo case this
  extension's differentiator is built around. It's also not exposed as a
  public `Query` method anyway (only the raw control-request type exists in
  `sdk.d.ts`, like `get_usage` before it). `AgentSession.addDirectory()`
  returns whether a query was already running so the caller can tell the
  user it'll apply next chat instead of claiming it took effect when it
  didn't.
- Same-window desktop notifications (`notifyIfBackgrounded()` in
  `webviewProvider.ts`) piggyback on the existing `AgentSession` event
  pipe — no new poller. Cross-window/cross-repo "a chat somewhere else
  finished" notifications would need a real host-side poller (periodic
  `listSessions()` + `isSessionActive()` diffing across ticks) — deliberately
  not built; scoped down from the backlog's more ambitious framing once the
  real cost became clear. `<viewId>.focus"` (here,
  `"sessionCompanion.chat.focus"`) is VS Code's own auto-generated
  command for any view contributed via `contributes.views` — already relied
  on elsewhere in this codebase (`extension.ts`'s pending-session-open
  handling) before the "New Chat" command reused it to bring the view into
  focus with no webview interaction to trigger that from.

## Styling

- Tailwind CSS v4 (`@theme` in `webview/src/styles.css` for design tokens).
  Dark theme with an orange accent, matching Claude's design language.
  Reuse existing tokens (`bg-surface`, `text-muted`, `border-border`,
  `text-accent`, etc.) rather than hardcoding colors.
- No shadcn CLI (it doesn't target `vscode-webview`) — components under
  `components/` are hand-written Tailwind-classed React, styled to look
  shadcn-ish. Keep new primitives consistent with that look.
- For actual interactive behavior (positioning, focus, dismiss-on-outside-
  click/Escape) that a real headless-UI primitive already solves, install
  the underlying Radix package shadcn/ui itself wraps (e.g.
  `@radix-ui/react-popover` for `components/Popover.tsx`) rather than
  hand-rolling it — pin it exact like every other dependency. Don't reach
  for the shadcn CLI to do this (see above); just install the primitive and
  style its `className` the same way the rest of `components/` is styled.
  `Popover` takes `interactive` (default `true`) to pick Radix's `Trigger`
  (click/keyboard-driven anchor — used by every dropdown menu) vs. `Anchor`
  (a pure position reference with no click handling of its own — used by
  the hover-driven context-usage gauge). Don't give a `Trigger`-backed
  anchor its own `onClick` toggle: Radix's outside-click dismissal doesn't
  know to exempt an anchor that isn't the `Trigger` it manages, and a
  manual toggle on top of that races with Radix's own open/close state.
  `components/Collapsible.tsx` wraps `@radix-ui/react-collapsible` the same
  way, for the transcript's collapsible step cards
  (`transcript/TranscriptView.tsx`).
- `components/Tooltip.tsx` wraps `@radix-ui/react-tooltip` the same way, for
  hover tooltips on icon buttons across the app (replacing the plain native
  `title` attribute most of them used to have — one shared `TooltipProvider`
  mounted once at `App.tsx`'s root gives every `Tooltip` in the tree the
  same hover-intent delay and lets moving between adjacent tooltips in one
  row skip the delay, matching how a native tooltip row feels). **Don't**
  wrap a button that's already a `Popover`/dropdown-menu `anchor` (Radix
  `asChild` only clones one level via `Slot`; wrapping it in `<Tooltip>`
  means `Popover`'s `<Anchor asChild>` clones `Tooltip.Root` instead of the
  real `<button>`, and `Tooltip.Root` doesn't forward the merged
  onClick/ref/aria-* props anywhere — so the button silently stops opening
  the popover). `ModelPicker`/`ModePicker`/`SendMenu`/`AttachMenu`/
  `TasksTray`'s own trigger button keep their plain `title` attribute for
  exactly this reason — everything else uses `Tooltip`.
- Any transcript/markdown content that can contain a long unbroken token
  (a grep pattern, a file path, a URL) needs `min-w-0` on its flex-item
  ancestors plus `break-words` on the text container itself — a flex item's
  default `min-width: auto` means it won't shrink below its content's
  intrinsic width, so without `min-w-0` a single long token silently pushes
  the whole page into horizontal scroll instead of wrapping inside its own
  box. This bit us in `TranscriptView.tsx`'s tool-call label (a `rg -n
  "a|b|c" /long/path` command with no space in the pattern) and in
  `Markdown.tsx`'s root container. When adding new transcript item kinds,
  apply the same `min-w-0 break-words` (or `truncate` for a single-line
  collapsed summary — see the `toolUse`/`contextNote` trigger labels) to
  any container holding raw/untrusted-length text.

## Verifying against the real Agent SDK

Don't trust `.d.ts` comments alone for `Query` control methods
(`rewindFiles`, `mcpServerStatus`, `supportedAgents`, `updateSettings`,
etc.) — verify against the running CLI before wiring a feature to one.
Pattern that's worked throughout this project:

1. Write a throwaway `.mjs` script that imports
   `@anthropic-ai/claude-agent-sdk` directly and drives the method in
   question.
2. Run it with plain `node` **from the repo root** (module resolution
   needs the repo's `node_modules`).
3. Delete the script once you've confirmed the behavior.
4. If the script used `query()` with a real `cwd` (even `/tmp`), it created
   a real session file under `~/.claude/projects/`. Since this extension
   lists sessions from *every* directory on the machine, that scratch
   session will show up in the Sessions view. Delete it (find it by the
   session ID the script printed, or by the throwaway prompt text) once
   you're done — don't leave it for the user to find.

This caught real bugs type-checking alone wouldn't have: the ESM/
`createRequire` crash, `stream_event` block indices resetting every turn,
heartbeat write timing, and:

- `rewindFiles` silently never works unless the sent `SDKUserMessage`
  carries a `uuid` field (present in the SDK's runtime behavior but not in
  its documented public type).
- `SDKUserMessage.priority` (`'now' | 'next' | 'later'`, undocumented) is
  what "Add to Queue"/"Steer with Message" run on. `'later'` genuinely
  queues (waits for the in-flight turn's `result`, then runs as its own
  turn); `'now'` folds into the currently-running turn — and so does
  omitting `priority` entirely, which means a plain send while a turn is
  in progress already steers by default. Don't assume an undocumented
  enum-like field's values do what their names suggest; verify each one.
- There's no public `compact()`/`compactConversation()` method on `Query`.
  Compaction is triggered by sending the literal string `"/compact"` as a
  normal user message through the same streaming-input pipeline as
  everything else — confirmed by the resulting `system` messages
  (`status: 'compacting'` → `SessionStart:compact` hooks → `status: null,
  compact_result: 'success'` → a `compact_boundary` with `compact_metadata`
  token counts). This means the Compact Conversation button needs zero new
  host-side code — it just calls the existing send-message path.
- `SDKResultMessage.total_cost_usd` is cumulative across turns per its own
  doc comment — read the latest `result` message's value, don't sum across
  turns. It resets on a resumed session or a mid-session `/clear`.
- `Query.getContextUsage({ detail: 'full' | 'summary' })` returns
  `{ categories: {name, tokens, kind: 'used'|'free'|'buffer'|'deferred'}[],
  totalTokens, maxTokens, percentage, ... }`. `'full'` does per-category
  token-count API calls; `'summary'` estimates from the last response's
  usage without those extra calls. Category names are whatever the SDK
  itself reports — don't hardcode another tool's taxonomy (e.g. Copilot's
  "System Instructions"/"Tool Definitions" labels) expecting a 1:1 match.
  `getContextUsage()` requires a live `Query` — `ensureStarted()` fires it
  once as soon as the Query exists (not just after a turn's `result`), and
  `AgentSession.warmStart()` (a thin public wrapper around the private
  `ensureStarted()`) is called from `webviewProvider.ts` right after
  `session.reset(...)` for both "new chat" and "open a past session," so
  the gauge doesn't require the user to send a message first — a resumed
  session already has real history for `getContextUsage()` to report on.
- `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` exists on
  `Query` but is explicitly marked unstable in its own doc comment — don't
  wire anything to it. `SDKControlGetSessionCostRequest` similarly exists
  only as an internal control-request type with no public method wrapper —
  cost comes from `result.total_cost_usd`, not a dedicated cost API.
- Extended-thinking content streams as its own content-block type: a
  `content_block_start` event with `content_block.type === 'thinking'`,
  `content_block_delta` events with `delta.type === 'thinking_delta'` and a
  `.thinking` field (not `.text` — that's `text_delta`'s field), and a
  `signature_delta` right before `content_block_stop` (an opaque value,
  never rendered). `AgentSession` tracks thinking block indices in their
  own `Set` (mirroring `textBlockIndices`) and emits
  `thinkingDeltaStart`/`thinkingDelta`/`thinkingDeltaEnd`, parallel to the
  existing text events. A stored session's `assistant` message content can
  likewise include `{ type: 'thinking', thinking: string }` blocks —
  `buildReplayItems` (`src/utils/sessionHistory.ts`) maps those to a
  `thinking` `ReplayItem` the same way it maps `text` blocks to
  `assistantText`.
- The IDE integration (when driving a session via the real `claude` CLI
  with IDE hooks active — e.g. a session created outside this extension and
  later opened here) auto-injects context as ordinary `user`-role messages
  wrapped in a tag like `<ide_opened_file>...</ide_opened_file>` or
  `<ide_selection>...</ide_selection>`. These aren't something the person
  typed, so rendering them as a normal chat bubble looks broken (a huge
  literal-XML message attributed to "you"). `sessionHistory.ts` detects
  this structurally — the whole trimmed message wrapped in one matching
  `<tag>...</tag>` pair, via `isSystemContextTag()` — rather than an
  allowlist of known tag names, so new tag types the IDE integration adds
  later are still caught. Detected ones become a `contextNote` `ReplayItem`
  instead of `user`, rendered as a small collapsed note
  (`TranscriptView.tsx`) instead of a chat bubble. This is only wired into
  session-history replay, not the live turn path — this extension doesn't
  drive its own IDE-file-open hook integration, so a live session it's
  driving directly shouldn't produce these; if that changes, mirror the
  same detection in `AgentSession`'s live `"user"` message handling.
- `Options.forkSession: true` (with `resume: <id>`) confirmed empirically:
  the forked session gets a genuinely different `session_id` on its very
  first message than the one it resumed from (verified twice against the
  real CLI), leaving the original session's file untouched. `AgentSession.
  reset(resumeSessionId, { fork: true })` deliberately leaves
  `knownSessionId` unset in this case rather than seeding it with the old
  id, since the real new id isn't known until the SDK reports it.
- `Options.promptSuggestions: true` is accepted with no errors across
  several real turns, and the `prompt_suggestion` message shape
  (`{ type: 'prompt_suggestion', suggestion: string }`) is a documented,
  typed part of `SDKMessage` — but it never actually fired in manual
  testing (multiple turns, cwd `/tmp`, trivial-to-moderate prompts). Per
  its own doc comment it's suppressed on the first turn, after API errors,
  in plan mode, and near/at plan usage limits — one of those (most likely
  account plan-limit proximity, or simply the model's own judgment that no
  suggestion was warranted) probably explains it here. Wiring
  (`agentSession.ts`'s `handleMessage`, the `promptSuggestion` chip in
  `App.tsx`) is in place and type-correct; if it's still never observed
  once genuinely exercised through the extension, that's worth a closer
  look rather than assuming the plumbing is right.
- `Options.allowDangerouslySkipPermissions: true` genuinely gates
  `bypassPermissions` at runtime, not just at initial `query()` construction
  — confirmed empirically: calling `Query.setPermissionMode('bypassPermissions')`
  on a session started without the flag throws `Cannot set permission mode
  to bypassPermissions because it is disabled by settings or configuration`
  immediately. `agentSession.ts` passes the flag unconditionally (safe on
  its own — the effective mode still starts at `'default'` and only changes
  when the user explicitly requests it); `webviewProvider.ts`'s
  `requestBypassPermissions` handler is the only thing that actually
  switches to it, gated behind a modal `vscode.window.showWarningMessage`
  confirmation.
- `Options.forwardSubagentText: true` + `Options.agentProgressSummaries: true`
  confirmed empirically against a real Task-tool subagent spawn: subagent
  content arrives as ordinary `assistant`-type messages with
  `parent_tool_use_id` set to the spawning Task's `tool_use_id` (one message
  per completed content block — thinking, tool_use, text all observed,
  matching the general "one assistant message per completed content block"
  behavior). `task_started` (`is_backgrounded`, `description`,
  `subagent_type`), `task_progress` (`summary` when the AI-generated one is
  available, else fall back to `description` — in testing, a trivial
  subagent task only ever populated `description`), and `task_updated`
  (`patch.status`) all fired as documented. **Important**: `stream_event`
  (`SDKPartialAssistantMessage`) also carries a top-level
  `parent_tool_use_id: string | null` sibling to `event` — if a subagent's
  partial stream ever comes through with `includePartialMessages: true`,
  reusing the main thread's per-index `blockId` scheme for it risks a
  collision with a concurrently-streaming main-thread block (relevant if a
  Task subagent gets backgrounded and the main turn keeps generating past
  it). `agentSession.ts`'s `handleMessage` explicitly ignores any
  `stream_event` with a non-null `parent_tool_use_id` for this reason —
  subagent content is rendered from the complete (non-partial)
  `assistant`/`user` messages only. Didn't actually observe a subagent
  partial stream_event in testing, but the guard costs nothing and the risk
  is real per the type shape.
- `system`/`background_tasks_changed` confirmed to have REPLACE semantics
  exactly as documented — `message.tasks` is the full current live set, not
  a delta, so the webview's `backgroundTasksChanged` reducer case just
  overwrites `state.backgroundTasks` wholesale rather than merging.
- `Query.backgroundTasks(toolUseId)` can return `false` even for a real,
  genuinely-backgroundable Bash task if called too soon after the tool_use
  block first appears — in testing, calling it within milliseconds of
  seeing the `tool_use` block raced ahead of the CLI's own task
  registration and returned `false`, while `background_tasks_changed` still
  later reported the same task as backgrounded through some other path.
  This is very unlikely to matter for the real UI (a human clicking "run in
  background" takes far longer than that race window), but if this control
  seems to silently fail, check timing before assuming it's broken —
  `webviewProvider.ts`'s `backgroundTask` handler already surfaces a
  best-effort "Nothing to background for this tool call" notification when
  it returns `false`, which could show up on that race in rare cases.
- `Query.readFile(path, opts)` returned `null` in every real-CLI attempt —
  an in-scope file directly under `cwd`, an out-of-scope one, both relative
  and absolute paths, no thrown errors either time. Its own doc comment
  ("for the remote sidebar viewer") suggests this control request may be
  scoped to VS Code's own remote/web sidebar feature specifically, not a
  generically-usable file-read API for any SDK consumer. **Don't wire a
  feature to this without re-verifying first**.
- `getSessionInfo(sessionId, { dir })`'s auto-generated `summary` (custom
  title, or an AI-generated one, or a first-prompt fallback) is already
  readable the moment the first turn's `result` message fires — confirmed
  empirically (checked immediately and at +500ms/+1.5s/+3s/+6s/+10s/+15s
  after `result`, value was already final at +0ms both for a trivial "Say
  OK." prompt, which never got past the first-prompt fallback, and for a
  substantive one, which got a real generated title immediately). No
  polling or delay needed — `agentSession.ts`'s `loadSessionTitle()` does
  one lookup right after `result` (guarded by a `titleKnown` flag so a
  resumed, already-titled chat isn't re-queried every turn) and emits the
  same `sessionRenamed` event the explicit rename flow uses.
- Investigated backfilling the per-turn stats line (duration/cost/tokens,
  see the Features list) for replayed past sessions, and deliberately
  didn't ship it — don't re-attempt without re-verifying:
  - `getSessionMessages()`'s `SessionMessage` return type doesn't declare a
    `timestamp` field (`message: unknown` too), but confirmed empirically
    that both `entry.timestamp` (ISO string) and, for assistant entries,
    `entry.message.usage` (the raw per-completion Anthropic API usage
    object) are genuinely present at runtime — same undocumented-field
    pattern as `rewindFiles`' `uuid` requirement and `SDKUserMessage.
    priority` elsewhere in this doc.
  - Cost is not recoverable at all: grepped a real session's `.jsonl` for
    `total_cost_usd`/`duration_ms`/any `*cost*` field — zero matches. Only
    token counts are ever persisted, no pricing data.
  - Tokens looked reconstructable (sum each top-level, non-subagent
    assistant entry's `message.usage.input_tokens`/`output_tokens` between
    two real human-sent messages) but turned out unreliable: for a real
    multi-tool-call turn, that sum came to 14 output tokens while the
    live `SDKResultMessage.usage.output_tokens` for the equivalent turn was
    197 — a ~14x undercount. The stored transcript's visible assistant
    messages don't expose everything that counts toward the SDK's own
    per-turn usage total (extra internal model calls, or something else
    server-side not surfaced 1:1 as client-visible messages).
  - Only duration is honestly reconstructable (diff the first and last
    message `timestamp` in a turn) — approximate wall-clock, not the SDK's
    own measured `duration_ms`. Shipping duration alone, with no
    cost/tokens, was judged not worth the visible inconsistency with the
    live version of the same stats line — deliberately skipped rather than
    shipped partial.
- `listSessions({ limit })` confirmed empirically to already return sessions
  in `lastModified`-descending order (checked against a manual sort of the
  unlimited result — identical) — safe to rely on for the Sessions list's
  "Load 50 more" pagination without re-sorting or second-guessing the SDK's
  ordering.
- The standalone `forkSession(sessionId, { upToMessageId })` function (used
  for the "edit a message" flow, distinct from `Options.forkSession` — the
  live-resume-time option used by the plain "Fork conversation" button) has
  two confirmed-empirically gotchas:
  - `upToMessageId` rejects a non-UUID string outright — throws `Invalid
    upToMessageId: <value>` — even for a value that's the literal uuid of a
    real message in that exact session. Always use real UUIDs
    (`randomUUID()`) for outgoing message uuids, never a human-readable
    placeholder; this repo already does, both webview- and host-side.
  - Every message in the forked copy gets a **new**, regenerated uuid —
    confirmed by forking a 2-turn session and finding the forked copy's
    single message had a uuid matching neither original. Don't reuse
    pre-fork uuids after forking; re-fetch the forked session's own
    `getSessionMessages()` result for its authoritative (new) uuids if
    anything downstream needs to reference a message in it again (e.g.
    editing a message a second time, in the newly-forked session).
  - `upToMessageId` is inclusive and correctly stops right there — forking
    up to a user message's own uuid excludes that message's assistant
    reply (it comes after); forking up to that reply's uuid instead
    includes both. Confirmed with both cases against a real 3-turn session.
- `Query.supportedCommands()`/`mcpServerStatus()` confirmed empirically to
  return complete, correct results immediately — no warm-up call or delay
  needed, and no evidence of stale/partial data. The "/" palette's search
  couldn't find custom slash commands or MCP servers not because the SDK
  hadn't loaded them, but because `SlashPalette.tsx`'s root-view search only
  ever matched its ~20 hardcoded static category-row labels (e.g. `matches("MCP
  servers")` — checking whether the user's query matched the literal English
  string "MCP servers", not whether any actual MCP server matched). It never
  searched into the real `slashCommands`/`mcpServers`/`agents`/`skills`
  arrays. Fixed by adding dedicated search-result sections
  (`webview/src/utils/paletteSearch.ts`'s `matchesName`/
  `matchesNameOrDescription`) that filter those real arrays and only render
  when non-empty. Relatedly, `mcpServers`/`agents`/`skills` (unlike
  `slashCommands`) were only fetched lazily on first visit to their own
  subview, not eagerly on palette mount — so a search could come up empty
  simply because the user had never opened that subview this session. Fixed
  with a mount-time `useEffect` that requests all three up front.
- The standalone `resolveSettings({ cwd })` function reports the effective,
  fully-merged Claude Code settings (project/user/managed/flag tiers) the
  same way the CLI itself would resolve them for that cwd, without spawning
  a `Query` — confirmed empirically against this machine's real
  `~/.claude/settings.json` (`permissions.defaultMode: "auto"`, source
  reported as `"user"`). Two things matter before acting on the result:
  - `permissions.disableBypassPermissionsMode: 'disable'` is the real org
    policy the user suspected might exist — it's a restrictive switch, safe
    to read straight off `resolved.effective.permissions` and act on
    immediately (hide/guard "Full bypass" — see `ModePicker.tsx`'s
    `bypassPermissionsDisabled` prop and `webviewProvider.ts`'s
    `requestBypassPermissions` guard). On this machine, nothing sets it —
    Full Bypass being absent from the official extension's palette (per a
    user screenshot) isn't evidence of an org policy block here; it's that
    extension's own UI subset, not something `resolveSettings()` reports.
  - `permissions.defaultMode` is **not** similarly safe to trust as-is: the
    CLI only honors an *escalating* value (`bypassPermissions`/`auto`/
    `acceptEdits`) when it wasn't set by a repo-committed (`project`) tier
    — otherwise a malicious repo's checked-in `.claude/settings.json` could
    silently escalate a fresh clone's session. Always pass the
    `ResolvedSettings` through `filterEscalatingDefaultMode()` before
    reading `defaultMode` off the result; never read
    `resolved.effective.permissions.defaultMode` directly.
  - `webviewProvider.ts` calls both once per session build (fire-and-forget,
    since `ensureStarted()` doesn't run until the user's first
    message/warmStart — see `AgentSession.setPermissionDefaults()`), then
    falls back to this extension's own remembered last-picked mode
    (`PermissionModeState`, `src/state/permissionModeState.ts`) only when
    neither tier configures a `defaultMode` at all.
- A slash command typed into the interactive CLI (`entrypoint: "cli"` in the
  stored transcript) gets expanded, before it's ever persisted, into a
  tag-wrapped string as the user message's actual content — e.g.
  `<command-message>update-config</command-message>\n<command-name>/update-
  config</command-name>`. Confirmed against real stored sessions that tag
  order and whitespace both vary across CLI versions (an older format with
  just `command-message`/`command-name`; a newer one that adds
  `command-args` and puts `command-name` first). This is a stored-transcript
  fact, not something this extension's own live send path produces or needs
  to guard against — a live-sent message's bubble always renders from the
  locally dispatched text, never from a round-tripped SDK message, so only
  replay was ever affected. `sessionHistory.ts`'s `parseSlashCommandMessage()`
  detects it structurally (strip every known tag, require nothing but
  whitespace left over) and collapses it to the compact `/update-config` the
  terminal and official extension both show, instead of dumping the raw
  wrapper into the bubble.
- Org spend-limit/rate-limit usage data (`SDKUsageReport`) has **no**
  dedicated `Query` method — confirmed by listing every method on the
  `Query` interface in the SDK's own `.d.ts`; unlike `getContextUsage()`,
  there's nothing to call directly. The only way to get it is to send the
  literal message `"/usage"` (the same "just send the slash command" trick
  already used for `/compact`) and read the `usage_report` field the CLI
  attaches to the resulting synthetic assistant message — confirmed
  empirically end-to-end against this machine's real Enterprise account:
  `extra_usage.monthly_limit`/`used_credits` came back as **cents** (250000 /
  56462), matching Claude Desktop's own "$559.25 of $2,500.00 spent, 22%
  used" display once divided by 100 — see `toMajorUnits()` in
  `src/utils/usageReport.ts`. More from the empirical check, including a
  real design mistake it took a live bug report to surface:
  - Even a pure local-command send (no LLM turn, `total_cost_usd: 0`) still
    gets persisted as a real session file — confirmed by finding the
    throwaway verification session under `~/.claude/projects/-private-tmp/`
    afterward and deleting it (same cleanup discipline as every other
    verification script here).
  - First design mistake, caught by a real user report rather than testing:
    `requestUsage()` initially sent "/usage" on the AgentSession's own
    **current** session specifically to avoid spawning an extra session
    file. That reasoning only holds when a real session already exists to
    piggyback on. Once the Usage button moved to the Sessions screen (not
    tied to any open chat), "the current session" was usually a blank,
    never-started one — so the probe became the session's *first* message,
    the CLI auto-titled the new session "/usage" from it, and that
    now-real session immediately showed up in the cross-repo Sessions list.
    Fixed by making the probe fully standalone: its own `query()` call,
    never touching `this.query`/`this.inputQueue`, with the resulting
    session explicitly removed via `deleteSession()` (best-effort) once the
    probe has its answer. This does spawn one throwaway CLI process per
    click — acceptable for a manual, occasional stats check — but never
    touches the user's real chat state or session list, in either
    direction (no piggybacked pollution of an existing chat's transcript,
    no stray new entries in the Sessions list).
  - `extra_usage` (the monthly spend cap) carries no `resets_at` — only the
    plan's own `limits[]` rows do. `UsageDialog.tsx` doesn't fabricate a
    reset date for the spend-limit bar; it only shows one where the SDK
    actually supplies it (a `limits` row).

## Testing

- Vitest, not Jest — this repo already leans on esbuild/Vite-family tooling
  and Vitest's config/mocking model (`resolve.alias`, native ESM, no
  transform config needed for TS) fits it directly; Jest would need extra
  ts-jest/babel wiring for the same result. Run with `npm test` (single
  run) or `npm run test:watch`.
- Tests live in a `__tests__` subfolder next to what they test: `foo.ts` →
  `__tests__/foo.test.ts` in the same directory (not `foo.test.ts` beside
  it). Every relative import inside a test file is one level deeper than
  it would be for a sibling file — `./foo` becomes `../foo`, `../../shared`
  becomes `../../../shared`, etc. Don't put test files straight in `src/`
  or `webview/src/` at the repo-root `test/` directory — that's reserved
  for cross-cutting test infra (currently `test/mocks/vscode.ts` and
  `test/setup.ts`), not test files themselves. Vitest's default include
  glob (`**/*.test.ts`) already matches any depth, so `__tests__/*.test.ts`
  needs no config change.
- `vscode` isn't installable — it only exists inside the VS Code Extension
  Host. `vitest.config.mts` aliases the specifier to `test/mocks/vscode.ts`
  for test runs; production code still imports the bare `"vscode"` and
  type-checks against the real `@types/vscode`. Extend the mock file as
  tests need more of the API surface — keep it to what's actually used,
  it's not trying to be a full fake VS Code.
- The alias only affects runtime resolution, not `tsc`. If a test needs to
  set a property the real `@types/vscode` types as read-only (e.g.
  `workspace.workspaceFolders`), import the mock by its relative path
  (from a `__tests__` folder two levels down from the repo root, that's
  `../../../test/mocks/vscode`) instead of the bare `"vscode"` specifier,
  so it type-checks against the mock's own (mutable) shape. Vitest resolves
  both specifiers to the same module instance, so this changes nothing at
  runtime — see `src/utils/__tests__/fileMentions.test.ts`.
- Any webview module that transitively imports `webview/src/lib/vscodeApi.ts`
  calls the webview-only global `acquireVsCodeApi()` at import time.
  `test/setup.ts` (wired via `test.setupFiles`) stubs it before test modules
  load — if a new webview entry point does something similar at import
  time, stub it there too rather than in individual test files.
- `App.tsx` exports `reducer` and `initialState` specifically so the
  reducer — the largest single piece of non-trivial logic in the webview —
  can be unit-tested directly. Keep that export if you refactor `App.tsx`.
- Don't try to unit-test `agentSession.ts` or `webviewProvider.ts`
  end-to-end (mocking the Agent SDK's `Query` well enough to be meaningful
  is a lot of surface for little confidence). For those, prefer either
  driving the extension for real (README's "Testing locally") or the
  throwaway-script-against-the-real-SDK pattern below.

## Feature scoping philosophy

When the SDK has no live control for something the official Claude Code
extension exposes, don't fake it with local-only UI state. Either:

- open the real underlying file (e.g. Hooks/Permissions/general config →
  `~/.claude/settings.json`, Memory → `CLAUDE.md`), or
- omit the feature entirely and say so, rather than building a toggle that
  looks functional but does nothing.

See the README's "Known scope limits" section for the current list of
these decisions — add to it if you make a new one.

Same principle for actual VS Code settings: the Settings cog opens VS
Code's Settings UI pre-filtered to this extension's `contributes.configuration`
section (`workbench.action.openSettings` with the config section id as the
query) rather than building a custom in-webview settings screen. Add new
user-facing config to `package.json`'s `configuration.properties` and read
it host-side with `vscode.workspace.getConfiguration(...)`; there's no need
for a settings message round-trip to the webview unless a setting needs to
affect webview-only rendering.

## Working the features backlog

`FEATURES_BACKLOG.md` (gitignored — a local, private scratchpad, not part
of this public repo) holds candidate features gathered by auditing the
Agent SDK's full surface against what this extension actually uses — a
menu to pick from gradually, not a roadmap. If one exists locally, when you
pick an entry up:

1. Remove its entry from `FEATURES_BACKLOG.md` as part of the same change
   that implements it (not before — it should stay listed while still just
   an idea, even mid-conversation).
2. If it's user-discoverable and non-trivial, add a line to `README.md`'s
   Features list, following the existing style (one bullet, terse, links
   the concrete SDK behavior where relevant).
3. If it's the kind of thing a user would want explained the first time
   they see it (matches the bar the existing `FEATURES` array in
   `HelpDialog.tsx` already uses), add an entry there too.
4. Small completeness fixes (e.g. a missing enum value in a picker) don't
   need README/Help entries — use judgment; the backlog entry itself
   usually says which category it is.

Don't let the backlog silently drift stale — if you learn an entry's SDK
API changed shape or no longer exists while implementing something else,
fix or drop that entry in the same change rather than leaving it wrong for
whoever picks it up next.

## Process notes

- Never use heredocs (`cat <<EOF`) or other shell tricks to create/edit
  files — use the file-editing tools directly.
- macOS has no `timeout` command; don't rely on it in scratch scripts.
- Dragging from VS Code's own Explorer/tabs into a webview requires the user
  to hold Shift — VS Code intercepts the drag otherwise to move/open the tab
  instead of delivering it to the webview. This is a VS Code platform
  restriction, not something fixable from extension code, and there's no
  event to detect the failed (no-Shift) attempt from inside the webview to
  surface a just-in-time warning. Document it statically instead (Attach
  menu description, Help dialog) rather than trying to "fix" the drop zone.
- If `npx vitest run` fails at startup with "Cannot find native binding" /
  "Cannot find module '@rolldown/binding-...'", that's npm's known
  optional-dependency bug (npm/cli#4828), not a real config problem —
  recurred more than once in this repo after touching `devDependencies`.
  Fix: `rm -rf node_modules package-lock.json && npm install`, then rerun.
  Don't go looking for a vitest/vite/rolldown config fix; there isn't one.
- `extension.ts` registers the chat view with `webviewOptions:
  { retainContextWhenHidden: true }`. Without it, VS Code fully tears down
  and reloads the webview's JS/DOM every time its tab loses visibility
  (switching to Explorer/Search and back), silently wiping all React state
  — including an unsent composer draft. This is deliberate and shouldn't be
  reverted for a "save memory" argument; the tradeoff (webview kept alive,
  using somewhat more memory) is the right one for a chat UI.
- That same setting means `resolveWebviewView` now only runs its setup
  **once** per VS Code window session instead of on every reload — so any
  race in that one-time setup no longer self-heals itself the way it used
  to (a later hide/show reload would previously retry it for free).
  Concretely: VS Code does **not** buffer `webview.postMessage` calls sent
  from the webview side before the extension host has called
  `webview.onDidReceiveMessage(...)` — if the webview's JS starts running
  and fires off its initial `requestModels`/`requestSessionList` posts
  before that listener is attached, those messages are silently dropped,
  and (now that there's no automatic reload to retry) the model
  picker/session list can stay permanently empty for the rest of the VS
  Code session. Fix: in `webviewProvider.ts`'s `resolveWebviewView`,
  `webview.html = ...` is assigned **last**, strictly after
  `onDidReceiveMessage` is registered — never move it earlier.
- Merely *resuming* a session (`query({ resume: sessionId })`, i.e. what
  `AgentSession.warmStart()` does to pre-warm the context gauge when a past
  session is opened) bumps that session file's mtime, even with zero
  messages sent — confirmed empirically: resumed a real session, sent
  nothing, and the file's mtime jumped to "now" within half a second (the
  CLI fires a `SessionStart:resume` hook and appends its own bookkeeping).
  `listSessions()`'s `lastModified` reads straight from that mtime, so
  merely opening a session from the Sessions list — without sending
  anything — was reordering it to the top and showing "Just now". Fixed via
  `LastActivityOverride` (`src/state/lastActivityOverride.ts`):
  `webviewProvider.ts`'s `openSessionInline` snapshots the real last-message
  timestamp (`sessionHistory.ts`'s `lastMessageTimestamp()`, reading the
  undocumented-but-present `timestamp` field on `getSessionMessages()`'s
  entries — same pattern as the `getSessionInfo`/`timestamp`/`usage` finding
  above) *before* calling `warmStart()`, and `requestSessionList` prefers
  that override over the SDK's raw `lastModified` until a real message is
  actually sent (which clears it). `getSessionMessages()`'s default options
  already exclude system messages, so its last entry is guaranteed to be
  real user/assistant content, never the resume hook's own bookkeeping.
- The webview's CSP (`webviewProvider.ts`'s `getHtml()`) had `default-src
  'none'` with no `img-src` at all — meaning every `<img>` tag, including a
  `data:` base64 URI, was silently blocked from the start, not just after
  the attachment-preview feature added the first real one. The failure
  mode is easy to misdiagnose as a data/logic bug: a blocked image renders
  Chromium's small "broken image" icon immediately followed by the `alt`
  text, which reads a lot like "the base64 payload got corrupted somewhere"
  rather than "the browser refused to load it." Traced the actual base64
  data through the full pipeline (raw `.jsonl` → `getSessionMessages()` →
  `buildReplayItems()` → a simulated `JSON.stringify`/`parse` round trip)
  and it was correct and unchanged at every step — the fix was adding
  `img-src ${webview.cspSource} data:;` to the CSP, not touching any of the
  data-extraction logic. If an `<img>` (or anything else CSP-gated) looks
  "broken" with correct-seeming data behind it, check the CSP meta tag
  before assuming the bug is downstream.
