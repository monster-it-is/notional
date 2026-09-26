import type { OrderResponse, OrderSide } from "@notional/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelOrder, listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { invalidateAfterCancel } from "../realtime/invalidate.ts";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

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
    return <TableStatus>Loading open orders…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const orders = query.data?.orders ?? [];

  if (orders.length === 0) {
    return <EmptyState>No open orders.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      {cancel.error ? <ErrorBanner error={cancel.error} /> : null}
      <DataTable>
        <thead>
          <tr>
            <Th>Symbol</Th>
            <Th>Side</Th>
            <Th>Type</Th>
            <Th>Quantity</Th>
            <Th>Limit</Th>
            <Th>Reduce</Th>
            <Th>Time</Th>
            <Th>Action</Th>
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
      </DataTable>
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
    <tr>
      <Td>{order.symbol}</Td>
      <Td className={sideClass(order.side)}>{order.side}</Td>
      <Td>{order.type}</Td>
      <Td numeric>{order.quantity}</Td>
      <Td numeric>{order.limitPrice ?? "—"}</Td>
      <Td>{order.reduceOnly ? "yes" : "no"}</Td>
      <Td>{formatTimestamp(order.createdAt)}</Td>
      <Td>
        <Button type="button" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </Td>
    </tr>
  );
}

function sideClass(side: OrderSide): string | undefined {
  if (side === "BUY") {
    return "text-positive";
  }

  if (side === "SELL") {
    return "text-negative";
  }

  return undefined;
}

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
