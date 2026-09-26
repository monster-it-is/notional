import type { OrderSide } from "@notional/contracts";

export function orderSideClass(side: OrderSide): string | undefined {
  if (side === "BUY") {
    return "text-positive";
  }

  if (side === "SELL") {
    return "text-negative";
  }

  return undefined;
}
