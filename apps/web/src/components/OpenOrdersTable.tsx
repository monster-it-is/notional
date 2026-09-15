import type { OrderResponse } from "@notional/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelOrder, listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { invalidateAfterCancel } from "../realtime/invalidate.ts";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function OpenOrdersTable({ symbol }: { symbol?: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.orders.list({ status: "OPEN", symbol, limit: 50, offset: 0 }),
    queryFn: () => listOrders({ status: "OPEN", symbol, limit: 50, offset: 0 }),
  });

  const cancel = useMutation({
    retry: false,
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: () => {
      invalidateAfterCancel(queryClient);
    },
  });

  if (query.isLoading) {
    return <p className="text-sm text-app-text">Loading open orders…</p>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const orders = query.data?.orders ?? [];

  if (orders.length === 0) {
    return <EmptyState>No open orders.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      {cancel.error ? <ErrorBanner error={cancel.error} /> : null}
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-app-text">
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3">Side</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Quantity</th>
            <th className="py-2 pr-3">Limit</th>
            <th className="py-2 pr-3">Reduce</th>
            <th className="py-2 pr-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OpenOrderRow
              key={order.id}
              order={order}
              pending={cancel.isPending}
              onCancel={() => cancel.mutate(order.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpenOrderRow({
  order,
  pending,
  onCancel,
}: {
  order: OrderResponse;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <tr className="border-t border-app-border text-app-heading">
      <td className="py-2 pr-3">{order.symbol}</td>
      <td className="py-2 pr-3">{order.side}</td>
      <td className="py-2 pr-3">{order.type}</td>
      <td className="py-2 pr-3 tabular-nums">{order.quantity}</td>
      <td className="py-2 pr-3 tabular-nums">{order.limitPrice ?? "—"}</td>
      <td className="py-2 pr-3">{order.reduceOnly ? "yes" : "no"}</td>
      <td className="py-2 pr-3">
        <Button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </td>
    </tr>
  );
}
