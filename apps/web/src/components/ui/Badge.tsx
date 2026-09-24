import { cn } from "../../lib/cn.ts";

export type BadgeVariant = "neutral" | "accent" | "paper" | "warning";

const variants: Record<BadgeVariant, string> = {
  neutral: "border-border bg-surface-subtle text-secondary",
  accent: "border-accent/40 bg-accent-soft text-foreground",
  paper: "border-accent/40 bg-accent-soft text-foreground",
  warning: "border-warning-border bg-warning-background text-warning",
};

export function Badge({
  children,
  variant = "neutral",
}: {
  children: string;
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide uppercase",
        variants[variant],
      )}
    >
      {children}
    </span>
  );
}
