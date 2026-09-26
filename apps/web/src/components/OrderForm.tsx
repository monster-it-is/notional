import type { CreateOrderRequest, OrderSide, OrderType } from "@notional/contracts";
import { useState } from "react";

import { isApiError } from "../lib/api/errors.ts";
import { isPlainPositiveDecimal } from "../lib/decimal-string.ts";
import { cn } from "../lib/cn.ts";
import { usePlaceOrder } from "../hooks/use-place-order.ts";
import { Button } from "./ui/Button.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { Input } from "./ui/Input.tsx";

export function OrderForm({
  symbol,
  disabled,
  baseAsset,
  quoteAsset = "USDT",
}: {
  symbol: string | null;
  disabled: boolean;
  baseAsset?: string;
  quoteAsset?: string;
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

  const locked = disabled || order.pending || !symbol;
  const quantityError = validation === "Quantity must be a positive decimal string.";
  const limitError = validation === "Limit price is required for LIMIT orders.";
  const failClosed =
    isApiError(order.error) &&
    (order.error.code === "FUNDING_DATA_UNAVAILABLE" ||
      order.error.code === "MARKET_DATA_UNAVAILABLE");

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="min-w-0" disabled={locked}>
        <legend className="mb-1 text-xs text-secondary">Side</legend>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="secondary"
            aria-pressed={side === "BUY"}
            className={cn(side === "BUY" && "border-positive bg-positive/10 text-positive")}
            onClick={() => setSide("BUY")}
          >
            BUY
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-pressed={side === "SELL"}
            className={cn(side === "SELL" && "border-negative bg-negative/10 text-negative")}
            onClick={() => setSide("SELL")}
          >
            SELL
          </Button>
        </div>
      </fieldset>

      <fieldset className="min-w-0" disabled={locked}>
        <legend className="mb-1 text-xs text-secondary">Order type</legend>
        <div className="grid grid-cols-2 gap-1.5">
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
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-secondary">Quantity</span>
        <span className="relative block">
          <Input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label="Quantity"
            aria-describedby={quantityError ? "order-quantity-error" : undefined}
            numeric
            invalid={quantityError}
            disabled={locked}
            className={baseAsset ? "pr-12" : undefined}
          />
          {baseAsset ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-numeric text-xs text-secondary">
              {baseAsset}
            </span>
          ) : null}
        </span>
      </label>
      {quantityError ? (
        <p id="order-quantity-error" role="alert" className="text-sm text-warning">
          {validation}
        </p>
      ) : null}

      {type === "LIMIT" ? (
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-secondary">Limit price</span>
          <span className="relative block">
            <Input
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              aria-label="Limit price"
              aria-describedby={limitError ? "order-limit-price-error" : undefined}
              numeric
              invalid={limitError}
              disabled={locked}
              className="pr-12"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-numeric text-xs text-secondary">
              {quoteAsset}
            </span>
          </span>
        </label>
      ) : null}
      {limitError ? (
        <p id="order-limit-price-error" role="alert" className="text-sm text-warning">
          {validation}
        </p>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(event) => setReduceOnly(event.target.checked)}
          disabled={locked}
        />
        Reduce only
      </label>

      {validation && !quantityError && !limitError ? (
        <ErrorBanner error={new Error(validation)} />
      ) : null}
      {order.error ? <ErrorBanner error={order.error} /> : null}
      {failClosed ? <p className="text-sm text-warning">The order did not succeed.</p> : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" variant="primary" disabled={locked} className="w-full">
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
