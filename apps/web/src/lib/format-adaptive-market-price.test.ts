import { describe, expect, it } from "vitest";

import { formatAdaptiveMarketPriceDisplay } from "./format-adaptive-market-price.ts";

describe("formatAdaptiveMarketPriceDisplay", () => {
  it("uses six significant digits with at least two fraction places for abs >= 1", () => {
    expect(formatAdaptiveMarketPriceDisplay("85676.79891304")).toBe("85676.80");
    expect(formatAdaptiveMarketPriceDisplay("1234.567891")).toBe("1234.57");
    expect(formatAdaptiveMarketPriceDisplay("123.456789")).toBe("123.457");
    expect(formatAdaptiveMarketPriceDisplay("12.3456789")).toBe("12.3457");
    expect(formatAdaptiveMarketPriceDisplay("2.17821529")).toBe("2.17822");
    expect(formatAdaptiveMarketPriceDisplay("1")).toBe("1.00000");
  });

  it("keeps five significant digits from the first non-zero fraction digit below 1", () => {
    expect(formatAdaptiveMarketPriceDisplay("0.987654321")).toBe("0.98765");
    expect(formatAdaptiveMarketPriceDisplay("0.123456789")).toBe("0.12346");
    expect(formatAdaptiveMarketPriceDisplay("0.012345678")).toBe("0.012346");
    expect(formatAdaptiveMarketPriceDisplay("0.0012345678")).toBe("0.0012346");
    expect(formatAdaptiveMarketPriceDisplay("0.000012345678")).toBe("0.000012346");
  });

  it("formats zero as two fraction digits", () => {
    expect(formatAdaptiveMarketPriceDisplay("0")).toBe("0.00");
    expect(formatAdaptiveMarketPriceDisplay("0.0")).toBe("0.00");
    expect(formatAdaptiveMarketPriceDisplay("-0")).toBe("0.00");
    expect(formatAdaptiveMarketPriceDisplay("-0.000")).toBe("0.00");
  });

  it("preserves sign on negative counterparts", () => {
    expect(formatAdaptiveMarketPriceDisplay("-85676.79891304")).toBe("-85676.80");
    expect(formatAdaptiveMarketPriceDisplay("-2.17821529")).toBe("-2.17822");
    expect(formatAdaptiveMarketPriceDisplay("-0.012345678")).toBe("-0.012346");
    expect(formatAdaptiveMarketPriceDisplay("-1")).toBe("-1.00000");
  });

  it("returns malformed input unchanged", () => {
    expect(formatAdaptiveMarketPriceDisplay("")).toBe("");
    expect(formatAdaptiveMarketPriceDisplay("abc")).toBe("abc");
    expect(formatAdaptiveMarketPriceDisplay("1e2")).toBe("1e2");
    expect(formatAdaptiveMarketPriceDisplay("01")).toBe("01");
    expect(formatAdaptiveMarketPriceDisplay("1.")).toBe("1.");
    expect(formatAdaptiveMarketPriceDisplay("1.2.3")).toBe("1.2.3");
    expect(formatAdaptiveMarketPriceDisplay("—")).toBe("—");
  });

  it("does not emit scientific notation for large or tiny canonical prices", () => {
    expect(formatAdaptiveMarketPriceDisplay("123456789012.345678")).toBe("123456789012.35");
    expect(formatAdaptiveMarketPriceDisplay("0.00000012345678")).toBe("0.00000012346");
    expect(formatAdaptiveMarketPriceDisplay("999999999999999999.999")).toBe("1000000000000000000.00");
    expect(formatAdaptiveMarketPriceDisplay("0.000000000000000001")).toBe("0.0000000000000000010000");

    for (const value of [
      "123456789012.345678",
      "0.00000012345678",
      "999999999999999999.999",
      "0.000000000000000001",
      "-0.00000012345678",
    ]) {
      expect(formatAdaptiveMarketPriceDisplay(value)).not.toMatch(/e/i);
    }
  });

  it("carries fractional rounding into 1.00000 without using Number", () => {
    expect(formatAdaptiveMarketPriceDisplay("0.999999")).toBe("1.00000");
    expect(formatAdaptiveMarketPriceDisplay("1.999999")).toBe("2.00000");
  });
});
