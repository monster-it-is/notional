import { isDecimalGte, isDecimalLte } from "@notional/trading";

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type TradingTone = "positive" | "negative" | "flat";

export function tradingTone(value: string): TradingTone {
  if (isNumericZero(value)) {
    return "flat";
  }

  if (value.startsWith("-")) {
    return "negative";
  }

  return "positive";
}

function isNumericZero(value: string): boolean {
  if (!DECIMAL.test(value)) {
    return false;
  }

  try {
    return isDecimalGte(value, "0") && isDecimalLte(value, "0");
  } catch {
    return false;
  }
}

export function tradingOutcome(value: string): "gain" | "loss" | "flat" {
  const tone = tradingTone(value);

  if (tone === "positive") {
    return "gain";
  }

  if (tone === "negative") {
    return "loss";
  }

  return "flat";
}

export function toneClass(tone: TradingTone): string {
  if (tone === "positive") {
    return "text-positive";
  }

  if (tone === "negative") {
    return "text-negative";
  }

  return "text-foreground";
}

/**
 * Display rounding only. Ledger values stay canonical strings from @notional/trading.
 * Fractional digits are capped for layout, with at least two places on whole amounts.
 */
export function formatTradingAmount(value: string, maxFraction = 8): string {
  if (!DECIMAL.test(value) || maxFraction < 2) {
    return value;
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const rounded = roundHalfUp(whole, fraction, maxFraction);
  const shownFraction = displayFraction(rounded.fraction);
  const body = `${groupInteger(rounded.whole)}.${shownFraction}`;
  return negative && body !== "0.00" ? `-${body}` : body;
}

export function formatSignedTradingAmount(value: string, maxFraction = 8): string {
  const formatted = formatTradingAmount(value, maxFraction);

  if (tradingTone(value) === "positive") {
    return `+${formatted}`;
  }

  return formatted;
}

export function formatSignedPercentPoints(value: string): string {
  return `${formatSignedTradingAmount(value, 2)}%`;
}

function roundHalfUp(
  whole: string,
  fraction: string,
  scale: number,
): { whole: string; fraction: string } {
  const padded = `${fraction}${"0".repeat(scale + 1)}`.slice(0, scale + 1);
  const keep = padded.slice(0, scale);
  const next = padded.slice(scale, scale + 1);

  if (next < "5") {
    return { whole, fraction: keep };
  }

  const bumped = incrementInteger(keep);

  if (bumped.length > scale) {
    return { whole: incrementInteger(whole), fraction: "0".repeat(scale) };
  }

  return { whole, fraction: bumped.padStart(scale, "0") };
}

function displayFraction(fraction: string): string {
  const trimmed = fraction.replace(/0+$/, "");

  if (trimmed.length >= 2) {
    return trimmed;
  }

  return fraction.slice(0, 2);
}

function groupInteger(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function incrementInteger(digits: string): string {
  const chars = digits.split("");
  let carry = 1;

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const code = chars[index]?.codePointAt(0);

    if (code === undefined) {
      break;
    }

    const sum = code - 48 + carry;

    if (sum >= 10) {
      chars[index] = "0";
      carry = 1;
      continue;
    }

    chars[index] = String.fromCharCode(48 + sum);
    carry = 0;
    break;
  }

  if (carry) {
    chars.unshift("1");
  }

  return chars.join("");
}
