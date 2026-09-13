import {
  TradingDecimal,
  parseCommittedDecimal,
  parseCommittedPositive,
  toCanonicalFromDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";
import { assertPositionInvariant, parseOptionalEntry } from "./position-state.js";

const ONE = new TradingDecimal("1");
const NEGATIVE_ONE = new TradingDecimal("-1");

export function calculateRealizedPnl(params: {
  closedQty: string;
  entryPrice: string;
  exitPrice: string;
  currentQty: string;
}): string {
  const closedQty = parseCommittedPositive(params.closedQty, "closedQty");
  const entryPrice = parseCommittedPositive(params.entryPrice, "entryPrice");
  const exitPrice = parseCommittedPositive(params.exitPrice, "exitPrice");
  const currentQty = parseCommittedDecimal(params.currentQty, "currentQty");

  if (currentQty.isZero()) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "currentQty must be non-zero to realize PnL",
    );
  }

  if (closedQty.gt(currentQty.abs())) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "closedQty must not exceed abs(currentQty)",
    );
  }

  return toCanonicalFromDecimal(
    realizedPnlValue(closedQty, entryPrice, exitPrice, currentQty),
  );
}

export function calculateUnrealizedPnl(params: {
  positionQty: string;
  entryPrice: string | null;
  markPrice: string;
}): string {
  const positionQty = parseCommittedDecimal(params.positionQty, "positionQty");
  const entryPrice = parseOptionalEntry(params.entryPrice);
  assertPositionInvariant(positionQty, entryPrice);

  if (positionQty.isZero()) {
    return "0";
  }

  const markPrice = parseCommittedPositive(params.markPrice, "markPrice");
  return toCanonicalFromDecimal(positionQty.times(markPrice.minus(entryPrice!)));
}

export function realizedPnlValue(
  closedQty: TradingDecimal,
  entryPrice: TradingDecimal,
  exitPrice: TradingDecimal,
  currentQty: TradingDecimal,
): TradingDecimal {
  const sign = currentQty.isPositive() ? ONE : NEGATIVE_ONE;
  return closedQty.times(exitPrice.minus(entryPrice)).times(sign);
}
