import type { ReactNode } from "react";

import { Surface } from "./Surface.tsx";

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
    <Surface as="section" variant="default" className={className}>
      {title ? <h2 className="mb-3 font-heading text-base text-foreground">{title}</h2> : null}
      {children}
    </Surface>
  );
}
