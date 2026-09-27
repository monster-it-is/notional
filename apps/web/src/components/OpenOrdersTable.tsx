import type { OrderResponse, OrderSide } from "@notional/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { cancelOrder, listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { invalidateAfterCancel } from "../realtime/invalidate.ts";
import { OffsetPagination } from "./OffsetPagination.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

const PAGE_SIZE = 50;

export function OpenOrdersTable({ symbol }: { symbol?: string }) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: queryKeys.orders.list({ status: "OPEN", symbol, limit: PAGE_SIZE, offset }),
    queryFn: () => listOrders({ status: "OPEN", symbol, limit: PAGE_SIZE, offset }),
  });

  const cancel = useMutation({
    retry: false,
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: () => {
      invalidateAfterCancel(queryClient);
    },
  });

  const orders = query.data?.orders ?? [];
  const rowCount = query.isSuccess ? orders.length : null;

  return (
    <div className="space-y-3">
      {query.isLoading ? <TableStatus>Loading open orders…</TableStatus> : null}
      {query.error ? <ErrorBanner error={query.error} /> : null}
      {query.isSuccess && cancel.error ? <ErrorBanner error={cancel.error} /> : null}
      {query.isSuccess && orders.length === 0 ? (
        <EmptyState>{offset > 0 ? "No more open orders." : "No open orders."}</EmptyState>
      ) : null}
      {query.isSuccess && orders.length > 0 ? (
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
      ) : null}
      <OffsetPagination
        offset={offset}
        pageSize={PAGE_SIZE}
        rowCount={rowCount}
        onPrevious={() => setOffset(offset > PAGE_SIZE ? offset - PAGE_SIZE : 0)}
        onNext={() => setOffset(offset + PAGE_SIZE)}
      />
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
        <Button
          type="button"
          size="sm"
          aria-label={`Cancel ${order.symbol}`}
          onClick={onCancel}
          disabled={pending}
        >
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
