import { useQuery } from "@tanstack/react-query";

import { listLiquidations } from "../lib/api/liquidations.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function LiquidationsTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.liquidations.list({ limit, offset }),
    queryFn: () => listLiquidations({ limit, offset }),
  });

  if (query.isLoading) {
    return <TableStatus>Loading liquidations…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const rows = query.data?.liquidations ?? [];

  if (rows.length === 0) {
    return <EmptyState>No liquidations.</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Mode</Th>
          <Th>Symbol</Th>
          <Th>Equity snapshot</Th>
          <Th>Maintenance</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{row.createdAt}</Td>
            <Td>{row.marginMode}</Td>
            <Td>{row.symbol ?? "CROSS"}</Td>
            <Td numeric>{row.equity}</Td>
            <Td numeric>{row.maintenanceMargin}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
