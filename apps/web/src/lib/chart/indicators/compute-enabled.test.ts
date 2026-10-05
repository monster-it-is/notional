import { describe, expect, it } from "vitest";

import { computeEnabledIndicators } from "./compute-enabled.ts";
import { DEFAULT_INDICATOR_SETTINGS } from "./settings.ts";
import { indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

describe("computeEnabledIndicators", () => {
  it("computes nothing when every indicator is disabled", () => {
    const candles = [
      {
        openTime: 1,
        closeTime: 2,
        open: "1",
        high: "1",
        low: "1",
        volume: "1",
        get close(): string {
          throw new Error("disabled indicators must not read candle close");
        },
      },
    ];

    expect(computeEnabledIndicators(candles, DEFAULT_INDICATOR_SETTINGS)).toEqual({});
  });

  it("invokes only enabled overlay calculators", () => {
    const candles = indicatorCandles(["1", "2", "3", "4"]);
    const computed = computeEnabledIndicators(candles, {
      ...DEFAULT_INDICATOR_SETTINGS,
      sma: { enabled: true, period: 2 },
    });

    expect(computed.sma).toHaveLength(3);
    expect(computed.ema).toBeUndefined();
    expect(computed.rsi).toBeUndefined();
    expect(computed.macd).toBeUndefined();
    expect(computed.bollinger).toBeUndefined();
  });

  it("computes RSI and MACD only when those oscillators are enabled", () => {
    const candles = indicatorCandles(["1", "2", "3", "4", "5"]);
    const computed = computeEnabledIndicators(candles, {
      ...DEFAULT_INDICATOR_SETTINGS,
      rsi: { enabled: true, period: 2 },
      macd: { enabled: true, fast: 1, slow: 2, signal: 1 },
    });

    expect(computed.rsi?.length).toBeGreaterThan(0);
    expect(computed.macd?.length).toBeGreaterThan(0);
    expect(computed.sma).toBeUndefined();
    expect(computed.ema).toBeUndefined();
    expect(computed.bollinger).toBeUndefined();
  });

  it("computes 10,000 candles for enabled overlays only", () => {
    const candles = manyIndicatorCandles(10_000);
    const computed = computeEnabledIndicators(candles, {
      ...DEFAULT_INDICATOR_SETTINGS,
      sma: { enabled: true, period: 20 },
      ema: { enabled: true, period: 20 },
      bollinger: { enabled: true, period: 20, multiplier: "2" },
    });

    expect(computed.sma).toHaveLength(10_000 - 19);
    expect(computed.ema).toHaveLength(10_000 - 19);
    expect(computed.bollinger).toHaveLength(10_000 - 19);
    expect(computed.rsi).toBeUndefined();
    expect(computed.macd).toBeUndefined();
  }, 30_000);
});
