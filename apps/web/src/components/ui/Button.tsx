import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "buy" | "sell";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-subtle hover:border-border-strong active:bg-surface-subtle",
  ghost: "text-foreground hover:bg-surface-subtle active:bg-surface-subtle",
  buy: "border border-accent bg-accent-soft text-foreground hover:bg-accent/20 active:bg-accent/25",
  sell: "border border-accent bg-accent-soft text-foreground hover:bg-accent/20 active:bg-accent/25",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-2.5 text-xs",
  md: "min-h-10 px-3 text-sm",
  lg: "min-h-11 px-4 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      data-variant={variant}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variants[variant],
        sizes[size],
        "disabled:pointer-events-none disabled:bg-disabled disabled:text-muted disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
