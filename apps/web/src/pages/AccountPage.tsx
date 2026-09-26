import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { FaucetCard } from "../components/FaucetCard.tsx";
import { OffsetPagination } from "../components/OffsetPagination.tsx";
import { WalletFundingTable } from "../components/WalletFundingTable.tsx";
import { Button } from "../components/ui/Button.tsx";
import { ErrorBanner } from "../components/ui/ErrorBanner.tsx";
import { NumericText } from "../components/ui/NumericText.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { getAccount } from "../lib/api/account.ts";
import { formatExactMoneyDisplay } from "../lib/format-exact-money.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { stopRealtime } from "../realtime/runtime.ts";

type OutletContext = { suspended: boolean };

const PAGE_SIZE = 50;

export function AccountPage() {
  const { suspended } = useOutletContext<OutletContext>();
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [offset, setOffset] = useState(0);
  const [rowCountByOffset, setRowCountByOffset] = useState<Record<number, number | null>>({});
  const accountQuery = useQuery({
    queryKey: queryKeys.account,
    queryFn: getAccount,
  });
  const user = session.data?.user;
  const account = accountQuery.data;
  const rowCount = rowCountByOffset[offset] ?? null;
  const faucetSuspended = suspended || account?.status === "SUSPENDED";

  const onRowCountChange = useCallback(
    (next: number | null) => {
      setRowCountByOffset((prev) => {
        if (prev[offset] === next) {
          return prev;
        }

        return { [offset]: next };
      });
    },
    [offset],
  );

  async function signOut(): Promise<void> {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    try {
      stopRealtime();
      await authClient.signOut();
      queryClient.clear();
      navigate("/signin", { replace: true });
    } catch {
      return;
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl">Account</h1>
        <p className="text-sm text-secondary">Paper wallet and virtual funding for this account.</p>
      </div>

      {!account && accountQuery.isPending ? (
        <p className="text-sm text-secondary">Loading account…</p>
      ) : null}
      {!account && accountQuery.error ? <ErrorBanner error={accountQuery.error} /> : null}

      {account ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Paper wallet">
              <p className="text-sm text-secondary">Paper trading balance</p>
              <p className="mt-2" title={account.balance}>
                <NumericText>
                  {formatExactMoneyDisplay(account.balance)} {account.currency}
                </NumericText>
              </p>
              {account.status === "SUSPENDED" ? (
                <p className="mt-2 text-sm text-secondary">Suspended</p>
              ) : null}
            </Panel>
            <Panel title="Virtual faucet">
              <FaucetCard
                lastFaucetClaimAt={account.lastFaucetClaimAt}
                suspended={faucetSuspended}
              />
            </Panel>
          </div>

          <Panel title="Wallet funding">
            <WalletFundingTable
              limit={PAGE_SIZE}
              offset={offset}
              onRowCountChange={onRowCountChange}
            />
            <OffsetPagination
              offset={offset}
              pageSize={PAGE_SIZE}
              rowCount={rowCount}
              onPrevious={() => setOffset(offset > PAGE_SIZE ? offset - PAGE_SIZE : 0)}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          </Panel>
        </>
      ) : null}

      <Panel title="Session">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-secondary">Name</dt>
            <dd className="text-foreground">{user?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-secondary">Email</dt>
            <dd className="text-foreground">{user?.email ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <Button type="button" disabled={signingOut} onClick={() => void signOut()}>
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
