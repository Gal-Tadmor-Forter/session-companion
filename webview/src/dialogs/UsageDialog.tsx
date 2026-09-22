import { useEffect } from "react";
import { X } from "lucide-react";
import type { UsageReportInfo } from "../../../shared/protocol";
import { Markdown } from "../components/Markdown";

interface UsageDialogProps {
  open: boolean;
  loading: boolean;
  report: UsageReportInfo | undefined;
  onClose: () => void;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The SDK gives no reset timestamp for `extraUsage` (only `limits` rows carry one —
 * see `UsageReportInfo`'s doc comment), so this only ever applies to those rows. */
function formatResetsAt(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `resets ${date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export function UsageDialog({ open, loading, report, onClose }: UsageDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const extraUsage = report?.extraUsage;
  const hasExtraUsageAmounts = extraUsage && extraUsage.usedUsd !== null && extraUsage.monthlyLimitUsd !== null;

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-4 pt-10" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-foreground">Usage</h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-muted">Loading usage...</p>}
          {!loading && !report && (
            <p className="text-sm text-muted">
              Usage data isn't available here — this happens for API-key/non-subscriber sessions, or an older CLI
              version that doesn't report it.
            </p>
          )}
          {!loading && report && (
            <div className="flex flex-col gap-4">
              {hasExtraUsageAmounts && extraUsage && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-foreground">
                      {formatUsd(extraUsage.usedUsd as number)} of {formatUsd(extraUsage.monthlyLimitUsd as number)}{" "}
                      spent
                    </span>
                    {extraUsage.utilizationPercent !== null && (
                      <span className="shrink-0 text-xs text-muted">
                        {Math.round(extraUsage.utilizationPercent)}% used
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, Math.max(0, extraUsage.utilizationPercent ?? 0))}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted">
                    Monthly spend limit{extraUsage.isEnabled ? "" : " (currently disabled)"}
                  </span>
                </div>
              )}

              {report.limits.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {report.limits.map((limit, index) => {
                    const resetLabel = formatResetsAt(limit.resetsAt);
                    return (
                      <div key={`${limit.kind}-${index}`} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-foreground">{limit.scopeLabel ?? limit.group}</span>
                        <span className="shrink-0 text-muted">
                          {Math.round(limit.percent)}% used{resetLabel ? ` · ${resetLabel}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {report.detailsMarkdown.trim().length > 0 && (
                <div className="border-t border-border pt-3 text-sm">
                  <Markdown text={report.detailsMarkdown} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
