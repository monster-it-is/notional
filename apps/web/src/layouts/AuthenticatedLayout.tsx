import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router";

import { AppBottomNav } from "../components/app/AppBottomNav.tsx";
import { AppHeader } from "../components/app/AppHeader.tsx";
import { APP_MAIN_CLASS } from "../components/app/app-nav.ts";
import { useMarketSocket } from "../hooks/use-market-socket.ts";
import { getAccount } from "../lib/api/account.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { AccountBootstrap, useAccountBootstrap } from "./AccountBootstrap.tsx";

export function AuthenticatedLayout() {
  useMarketSocket(true);

  return (
    <AccountBootstrap>
      <AuthenticatedShell />
    </AccountBootstrap>
  );
}

function AuthenticatedShell() {
  const bootstrap = useAccountBootstrap();
  const accountQuery = useQuery({
    queryKey: queryKeys.account,
    queryFn: getAccount,
  });
  const account = accountQuery.data ?? bootstrap.account;
  const suspended = account?.status === "SUSPENDED";

  return (
    <div className="app-shell flex min-h-svh flex-col bg-background">
      <AppHeader accountReady walletBalance={account?.balance} />
      {suspended ? (
        <div role="alert" className="border-b border-warning-border bg-warning-background px-4 py-2 text-center text-sm text-warning">
          This paper account is suspended. Trading and faucet claims are disabled.
        </div>
      ) : null}
      <main className={APP_MAIN_CLASS} id="main">
        <Outlet context={{ suspended }} />
      </main>
      <AppBottomNav />
    </div>
  );
}
