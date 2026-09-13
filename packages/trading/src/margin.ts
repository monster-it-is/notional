import {
  parseNonNegativeValue,
  toCanonicalFromDecimal,
  TradingDecimal,
} from "./decimal.js";
import { TradingMathError } from "./errors.js";

const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function calculateInitialMargin(params: {
  notional: string;
  leverage: string;
}): string {
  if (typeof params.leverage !== "string" || !POSITIVE_INTEGER.test(params.leverage)) {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "leverage must be a positive integer",
    );
  }

  const notional = parseNonNegativeValue(params.notional, "notional");
  const leverage = new TradingDecimal(params.leverage);
  return toCanonicalFromDecimal(notional.div(leverage));
}
