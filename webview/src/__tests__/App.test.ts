import { describe, expect, it } from "vitest";
import { initialState, reducer } from "../App";
import type { AttachmentSummary, SessionListEntry } from "../../../shared/protocol";

function attachment(id: string): AttachmentSummary {
  return { id, fileName: `${id}.png`, kind: "image", sizeBytes: 100 };
}

function session(overrides: Partial<SessionListEntry> = {}): SessionListEntry {
  return {
    sessionId: "s1",
    title: "Untitled",
    repoName: "repo",
    cwd: "/repo",
    lastModified: 1000,
    unread: false,
    active: false,
    archived: false,
    ...overrides,
  };
}

describe("reducer: userSubmitted", () => {
  it("starts a new chat, clearing prior transcript and session identity", () => {
    const withHistory = {
      ...initialState,
      items: [{ id: "old", kind: "error" as const, message: "boom" }],
      currentSessionId: "old-session",
      currentSessionTitle: "Old chat",
    };
    const next = reducer(withHistory, {
      kind: "userSubmitted",
      text: "hello",
      attachments: [],
      startNewChat: true,
      uuid: "u1",
    });
    expect(next.screen).toBe("chat");
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ kind: "user", text: "hello" });
    expect(next.currentSessionId).toBeUndefined();
    expect(next.currentSessionTitle).toBeUndefined();
    expect(next.waitingForFirstEvent).toBe(true);
  });

  it("appends to the existing transcript when continuing a chat", () => {
    const withHistory = {
      ...initialState,
      items: [{ id: "prev", kind: "user" as const, text: "first", attachments: [], uuid: "u0" }],
      currentSessionId: "s1",
      currentSessionTitle: "Chat",
    };
    const next = reducer(withHistory, {
      kind: "userSubmitted",
      text: "second",
      attachments: [attachment("a1")],
      startNewChat: false,
      uuid: "u1",
    });
    expect(next.items).toHaveLength(2);
    expect(next.currentSessionId).toBe("s1");
    expect(next.pendingAttachments).toEqual([]);
  });

  it("does not show a second waiting indicator when a turn is already streaming", () => {
    const streaming = { ...initialState, sending: true };
    const next = reducer(streaming, {
      kind: "userSubmitted",
      text: "steer this",
      attachments: [],
      startNewChat: false,
      uuid: "u1",
    });
    expect(next.sending).toBe(true);
    expect(next.waitingForFirstEvent).toBe(false);
  });
});

describe("reducer: session list actions", () => {
  const withSessions = { ...initialState, sessions: [session({ sessionId: "s1", title: "A" })] };

  it("removes a session locally on sessionRemovedLocally", () => {
    const next = reducer(withSessions, { kind: "sessionRemovedLocally", sessionId: "s1" });
    expect(next.sessions).toEqual([]);
  });

  it("archives a session locally on sessionArchivedLocally", () => {
    const next = reducer(withSessions, { kind: "sessionArchivedLocally", sessionId: "s1", archived: true });
    expect(next.sessions[0].archived).toBe(true);
  });

  it("renames a session in the list and, if it's the open chat, its header title too", () => {
    const openChat = {
      ...withSessions,
      currentSessionId: "s1",
      currentSessionTitle: "A",
    };
    const next = reducer(openChat, { kind: "sessionRenamedLocally", sessionId: "s1", title: "Renamed" });
    expect(next.sessions[0].title).toBe("Renamed");
    expect(next.currentSessionTitle).toBe("Renamed");
  });

  it("does not touch currentSessionTitle when renaming a session that isn't open", () => {
    const openChat = { ...withSessions, currentSessionId: "other", currentSessionTitle: "Other" };
    const next = reducer(openChat, { kind: "sessionRenamedLocally", sessionId: "s1", title: "Renamed" });
    expect(next.currentSessionTitle).toBe("Other");
  });
});

describe("reducer: hostMessage streaming lifecycle", () => {
  it("starts, appends to, and closes a streaming text block", () => {
    let state = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "textDeltaStart", blockId: "b1" },
    });
    expect(state.sending).toBe(true);
    expect(state.items).toHaveLength(1);

    state = reducer(state, { kind: "hostMessage", message: { type: "textDelta", blockId: "b1", text: "He" } });
    state = reducer(state, { kind: "hostMessage", message: { type: "textDelta", blockId: "b1", text: "llo" } });
    expect(state.items[0]).toMatchObject({ text: "Hello", streaming: true });

    state = reducer(state, { kind: "hostMessage", message: { type: "textDeltaEnd", blockId: "b1" } });
    expect(state.items[0]).toMatchObject({ text: "Hello", streaming: false });
  });

  it("marks sending true again the moment a queued turn's own events start arriving", () => {
    // Simulates: turn 1 finished (sending -> false via turnComplete), then a queued
    // second turn starts on its own, with no explicit userSubmitted dispatch.
    const idleAfterFirstTurn = { ...initialState, sending: false };
    const next = reducer(idleAfterFirstTurn, {
      kind: "hostMessage",
      message: { type: "toolUse", toolUseId: "t1", name: "Bash", input: { command: "ls" } },
    });
    expect(next.sending).toBe(true);
  });

  it("finalizes any still-streaming text block on turnComplete (e.g. after an interrupt)", () => {
    const midStream = {
      ...initialState,
      sending: true,
      items: [{ id: "i1", kind: "assistantText" as const, blockId: "b1", text: "cut off", streaming: true }],
    };
    const next = reducer(midStream, { kind: "hostMessage", message: { type: "turnComplete" } });
    expect(next.sending).toBe(false);
    expect(next.items[0]).toMatchObject({ text: "cut off", streaming: false });
  });

  it("starts, appends to, and closes a streaming thinking block", () => {
    let state = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "thinkingDeltaStart", blockId: "b1" },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "thinking", text: "", streaming: true });

    state = reducer(state, {
      kind: "hostMessage",
      message: { type: "thinkingDelta", blockId: "b1", text: "Let me " },
    });
    state = reducer(state, {
      kind: "hostMessage",
      message: { type: "thinkingDelta", blockId: "b1", text: "check." },
    });
    expect(state.items[0]).toMatchObject({ text: "Let me check.", streaming: true });

    state = reducer(state, { kind: "hostMessage", message: { type: "thinkingDeltaEnd", blockId: "b1" } });
    expect(state.items[0]).toMatchObject({ text: "Let me check.", streaming: false });
  });

  it("finalizes any still-streaming thinking block on turnComplete", () => {
    const midStream = {
      ...initialState,
      sending: true,
      items: [{ id: "i1", kind: "thinking" as const, blockId: "b1", text: "cut off", streaming: true }],
    };
    const next = reducer(midStream, { kind: "hostMessage", message: { type: "turnComplete" } });
    expect(next.items[0]).toMatchObject({ text: "cut off", streaming: false });
  });
});

describe("reducer: hostMessage session updates", () => {
  it("applies a sessionRenamed confirmation the same way as the optimistic update", () => {
    const state = { ...initialState, sessions: [session({ sessionId: "s1", title: "A" })] };
    const next = reducer(state, {
      kind: "hostMessage",
      message: { type: "sessionRenamed", sessionId: "s1", title: "B" },
    });
    expect(next.sessions[0].title).toBe("B");
  });

  it("replaces the transcript with the replay on sessionOpened", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: {
        type: "sessionOpened",
        sessionId: "s1",
        title: "Resumed",
        replay: [{ kind: "user", text: "hi", uuid: "u1" }],
      },
    });
    expect(next.screen).toBe("chat");
    expect(next.currentSessionId).toBe("s1");
    expect(next.items).toEqual([
      { id: expect.any(String), kind: "user", text: "hi", attachments: [], uuid: "u1" },
    ]);
  });
});

describe("reducer: drag-and-drop workspace mentions", () => {
  it("queues a resolved workspace path for the composer to insert", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: {
        type: "workspacePathResolved",
        result: { relativePath: "src/App.tsx", absolutePath: "/repo/src/App.tsx" },
      },
    });
    expect(next.pendingMentionInserts).toEqual([
      { relativePath: "src/App.tsx", absolutePath: "/repo/src/App.tsx" },
    ]);
  });

  it("appends to, rather than replaces, an already-queued mention", () => {
    const withOne = {
      ...initialState,
      pendingMentionInserts: [{ relativePath: "a.ts", absolutePath: "/repo/a.ts" }],
    };
    const next = reducer(withOne, {
      kind: "hostMessage",
      message: {
        type: "workspacePathResolved",
        result: { relativePath: "b.ts", absolutePath: "/repo/b.ts" },
      },
    });
    expect(next.pendingMentionInserts.map((m) => m.relativePath)).toEqual(["a.ts", "b.ts"]);
  });

  it("clears queued mentions once the composer has consumed them", () => {
    const withPending = {
      ...initialState,
      pendingMentionInserts: [{ relativePath: "a.ts", absolutePath: "/repo/a.ts" }],
    };
    const next = reducer(withPending, { kind: "mentionInsertsConsumed" });
    expect(next.pendingMentionInserts).toEqual([]);
  });
});

describe("reducer: permission mode confirmation echo", () => {
  it("applies permissionModeChanged the same way as the optimistic update", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "permissionModeChanged", mode: "bypassPermissions" },
    });
    expect(next.permissionMode).toBe("bypassPermissions");
  });

  it("applies bypassPermissionsDisabled when the host includes it (startup resolution)", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "permissionModeChanged", mode: "auto", bypassPermissionsDisabled: true },
    });
    expect(next.permissionMode).toBe("auto");
    expect(next.bypassPermissionsDisabled).toBe(true);
  });

  it("leaves bypassPermissionsDisabled untouched when the host omits it (the confirm-flow echo)", () => {
    const withDisabled = { ...initialState, bypassPermissionsDisabled: true };
    const next = reducer(withDisabled, {
      kind: "hostMessage",
      message: { type: "permissionModeChanged", mode: "bypassPermissions" },
    });
    expect(next.bypassPermissionsDisabled).toBe(true);
  });
});

describe("reducer: directoryAdded", () => {
  it("appends a contextNote saying it applied immediately", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "directoryAdded", path: "/repo/other", appliedImmediately: true },
    });
    expect(next.items).toEqual([{ id: expect.any(String), kind: "contextNote", text: "Added /repo/other to this chat." }]);
  });

  it("appends a different contextNote when it'll only apply on the next new chat", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "directoryAdded", path: "/repo/other", appliedImmediately: false },
    });
    expect(next.items[0]).toMatchObject({
      kind: "contextNote",
      text: expect.stringContaining("next new chat"),
    });
  });
});

describe("reducer: forceNewChat (Command Palette \"New Chat\")", () => {
  it("resets to a blank chat the same way a local newChatStarted click does", () => {
    const midChat = {
      ...initialState,
      screen: "chat" as const,
      items: [{ id: "1", kind: "assistantText" as const, blockId: "0-0", text: "hi", streaming: false }],
      currentSessionId: "abc",
      currentSessionTitle: "Some chat",
      sending: true,
    };
    const next = reducer(midChat, { kind: "hostMessage", message: { type: "forceNewChat" } });
    expect(next.screen).toBe("chat");
    expect(next.items).toEqual([]);
    expect(next.sending).toBe(false);
    expect(next.currentSessionId).toBeUndefined();
    expect(next.currentSessionTitle).toBeUndefined();
  });
});

describe("reducer: usage dialog", () => {
  it("usageRequested clears any previous report and flips on loading", () => {
    const withStale = { ...initialState, usageReport: { extraUsage: undefined, limits: [], detailsMarkdown: "" } };
    const next = reducer(withStale, { kind: "usageRequested" });
    expect(next.usageLoading).toBe(true);
    expect(next.usageReport).toBeUndefined();
  });

  it("usageLoaded stores the report and clears loading", () => {
    const loading = { ...initialState, usageLoading: true };
    const report = { extraUsage: undefined, limits: [], detailsMarkdown: "hi" };
    const next = reducer(loading, { kind: "hostMessage", message: { type: "usageLoaded", report } });
    expect(next.usageLoading).toBe(false);
    expect(next.usageReport).toEqual(report);
  });

  it("usageLoaded with an undefined report (not available) still clears loading", () => {
    const loading = { ...initialState, usageLoading: true };
    const next = reducer(loading, { kind: "hostMessage", message: { type: "usageLoaded", report: undefined } });
    expect(next.usageLoading).toBe(false);
    expect(next.usageReport).toBeUndefined();
  });
});

describe("reducer: prompt suggestions", () => {
  it("stores a prompt suggestion from the host", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "promptSuggestion", text: "Run the tests?" },
    });
    expect(next.promptSuggestion).toBe("Run the tests?");
  });

  it("clears a pending suggestion once the user sends their own message", () => {
    const withSuggestion = { ...initialState, promptSuggestion: "Run the tests?" };
    const next = reducer(withSuggestion, {
      kind: "userSubmitted",
      text: "Something else",
      attachments: [],
      startNewChat: false,
      uuid: "u1",
    });
    expect(next.promptSuggestion).toBeUndefined();
  });

  it("clears a pending suggestion on newChatStarted", () => {
    const withSuggestion = { ...initialState, promptSuggestion: "Run the tests?" };
    const next = reducer(withSuggestion, { kind: "newChatStarted" });
    expect(next.promptSuggestion).toBeUndefined();
  });
});

describe("reducer: skills", () => {
  it("stores the loaded skills list", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "skillsLoaded", skills: [{ name: "pdf", description: "Work with PDFs" }] },
    });
    expect(next.skills).toEqual([{ name: "pdf", description: "Work with PDFs" }]);
  });
});

describe("reducer: sessionForked", () => {
  it("detaches the current session identity while keeping the visible transcript", () => {
    const openChat = {
      ...initialState,
      items: [{ id: "i1", kind: "user" as const, text: "hi", attachments: [], uuid: "u1" }],
      currentSessionId: "s1",
      currentSessionTitle: "Original",
      contextUsage: {
        categories: [],
        totalTokens: 100,
        maxTokens: 1000,
        percentage: 10,
        costUsd: 0.01,
      },
      promptSuggestion: "Next step?",
    };
    const next = reducer(openChat, { kind: "sessionForked" });
    expect(next.currentSessionId).toBeUndefined();
    expect(next.currentSessionTitle).toBeUndefined();
    expect(next.contextUsage).toBeUndefined();
    expect(next.promptSuggestion).toBeUndefined();
    expect(next.items).toBe(openChat.items);
  });
});

describe("reducer: nested subagent transcripts", () => {
  it("appends a forwarded subagent step to its parent toolUse item", () => {
    const withTool = {
      ...initialState,
      items: [{ id: "i1", kind: "toolUse" as const, toolUseId: "t1", name: "Task", label: "Task", input: {} }],
    };
    const next = reducer(withTool, {
      kind: "hostMessage",
      message: { type: "subagentStep", toolUseId: "t1", step: { kind: "text", text: "Found it." } },
    });
    expect(next.items[0]).toMatchObject({
      subagentSteps: [{ step: { kind: "text", text: "Found it." } }],
    });
  });

  it("accumulates multiple subagent steps in order", () => {
    const withTool = {
      ...initialState,
      items: [{ id: "i1", kind: "toolUse" as const, toolUseId: "t1", name: "Task", label: "Task", input: {} }],
    };
    let next = reducer(withTool, {
      kind: "hostMessage",
      message: { type: "subagentStep", toolUseId: "t1", step: { kind: "thinking", text: "Let me check" } },
    });
    next = reducer(next, {
      kind: "hostMessage",
      message: { type: "subagentStep", toolUseId: "t1", step: { kind: "text", text: "Done." } },
    });
    expect(next.items[0]).toMatchObject({
      subagentSteps: [{ step: { kind: "thinking", text: "Let me check" } }, { step: { kind: "text", text: "Done." } }],
    });
  });

  it("updates the live progress summary on the matching toolUse item", () => {
    const withTool = {
      ...initialState,
      items: [{ id: "i1", kind: "toolUse" as const, toolUseId: "t1", name: "Task", label: "Task", input: {} }],
    };
    const next = reducer(withTool, {
      kind: "hostMessage",
      message: { type: "taskProgress", taskId: "task-1", toolUseId: "t1", summary: "Analyzing auth module" },
    });
    expect(next.items[0]).toMatchObject({ progressSummary: "Analyzing auth module" });
  });

  it("leaves items untouched when a background-only task_progress has no toolUseId", () => {
    const withTool = {
      ...initialState,
      items: [{ id: "i1", kind: "toolUse" as const, toolUseId: "t1", name: "Task", label: "Task", input: {} }],
    };
    const next = reducer(withTool, {
      kind: "hostMessage",
      message: { type: "taskProgress", taskId: "task-1", summary: "Working…" },
    });
    expect(next.items[0]).not.toHaveProperty("progressSummary");
  });
});

describe("reducer: background tasks", () => {
  it("replaces the background task list wholesale (REPLACE semantics)", () => {
    const withOne = {
      ...initialState,
      backgroundTasks: [{ taskId: "old", taskType: "local_bash", description: "stale" }],
    };
    const next = reducer(withOne, {
      kind: "hostMessage",
      message: {
        type: "backgroundTasksChanged",
        tasks: [{ taskId: "new", taskType: "local_bash", description: "sleep 8" }],
      },
    });
    expect(next.backgroundTasks).toEqual([{ taskId: "new", taskType: "local_bash", description: "sleep 8" }]);
  });

  it("stamps the matching background task with the latest task_progress summary", () => {
    const withTasks = {
      ...initialState,
      backgroundTasks: [
        { taskId: "t1", taskType: "local_agent", description: "Map portal-next integration center" },
        { taskId: "t2", taskType: "local_agent", description: "Map onboarder service model" },
      ],
    };
    const next = reducer(withTasks, {
      kind: "hostMessage",
      message: { type: "taskProgress", taskId: "t1", summary: "Reading src/onboarding/*.ts" },
    });
    expect(next.backgroundTasks).toEqual([
      {
        taskId: "t1",
        taskType: "local_agent",
        description: "Map portal-next integration center",
        progressSummary: "Reading src/onboarding/*.ts",
      },
      { taskId: "t2", taskType: "local_agent", description: "Map onboarder service model" },
    ]);
  });
});

describe("reducer: turn stats", () => {
  it("appends a turnStats item carrying the per-turn duration/cost/tokens", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "turnStats", durationMs: 2073, costUsd: 0.0742, inputTokens: 2, outputTokens: 5 },
    });
    expect(next.items).toEqual([
      { id: expect.any(String), kind: "turnStats", durationMs: 2073, costUsd: 0.0742, inputTokens: 2, outputTokens: 5 },
    ]);
  });
});

describe("reducer: sessions pagination", () => {
  it("stores hasMore alongside the loaded sessions", () => {
    const next = reducer(initialState, {
      kind: "hostMessage",
      message: { type: "sessionListLoaded", sessions: [session({ sessionId: "s1" })], hasMore: true },
    });
    expect(next.sessions).toEqual([session({ sessionId: "s1" })]);
    expect(next.hasMoreSessions).toBe(true);
  });

  it("defaults sessionsLimit to 50 and bumps it by 50 on sessionsLimitIncreased", () => {
    expect(initialState.sessionsLimit).toBe(50);
    const next = reducer(initialState, { kind: "sessionsLimitIncreased", limit: 100 });
    expect(next.sessionsLimit).toBe(100);
  });
});

describe("reducer: userSubmitted carries the webview-generated uuid", () => {
  it("stamps the uuid from the action onto the new user item", () => {
    const next = reducer(initialState, {
      kind: "userSubmitted",
      text: "hello",
      attachments: [],
      startNewChat: true,
      uuid: "u1",
    });
    expect(next.items[0]).toMatchObject({ kind: "user", text: "hello", uuid: "u1" });
  });
});

describe("reducer: editMessageStarted", () => {
  it("shows the waiting indicator without touching the transcript yet", () => {
    const withHistory = {
      ...initialState,
      items: [{ id: "i1", kind: "user" as const, text: "hi", attachments: [], uuid: "u1" }],
      promptSuggestion: "Next step?",
    };
    const next = reducer(withHistory, { kind: "editMessageStarted" });
    expect(next.sending).toBe(true);
    expect(next.waitingForFirstEvent).toBe(true);
    expect(next.promptSuggestion).toBeUndefined();
    // The host replaces the transcript wholesale once the fork/rewind round trip
    // finishes (via "sessionOpened"), not here.
    expect(next.items).toEqual(withHistory.items);
  });
});

describe("reducer: sessionOpened with no id/title (editing the very first message)", () => {
  it("clears the current session identity when the host omits sessionId/title", () => {
    const withOpenChat = { ...initialState, currentSessionId: "s1", currentSessionTitle: "Old" };
    const next = reducer(withOpenChat, {
      kind: "hostMessage",
      message: { type: "sessionOpened", replay: [{ kind: "user", text: "edited", uuid: "u2" }] },
    });
    expect(next.currentSessionId).toBeUndefined();
    expect(next.currentSessionTitle).toBeUndefined();
    expect(next.items).toEqual([
      { id: expect.any(String), kind: "user", text: "edited", attachments: [], uuid: "u2" },
    ]);
  });
});
