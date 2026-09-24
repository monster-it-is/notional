import { useQuery } from "@tanstack/react-query";

import { listExecutions } from "../lib/api/executions.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function ExecutionsTable({
  symbol,
  limit = 20,
  offset = 0,
}: {
  symbol?: string;
  limit?: number;
  offset?: number;
}) {
  const query = useQuery({
    queryKey: queryKeys.executions.list({ symbol, limit, offset }),
    queryFn: () => listExecutions({ symbol, limit, offset }),
  });

  if (query.isLoading) {
    return <TableStatus>Loading executions…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const executions = query.data?.executions ?? [];

  if (executions.length === 0) {
    return <EmptyState>No executions.</EmptyState>;
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
        </tr>
      </thead>
      <tbody>
        {executions.map((execution) => (
          <tr key={execution.id}>
            <Td>{execution.executedAt}</Td>
            <Td>{execution.symbol}</Td>
            <Td>{execution.side}</Td>
            <Td>{execution.orderType}</Td>
            <Td numeric>{execution.quantity}</Td>
            <Td numeric>{execution.price}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
