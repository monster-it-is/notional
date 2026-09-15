import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-heading tabular-nums outline-none focus:border-app-accent ${className}`}
      {...props}
    />
  );
}
