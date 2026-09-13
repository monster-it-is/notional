import type { TradingDecimal } from "./decimal.js";
import { parseCommittedDecimal } from "./decimal.js";
import { TradingMathError } from "./errors.js";

export function parseOptionalEntry(entry: string | null): TradingDecimal | null {
  if (entry === null) {
    return null;
  }

  if (typeof entry !== "string") {
    throw new TradingMathError(
      "INVALID_ARGUMENT",
      "entryPrice must be a decimal string or null",
    );
  }

  return parseCommittedDecimal(entry, "entryPrice");
}

export function assertPositionInvariant(
  qty: TradingDecimal,
  entry: TradingDecimal | null,
): void {
  if (qty.isZero()) {
    if (entry !== null) {
      throw new TradingMathError(
        "INVARIANT_VIOLATION",
        "flat position requires entryPrice null",
      );
    }

    return;
  }

  if (entry === null) {
    throw new TradingMathError(
      "INVARIANT_VIOLATION",
      "open position requires entryPrice",
    );
  }

  if (entry.lte(0)) {
    throw new TradingMathError(
      "INVARIANT_VIOLATION",
      "open position requires entryPrice > 0",
    );
  }
}
