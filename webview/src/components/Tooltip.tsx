import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

interface TooltipProps {
  /** The trigger — almost always an icon button. Wrapped with `asChild` so no extra DOM
   * node is introduced (matters for the tight icon rows this is used in). */
  children: ReactNode;
  /** Empty/whitespace-only disables the tooltip entirely (renders the trigger with no
   * wrapper at all) rather than showing a blank bubble. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
}

/** Built on Radix's Tooltip primitive (the same one shadcn/ui wraps), consistent with
 * `Popover.tsx`/`Collapsible.tsx` elsewhere in this app — installed the underlying
 * package directly rather than hand-rolling hover-timing/positioning logic again. Icon
 * buttons across the app previously relied on the native `title` attribute, which has an
 * inconsistent, OS-controlled delay and no styling; this instead matches the rest of the
 * UI (dark surface, border, shadow) and appears immediately as one popover replaces the
 * next when the pointer moves between adjacent icons in the same row (Radix's shared
 * `Provider` below handles that; see `App.tsx`'s single top-level provider). */
export function Tooltip({ children, label, side = "bottom" }: TooltipProps) {
  if (!label.trim()) return <>{children}</>;

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-30 max-w-64 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-lg"
          )}
        >
          {label}
          <RadixTooltip.Arrow className="fill-border" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** One shared delay group for the whole app — hovering from one tooltip's trigger
 * straight onto another's skips the delay, matching how a native OS tooltip row feels.
 * Mount once at the root (`App.tsx`), not per-`Tooltip`. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}
