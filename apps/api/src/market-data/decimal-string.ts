import { MoneyDecimal } from "@notional/db";

export function isFiniteDecimalString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  try {
    const parsed = new MoneyDecimal(value);
    return parsed.isFinite();
  } catch {
    return false;
  }
}

export function parseFiniteDecimalString(value: unknown): string | null {
  return isFiniteDecimalString(value) ? value : null;
}

export function parseNonNegativeDecimalString(value: unknown): string | null {
  const parsed = parseFiniteDecimalString(value);

  if (parsed === null) {
    return null;
  }

  return new MoneyDecimal(parsed).gte(0) ? parsed : null;
}

export function parsePositiveDecimalString(value: unknown): string | null {
  const parsed = parseFiniteDecimalString(value);

  if (parsed === null) {
    return null;
  }

  return new MoneyDecimal(parsed).gt(0) ? parsed : null;
}

export function parseSafeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }

  return value;
}
