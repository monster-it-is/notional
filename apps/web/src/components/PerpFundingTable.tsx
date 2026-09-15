import { useQuery } from "@tanstack/react-query";

import { listPerpFunding } from "../lib/api/funding.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function PerpFundingTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.perpFunding.list({ limit, offset }),
    queryFn: () => listPerpFunding({ limit, offset }),
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading perpetual funding…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const rows = query.data?.funding ?? [];

  if (rows.length === 0) {
    return <EmptyState>No perpetual funding settlements.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Funding time</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Mode</th>
            <th className="py-2 pr-3">Quantity</th>
            <th className="py-2 pr-3">Rate</th>
            <th className="py-2 pr-3">Mark</th>
            <th className="py-2 pr-3">Payment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{row.fundingTime}</td>
              <td className="py-2 pr-3">{row.symbol}</td>
              <td className="py-2 pr-3">{row.marginMode}</td>
              <td className="py-2 pr-3 tabular-nums">{row.quantity}</td>
              <td className="py-2 pr-3 tabular-nums">{row.fundingRate}</td>
              <td className="py-2 pr-3 tabular-nums">{row.markPrice}</td>
              <td className="py-2 pr-3 tabular-nums">{row.fundingPayment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
