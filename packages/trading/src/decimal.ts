import { Decimal } from "decimal.js";

import { TradingMathError } from "./errors.js";

export const TradingDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export type TradingDecimal = InstanceType<typeof TradingDecimal>;

export const NUMERIC_PRECISION = 38;
export const NUMERIC_SCALE = 18;
export const NUMERIC_INTEGER_DIGITS = NUMERIC_PRECISION - NUMERIC_SCALE;

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parsePlainDecimal(value: unknown): TradingDecimal {
  if (typeof value !== "string") {
    throw new TradingMathError("INVALID_DECIMAL", "decimal value must be a string");
  }

  if (!PLAIN_DECIMAL.test(value)) {
    throw new TradingMathError(
      "INVALID_DECIMAL",
      `invalid decimal string: ${JSON.stringify(value)}`,
    );
  }

  const parsed = new TradingDecimal(value);

  if (!parsed.isFinite()) {
    throw new TradingMathError("INVALID_DECIMAL", "decimal value must be finite");
  }

  return parsed;
}

export function toCanonicalFromDecimal(value: TradingDecimal): string {
  if (!value.isFinite()) {
    throw new TradingMathError("INVALID_DECIMAL", "decimal value must be finite");
  }

  if (value.isZero()) {
    return "0";
  }

  return value.toFixed(value.decimalPlaces());
}

export function toCanonicalDecimalString(value: string): string {
  return toCanonicalFromDecimal(parsePlainDecimal(value));
}

export function parseDecimalString(value: string): string {
  return toCanonicalFromDecimal(parsePlainDecimal(value));
}

export function parseNonNegativeDecimalString(value: string): string {
  return toCanonicalFromDecimal(parseNonNegativeValue(value, "value"));
}

export function parsePositiveDecimalString(value: string): string {
  return toCanonicalFromDecimal(parsePositiveValue(value, "value"));
}

export function parsePositiveValue(value: unknown, label: string): TradingDecimal {
  const parsed = parsePlainDecimal(value);

  if (parsed.lte(0)) {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be positive`);
  }

  return parsed;
}

export function parseNonNegativeValue(value: unknown, label: string): TradingDecimal {
  const parsed = parsePlainDecimal(value);

  if (parsed.isNegative()) {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be non-negative`);
  }

  return parsed;
}

export function integerDigitCount(value: TradingDecimal): number {
  const [integerPart = "0"] = value.abs().toFixed(value.decimalPlaces()).split(".");
  const integerDigits = integerPart.replace(/^0+/, "") || "0";
  return integerDigits.length;
}

export function assertFitsValue(value: TradingDecimal): void {
  if (!value.isFinite()) {
    throw new TradingMathError("INVALID_DECIMAL", "decimal value must be finite");
  }

  if (value.decimalPlaces() > NUMERIC_SCALE) {
    throw new TradingMathError("OVERFLOW", "value exceeds 18 decimal places");
  }

  if (integerDigitCount(value) > NUMERIC_INTEGER_DIGITS) {
    throw new TradingMathError("OVERFLOW", "value exceeds NUMERIC(38,18) precision");
  }
}

export function assertFitsNumeric3818(value: string): void {
  assertFitsValue(parsePlainDecimal(value));
}

export function parseCommittedDecimal(value: unknown, label: string): TradingDecimal {
  const parsed = parsePlainDecimal(value);

  try {
    assertFitsValue(parsed);
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", `${label} exceeds NUMERIC(38,18)`);
    }

    throw error;
  }

  return parsed;
}

export function parseCommittedPositive(value: unknown, label: string): TradingDecimal {
  const parsed = parseCommittedDecimal(value, label);

  if (parsed.lte(0)) {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be positive`);
  }

  return parsed;
}

export function parseCommittedNonNegative(value: unknown, label: string): TradingDecimal {
  const parsed = parseCommittedDecimal(value, label);

  if (parsed.isNegative()) {
    throw new TradingMathError("INVALID_ARGUMENT", `${label} must be non-negative`);
  }

  return parsed;
}

export function quantizeValue(value: TradingDecimal): string {
  if (!value.isFinite()) {
    throw new TradingMathError("INVALID_DECIMAL", "decimal value must be finite");
  }

  const rounded = value.toDecimalPlaces(NUMERIC_SCALE, Decimal.ROUND_HALF_EVEN);

  if (integerDigitCount(rounded) > NUMERIC_INTEGER_DIGITS) {
    throw new TradingMathError(
      "OVERFLOW",
      "quantized value exceeds NUMERIC(38,18) precision",
    );
  }

  return toCanonicalFromDecimal(rounded);
}

export function quantizeToNumeric3818(value: string): string {
  return quantizeValue(parsePlainDecimal(value));
}

export function addNumeric3818Exact(left: string, right: string): string {
  const sum = parseCommittedDecimal(left, "left").plus(parseCommittedDecimal(right, "right"));

  try {
    assertFitsValue(sum);
  } catch (error) {
    if (error instanceof TradingMathError && error.code === "OVERFLOW") {
      throw new TradingMathError("OVERFLOW", "sum exceeds NUMERIC(38,18)");
    }

    throw error;
  }

  return toCanonicalFromDecimal(sum);
}

export function quantizeCollateralRequirementToNumeric3818(value: string): string {
  const parsed = parseNonNegativeValue(value, "collateralRequirement");
  const rounded = parsed.toDecimalPlaces(NUMERIC_SCALE, Decimal.ROUND_UP);

  if (integerDigitCount(rounded) > NUMERIC_INTEGER_DIGITS) {
    throw new TradingMathError(
      "OVERFLOW",
      "collateral requirement exceeds NUMERIC(38,18) precision",
    );
  }

  return toCanonicalFromDecimal(rounded);
}

export function sumDecimalValues(values: string[]): string {
  let sum = new TradingDecimal("0");

  for (const value of values) {
    sum = sum.plus(parsePlainDecimal(value));
  }

  if (!sum.isFinite() || integerDigitCount(sum) > NUMERIC_INTEGER_DIGITS) {
    throw new TradingMathError("OVERFLOW", "sum exceeds NUMERIC(38,18) precision");
  }

  return toCanonicalFromDecimal(sum);
}

export function isDecimalGte(left: string, right: string): boolean {
  return parsePlainDecimal(left).gte(parsePlainDecimal(right));
}
