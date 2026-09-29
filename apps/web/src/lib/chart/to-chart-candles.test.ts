import type { Candle } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { toChartCandles } from "./to-chart-candles.ts";

const sample: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_644_799_999,
  open: "0.01634790",
  high: "0.80000000",
  low: "0.01575800",
  close: "0.01577100",
  volume: "148976.11427815",
};

describe("toChartCandles", () => {
  it("is a render-only boundary that converts OHLC strings for plotting", () => {
    const points = toChartCandles([sample]);

    expect(points).toEqual([
      {
        time: 1_499_040_000,
        open: 0.0163479,
        high: 0.8,
        low: 0.015758,
        close: 0.015771,
      },
    ]);
    expect(typeof points[0]?.open).toBe("number");
    expect(typeof points[0]?.time).toBe("number");
  });

  it("converts epoch-ms openTime to Lightweight Charts UTC seconds", () => {
    expect(toChartCandles([sample])[0]?.time).toBe(1_499_040_000);
  });

  it("preserves chronological order", () => {
    const later: Candle = { ...sample, openTime: 1_499_644_800_000, close: "0.02000000" };
    expect(toChartCandles([sample, later]).map((row) => row.close)).toEqual([0.015771, 0.02]);
  });

  it("does not mutate source Candle objects or the source array", () => {
    const candles: Candle[] = [{ ...sample }];
    const snapshot = structuredClone(candles);

    toChartCandles(candles);

    expect(candles).toEqual(snapshot);
    expect(typeof candles[0]?.open).toBe("string");
    expect(candles[0]?.volume).toBe("148976.11427815");
  });

  it("skips rows whose plotting conversion is non-finite", () => {
    const invalid: Candle = { ...sample, open: "not-a-price" };
    const inf: Candle = { ...sample, high: "Infinity" };
    const later: Candle = { ...sample, openTime: 1_499_644_800_000, close: "0.02000000" };

    expect(toChartCandles([invalid, sample, inf, later]).map((row) => row.time)).toEqual([
      1_499_040_000,
      1_499_644_800,
    ]);
  });

  it("returns only candlestick plotting fields", () => {
    const keys = Object.keys(toChartCandles([sample])[0] ?? {}).sort();
    expect(keys).toEqual(["close", "high", "low", "open", "time"]);
  });
});
