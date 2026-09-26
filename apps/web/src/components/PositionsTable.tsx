import { useQuery } from "@tanstack/react-query";

import { listPositions } from "../lib/api/positions.ts";
import {
  decimalVisualSign,
  positionSideFromQuantity,
  type DecimalVisualSign,
  type PositionVisualSide,
} from "../lib/decimal-string.ts";
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
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => {
          const side = positionSideFromQuantity(position.quantity);
          const pnlSign = decimalVisualSign(position.cumulativeRealizedPnl);

          return (
            <tr key={position.symbol}>
              <Td>{position.symbol}</Td>
              <Td className={sideClass(side)}>{side}</Td>
              <Td numeric>{position.quantity}</Td>
              <Td numeric>{position.entryPrice}</Td>
              <Td numeric className={pnlClass(pnlSign)}>
                {position.cumulativeRealizedPnl}
              </Td>
              <Td>{formatTimestamp(position.updatedAt)}</Td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

function sideClass(side: PositionVisualSide): string | undefined {
  if (side === "LONG") {
    return "text-positive";
  }

  if (side === "SHORT") {
    return "text-negative";
  }

  return undefined;
}

function pnlClass(sign: DecimalVisualSign): string | undefined {
  if (sign === "positive") {
    return "text-positive";
  }

  if (sign === "negative") {
    return "text-negative";
  }

  return undefined;
}

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
