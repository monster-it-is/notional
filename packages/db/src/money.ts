import { Decimal } from "decimal.js";

export const MoneyDecimal = Decimal.clone({
  precision: 50,
});

export type MoneyDecimal = InstanceType<typeof MoneyDecimal>;

export const NUMERIC_PRECISION = 38;
export const NUMERIC_SCALE = 18;
export const NUMERIC_INTEGER_DIGITS = NUMERIC_PRECISION - NUMERIC_SCALE;

export const SIGNUP_ALLOCATION_AMOUNT = new MoneyDecimal("1000");

export function fromDbDecimal(value: string): MoneyDecimal {
  if (typeof value !== "string") {
    throw new Error("financial value must be a string");
  }

  const parsed = new MoneyDecimal(value);

  if (!parsed.isFinite()) {
    throw new Error("financial value must be finite");
  }

  return parsed;
}

export function toDbDecimal(value: MoneyDecimal): string {
  assertFitsNumeric3818(value);
  return value.toFixed(value.decimalPlaces());
}

export function assertFitsNumeric3818(value: MoneyDecimal): void {
  if (!value.isFinite()) {
    throw new Error("financial value must be finite");
  }

  if (value.decimalPlaces() > NUMERIC_SCALE) {
    throw new Error("financial value exceeds 18 decimal places");
  }

  const [integerPart = "0"] = value
    .abs()
    .toFixed(value.decimalPlaces())
    .split(".");
  const integerDigits = integerPart.replace(/^0+/, "") || "0";

  if (integerDigits.length > NUMERIC_INTEGER_DIGITS) {
    throw new Error("financial value exceeds NUMERIC(38,18) precision");
  }
}

export function signupAllocationIdempotencyKey(userId: string): string {
  return `signup-allocation:${userId}`;
}

export function faucetClaimIdempotencyKey(
  paperAccountId: string,
  claimId: string,
): string {
  return `faucet:${paperAccountId}:${claimId}`;
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

export function parseConfiguredMoney(value: string): MoneyDecimal {
  if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) {
    throw new Error("configured money must be a plain decimal string");
  }

  const parsed = new MoneyDecimal(value);

  if (!parsed.isFinite() || parsed.lte(0)) {
    throw new Error("configured money must be a positive decimal");
  }

  assertFitsNumeric3818(parsed);
  return parsed;
}
