import { useQuery } from "@tanstack/react-query";

import { getWalletFunding } from "../lib/api/account.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function WalletFundingTable({ limit, offset }: { limit: number; offset: number }) {
  const query = useQuery({
    queryKey: queryKeys.walletFunding.list({ limit, offset }),
    queryFn: () => getWalletFunding({ limit, offset }),
  });

  if (query.isLoading) {
    return <TableStatus>Loading wallet funding…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  const events = query.data?.events ?? [];

  if (events.length === 0) {
    return <EmptyState>No wallet funding events.</EmptyState>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Type</Th>
          <Th>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <Td>{event.createdAt}</Td>
            <Td>{event.type}</Td>
            <Td numeric>
              {event.amount} {event.currency}
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
