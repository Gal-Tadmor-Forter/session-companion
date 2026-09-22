import { describe, expect, it } from "vitest";
import type { SDKUsageReport } from "@anthropic-ai/claude-agent-sdk";
import { toUsageReportInfo } from "../usageReport";

function report(overrides: Partial<SDKUsageReport>): SDKUsageReport {
  return {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 0,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    rate_limits: null,
    ...overrides,
  } as SDKUsageReport;
}

describe("toUsageReportInfo", () => {
  it("converts extra-usage minor units (cents) to whole USD", () => {
    const info = toUsageReportInfo(
      report({
        rate_limits: {
          limits: null,
          extra_usage: { is_enabled: true, monthly_limit: 250000, used_credits: 55925, utilization: 22.37, currency: "USD" },
        },
      }),
      ""
    );
    expect(info.extraUsage).toEqual({
      isEnabled: true,
      monthlyLimitUsd: 2500,
      usedUsd: 559.25,
      utilizationPercent: 22.37,
      currency: "USD",
    });
  });

  it("leaves null extra-usage amounts as null rather than coercing to 0", () => {
    const info = toUsageReportInfo(
      report({
        rate_limits: {
          limits: null,
          extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null },
        },
      }),
      ""
    );
    expect(info.extraUsage).toEqual({
      isEnabled: false,
      monthlyLimitUsd: null,
      usedUsd: null,
      utilizationPercent: null,
      currency: null,
    });
  });

  it("omits extraUsage entirely when the plan has none", () => {
    const info = toUsageReportInfo(report({ rate_limits: { limits: [], extra_usage: null } }), "");
    expect(info.extraUsage).toBeUndefined();
  });

  it("defaults to an empty limits array when rate_limits or limits is null", () => {
    expect(toUsageReportInfo(report({ rate_limits: null }), "").limits).toEqual([]);
    expect(toUsageReportInfo(report({ rate_limits: { limits: null, extra_usage: null } }), "").limits).toEqual([]);
  });

  it("maps limits verbatim, preferring the model scope label over the surface one", () => {
    const info = toUsageReportInfo(
      report({
        rate_limits: {
          extra_usage: null,
          limits: [
            {
              kind: "weekly_scoped",
              group: "weekly",
              percent: 41,
              resets_at: "2026-10-01T00:00:00Z",
              scope: { model: { display_name: "Opus" }, surface: { display_name: "Chat" } },
              severity: "warning",
              is_active: true,
            },
          ],
        },
      }),
      ""
    );
    expect(info.limits).toEqual([
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 41,
        resetsAt: "2026-10-01T00:00:00Z",
        scopeLabel: "Opus",
        severity: "warning",
        isActive: true,
      },
    ]);
  });

  it("falls back to the surface label when there's no model scope", () => {
    const info = toUsageReportInfo(
      report({
        rate_limits: {
          extra_usage: null,
          limits: [
            {
              kind: "weekly_all",
              group: "weekly",
              percent: 10,
              resets_at: null,
              scope: { surface: { display_name: "Chat" } },
            },
          ],
        },
      }),
      ""
    );
    expect(info.limits[0].scopeLabel).toBe("Chat");
  });

  it("passes the details markdown through untouched", () => {
    const info = toUsageReportInfo(report({}), "Last 24h · 3 requests");
    expect(info.detailsMarkdown).toBe("Last 24h · 3 requests");
  });
});
