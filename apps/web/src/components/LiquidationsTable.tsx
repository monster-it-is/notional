import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { listLiquidations } from "../lib/api/liquidations.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function LiquidationsTable({
  limit,
  offset,
  onRowCountChange,
}: {
  limit: number;
  offset: number;
  onRowCountChange?: (rowCount: number | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.liquidations.list({ limit, offset }),
    queryFn: () => listLiquidations({ limit, offset }),
  });
  const rows = query.data?.liquidations ?? [];

  useEffect(() => {
    if (!onRowCountChange) {
      return;
    }

    if (query.isSuccess) {
      onRowCountChange(rows.length);
      return;
    }

    onRowCountChange(null);
  }, [onRowCountChange, query.isSuccess, rows.length]);

  if (query.isLoading) {
    return <TableStatus>Loading liquidations…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (rows.length === 0) {
    return <EmptyState>{offset > 0 ? "No more liquidations." : "No liquidations."}</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Mode</Th>
          <Th>Symbol</Th>
          <Th>Equity</Th>
          <Th>Maintenance</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{formatTimestamp(row.createdAt)}</Td>
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
