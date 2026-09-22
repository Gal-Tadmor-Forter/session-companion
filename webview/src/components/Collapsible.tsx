import type { ReactNode } from "react";
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";

interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A single collapsible "step" row — used for tool calls, thinking blocks, and
 * auto-injected IDE context notes, so a response with many steps stays compact by
 * default instead of dumping everything open. Built on Radix's Collapsible (the same
 * primitive shadcn/ui's own Collapsible wraps). */
export function Collapsible({ open, onOpenChange, trigger, children, className }: CollapsibleProps) {
  return (
    <RadixCollapsible.Root open={open} onOpenChange={onOpenChange} className={className}>
      <RadixCollapsible.Trigger className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-left">
        <ChevronRight size={12} className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")} />
        {trigger}
      </RadixCollapsible.Trigger>
      <RadixCollapsible.Content>{children}</RadixCollapsible.Content>
    </RadixCollapsible.Root>
  );
}
