import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { listPerpFunding } from "../lib/api/funding.ts";
import {
  decimalVisualSign,
  type DecimalVisualSign,
} from "../lib/decimal-string.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

export function PerpFundingTable({
  limit,
  offset,
  onRowCountChange,
}: {
  limit: number;
  offset: number;
  onRowCountChange?: (rowCount: number | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.perpFunding.list({ limit, offset }),
    queryFn: () => listPerpFunding({ limit, offset }),
  });
  const rows = query.data?.funding ?? [];

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
    return <TableStatus>Loading perpetual funding…</TableStatus>;
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState>
        {offset > 0 ? "No more perpetual funding settlements." : "No perpetual funding settlements."}
      </EmptyState>
    );
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
        {rows.map((row) => {
          const paymentSign = decimalVisualSign(row.fundingPayment);

          return (
            <tr key={row.id}>
              <Td>{formatTimestamp(row.fundingTime)}</Td>
              <Td>{row.symbol}</Td>
              <Td>{row.marginMode}</Td>
              <Td numeric>{row.quantity}</Td>
              <Td numeric>{row.fundingRate}</Td>
              <Td numeric>{row.markPrice}</Td>
              <Td numeric className={paymentClass(paymentSign)}>
                {row.fundingPayment}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

function paymentClass(sign: DecimalVisualSign): string | undefined {
  if (sign === "positive") {
    return "text-positive";
  }

  if (sign === "negative") {
    return "text-negative";
  }

  return undefined;
}
