import {
  type TradingDecimal,
  addNumeric3818Exact,
  assertFitsNumeric3818,
  assertFitsValue,
  parseCommittedDecimal,
  parseCommittedPositive,
  quantizeToNumeric3818,
  toCanonicalFromDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";
import { realizedPnlValue } from "./pnl.js";
import { assertPositionInvariant, parseOptionalEntry } from "./position-state.js";

export type OrderSide = "BUY" | "SELL";

export type PositionSide = "LONG" | "SHORT" | "FLAT";

export type PositionTransition =
  | "OPEN"
  | "INCREASE"
  | "REDUCE"
  | "CLOSE"
  | "REVERSE";

export type ApplyFillInput = {
  currentQty: string;
  currentEntryPrice: string | null;
  fillSide: OrderSide;
  fillQty: string;
  fillPrice: string;
};

export type ApplyFillResult = {
  previousQty: string;
  nextQty: string;
  previousEntryPrice: string | null;
  nextEntryPrice: string | null;
  closedQty: string;
  openedQty: string;
  realizedPnl: string;
  transition: PositionTransition;
};

export function parseOrderSide(side: unknown): OrderSide {
  if (side === "BUY" || side === "SELL") {
    return side;
  }

  throw new TradingMathError("INVALID_ARGUMENT", "fillSide must be BUY or SELL");
}

export function signedFillValue(side: OrderSide, fillQty: TradingDecimal): TradingDecimal {
  return side === "BUY" ? fillQty : fillQty.negated();
}

export function signedFillQuantity(side: OrderSide, fillQty: string): string {
  const qty = parseCommittedPositive(fillQty, "fillQty");
  return toCanonicalFromDecimal(signedFillValue(parseOrderSide(side), qty));
}

export function positionSide(qty: string): PositionSide {
  const parsed = parseCommittedDecimal(qty, "qty");

  if (parsed.isZero()) {
    return "FLAT";
  }

  return parsed.isPositive() ? "LONG" : "SHORT";
}

function classifyTransition(
  currentQty: TradingDecimal,
  fillSide: OrderSide,
  fillQty: TradingDecimal,
): PositionTransition {
  if (currentQty.isZero()) {
    return "OPEN";
  }

  const signedFill = signedFillValue(fillSide, fillQty);

  if (currentQty.isPositive() === signedFill.isPositive()) {
    return "INCREASE";
  }

  const absCurrent = currentQty.abs();

  if (fillQty.lt(absCurrent)) {
    return "REDUCE";
  }

  if (fillQty.eq(absCurrent)) {
    return "CLOSE";
  }

  return "REVERSE";
}

export function classifyPositionTransition(params: {
  currentQty: string;
  fillSide: OrderSide;
  fillQty: string;
}): PositionTransition {
  const currentQty = parseCommittedDecimal(params.currentQty, "currentQty");
  const fillQty = parseCommittedPositive(params.fillQty, "fillQty");
  const fillSide = parseOrderSide(params.fillSide);
  return classifyTransition(currentQty, fillSide, fillQty);
}

function exactNextQty(value: TradingDecimal): string {
  const canonical = toCanonicalFromDecimal(value);
  const toCheck = value.isZero() ? value.abs() : value;

  try {
    assertFitsValue(toCheck);
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", "nextQty exceeds NUMERIC(38,18)");
    }

    throw error;
  }

  return canonical;
}

export function applyFillToPosition(input: ApplyFillInput): ApplyFillResult {
  const currentQty = parseCommittedDecimal(input.currentQty, "currentQty");
  const fillQty = parseCommittedPositive(input.fillQty, "fillQty");
  const fillPrice = parseCommittedPositive(input.fillPrice, "fillPrice");
  const fillSide = parseOrderSide(input.fillSide);
  const currentEntryPrice = parseOptionalEntry(input.currentEntryPrice);
  assertPositionInvariant(currentQty, currentEntryPrice);

  const previousQty = toCanonicalFromDecimal(currentQty);
  const previousEntryPrice =
    currentEntryPrice === null ? null : toCanonicalFromDecimal(currentEntryPrice);
  const transition = classifyTransition(currentQty, fillSide, fillQty);
  const nextQty = exactNextQty(currentQty.plus(signedFillValue(fillSide, fillQty)));

  if (transition === "OPEN") {
    return {
      previousQty,
      nextQty,
      previousEntryPrice,
      nextEntryPrice: toCanonicalFromDecimal(fillPrice),
      closedQty: "0",
      openedQty: toCanonicalFromDecimal(fillQty),
      realizedPnl: "0",
      transition,
    };
  }

  if (transition === "INCREASE") {
    const nextQtyValue = currentQty.plus(signedFillValue(fillSide, fillQty));
    const nextEntry = currentQty
      .abs()
      .times(currentEntryPrice!)
      .plus(fillQty.times(fillPrice))
      .div(nextQtyValue.abs());

    return {
      previousQty,
      nextQty,
      previousEntryPrice,
      nextEntryPrice: toCanonicalFromDecimal(nextEntry),
      closedQty: "0",
      openedQty: toCanonicalFromDecimal(fillQty),
      realizedPnl: "0",
      transition,
    };
  }

  const realized = realizedPnlValue(
    fillQty.lt(currentQty.abs()) ? fillQty : currentQty.abs(),
    currentEntryPrice!,
    fillPrice,
    currentQty,
  );

  if (transition === "REDUCE") {
    return {
      previousQty,
      nextQty,
      previousEntryPrice,
      nextEntryPrice: previousEntryPrice,
      closedQty: toCanonicalFromDecimal(fillQty),
      openedQty: "0",
      realizedPnl: toCanonicalFromDecimal(realized),
      transition,
    };
  }

  if (transition === "CLOSE") {
    return {
      previousQty,
      nextQty: "0",
      previousEntryPrice,
      nextEntryPrice: null,
      closedQty: toCanonicalFromDecimal(fillQty),
      openedQty: "0",
      realizedPnl: toCanonicalFromDecimal(realized),
      transition,
    };
  }

  return {
    previousQty,
    nextQty,
    previousEntryPrice,
    nextEntryPrice: toCanonicalFromDecimal(fillPrice),
    closedQty: toCanonicalFromDecimal(currentQty.abs()),
    openedQty: toCanonicalFromDecimal(fillQty.minus(currentQty.abs())),
    realizedPnl: toCanonicalFromDecimal(realized),
    transition,
  };
}

export type PersistedFillState = {
  quantity: string;
  entryPrice: string | null;
  realizedPnlDelta: string;
  realizedPnl: string;
  transition: PositionTransition;
  previousQty: string;
  previousEntryPrice: string | null;
};

export function toPersistedFillState(
  fill: ApplyFillResult,
  currentRealizedPnl: string,
): PersistedFillState {
  assertFitsNumeric3818(fill.nextQty);

  const entryPrice =
    fill.nextEntryPrice === null ? null : quantizeToNumeric3818(fill.nextEntryPrice);

  if (fill.nextQty === "0") {
    if (entryPrice !== null) {
      throw new TradingMathError(
        "INVARIANT_VIOLATION",
        "flat position requires entryPrice null",
      );
    }
  } else if (entryPrice === null) {
    throw new TradingMathError("INVARIANT_VIOLATION", "open position requires entryPrice");
  } else {
    const persistedEntry = parseCommittedDecimal(entryPrice, "entryPrice");
    if (persistedEntry.lte(0)) {
      throw new TradingMathError(
        "INVARIANT_VIOLATION",
        "open position requires entryPrice > 0",
      );
    }
  }

  const realizedPnlDelta = quantizeToNumeric3818(fill.realizedPnl);

  return {
    quantity: fill.nextQty,
    entryPrice,
    realizedPnlDelta,
    realizedPnl: addNumeric3818Exact(currentRealizedPnl, realizedPnlDelta),
    transition: fill.transition,
    previousQty: fill.previousQty,
    previousEntryPrice: fill.previousEntryPrice,
  };
}
