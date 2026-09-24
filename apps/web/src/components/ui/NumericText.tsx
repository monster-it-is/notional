import type { ReactNode } from "react";

import { cn } from "../../lib/cn.ts";

export function NumericText({
  children,
  className = "",
  as: Comp = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "dd" | "p";
}) {
  return <Comp className={cn("font-numeric text-foreground", className)}>{children}</Comp>;
}
