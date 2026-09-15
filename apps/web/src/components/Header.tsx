import { NavLink } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";
import { ConnectionStatusChip } from "./ConnectionStatus.tsx";
import { PaperBadge } from "./PaperBadge.tsx";

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
    <header className="border-b border-app-border bg-app-bg">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <NavLink to={signedIn ? "/trade" : "/"} className="text-lg font-semibold text-app-heading">
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
                <span className="tabular-nums text-app-heading">
                  Wallet balance {walletBalance} USDT
                </span>
              ) : null}
              {email ? <span className="text-app-text">{email}</span> : null}
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "text-app-heading font-medium" : "text-app-text hover:text-app-heading";
}
