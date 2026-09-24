import { describe, expect, it } from "vitest";

import { formatSignedPercentPoints, formatSignedTradingAmount, formatTradingAmount, tradingOutcome, tradingTone } from "./format-decimal.ts";

describe("formatTradingAmount", () => {
  it("groups whole amounts and keeps two decimal places", () => {
    expect(formatTradingAmount("10000")).toBe("10,000.00");
    expect(formatTradingAmount("0")).toBe("0.00");
    expect(formatTradingAmount("50")).toBe("50.00");
  });

  it("keeps meaningful fraction digits and rounds display halves up", () => {
    expect(formatTradingAmount("-100.5")).toBe("-100.50");
    expect(formatTradingAmount("0.005")).toBe("0.005");
    expect(formatTradingAmount("0.0001")).toBe("0.0001");
    expect(formatTradingAmount("101000.505")).toBe("101,000.505");
    expect(formatTradingAmount("1.999999999")).toBe("2.00");
  });

  it("prefixes a positive signed amount and leaves losses unsigned in the digits", () => {
    expect(formatSignedTradingAmount("100")).toBe("+100.00");
    expect(formatSignedTradingAmount("-100")).toBe("-100.00");
    expect(formatSignedTradingAmount("0")).toBe("0.00");
    expect(formatSignedPercentPoints("10")).toBe("+10.00%");
    expect(formatSignedPercentPoints("-100")).toBe("-100.00%");
  });

  it("does not prefix a plus on equivalent zero strings", () => {
    expect(formatSignedTradingAmount("0")).toBe("0.00");
    expect(formatSignedTradingAmount("0.0")).toBe("0.00");
    expect(formatSignedTradingAmount("0.00")).toBe("0.00");
    expect(formatSignedTradingAmount("0.000000")).toBe("0.00");
    expect(formatSignedTradingAmount("-0")).toBe("0.00");
    expect(formatSignedTradingAmount("-0.00")).toBe("0.00");
    expect(formatSignedPercentPoints("0.00")).toBe("0.00%");
    expect(formatSignedPercentPoints("-0")).toBe("0.00%");
  });
});

describe("tradingTone", () => {
  it("treats equivalent zero strings as flat", () => {
    for (const value of ["0", "0.0", "0.00", "0.000000", "-0", "-0.00"]) {
      expect(tradingTone(value)).toBe("flat");
      expect(tradingOutcome(value)).toBe("flat");
    }
  });

  it("keeps signed non-zero amounts directional", () => {
    expect(tradingTone("0.01")).toBe("positive");
    expect(tradingOutcome("0.01")).toBe("gain");
    expect(tradingTone("-0.01")).toBe("negative");
    expect(tradingOutcome("-0.01")).toBe("loss");
  });
});
