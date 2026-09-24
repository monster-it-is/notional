import type { OrderStatus } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";

import { listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

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
    return <TableStatus>Loading orders…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const orders = query.data?.orders ?? [];

  if (orders.length === 0) {
    return <EmptyState>No orders.</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Created</Th>
          <Th>Symbol</Th>
          <Th>Side</Th>
          <Th>Type</Th>
          <Th>Quantity</Th>
          <Th>Limit</Th>
          <Th>Status</Th>
          <Th>Origin</Th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <Td>{order.createdAt}</Td>
            <Td>{order.symbol}</Td>
            <Td>{order.side}</Td>
            <Td>{order.type}</Td>
            <Td numeric>{order.quantity}</Td>
            <Td numeric>{order.limitPrice ?? "—"}</Td>
            <Td>{order.status}</Td>
            <Td>{order.origin}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
