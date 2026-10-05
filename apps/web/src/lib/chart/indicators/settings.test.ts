import { describe, expect, it } from "vitest";

import { DEFAULT_INDICATOR_SETTINGS, indicatorEnabledCount, parseBollingerMultiplierInput, parseMacdFast, parseMacdTripleInput, parseSmaPeriod, parseRsiPeriod, isValidMacdTriple } from "./settings.ts";

describe("indicator settings", () => {
  it("defaults every indicator off with documented parameters", () => {
    expect(DEFAULT_INDICATOR_SETTINGS).toEqual({
      sma: { enabled: false, period: 20 },
      ema: { enabled: false, period: 20 },
      rsi: { enabled: false, period: 14 },
      macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
      bollinger: { enabled: false, period: 20, multiplier: "2" },
    });
  });

  it("accepts valid period and multiplier drafts", () => {
    expect(parseSmaPeriod("20")).toBe(20);
    expect(parseSmaPeriod("1")).toBe(1);
    expect(parseRsiPeriod("2")).toBe(2);
    expect(parseBollingerMultiplierInput("2")).toBe("2");
    expect(parseBollingerMultiplierInput("0.5")).toBe("0.5");
    expect(isValidMacdTriple(12, 26, 9)).toBe(true);
  });

  it("rejects invalid drafts without coercing financial strings", () => {
    expect(parseSmaPeriod("0")).toBeNull();
    expect(parseSmaPeriod("501")).toBeNull();
    expect(parseSmaPeriod("20.5")).toBeNull();
    expect(parseSmaPeriod("1e2")).toBeNull();
    expect(parseRsiPeriod("1")).toBeNull();
    expect(parseMacdFast("0")).toBeNull();
    expect(isValidMacdTriple(26, 12, 9)).toBe(false);
    expect(parseMacdTripleInput("30", "26", "9")).toBeNull();
    expect(parseMacdTripleInput("12", "26", "9")).toEqual({ fast: 12, slow: 26, signal: 9 });
    expect(indicatorEnabledCount(DEFAULT_INDICATOR_SETTINGS)).toBe(0);
    expect(parseBollingerMultiplierInput("0")).toBeNull();
    expect(parseBollingerMultiplierInput("21")).toBeNull();
    expect(parseBollingerMultiplierInput("1e2")).toBeNull();
    expect(parseBollingerMultiplierInput("-1")).toBeNull();
  });
});
