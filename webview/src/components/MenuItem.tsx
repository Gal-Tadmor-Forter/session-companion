import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

interface MenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

export function MenuItem({ icon, label, description, trailing, selected, className, ...props }: MenuItemProps) {
  return (
    <button
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm text-foreground">{label}</span>
        {description && <span className="block truncate text-xs text-muted">{description}</span>}
      </span>
      {selected && <Check size={14} className="mt-0.5 shrink-0 text-accent" />}
      {trailing}
    </button>
  );
}

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted">{children}</div>;
}

export function MenuDivider() {
  return <div className="my-1 border-t border-border" />;
}
