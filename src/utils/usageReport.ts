import type { SDKUsageReport } from "@anthropic-ai/claude-agent-sdk";
import type { UsageReportInfo } from "../../shared/protocol";

/** `SDKUsageReport.rate_limits.extra_usage`'s `monthlyLimit`/`usedCredits` are in minor
 * units of `currency` (cents for USD, per the SDK's own doc comment) — convert to whole
 * units for display. Currency-agnostic in form, though only USD is exercised in
 * practice (Claude Code's own billing). */
function toMajorUnits(minorUnits: number | null): number | null {
  return minorUnits === null ? null : minorUnits / 100;
}

/** Converts the SDK's `/usage`-probe response (see `AgentSession.requestUsage()`) into
 * the display-ready shape the webview renders — pulled out as a pure function so it's
 * testable without the `agentSession.ts` end-to-end restriction (see AGENTS.md). */
export function toUsageReportInfo(report: SDKUsageReport, detailsMarkdown: string): UsageReportInfo {
  const extraUsage = report.rate_limits?.extra_usage;
  return {
    extraUsage: extraUsage
      ? {
          isEnabled: extraUsage.is_enabled,
          monthlyLimitUsd: toMajorUnits(extraUsage.monthly_limit),
          usedUsd: toMajorUnits(extraUsage.used_credits),
          utilizationPercent: extraUsage.utilization,
          currency: extraUsage.currency ?? null,
        }
      : undefined,
    limits: (report.rate_limits?.limits ?? []).map((limit) => ({
      kind: limit.kind,
      group: limit.group,
      percent: limit.percent,
      resetsAt: limit.resets_at,
      scopeLabel: limit.scope?.model?.display_name ?? limit.scope?.surface?.display_name,
      severity: limit.severity ?? null,
      isActive: limit.is_active ?? null,
    })),
    detailsMarkdown,
  };
}
