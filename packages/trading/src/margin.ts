import {
  parseCommittedDecimal,
  parseNonNegativeValue,
  parsePlainDecimal,
  toCanonicalFromDecimal,
  TradingDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";
import { calculateNotional } from "./notional.js";
import { assertPositionInvariant, parseOptionalEntry } from "./position-state.js";

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 100;
export const DEFAULT_LEVERAGE = 1;
export const DEFAULT_MARGIN_MODE = "CROSS" as const;

export type MarginMode = "CROSS" | "ISOLATED";

export function calculateInitialMargin(params: {
  notional: string;
  leverage: string;
}): string {
  const notional = parseNonNegativeValue(params.notional, "notional");
  const leverage = parsePositiveIntegerLeverage(params.leverage);
  return toCanonicalFromDecimal(notional.div(leverage));
}

export function calculateMaintenanceMargin(params: {
  notional: string;
  maintenanceMarginRate: string;
}): string {
  const notional = parseNonNegativeValue(params.notional, "notional");
  const rate = parsePlainDecimal(params.maintenanceMarginRate);

  if (rate.lte(0) || rate.gte(1)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "maintenanceMarginRate must be greater than 0 and less than 1",
    );
  }

  return toCanonicalFromDecimal(notional.times(rate));
}

export function calculateCrossCollateral(params: {
  walletBalance: string;
  isolatedReservedMargin: string;
  crossUnrealizedPnl: string;
}): string {
  const walletBalance = parsePlainDecimal(params.walletBalance);
  const isolatedReservedMargin = parseNonNegativeValue(
    params.isolatedReservedMargin,
    "isolatedReservedMargin",
  );
  const crossUnrealizedPnl = parsePlainDecimal(params.crossUnrealizedPnl);
  return toCanonicalFromDecimal(
    walletBalance.minus(isolatedReservedMargin).plus(crossUnrealizedPnl),
  );
}

export function calculateAvailableBalance(params: {
  crossCollateral: string;
  crossInitialMargin: string;
  openOrderReservedMargin: string;
}): string {
  const crossCollateral = parsePlainDecimal(params.crossCollateral);
  const crossInitialMargin = parseNonNegativeValue(
    params.crossInitialMargin,
    "crossInitialMargin",
  );
  const openOrderReservedMargin = parseNonNegativeValue(
    params.openOrderReservedMargin,
    "openOrderReservedMargin",
  );
  return toCanonicalFromDecimal(
    crossCollateral.minus(crossInitialMargin).minus(openOrderReservedMargin),
  );
}

export function calculateIsolatedEquity(params: {
  isolatedMargin: string;
  unrealizedPnl: string;
}): string {
  const isolatedMargin = parseNonNegativeValue(params.isolatedMargin, "isolatedMargin");
  const unrealizedPnl = parsePlainDecimal(params.unrealizedPnl);
  return toCanonicalFromDecimal(isolatedMargin.plus(unrealizedPnl));
}

export function calculateRequiredIsolatedMargin(params: {
  positionQty: string;
  entryPrice: string | null;
  leverage: string;
}): string {
  parsePositiveIntegerLeverage(params.leverage);
  const positionQty = parseCommittedDecimal(params.positionQty, "positionQty");
  const entryPrice = parseOptionalEntry(params.entryPrice);
  assertPositionInvariant(positionQty, entryPrice);

  if (positionQty.isZero()) {
    return "0";
  }

  return calculateInitialMargin({
    notional: calculateNotional({
      quantity: params.positionQty,
      price: params.entryPrice!,
    }),
    leverage: params.leverage,
  });
}

function parsePositiveIntegerLeverage(leverage: string): TradingDecimal {
  if (typeof leverage !== "string" || !POSITIVE_INTEGER.test(leverage)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "leverage must be a positive integer",
    );
  }

  return new TradingDecimal(leverage);
}
