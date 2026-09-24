import type { ReactNode } from "react";

import { cn } from "../../lib/cn.ts";

export type SurfaceVariant = "default" | "subtle" | "raised";

const variants: Record<SurfaceVariant, string> = {
  default: "border-border bg-surface",
  subtle: "border-border bg-surface-subtle",
  raised: "border-border bg-surface-raised shadow-[var(--shadow-raised)]",
};

export function Surface({
  as: Comp = "div",
  variant = "default",
  className = "",
  children,
}: {
  as?: "div" | "section";
  variant?: SurfaceVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Comp className={cn("rounded-lg border p-4", variants[variant], className)}>{children}</Comp>
  );
}
