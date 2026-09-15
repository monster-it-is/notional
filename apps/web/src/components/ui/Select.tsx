import type { SelectHTMLAttributes } from "react";

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-heading outline-none focus:border-app-accent ${className}`}
      {...props}
    />
  );
}
