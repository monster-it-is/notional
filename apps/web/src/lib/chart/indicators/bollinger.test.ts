import { describe, expect, it } from "vitest";

import { IndicatorDecimal, serializeIndicatorValue } from "./decimal.ts";
import {
  appendBollinger,
  computeBollinger,
  rebuildBollinger,
  replaceBollingerLatest,
  resolvePopulationVariance,
} from "./bollinger.ts";
import { indicatorCandle, indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

describe("computeBollinger", () => {
  it("emits nothing until the period is filled", () => {
    expect(computeBollinger(indicatorCandles(["1"]), 2, "2")).toEqual([]);
  });

  it("uses population standard deviation and the multiplier string", () => {
    const points = computeBollinger(indicatorCandles(["1", "2", "3"]), 3, "2");
    const mean = new IndicatorDecimal("2");
    const variance = new IndicatorDecimal("2").div(3);
    const stdDev = variance.sqrt();
    const offset = new IndicatorDecimal("2").times(stdDev);
    expect(points).toHaveLength(1);
    expect(points?.[0]?.middle).toBe("2");
    expect(points?.[0]?.upper).toBe(serializeIndicatorValue(mean.plus(offset)));
    expect(points?.[0]?.lower).toBe(serializeIndicatorValue(mean.minus(offset)));
  });

  it("emits zero width bands for constant prices", () => {
    expect(computeBollinger(indicatorCandles(["10", "10", "10"]), 3, "2")).toEqual([
      { openTime: 1_000_000 + 120_000, middle: "10", upper: "10", lower: "10" },
    ]);
  });

  it("handles large high-precision closes", () => {
    const close = "12345678901234567890.123456789012345678";
    const points = computeBollinger(indicatorCandles([close, close, close]), 3, "2");
    expect(points?.[0]?.middle).toBe(close);
    expect(points?.[0]?.upper).toBe(close);
    expect(points?.[0]?.lower).toBe(close);
    expect(points?.[0]?.middle).not.toMatch(/e/i);
  });

  it("survives large-close tiny-spread cancellation", () => {
    const a = "100000000000000000.000000000000000001";
    const b = "100000000000000000.000000000000000002";
    const c = "100000000000000000.000000000000000003";
    const points = computeBollinger(indicatorCandles([a, b, c]), 3, "2");
    expect(points).toHaveLength(1);
    expect(points?.[0]?.upper).not.toBe(points?.[0]?.lower);
    expect(new IndicatorDecimal(points![0]!.upper).gt(points![0]!.middle)).toBe(true);
    expect(new IndicatorDecimal(points![0]!.lower).lt(points![0]!.middle)).toBe(true);
  });

  it("fails closed on a malformed middle close", () => {
    const candles = indicatorCandles(["1", "2", "3"]);
    candles[1] = { ...candles[1]!, close: "oops" };
    expect(computeBollinger(candles, 2, "2")).toBeNull();
  });

  it("fails closed on an invalid multiplier", () => {
    expect(computeBollinger(indicatorCandles(["1", "2", "3"]), 3, "0")).toBeNull();
    expect(computeBollinger(indicatorCandles(["1", "2", "3"]), 3, "21")).toBeNull();
    expect(computeBollinger(indicatorCandles(["1", "2", "3"]), 3, "1e2")).toBeNull();
  });

  it("computes 10,000 candles without duplicate timestamps", () => {
    const points = computeBollinger(manyIndicatorCandles(10_000), 20, "2");
    expect(points).toHaveLength(10_000 - 19);
    expect(new Set(points?.map((point) => point.openTime)).size).toBe(points?.length);
  }, 20_000);
});

describe("resolvePopulationVariance", () => {
  it("clamps a tiny negative within Decimal ULP scale to zero", () => {
    const scale = new IndicatorDecimal("1e40");
    const tiny = new IndicatorDecimal("-1e-90");
    expect(resolvePopulationVariance(tiny, scale)?.isZero()).toBe(true);
  });

  it("fails closed on a materially negative variance", () => {
    expect(resolvePopulationVariance(new IndicatorDecimal("-1"), new IndicatorDecimal("1"))).toBeNull();
  });
});

describe("bollinger incremental contract", () => {
  it("replaces v1/v2/v3 from t-1 window state and matches full recompute", () => {
    const history = indicatorCandles(["10", "11", "12", "13"]);
    const openTime = 1_000_000 + 240_000;
    const v1 = indicatorCandle(openTime, "14");
    const v2 = indicatorCandle(openTime, "40");
    const v3 = indicatorCandle(openTime, "8.25");
    const next = indicatorCandle(openTime + 60_000, "15");

    const sessionV1 = rebuildBollinger([...history, v1], 3, "2");
    expect(sessionV1?.points).toEqual(computeBollinger([...history, v1], 3, "2"));

    const sessionV2 = replaceBollingerLatest(sessionV1!, v2);
    expect(sessionV2?.points).toEqual(computeBollinger([...history, v2], 3, "2"));

    const sessionV3 = replaceBollingerLatest(sessionV2!, v3);
    expect(sessionV3?.points).toEqual(computeBollinger([...history, v3], 3, "2"));

    const appended = appendBollinger(sessionV3!, next);
    expect(appended?.points).toEqual(computeBollinger([...history, v3, next], 3, "2"));
  });

  it("rebuilds fully for prepended history", () => {
    const current = indicatorCandles(["8", "9", "10"], 2_000_000);
    const older = indicatorCandles(["1", "2", "3"], 1_000_000);
    expect(rebuildBollinger([...older, ...current], 3, "2")?.points).toEqual(
      computeBollinger([...older, ...current], 3, "2"),
    );
  });
});
