import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { listPositions } from "../lib/api/positions.ts";
import {
  decimalVisualSign,
  positionSideFromQuantity,
  type DecimalVisualSign,
  type PositionVisualSide,
} from "../lib/decimal-string.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { ClosePositionConfirm } from "./ClosePositionConfirm.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

const CUMULATIVE_REALIZED_HELP =
  "Lifetime realized PnL for this symbol, including earlier reductions. Not this leg only.";

export function PositionsTable({
  disabled = false,
  onClosePendingChange,
}: {
  disabled?: boolean;
  onClosePendingChange?: (pending: boolean) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.positions.all,
    queryFn: listPositions,
    staleTime: 0,
    refetchInterval: 1000,
  });
  const [selection, setSelection] = useState<{
    symbol: string;
    signedQuantity: string;
  } | null>(null);
  const [closePending, setClosePending] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const reportClosePending = useCallback(
    (pending: boolean) => {
      setClosePending(pending);
      onClosePendingChange?.(pending);
    },
    [onClosePendingChange],
  );
  const dismissClose = useCallback(() => {
    reportClosePending(false);
    setSelection(null);
    const opener = openerRef.current;
    queueMicrotask(() => {
      opener?.focus();
    });
  }, [reportClosePending]);

  if (query.isLoading) {
    return <TableStatus>Loading positions…</TableStatus>;
  }

  if (query.isLoadingError) {
    return <ErrorBanner error={query.error} />;
  }

  const positions = query.data?.positions ?? [];
  const refetchError = query.isRefetchError ? query.error : null;

  return (
    <div className="space-y-3">
      {refetchError ? <ErrorBanner error={refetchError} /> : null}
      {selection ? (
        <ClosePositionConfirm
          key={`${selection.symbol}:${selection.signedQuantity}`}
          symbol={selection.symbol}
          signedQuantity={selection.signedQuantity}
          disabled={disabled}
          onDismiss={dismissClose}
          onPendingChange={reportClosePending}
        />
      ) : null}
      {positions.length === 0 ? (
        <EmptyState>No open positions.</EmptyState>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <Th>Symbol</Th>
              <Th>Side</Th>
              <Th>Quantity</Th>
              <Th>Entry</Th>
              <Th>Mark</Th>
              <Th>Unrealized PnL</Th>
              <Th title={CUMULATIVE_REALIZED_HELP}>Cumulative realized</Th>
              <Th>Mode</Th>
              <Th>Leverage</Th>
              <Th>Updated</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const side = positionSideFromQuantity(position.quantity);
              const realizedSign = decimalVisualSign(position.cumulativeRealizedPnl);
              const unrealizedSign =
                position.unrealizedPnl === null
                  ? "zero"
                  : decimalVisualSign(position.unrealizedPnl);

              return (
                <tr key={position.symbol}>
                  <Td>{position.symbol}</Td>
                  <Td className={sideClass(side)}>{side}</Td>
                  <Td numeric>{position.quantity}</Td>
                  <Td numeric>{position.entryPrice}</Td>
                  <Td numeric>{position.markPrice ?? "—"}</Td>
                  <Td numeric className={pnlClass(unrealizedSign)}>
                    {position.unrealizedPnl ?? "—"}
                  </Td>
                  <Td numeric className={pnlClass(realizedSign)}>
                    {position.cumulativeRealizedPnl}
                  </Td>
                  <Td>{position.marginMode}</Td>
                  <Td numeric>{`${position.leverage}x`}</Td>
                  <Td>{formatTimestamp(position.updatedAt)}</Td>
                  <Td>
                    {side === "FLAT" ? null : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={disabled || closePending}
                        aria-label={`Close ${position.symbol}`}
                        onClick={(event) => {
                          if (closePending) {
                            return;
                          }

                          openerRef.current = event.currentTarget;
                          setSelection({
                            symbol: position.symbol,
                            signedQuantity: position.quantity,
                          });
                        }}
                      >
                        Close
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
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
