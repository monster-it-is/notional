import type { OrderResponse, OrderSide } from "@notional/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { listPositions } from "../lib/api/positions.ts";
import { cn } from "../lib/cn.ts";
import {
  decimalVisualSign,
  positionSideFromQuantity,
  type DecimalVisualSign,
  type PositionVisualSide,
} from "../lib/decimal-string.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { ClosePositionConfirm } from "./ClosePositionConfirm.tsx";
import { OrderAcknowledgement } from "./OrderAcknowledgement.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { DataTable, TableStatus, Td, Th } from "./ui/table.tsx";

const CUMULATIVE_REALIZED_HELP =
  "Lifetime realized PnL for this symbol, including earlier reductions. Not this leg only.";

const POSITION_TABLE_CLASS = "table-fixed min-w-[91rem]";
const CONTAINED_CELL = "max-w-0 overflow-hidden text-ellipsis whitespace-nowrap";

const POSITION_COLUMNS = [
  { name: "symbol", width: "7rem" },
  { name: "side", width: "5rem" },
  { name: "quantity", width: "8rem" },
  { name: "entry", width: "8rem" },
  { name: "mark", width: "8.5rem" },
  { name: "unrealizedPnl", width: "10rem" },
  { name: "cumulativeRealized", width: "11.5rem" },
  { name: "mode", width: "6rem" },
  { name: "leverage", width: "5rem" },
  { name: "updated", width: "12rem" },
  { name: "action", width: "10rem" },
] as const;

export function PositionsTable({
  disabled = false,
  reduceDisabled = false,
  onClosePendingChange,
  onReduce,
}: {
  disabled?: boolean;
  reduceDisabled?: boolean;
  onClosePendingChange?: (pending: boolean) => void;
  onReduce?: (command: { symbol: string; side: OrderSide }) => void;
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
  const [closeAcknowledgement, setCloseAcknowledgement] = useState<OrderResponse | null>(null);
  const [closePending, setClosePending] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const reportClosePending = useCallback(
    (pending: boolean) => {
      setClosePending(pending);
      onClosePendingChange?.(pending);
    },
    [onClosePendingChange],
  );
  const acknowledgeClose = useCallback((placed: OrderResponse) => {
    setCloseAcknowledgement(placed);
  }, []);
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
          onSuccess={acknowledgeClose}
          onPendingChange={reportClosePending}
        />
      ) : null}
      {closeAcknowledgement ? <OrderAcknowledgement order={closeAcknowledgement} /> : null}
      {positions.length === 0 ? (
        <EmptyState>No open positions.</EmptyState>
      ) : (
        <DataTable className={POSITION_TABLE_CLASS}>
          <colgroup>
            {POSITION_COLUMNS.map((column) => (
              <col key={column.name} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <Th className="whitespace-nowrap">Symbol</Th>
              <Th className="whitespace-nowrap">Side</Th>
              <Th className="whitespace-nowrap">Quantity</Th>
              <Th className="whitespace-nowrap">Entry</Th>
              <Th className="whitespace-nowrap">Mark</Th>
              <Th className="whitespace-nowrap">Unrealized PnL</Th>
              <Th className="whitespace-nowrap" title={CUMULATIVE_REALIZED_HELP}>
                Cumulative realized
              </Th>
              <Th className="whitespace-nowrap">Mode</Th>
              <Th className="whitespace-nowrap">Leverage</Th>
              <Th className="whitespace-nowrap">Updated</Th>
              <Th className="whitespace-nowrap">Action</Th>
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
                  <Td className={CONTAINED_CELL}>{position.symbol}</Td>
                  <Td className={cn(CONTAINED_CELL, sideClass(side))}>{side}</Td>
                  <Td numeric className={CONTAINED_CELL} title={position.quantity}>
                    {position.quantity}
                  </Td>
                  <Td numeric className={CONTAINED_CELL} title={position.entryPrice}>
                    {position.entryPrice}
                  </Td>
                  <Td numeric className={CONTAINED_CELL} title={position.markPrice ?? undefined}>
                    {position.markPrice ?? "—"}
                  </Td>
                  <Td
                    numeric
                    className={cn(CONTAINED_CELL, pnlClass(unrealizedSign))}
                    title={position.unrealizedPnl ?? undefined}
                  >
                    {position.unrealizedPnl ?? "—"}
                  </Td>
                  <Td
                    numeric
                    className={cn(CONTAINED_CELL, pnlClass(realizedSign))}
                    title={position.cumulativeRealizedPnl}
                  >
                    {position.cumulativeRealizedPnl}
                  </Td>
                  <Td className={CONTAINED_CELL}>{position.marginMode}</Td>
                  <Td numeric className={CONTAINED_CELL}>{`${position.leverage}x`}</Td>
                  <Td className={CONTAINED_CELL}>{formatTimestamp(position.updatedAt)}</Td>
                  <Td>
                    {side === "FLAT" ? null : (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={disabled || closePending || reduceDisabled}
                          aria-label={`Reduce ${position.symbol}`}
                          onClick={() => {
                            if (disabled || closePending || reduceDisabled) {
                              return;
                            }

                            const ticketSide = reduceOrderSide(side);
                            if (!ticketSide) {
                              return;
                            }

                            onReduce?.({ symbol: position.symbol, side: ticketSide });
                          }}
                        >
                          Reduce
                        </Button>
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
                            setCloseAcknowledgement(null);
                            setSelection({
                              symbol: position.symbol,
                              signedQuantity: position.quantity,
                            });
                          }}
                        >
                          Close
                        </Button>
                      </div>
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

function reduceOrderSide(side: PositionVisualSide): OrderSide | null {
  if (side === "LONG") {
    return "SELL";
  }

  if (side === "SHORT") {
    return "BUY";
  }

  return null;
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
