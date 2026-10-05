const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Render-only adaptive market-price formatting.
 *
 * Canonical decimal strings stay unchanged internally. Never feed this output
 * into orders, quantity/price inputs, PnL, margin, liquidation, risk, or API
 * payloads. Uses exact string rounding — no Number/parseFloat/parseInt.
 */
export function formatAdaptiveMarketPriceDisplay(value: string): string {
  if (!PLAIN_DECIMAL.test(value)) {
    return value;
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (isZeroMagnitude(whole, fraction)) {
    return "0.00";
  }

  const rounded =
    whole === "0"
      ? roundFractionalMagnitude(fraction)
      : roundAtLeastOne(whole, fraction);
  const body = `${rounded.whole}.${rounded.fraction}`;

  if (negative && body !== "0.00") {
    return `-${body}`;
  }

  return body;
}

function isZeroMagnitude(whole: string, fraction: string): boolean {
  if (whole !== "0") {
    return false;
  }

  return fraction === "" || /^0+$/.test(fraction);
}

function roundAtLeastOne(whole: string, fraction: string): { whole: string; fraction: string } {
  const decimalPlaces = Math.max(2, 6 - whole.length);
  return roundHalfUp(whole, fraction, decimalPlaces);
}

function roundFractionalMagnitude(fraction: string): { whole: string; fraction: string } {
  let firstNonZero = -1;

  for (let index = 0; index < fraction.length; index += 1) {
    if (fraction[index] !== "0") {
      firstNonZero = index;
      break;
    }
  }

  if (firstNonZero < 0) {
    return { whole: "0", fraction: "00" };
  }

  return roundHalfUp("0", fraction, firstNonZero + 5);
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

  const bumped = incrementDigitString(keep);

  if (bumped.length > scale) {
    return { whole: incrementDigitString(whole), fraction: "0".repeat(scale) };
  }

  return { whole, fraction: bumped.padStart(scale, "0") };
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
