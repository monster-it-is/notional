import type { CreateOrderRequest, OrderSide, OrderType } from "@notional/contracts";
import { useState } from "react";

import { isPlainPositiveDecimal } from "../lib/decimal-string.ts";
import { isApiError } from "../lib/api/errors.ts";
import { usePlaceOrder } from "../hooks/use-place-order.ts";
import { Button } from "./ui/Button.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { Input } from "./ui/Input.tsx";

export function OrderForm({
  symbol,
  disabled,
}: {
  symbol: string | null;
  disabled: boolean;
}) {
  const [side, setSide] = useState<OrderSide>("BUY");
  const [type, setType] = useState<OrderType>("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const order = usePlaceOrder();

  function submit(): void {
    setValidation(null);
    order.reset();

    if (!symbol) {
      setValidation("Select an instrument.");
      return;
    }

    if (!isPlainPositiveDecimal(quantity)) {
      setValidation("Quantity must be a positive decimal string.");
      return;
    }

    if (type === "LIMIT" && !isPlainPositiveDecimal(limitPrice)) {
      setValidation("Limit price is required for LIMIT orders.");
      return;
    }

    const request: CreateOrderRequest =
      type === "MARKET"
        ? { type, symbol, side, quantity, reduceOnly }
        : { type, symbol, side, quantity, limitPrice, reduceOnly };

    order.place(request);
  }

  const failClosed =
    isApiError(order.error) &&
    (order.error.code === "FUNDING_DATA_UNAVAILABLE" ||
      order.error.code === "MARKET_DATA_UNAVAILABLE");

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="flex gap-2" disabled={disabled || order.pending}>
        <legend className="mb-1 text-sm text-secondary">Side</legend>
        <Button
          type="button"
          variant={side === "BUY" ? "buy" : "secondary"}
          aria-pressed={side === "BUY"}
          onClick={() => setSide("BUY")}
        >
          BUY / LONG
        </Button>
        <Button
          type="button"
          variant={side === "SELL" ? "sell" : "secondary"}
          aria-pressed={side === "SELL"}
          onClick={() => setSide("SELL")}
        >
          SELL / SHORT
        </Button>
      </fieldset>

      <fieldset className="flex gap-2" disabled={disabled || order.pending}>
        <legend className="mb-1 text-sm text-secondary">Order type</legend>
        <Button
          type="button"
          variant={type === "MARKET" ? "primary" : "secondary"}
          aria-pressed={type === "MARKET"}
          onClick={() => setType("MARKET")}
        >
          MARKET
        </Button>
        <Button
          type="button"
          variant={type === "LIMIT" ? "primary" : "secondary"}
          aria-pressed={type === "LIMIT"}
          onClick={() => setType("LIMIT")}
        >
          LIMIT
        </Button>
      </fieldset>

      <label className="block text-sm">
        <span className="mb-1 block text-secondary">Quantity</span>
        <Input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          aria-label="Quantity"
          numeric
          disabled={disabled || order.pending}
        />
      </label>

      {type === "LIMIT" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-secondary">Limit price</span>
          <Input
            value={limitPrice}
            onChange={(event) => setLimitPrice(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-label="Limit price"
            numeric
            disabled={disabled || order.pending}
          />
        </label>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(event) => setReduceOnly(event.target.checked)}
          disabled={disabled || order.pending}
        />
        Reduce only
      </label>

      {validation ? <ErrorBanner error={new Error(validation)} /> : null}
      {order.error ? <ErrorBanner error={order.error} /> : null}
      {failClosed ? (
        <p className="text-sm text-warning">The order did not succeed.</p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={disabled || order.pending}>
          {order.pending ? "Placing…" : `Place ${type} ${side}`}
        </Button>
        {order.error ? (
          <Button type="button" onClick={() => order.retrySameIntent()} disabled={order.pending}>
            Retry same order
          </Button>
        ) : null}
      </div>
    </form>
  );
}
