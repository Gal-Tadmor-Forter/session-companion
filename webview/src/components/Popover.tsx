import type { ReactNode } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "../lib/cn";

interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: ReactNode;
  children: ReactNode;
  className?: string;
  /** Whether the anchor is itself the click/keyboard trigger (Radix Trigger) vs. a pure
   * position reference for a popover driven by something else, e.g. hover (Radix Anchor).
   * Defaults to true — most popovers in this app are click-toggled menus. */
  interactive?: boolean;
  /** Which side of the anchor the content opens toward. Defaults to "top" since most
   * popovers in this app anchor to the bottom composer; pass "bottom" for an anchor near
   * the top of the view (e.g. the Sessions screen's header row). */
  side?: "top" | "bottom";
}

/** Anchored floating panel built on Radix's Popover primitive (the same one shadcn/ui's
 * Popover wraps) instead of a hand-rolled `absolute bottom-full left-0` box — Radix
 * portals the content and repositions/flips it to stay inside the viewport, which matters
 * in a narrow VS Code sidebar where a fixed-corner popup would otherwise get clipped or
 * push the page into horizontal scroll. Opens upward by default since the composer sits
 * at the bottom of the view. Closes on outside click or Escape. */
export function Popover({ open, onOpenChange, anchor, children, className, interactive = true, side = "top" }: PopoverProps) {
  const Anchor = interactive ? RadixPopover.Trigger : RadixPopover.Anchor;

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <Anchor asChild>{anchor}</Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-20 max-h-96 w-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg outline-none",
            className
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
