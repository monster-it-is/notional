import { Decimal } from "decimal.js";

const DisplayDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});

const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type CandleChange = {
  change: string;
  changePercent: string | null;
};

export function calculateCandleChange(open: string, close: string): CandleChange | null {
  if (!PLAIN_DECIMAL.test(open) || !PLAIN_DECIMAL.test(close)) {
    return null;
  }

  try {
    const openValue = new DisplayDecimal(open);
    const closeValue = new DisplayDecimal(close);

    if (!openValue.isFinite() || !closeValue.isFinite()) {
      return null;
    }

    const changeValue = closeValue.minus(openValue);

    if (!changeValue.isFinite()) {
      return null;
    }

    return {
      change: changeValue.isZero() ? "0" : changeValue.toFixed(),
      changePercent: percentDisplay(openValue, changeValue),
    };
  } catch {
    return null;
  }
}

function percentDisplay(
  openValue: InstanceType<typeof DisplayDecimal>,
  changeValue: InstanceType<typeof DisplayDecimal>,
): string | null {
  if (openValue.isZero()) {
    return null;
  }

  const percent = changeValue.div(openValue).times(100);

  if (!percent.isFinite()) {
    return null;
  }

  const rounded = percent.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return rounded.isZero() ? "0.00" : rounded.toFixed(2);
}
