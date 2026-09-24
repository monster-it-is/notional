import type { SelectHTMLAttributes } from "react";

import { cn } from "../../lib/cn.ts";

export function Select({
  className = "",
  invalid = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-md border bg-input px-3 py-2 text-sm text-foreground",
        "min-h-10",
        "hover:border-border-strong",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted",
        invalid ? "border-warning-border" : "border-border",
        className,
      )}
      {...props}
    />
  );
}
