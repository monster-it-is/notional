import { describe, expect, it } from "vitest";

import { formatExactMoneyDisplay, formatMoneySummaryDisplay } from "./format-exact-money.ts";

describe("formatExactMoneyDisplay", () => {
  it("pads whole amounts to two fraction digits and groups thousands", () => {
    expect(formatExactMoneyDisplay("1000")).toBe("1,000.00");
    expect(formatExactMoneyDisplay("0")).toBe("0.00");
    expect(formatExactMoneyDisplay("50")).toBe("50.00");
    expect(formatExactMoneyDisplay("1234567")).toBe("1,234,567.00");
  });

  it("trims redundant trailing zeros without dropping a non-zero tail", () => {
    expect(formatExactMoneyDisplay("1000.000000000000000000")).toBe("1,000.00");
    expect(formatExactMoneyDisplay("999.999856000")).toBe("999.999856");
    expect(formatExactMoneyDisplay("0.1")).toBe("0.10");
    expect(formatExactMoneyDisplay("1.10")).toBe("1.10");
    expect(formatExactMoneyDisplay("1.100")).toBe("1.10");
    expect(formatExactMoneyDisplay("0.000000000000000001")).toBe("0.000000000000000001");
  });

  it("never rounds", () => {
    expect(formatExactMoneyDisplay("1.999999999")).toBe("1.999999999");
    expect(formatExactMoneyDisplay("999.999856")).toBe("999.999856");
    expect(formatExactMoneyDisplay("1.005")).toBe("1.005");
  });

  it("returns malformed strings unchanged", () => {
    expect(formatExactMoneyDisplay("")).toBe("");
    expect(formatExactMoneyDisplay("abc")).toBe("abc");
    expect(formatExactMoneyDisplay("1e2")).toBe("1e2");
    expect(formatExactMoneyDisplay("01")).toBe("01");
    expect(formatExactMoneyDisplay("1.")).toBe("1.");
    expect(formatExactMoneyDisplay("1.2.3")).toBe("1.2.3");
  });

  it("keeps a signed non-zero amount and treats equivalent zero as 0.00", () => {
    expect(formatExactMoneyDisplay("-1000.10")).toBe("-1,000.10");
    expect(formatExactMoneyDisplay("-0.00")).toBe("0.00");
  });
});

describe("formatMoneySummaryDisplay", () => {
  it("formats a whole value to exactly two fraction digits", () => {
    expect(formatMoneySummaryDisplay("1000")).toBe("1,000.00");
  });

  it("pads a single fraction digit", () => {
    expect(formatMoneySummaryDisplay("1000.1")).toBe("1,000.10");
  });

  it("rounds many fraction digits to two places", () => {
    expect(formatMoneySummaryDisplay("1000.000000000000000000")).toBe("1,000.00");
    expect(formatMoneySummaryDisplay("1234.567891234567890123")).toBe("1,234.57");
  });

  it("rounds down when the third fraction digit is below 5", () => {
    expect(formatMoneySummaryDisplay("12.344")).toBe("12.34");
    expect(formatMoneySummaryDisplay("0.004")).toBe("0.00");
  });

  it("rounds up when the third fraction digit is 5 or above", () => {
    expect(formatMoneySummaryDisplay("12.345")).toBe("12.35");
    expect(formatMoneySummaryDisplay("0.005")).toBe("0.01");
  });

  it("carries into the next integer", () => {
    expect(formatMoneySummaryDisplay("999.999856")).toBe("1,000.00");
  });

  it("keeps the sign on a rounded negative amount", () => {
    expect(formatMoneySummaryDisplay("-12.345")).toBe("-12.35");
  });

  it("normalizes negative zero after display rounding", () => {
    expect(formatMoneySummaryDisplay("-0.004")).toBe("0.00");
  });

  it("carries a huge integer part without floating-point precision loss", () => {
    expect(formatMoneySummaryDisplay("999999999999999999.999")).toBe("1,000,000,000,000,000,000.00");
  });

  it("returns malformed strings unchanged", () => {
    expect(formatMoneySummaryDisplay("")).toBe("");
    expect(formatMoneySummaryDisplay("abc")).toBe("abc");
    expect(formatMoneySummaryDisplay("1e2")).toBe("1e2");
    expect(formatMoneySummaryDisplay("01")).toBe("01");
    expect(formatMoneySummaryDisplay("1.")).toBe("1.");
    expect(formatMoneySummaryDisplay("1.2.3")).toBe("1.2.3");
  });
});
