import type { OrderResponse, OrderSide, PositionListResponse } from "@notional/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { usePlaceOrder } from "../hooks/use-place-order.ts";
import { listOrders } from "../lib/api/orders.ts";
import { absolutePositionQuantity, positionSideFromQuantity } from "../lib/decimal-string.ts";
import { queryKeys } from "../lib/query-keys.ts";
import { Button } from "./ui/Button.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { NumericText } from "./ui/NumericText.tsx";
import { Surface } from "./ui/Surface.tsx";

const OPEN_ORDER_CHECK = {
  status: "OPEN" as const,
  limit: 100,
  offset: 0,
};

export function ClosePositionConfirm({
  symbol,
  signedQuantity,
  disabled,
  onDismiss,
  onSuccess,
  onPendingChange,
}: {
  symbol: string;
  signedQuantity: string;
  disabled: boolean;
  onDismiss: () => void;
  onSuccess?: (order: OrderResponse) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef(false);
  const deliveredOrderIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const order = usePlaceOrder();
  const [stale, setStale] = useState(false);
  const closeSide = closeOrderSide(signedQuantity);
  const quantity = absolutePositionQuantity(signedQuantity);
  const ordersQuery = useQuery({
    queryKey: queryKeys.orders.list({ ...OPEN_ORDER_CHECK, symbol }),
    queryFn: () => listOrders({ ...OPEN_ORDER_CHECK, symbol }),
  });
  const hasReduceOnlyOpenOrder =
    ordersQuery.isSuccess && ordersQuery.data.orders.some((row) => row.reduceOnly);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    onPendingChange(order.pending);
    if (!order.pending) {
      placedRef.current = false;
    }
  }, [onPendingChange, order.pending]);

  useEffect(() => {
    if (!order.data || deliveredOrderIdRef.current === order.data.id) {
      return;
    }

    deliveredOrderIdRef.current = order.data.id;
    onSuccess?.(order.data);
    onDismiss();
  }, [order.data, onSuccess, onDismiss]);

  function confirmClose(): void {
    if (disabled || order.pending || placedRef.current || closeSide === null) {
      return;
    }

    const listed = queryClient.getQueryData<PositionListResponse>(queryKeys.positions.all);
    const current = listed?.positions.find((row) => row.symbol === symbol);

    if (!current || current.quantity !== signedQuantity) {
      setStale(true);
      return;
    }

    setStale(false);
    order.reset();
    placedRef.current = true;
    onPendingChange(true);
    order.place({
      type: "MARKET",
      symbol,
      side: closeSide,
      quantity,
      reduceOnly: true,
    });
  }

  return (
    <Surface className="min-w-0">
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="min-w-0 space-y-3 outline-none"
      >
        <h3 id={titleId} className="font-heading text-base text-foreground">
          Close {symbol}
        </h3>
        <p className="text-sm text-foreground">This is a reduce-only market close.</p>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-secondary">Symbol</dt>
            <dd>{symbol}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-secondary">Side</dt>
            <dd>{closeSide ?? "—"}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-secondary">Quantity</dt>
            <dd className="min-w-0 flex-1 overflow-x-auto">
              <NumericText className="whitespace-nowrap">{quantity}</NumericText>
            </dd>
          </div>
        </dl>
        {ordersQuery.isError ? (
          <p className="text-sm text-secondary">Unable to check open reduce-only orders</p>
        ) : null}
        {hasReduceOnlyOpenOrder ? (
          <p className="text-sm text-warning">
            This symbol has reduce-only open orders. A market close does not cancel them. They may
            stay OPEN but become unfillable. Cancel them from Open orders if you want them gone.
          </p>
        ) : null}
        {stale ? (
          <p role="alert" className="text-sm text-warning">
            Position changed. Cancel and reopen Close to review the current size.
          </p>
        ) : null}
        {order.error ? <ErrorBanner error={order.error} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onDismiss} disabled={order.pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={confirmClose}
            disabled={disabled || order.pending || closeSide === null}
          >
            Confirm close
          </Button>
        </div>
      </div>
    </Surface>
  );
}

function closeOrderSide(quantity: string): OrderSide | null {
  const side = positionSideFromQuantity(quantity);

  if (side === "LONG") {
    return "SELL";
  }

  if (side === "SHORT") {
    return "BUY";
  }

  return null;
}
