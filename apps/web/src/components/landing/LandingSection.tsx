import type { ReactNode } from "react";

import { cn } from "../../lib/cn.ts";

export const landingContainer =
  "mx-auto w-full max-w-7xl px-4 min-[360px]:px-5 sm:px-6 md:px-8 lg:px-10 xl:px-12";

export const landingSectionY = "py-12 sm:py-16 lg:py-24";

export const sectionTitle =
  "font-heading text-2xl font-semibold tracking-tight text-balance text-foreground sm:text-[2rem]";

export const sectionBody = "mt-3 max-w-2xl text-base leading-relaxed text-secondary";

export const exploreLinkClass =
  "landing-quiet inline-flex min-h-11 items-center justify-center px-1 text-sm font-medium sm:px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function Eyebrow({ index, label }: { index: string; label: string }) {
  return (
    <p className="font-numeric text-[11px] uppercase tracking-[0.16em] text-secondary">
      <span className="text-accent">{index}</span>
      <span className="mx-2 text-border-strong">/</span>
      {label}
    </p>
  );
}

export function LandingSection({
  id,
  titleId,
  children,
  className,
}: {
  id?: string;
  titleId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn("scroll-mt-24 border-t border-border", className)}
    >
      <div className={cn(landingContainer, landingSectionY)}>{children}</div>
    </section>
  );
}
