import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { listExecutions } from "../lib/api/executions.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { orderSideClass } from "../lib/order-side-class.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function ExecutionsTable({
  symbol,
  limit = 20,
  offset = 0,
  showOrderId = false,
  onRowCountChange,
}: {
  symbol?: string;
  limit?: number;
  offset?: number;
  showOrderId?: boolean;
  onRowCountChange?: (rowCount: number | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.executions.list({ symbol, limit, offset }),
    queryFn: () => listExecutions({ symbol, limit, offset }),
  });
  const executions = query.data?.executions ?? [];

  useEffect(() => {
    if (!onRowCountChange) {
      return;
    }

    if (query.isSuccess) {
      onRowCountChange(executions.length);
      return;
    }

    onRowCountChange(null);
  }, [onRowCountChange, executions.length, query.isSuccess]);

  if (query.isLoading) {
    return <TableStatus>Loading executions…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (executions.length === 0) {
    return <EmptyState>{offset > 0 ? "No more executions." : "No executions."}</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Symbol</Th>
          <Th>Side</Th>
          <Th>Type</Th>
          <Th>Quantity</Th>
          <Th>Price</Th>
          {showOrderId ? <Th>Order</Th> : null}
        </tr>
      </thead>
      <tbody>
        {executions.map((execution) => (
          <tr key={execution.id}>
            <Td>{formatTimestamp(execution.executedAt)}</Td>
            <Td>{execution.symbol}</Td>
            <Td className={orderSideClass(execution.side)}>{execution.side}</Td>
            <Td>{execution.orderType}</Td>
            <Td numeric>{execution.quantity}</Td>
            <Td numeric>{execution.price}</Td>
            {showOrderId ? <Td numeric>{execution.orderId}</Td> : null}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
