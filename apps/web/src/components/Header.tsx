import { NavLink } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";
import { ConnectionStatusChip } from "./ConnectionStatus.tsx";
import { PaperBadge } from "./PaperBadge.tsx";
import { NumericText } from "./ui/NumericText.tsx";

export function Header({
  signedIn,
  walletBalance,
}: {
  signedIn: boolean;
  walletBalance?: string;
}) {
  const session = authClient.useSession();
  const accountStatus = useRealtimeStatusStore((state) => state.account);
  const marketStatus = useRealtimeStatusStore((state) => state.market);
  const email = session.data?.user.email;

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <NavLink
            to={signedIn ? "/trade" : "/"}
            className="font-heading text-lg font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Notional
          </NavLink>
          <PaperBadge />
          {signedIn ? (
            <nav className="flex gap-3 text-sm">
              <NavLink to="/trade" className={navClass}>
                Trade
              </NavLink>
              <NavLink to="/history" className={navClass}>
                History
              </NavLink>
              <NavLink to="/account" className={navClass}>
                Account
              </NavLink>
            </nav>
          ) : (
            <nav className="flex gap-3 text-sm">
              <NavLink to="/signin" className={navClass}>
                Sign in
              </NavLink>
              <NavLink to="/signup" className={navClass}>
                Sign up
              </NavLink>
            </nav>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {signedIn ? (
            <>
              <ConnectionStatusChip label="Market" status={marketStatus} />
              <ConnectionStatusChip label="Account" status={accountStatus} />
              {walletBalance !== undefined ? (
                <span className="text-foreground">
                  Wallet balance <NumericText>{walletBalance} USDT</NumericText>
                </span>
              ) : null}
              {email ? <span className="text-secondary">{email}</span> : null}
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive
    ? "font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    : "text-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
}
