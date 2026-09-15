import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-app-border bg-app-bg p-4 ${className}`}>
      {title ? <h2 className="mb-3 text-base">{title}</h2> : null}
      {children}
    </section>
  );
}
