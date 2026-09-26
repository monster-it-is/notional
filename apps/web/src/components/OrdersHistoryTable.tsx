import type { OrderOrigin, OrderStatus } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { listOrders } from "../lib/api/orders.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { orderSideClass } from "../lib/order-side-class.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function OrdersHistoryTable({
  status,
  symbol,
  limit,
  offset,
  onRowCountChange,
}: {
  status?: OrderStatus;
  symbol?: string;
  limit: number;
  offset: number;
  onRowCountChange?: (rowCount: number | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.orders.list({ status, symbol, limit, offset }),
    queryFn: () => listOrders({ status, symbol, limit, offset }),
  });
  const orders = query.data?.orders ?? [];

  useEffect(() => {
    if (!onRowCountChange) {
      return;
    }

    if (query.isSuccess) {
      onRowCountChange(orders.length);
      return;
    }

    onRowCountChange(null);
  }, [onRowCountChange, orders.length, query.isSuccess]);

  if (query.isLoading) {
    return <TableStatus>Loading orders…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (orders.length === 0) {
    return <EmptyState>{offset > 0 ? "No more orders." : "No orders."}</EmptyState>;
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
          <Th>Reduce</Th>
          <Th>Status</Th>
          <Th>Origin</Th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <Td>{formatTimestamp(order.createdAt)}</Td>
            <Td>{order.symbol}</Td>
            <Td className={orderSideClass(order.side)}>{order.side}</Td>
            <Td>{order.type}</Td>
            <Td numeric>{order.quantity}</Td>
            <Td numeric>{order.limitPrice ?? "—"}</Td>
            <Td>{order.reduceOnly ? "yes" : "no"}</Td>
            <Td className={orderStatusClass(order.status)}>{order.status}</Td>
            <Td className={orderOriginClass(order.origin)}>{order.origin}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function orderStatusClass(status: OrderStatus): string | undefined {
  if (status === "OPEN") {
    return "text-accent";
  }

  if (status === "CANCELLED") {
    return "text-secondary";
  }

  return undefined;
}

function orderOriginClass(origin: OrderOrigin): string | undefined {
  if (origin === "LIQUIDATION") {
    return "text-warning";
  }

  return undefined;
}
