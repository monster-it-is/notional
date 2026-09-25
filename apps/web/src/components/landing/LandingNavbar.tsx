import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import { cn } from "../../lib/cn.ts";
import { ThemeToggle } from "../../theme/ThemeToggle.tsx";
import { Wordmark } from "../brand/Wordmark.tsx";
import { landingContainer } from "./LandingSection.tsx";
import { StartPaperTradingLink } from "./PaperTradeLink.tsx";
import { useLandingSession } from "./use-landing-session.ts";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#leverage-lab", label: "Leverage Lab" },
  { href: "#learn", label: "Learn" },
  { href: "#faq", label: "FAQ" },
] as const;

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function LandingNavbar() {
  const { hash } = useLocation();
  const { signedIn, pending, email } = useLandingSession();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function closeMenu(): void {
    setOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-40 focus:bg-surface focus:px-3 focus:py-2"
        href="#main"
      >
        Skip to content
      </a>
      <div className={cn(landingContainer, "flex items-center gap-3 py-2")}>
        <Link
          className="landing-text inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap"
          to="/"
        >
          <Wordmark />
          <span className="font-heading text-base font-semibold tracking-tight text-foreground">
            Notional
          </span>
          <span className="border border-border border-l-2 border-l-accent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-secondary">
            Paper
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              aria-current={hash === link.href ? "true" : undefined}
              className={cn(
                "landing-nav inline-flex min-h-11 items-center whitespace-nowrap px-2.5 text-sm",
                focus,
                hash === link.href && "shadow-[inset_0_-2px_0_0_var(--accent)]",
              )}
              href={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <div className="hidden items-center gap-2 lg:flex">
            <SessionLinks email={email} pending={pending} signedIn={signedIn} />
            <StartPaperTradingLink />
          </div>
          <button
            ref={menuButtonRef}
            aria-controls={menuId}
            aria-expanded={open}
            className={cn(
              "inline-flex min-h-11 items-center px-2 text-sm text-foreground lg:hidden",
              focus,
            )}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open ? (
        <nav
          aria-label="Mobile"
          className="border-t border-border lg:hidden"
          id={menuId}
        >
          <div className={cn(landingContainer, "flex flex-col py-2")}>
            {LINKS.map((link) => (
              <a
                key={link.href}
                className={cn("landing-nav inline-flex min-h-11 items-center text-base", focus)}
                href={link.href}
                onClick={closeMenu}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border py-3">
              <SessionLinks email={email} pending={pending} signedIn={signedIn} stacked />
              <StartPaperTradingLink className="w-full" />
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function SessionLinks({
  signedIn,
  pending,
  email,
  stacked = false,
}: {
  signedIn: boolean;
  pending: boolean;
  email: string | null;
  stacked?: boolean;
}) {
  if (pending && !signedIn) {
    return null;
  }

  if (signedIn) {
    return (
      <>
        <Link
          className={cn("landing-quiet inline-flex min-h-11 items-center px-2 text-sm", stacked && "px-0")}
          to="/account"
        >
          <span className="max-w-[12rem] truncate">{email ?? "Account"}</span>
        </Link>
        <Link
          className={cn("landing-quiet inline-flex min-h-11 items-center px-2 text-sm", stacked && "px-0")}
          to="/trade"
        >
          Trade
        </Link>
      </>
    );
  }

  return (
    <Link
      className={cn("landing-quiet inline-flex min-h-11 items-center px-2 text-sm", stacked && "px-0")}
      to="/signin"
    >
      Log in
    </Link>
  );
}
