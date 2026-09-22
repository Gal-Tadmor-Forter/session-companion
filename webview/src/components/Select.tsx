import type { SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "cursor-pointer bg-surface text-foreground border border-border rounded-md text-xs px-2 py-1",
        "hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
