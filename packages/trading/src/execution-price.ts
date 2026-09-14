import { parseCommittedPositive, toCanonicalFromDecimal } from "./decimal.js";
import { TradingMathError } from "./errors.js";
import type { OrderSide } from "./position.js";

export type MarketExecutionPriceInput = {
  side: OrderSide;
  bestBidPrice: string;
  bestAskPrice: string;
};

export type LimitMarketabilityInput = {
  side: OrderSide;
  limitPrice: string;
  bestBidPrice: string;
  bestAskPrice: string;
};

export function getMarketExecutionPrice(params: MarketExecutionPriceInput): string {
  const side = parseExecutionSide(params.side);
  const bid = parseCommittedPositive(params.bestBidPrice, "bestBidPrice");
  const ask = parseCommittedPositive(params.bestAskPrice, "bestAskPrice");

  return toCanonicalFromDecimal(side === "BUY" ? ask : bid);
}

export function isLimitMarketable(params: LimitMarketabilityInput): boolean {
  const side = parseExecutionSide(params.side);
  const limitPrice = parseCommittedPositive(params.limitPrice, "limitPrice");
  const bid = parseCommittedPositive(params.bestBidPrice, "bestBidPrice");
  const ask = parseCommittedPositive(params.bestAskPrice, "bestAskPrice");

  return side === "BUY" ? ask.lte(limitPrice) : bid.gte(limitPrice);
}

export function getLimitExecutionPrice(params: LimitMarketabilityInput): string | null {
  if (!isLimitMarketable(params)) {
    return null;
  }

  const side = parseExecutionSide(params.side);
  const bid = parseCommittedPositive(params.bestBidPrice, "bestBidPrice");
  const ask = parseCommittedPositive(params.bestAskPrice, "bestAskPrice");

  return toCanonicalFromDecimal(side === "BUY" ? ask : bid);
}

function parseExecutionSide(side: unknown): OrderSide {
  if (side === "BUY" || side === "SELL") {
    return side;
  }

  throw new TradingMathError("INVALID_ARGUMENT", "side must be BUY or SELL");
}
