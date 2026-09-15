import { useQuery } from "@tanstack/react-query";

import { getWalletFunding } from "../lib/api/account.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function WalletFundingTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.walletFunding.list({ limit, offset }),
    queryFn: () => getWalletFunding({ limit, offset }),
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading wallet funding…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const events = query.data?.events ?? [];

  if (events.length === 0) {
    return <EmptyState>No wallet funding events.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Amount</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{event.createdAt}</td>
              <td className="py-2 pr-3">{event.type}</td>
              <td className="py-2 pr-3 tabular-nums">
                {event.amount} {event.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
