import { useQuery } from "@tanstack/react-query";

import { listPositions } from "../lib/api/positions.ts";
import { positionSideFromQuantity } from "../lib/decimal-string.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function PositionsTable() {
  const query = useQuery({
    queryKey: queryKeys.positions.all,
    queryFn: listPositions,
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading positions…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const positions = query.data?.positions ?? [];

  if (positions.length === 0) {
    return <EmptyState>No open positions.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Side</th>
            <th className="py-2 pr-3">Quantity</th>
            <th className="py-2 pr-3">Entry</th>
            <th className="py-2 pr-3">Realized PnL</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.symbol} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{position.symbol}</td>
              <td className="py-2 pr-3">{positionSideFromQuantity(position.quantity)}</td>
              <td className="py-2 pr-3 tabular-nums">{position.quantity}</td>
              <td className="py-2 pr-3 tabular-nums">{position.entryPrice}</td>
              <td className="py-2 pr-3 tabular-nums">{position.cumulativeRealizedPnl}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
