const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Display-only exact decimal formatting. Never rounds.
 * Trims redundant trailing zeros, then pads to at least two fraction digits.
 */
export function formatExactMoneyDisplay(value: string): string {
  if (!PLAIN_DECIMAL.test(value)) {
    return value;
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const shownFraction = trimmedFraction.length >= 2 ? trimmedFraction : trimmedFraction.padEnd(2, "0");
  const body = `${groupThousands(whole)}.${shownFraction}`;

  if (negative && body !== "0.00") {
    return `-${body}`;
  }

  return body;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
