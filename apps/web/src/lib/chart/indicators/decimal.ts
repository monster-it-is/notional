import { Decimal } from "decimal.js";

/**
 * Indicator math Decimal. Precision 128 covers Bollinger sum-of-squares near
 * NUMERIC(38,18) before window accumulation/cancellation.
 *
 * Recurrence state (EMA/RSI/MACD) MUST stay on this clone. Serialized point
 * strings are a bounded display/render representation and must not feed
 * incremental state.
 */
export const IndicatorDecimal = Decimal.clone({
  precision: 128,
  rounding: Decimal.ROUND_HALF_UP,
});

export type IndicatorDecimal = InstanceType<typeof IndicatorDecimal>;

export const INDICATOR_DECIMAL_PRECISION = 128;
export const INDICATOR_OUTPUT_SCALE = 18;

export const INDICATOR_ZERO = new IndicatorDecimal(0);
export const INDICATOR_ONE = new IndicatorDecimal(1);
export const INDICATOR_TWO = new IndicatorDecimal(2);
export const INDICATOR_HUNDRED = new IndicatorDecimal(100);

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Canonical Candle.close values must be chronological plain decimal strings.
 * Invalid input fails closed at the calculator boundary — never skipped.
 */
export function parseIndicatorDecimal(value: string): IndicatorDecimal | null {
  if (!PLAIN_DECIMAL.test(value)) {
    return null;
  }

  try {
    const parsed = new IndicatorDecimal(value);

    if (!parsed.isFinite()) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Bounded indicator serialization: ROUND_HALF_UP to 18 decimal places, trim
 * trailing zeros, normalize negative zero to "0". Never scientific notation.
 */
export function serializeIndicatorValue(value: IndicatorDecimal): string | null {
  if (!value.isFinite()) {
    return null;
  }

  const rounded = value.toDecimalPlaces(INDICATOR_OUTPUT_SCALE, Decimal.ROUND_HALF_UP);

  if (rounded.isZero()) {
    return "0";
  }

  let serialized = rounded.toFixed();

  if (serialized.includes(".")) {
    serialized = serialized.replace(/0+$/, "").replace(/\.$/, "");
  }

  if (serialized === "-0") {
    return "0";
  }

  return serialized;
}

export function indicatorInteger(value: number): IndicatorDecimal {
  return new IndicatorDecimal(value);
}
