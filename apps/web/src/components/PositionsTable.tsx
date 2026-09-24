import { useQuery } from "@tanstack/react-query";

import { listPositions } from "../lib/api/positions.ts";
import { positionSideFromQuantity } from "../lib/decimal-string.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function PositionsTable() {
  const query = useQuery({
    queryKey: queryKeys.positions.all,
    queryFn: listPositions,
  });

  if (query.isLoading) {
    return <TableStatus>Loading positions…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const positions = query.data?.positions ?? [];

  if (positions.length === 0) {
    return <EmptyState>No open positions.</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Symbol</Th>
          <Th>Side</Th>
          <Th>Quantity</Th>
          <Th>Entry</Th>
          <Th>Realized PnL</Th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.symbol}>
            <Td>{position.symbol}</Td>
            <Td>{positionSideFromQuantity(position.quantity)}</Td>
            <Td numeric>{position.quantity}</Td>
            <Td numeric>{position.entryPrice}</Td>
            <Td numeric>{position.cumulativeRealizedPnl}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
