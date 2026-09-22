import type { AttachmentSummary, SubagentStep } from "../../shared/protocol";

export interface ToolResultInfo {
  summary: string;
  isError: boolean;
}

/** One nested line under a Task tool card, forwarded from the subagent it spawned. */
export interface SubagentStepEntry {
  id: string;
  step: SubagentStep;
}

export type TranscriptItem =
  | { id: string; kind: "user"; text: string; attachments: AttachmentSummary[]; timestamp?: number; uuid: string }
  | {
      id: string;
      kind: "assistantText";
      blockId: string;
      text: string;
      streaming: boolean;
      timestamp?: number;
    }
  | {
      id: string;
      kind: "thinking";
      blockId: string;
      text: string;
      streaming: boolean;
    }
  | {
      id: string;
      kind: "toolUse";
      toolUseId: string;
      /** The raw SDK tool name (e.g. "Edit", "Write", "Bash") — `label` below is
       * already a human-formatted description built from this plus `input`, but the
       * raw name is still needed to reliably tell tool kinds apart (e.g. the
       * Files-changed view picking out Edit/Write calls) without parsing `label`. */
      name: string;
      label: string;
      input: Record<string, unknown>;
      result?: ToolResultInfo;
      /** Live one-line status from the SDK's task_progress event, shown instead of
       * `label` while a Task subagent is running (see AgentSession.agentProgressSummaries). */
      progressSummary?: string;
      /** Forwarded subagent content, when this card is a Task tool call. */
      subagentSteps?: SubagentStepEntry[];
    }
  | { id: string; kind: "contextNote"; text: string }
  | {
      id: string;
      kind: "permission";
      requestId: string;
      toolName: string;
      label: string;
      description?: string;
      resolution?: "approved" | "denied";
    }
  | { id: string; kind: "error"; message: string }
  | {
      id: string;
      kind: "turnStats";
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
    };
