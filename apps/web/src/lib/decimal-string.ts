export const PLAIN_POSITIVE_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

export function isPlainPositiveDecimal(value: string): boolean {
  return PLAIN_POSITIVE_DECIMAL.test(value);
}

export type PositionVisualSide = "LONG" | "SHORT" | "FLAT";

export function positionSideFromQuantity(quantity: string): PositionVisualSide {
  if (quantity === "" || quantity === "0") {
    return "FLAT";
  }

  if (quantity.startsWith("-")) {
    return "SHORT";
  }

  return "LONG";
}
