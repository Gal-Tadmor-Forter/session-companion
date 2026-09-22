import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "default" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  default: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-hover",
  ghost: "bg-transparent text-foreground hover:bg-surface-hover",
  destructive: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-xs px-2 py-1",
  md: "text-sm px-3 py-1.5",
};

export function Button({ variant = "default", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "cursor-pointer rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
