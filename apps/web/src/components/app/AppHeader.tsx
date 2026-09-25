import { NavLink } from "react-router";

import { Wordmark } from "../brand/Wordmark.tsx";
import { ConnectionStatusChip } from "../ConnectionStatus.tsx";
import { NumericText } from "../ui/NumericText.tsx";
import { cn } from "../../lib/cn.ts";
import { useRealtimeStatusStore } from "../../stores/realtime-status-store.ts";
import { ThemeToggle } from "../../theme/ThemeToggle.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { APP_NAV } from "./app-nav.ts";

const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AppHeader({
  accountReady,
  walletBalance,
}: {
  accountReady: boolean;
  walletBalance?: string;
}) {
  const marketStatus = useRealtimeStatusStore((state) => state.market);
  const accountStatus = useRealtimeStatusStore((state) => state.account);
  const showWallet = accountReady && walletBalance !== undefined;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-40 focus:bg-surface focus:px-3 focus:py-2"
        href="#main"
      >
        Skip to content
      </a>
      <div className="flex h-12 w-full flex-nowrap items-center gap-3 px-3 xl:px-4">
        <NavLink
          className={cn(
            "app-chrome-link app-chrome-brand inline-flex shrink-0 items-center gap-2 whitespace-nowrap",
            focus,
          )}
          to="/trade"
        >
          <Wordmark />
          <span className="font-heading text-sm font-semibold tracking-tight">Notional</span>
          <span className="border border-border border-l-2 border-l-accent px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-secondary">
            Paper
          </span>
        </NavLink>

        <nav aria-label="Primary" className="hidden min-w-0 items-center md:flex">
          {APP_NAV.map((item) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "app-chrome-link inline-flex h-12 items-center px-2.5 text-sm",
                  focus,
                  isActive && "shadow-[inset_0_-2px_0_0_var(--accent)]",
                )
              }
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
          <div className="hidden items-center gap-3 lg:flex">
            <ConnectionStatusChip label="Market" status={marketStatus} />
            {accountReady ? (
              <ConnectionStatusChip label="Account" status={accountStatus} />
            ) : null}
            {showWallet ? (
              <span
                aria-label={`Wallet ${walletBalance} USDT`}
                className="hidden items-center gap-1.5 text-sm xl:inline-flex"
              >
                <span className="text-secondary">Wallet</span>
                <NumericText>{walletBalance} USDT</NumericText>
              </span>
            ) : null}
          </div>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
