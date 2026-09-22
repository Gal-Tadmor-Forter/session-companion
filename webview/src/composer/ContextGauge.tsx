import { useEffect, useRef, useState } from "react";
import type { ContextUsageInfo } from "../../../shared/protocol";
import { Popover } from "../components/Popover";
import { formatTokenCount } from "../utils/formatTokenCount";

interface ContextGaugeProps {
  usage: ContextUsageInfo;
  onCompact: () => void;
  disabled: boolean;
}

export function ContextGauge({ usage, onCompact, disabled }: ContextGaugeProps) {
  const [hovered, setHovered] = useState(false);
  // The trigger and the popover content are disjoint elements with a gap between them
  // (sideOffset). Moving the mouse from one to the other passes through a dead zone that's
  // over neither, so closing on mouseleave immediately would drop the popover mid-transit.
  // A short grace period, cancelled if either side re-enters, bridges that gap.
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openNow = () => {
    clearTimeout(closeTimeout.current);
    setHovered(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimeout.current);
    closeTimeout.current = setTimeout(() => setHovered(false), 250);
  };
  useEffect(() => () => clearTimeout(closeTimeout.current), []);
  const pct = Math.round(Math.min(100, Math.max(0, usage.percentage)));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  const usedCategories = usage.categories
    .filter((c) => c.kind === "used")
    .sort((a, b) => b.tokens - a.tokens);
  const bufferCategory = usage.categories.find((c) => c.kind === "buffer");

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <Popover open={hovered} onOpenChange={setHovered} interactive={false} anchor={
        <button
          type="button"
          className="flex cursor-default items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-xs text-muted"
          aria-label={`Context window ${pct}% used`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
            <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" className="text-border" strokeWidth="2" />
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-accent"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          {pct}%
        </button>
      }>
        <div className="flex flex-col gap-3 p-2" onMouseEnter={openNow} onMouseLeave={closeSoon}>
          {usage.costUsd !== undefined && (
            <div>
              <div className="text-xs font-medium text-muted">Session Info</div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-foreground">Session Cost</span>
                <span className="text-foreground">${usage.costUsd.toFixed(2)}</span>
              </div>
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-muted">Context Window</div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-foreground">
                {formatTokenCount(usage.totalTokens)} / {formatTokenCount(usage.maxTokens)} tokens
              </span>
              <span className="text-foreground">{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            {bufferCategory && bufferCategory.tokens > 0 && (
              <div className="mt-1 text-xs text-muted">
                Reserved for response · {formatTokenCount(bufferCategory.tokens)} tokens
              </div>
            )}
          </div>
          {usedCategories.length > 0 && (
            <div className="flex flex-col gap-1">
              {usedCategories.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{c.name}</span>
                  <span className="text-foreground">{((c.tokens / usage.maxTokens) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={onCompact}
            disabled={disabled}
            className="mt-1 cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compact Conversation
          </button>
        </div>
      </Popover>
    </div>
  );
}
