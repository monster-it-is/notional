import type { OrderStatus } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";

import { listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function OrdersHistoryTable({
  status,
  symbol,
  limit,
  offset,
}: {
  status?: OrderStatus;
  symbol?: string;
  limit: number;
  offset: number;
}) {
  const query = useQuery({
    queryKey: queryKeys.orders.list({ status, symbol, limit, offset }),
    queryFn: () => listOrders({ status, symbol, limit, offset }),
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading orders…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const orders = query.data?.orders ?? [];

  if (orders.length === 0) {
    return <EmptyState>No orders.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Created</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Side</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Quantity</th>
            <th className="py-2 pr-3">Limit</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Origin</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-t border-app-border text-app-heading">
              <td className="py-2 pr-3">{order.createdAt}</td>
              <td className="py-2 pr-3">{order.symbol}</td>
              <td className="py-2 pr-3">{order.side}</td>
              <td className="py-2 pr-3">{order.type}</td>
              <td className="py-2 pr-3 tabular-nums">{order.quantity}</td>
              <td className="py-2 pr-3 tabular-nums">{order.limitPrice ?? "—"}</td>
              <td className="py-2 pr-3">{order.status}</td>
              <td className="py-2 pr-3">{order.origin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
