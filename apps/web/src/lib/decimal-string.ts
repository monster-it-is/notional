import { isDecimalGte, isDecimalLte } from "@notional/trading";

export const PLAIN_POSITIVE_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const PLAIN_SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isPlainPositiveDecimal(value: string): boolean {
  return PLAIN_POSITIVE_DECIMAL.test(value);
}

export type PositionVisualSide = "LONG" | "SHORT" | "FLAT";

export function positionSideFromQuantity(quantity: string): PositionVisualSide {
  if (!PLAIN_SIGNED_DECIMAL.test(quantity)) {
    return "FLAT";
  }

  try {
    if (isDecimalGte(quantity, "0") && isDecimalLte(quantity, "0")) {
      return "FLAT";
    }

    if (isDecimalLte(quantity, "0")) {
      return "SHORT";
    }

    return "LONG";
  } catch {
    return "FLAT";
  }
}

export type DecimalVisualSign = "positive" | "negative" | "zero";

export function decimalVisualSign(value: string): DecimalVisualSign {
  if (!PLAIN_SIGNED_DECIMAL.test(value)) {
    return "zero";
  }

  try {
    if (isDecimalGte(value, "0") && isDecimalLte(value, "0")) {
      return "zero";
    }

    if (isDecimalLte(value, "0")) {
      return "negative";
    }

    return "positive";
  } catch {
    return "zero";
  }
}
