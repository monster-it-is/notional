import { useQuery } from "@tanstack/react-query";
import { Outlet } from "react-router";

import { Header } from "../components/Header.tsx";
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
    <div className="flex min-h-svh flex-col">
      <Header signedIn walletBalance={account?.balance} />
      {suspended ? (
        <div role="alert" className="bg-app-danger/10 px-4 py-2 text-center text-sm text-app-danger">
          This paper account is suspended. Trading and faucet claims are disabled.
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <Outlet context={{ suspended }} />
      </main>
    </div>
  );
}
