import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { findCandleByChartTime, findCandleByOpenTime } from "./find-candle-by-chart-time.ts";
import { toChartUtcTimestamp } from "./to-chart-candles.ts";

const sample: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_040_899_999,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

function candleAt(index: number): Candle {
  return {
    ...sample,
    openTime: sample.openTime + index * 900_000,
    closeTime: sample.closeTime + index * 900_000,
    close: `${100 + index}.00`,
  };
}

describe("findCandleByChartTime", () => {
  it("resolves first, middle, and last canonical candles by UTC seconds", () => {
    const candles = [candleAt(0), candleAt(1), candleAt(2)];

    expect(findCandleByChartTime(candles, toChartUtcTimestamp(candles[0]!.openTime))).toBe(
      candles[0],
    );
    expect(findCandleByChartTime(candles, toChartUtcTimestamp(candles[1]!.openTime))).toBe(
      candles[1],
    );
    expect(findCandleByChartTime(candles, toChartUtcTimestamp(candles[2]!.openTime))).toBe(
      candles[2],
    );
    expect(typeof findCandleByChartTime(candles, 1_499_040_000)?.open).toBe("string");
    expect(findCandleByChartTime(candles, 1_499_040_000)?.open).toBe("100.00");
  });

  it("returns null for empty candles, missing time, and unknown timestamps", () => {
    const candles = [candleAt(0)];

    expect(findCandleByChartTime([], 1_499_040_000)).toBeNull();
    expect(findCandleByChartTime(candles, undefined)).toBeNull();
    expect(findCandleByChartTime(candles, null)).toBeNull();
    expect(findCandleByChartTime(candles, 1_499_041_000)).toBeNull();
  });

  it("returns null for BusinessDay objects and non-number times", () => {
    const candles = [candleAt(0)];

    expect(findCandleByChartTime(candles, { year: 2017, month: 7, day: 3 })).toBeNull();
    expect(findCandleByChartTime(candles, "1499040000")).toBeNull();
  });

  it("returns null for non-finite and unsafe integer chart times", () => {
    const candles = [candleAt(0)];

    expect(findCandleByChartTime(candles, Number.NaN)).toBeNull();
    expect(findCandleByChartTime(candles, Number.POSITIVE_INFINITY)).toBeNull();
    expect(findCandleByChartTime(candles, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(findCandleByChartTime(candles, 1.5)).toBeNull();
    expect(findCandleByChartTime(candles, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(findCandleByChartTime(candles, -1)).toBeNull();
  });

  it("finds the first, middle, and last candle in a 10,000-entry series", () => {
    const candles = Array.from({ length: 10_000 }, (_, index) => candleAt(index));
    const first = candles[0]!;
    const middle = candles[4_999]!;
    const last = candles[9_999]!;

    expect(
      candles.every((candle, index) => index === 0 || candle.openTime > candles[index - 1]!.openTime),
    ).toBe(true);
    expect(findCandleByChartTime(candles, toChartUtcTimestamp(first.openTime))).toBe(first);
    expect(findCandleByChartTime(candles, toChartUtcTimestamp(middle.openTime))).toBe(middle);
    expect(findCandleByChartTime(candles, toChartUtcTimestamp(last.openTime))).toBe(last);
    expect(findCandleByOpenTime(candles, middle.openTime)).toBe(middle);
    expect(findCandleByOpenTime(candles, last.openTime + 900_000)).toBeNull();
  });

  it("does not convert canonical OHLCV fields", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/find-candle-by-chart-time.ts"), "utf8");

    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(\s*candle\.(open|high|low|close|volume)/);
  });
});
