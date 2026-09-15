import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useOutletContext } from "react-router";

import { authClient } from "../auth/auth-client.ts";
import { FaucetCard } from "../components/FaucetCard.tsx";
import { WalletFundingTable } from "../components/WalletFundingTable.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Panel } from "../components/ui/Panel.tsx";
import { getAccount } from "../lib/api/account.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { stopRealtime } from "../realtime/runtime.ts";

type OutletContext = { suspended: boolean };

export function AccountPage() {
  const { suspended } = useOutletContext<OutletContext>();
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accountQuery = useQuery({
    queryKey: queryKeys.account,
    queryFn: getAccount,
  });
  const user = session.data?.user;

  async function signOut(): Promise<void> {
    stopRealtime();
    await authClient.signOut();
    queryClient.clear();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl">Account</h1>
      <Panel title="Session">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-app-text">Name</dt>
            <dd className="text-app-heading">{user?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-app-text">Email</dt>
            <dd className="text-app-heading">{user?.email ?? "—"}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <Button type="button" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Panel>

      <Panel title="Wallet">
        <p className="mb-4 text-sm text-app-heading">
          Wallet balance{" "}
          <span className="tabular-nums">
            {accountQuery.data?.balance ?? "—"} {accountQuery.data?.currency ?? "USDT"}
          </span>
        </p>
        <FaucetCard
          lastFaucetClaimAt={accountQuery.data?.lastFaucetClaimAt ?? null}
          suspended={suspended || accountQuery.data?.status === "SUSPENDED"}
        />
      </Panel>

      <Panel title="Wallet funding history">
        <WalletFundingTable limit={50} offset={0} />
      </Panel>
    </div>
  );
}
