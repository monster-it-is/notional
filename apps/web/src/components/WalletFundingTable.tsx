import type { FundingEventType } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { getWalletFunding } from "../lib/api/account.ts";
import { formatExactMoneyDisplay } from "../lib/format-exact-money.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function WalletFundingTable({
  limit,
  offset,
  onRowCountChange,
}: {
  limit: number;
  offset: number;
  onRowCountChange?: (rowCount: number | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.walletFunding.list({ limit, offset }),
    queryFn: () => getWalletFunding({ limit, offset }),
  });
  const events = query.data?.events ?? [];

  useEffect(() => {
    if (!onRowCountChange) {
      return;
    }

    if (query.isSuccess) {
      onRowCountChange(events.length);
      return;
    }

    onRowCountChange(null);
  }, [onRowCountChange, query.isSuccess, events.length]);

  if (query.isLoading) {
    return <TableStatus>Loading wallet funding…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (events.length === 0) {
    return (
      <EmptyState>
        {offset > 0 ? "No more wallet funding events." : "No wallet funding events."}
      </EmptyState>
    );
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Time</Th>
          <Th>Event</Th>
          <Th>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <Td>{formatTimestamp(event.createdAt)}</Td>
            <Td>{fundingEventLabel(event.type)}</Td>
            <Td numeric className="text-positive">
              +{formatExactMoneyDisplay(event.amount)} {event.currency}
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function fundingEventLabel(type: FundingEventType): string {
  if (type === "SIGNUP_ALLOCATION") {
    return "Signup allocation";
  }

  if (type === "FAUCET_CLAIM") {
    return "Faucet claim";
  }

  return type;
}
