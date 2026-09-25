import { Link, Outlet } from "react-router";

import { AuthContextPanel } from "../components/auth/AuthContextPanel.tsx";
import { Wordmark } from "../components/brand/Wordmark.tsx";
import { ThemeToggle } from "../theme/ThemeToggle.tsx";

export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border bg-background">
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-40 focus:bg-surface focus:px-3 focus:py-2"
          href="#main"
        >
          Skip to content
        </a>
        <div className="flex items-center gap-3 px-4 py-2 sm:px-6">
          <Link
            className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap text-foreground"
            to="/"
          >
            <Wordmark />
            <span className="font-heading text-base font-semibold tracking-tight text-foreground">
              Notional
            </span>
            <span className="hidden border border-border border-l-2 border-l-accent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-secondary min-[360px]:inline">
              Paper
            </span>
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-2 xl:items-start">
        <main className="flex flex-1 flex-col px-4 py-8 sm:px-6 xl:px-10 xl:py-12" id="main">
          <div className="mx-auto w-full max-w-md md:mx-0 xl:mx-auto">
            <Outlet />
          </div>
        </main>
        <AuthContextPanel />
      </div>
      <footer className="border-t border-border px-4 py-3 sm:px-6">
        <p className="text-xs text-secondary">Educational simulator. Virtual funds only.</p>
      </footer>
    </div>
  );
}
