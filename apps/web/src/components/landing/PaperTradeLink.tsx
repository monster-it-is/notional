import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "../../lib/cn.ts";
import { useLandingSession } from "./use-landing-session.ts";

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function StartPaperTradingLink({
  children = "Start Paper Trading",
  className,
  variant = "primary",
}: {
  children?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary";
}) {
  const { signedIn, pending } = useLandingSession();
  const classes = cn(
    "inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium",
    focus,
    variant === "primary"
      ? "landing-amber w-full bg-accent hover:bg-accent-hover active:bg-accent-active sm:w-auto"
      : "landing-text border border-border-strong bg-surface hover:bg-surface-subtle",
    className,
  );

  if (pending && !signedIn) {
    return (
      <span aria-busy="true" aria-disabled="true" className={cn(classes, "opacity-70")}>
        {children}
      </span>
    );
  }

  return (
    <Link className={classes} to={signedIn ? "/trade" : "/signup"}>
      {children}
    </Link>
  );
}

export function PaperDestinationLink({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { signedIn, pending } = useLandingSession();

  if (pending && !signedIn) {
    return <span className={className}>{children}</span>;
  }

  return (
    <Link className={className} to={signedIn ? "/trade" : "/signup"}>
      {children}
    </Link>
  );
}
