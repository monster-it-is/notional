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

/**
 * Display-only compact money formatting. Rounds to exactly two fractional digits
 * with decimal half-up. Does not use floating-point arithmetic.
 */
export function formatMoneySummaryDisplay(value: string): string {
  if (!PLAIN_DECIMAL.test(value)) {
    return value;
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const rounded = roundHalfUpToCents(whole, fraction);
  const body = `${groupThousands(rounded.whole)}.${rounded.fraction}`;

  if (negative && body !== "0.00") {
    return `-${body}`;
  }

  return body;
}

function roundHalfUpToCents(whole: string, fraction: string): { whole: string; fraction: string } {
  const cents = `${fraction[0] ?? "0"}${fraction[1] ?? "0"}`;
  const third = fraction[2];

  if (third === undefined || third < "5") {
    return { whole, fraction: cents };
  }

  const bumped = incrementDigitString(`${whole}${cents}`);
  const width = whole.length + 2;
  const padded = bumped.length < width ? bumped.padStart(width, "0") : bumped;

  return {
    whole: padded.slice(0, -2) || "0",
    fraction: padded.slice(-2),
  };
}

function incrementDigitString(digits: string): string {
  const chars = digits.split("");

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    if (char === undefined) {
      continue;
    }

    if (char === "9") {
      chars[index] = "0";
      continue;
    }

    chars[index] = String.fromCharCode(char.charCodeAt(0) + 1);
    return chars.join("");
  }

  return `1${chars.join("")}`;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
