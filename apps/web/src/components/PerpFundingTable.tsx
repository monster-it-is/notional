import { useQuery } from "@tanstack/react-query";

import { listPerpFunding } from "../lib/api/funding.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function PerpFundingTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.perpFunding.list({ limit, offset }),
    queryFn: () => listPerpFunding({ limit, offset }),
  });

  if (query.isLoading) {
    return <TableStatus>Loading perpetual funding…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const rows = query.data?.funding ?? [];

  if (rows.length === 0) {
    return <EmptyState>No perpetual funding settlements.</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Funding time</Th>
          <Th>Symbol</Th>
          <Th>Mode</Th>
          <Th>Quantity</Th>
          <Th>Rate</Th>
          <Th>Mark</Th>
          <Th>Payment</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{row.fundingTime}</Td>
            <Td>{row.symbol}</Td>
            <Td>{row.marginMode}</Td>
            <Td numeric>{row.quantity}</Td>
            <Td numeric>{row.fundingRate}</Td>
            <Td numeric>{row.markPrice}</Td>
            <Td numeric>{row.fundingPayment}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
