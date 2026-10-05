import { describe, expect, it } from "vitest";

import { appendMacd, computeMacd, rebuildMacd, replaceMacdLatest } from "./macd.ts";
import { computeEma } from "./ema.ts";
import { indicatorCandle, indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

const PARAMS = { fast: 2, slow: 4, signal: 2 };

describe("computeMacd", () => {
  it("emits no MACD until the slow EMA exists", () => {
    expect(computeMacd(indicatorCandles(["1", "2", "3"]), PARAMS)).toEqual([]);
  });

  it("starts the MACD line at slow - 1 and signal at slow + signal - 2", () => {
    const candles = indicatorCandles(["1", "2", "3", "4", "5", "6", "7", "8"]);
    const points = computeMacd(candles, PARAMS);
    expect(points?.[0]?.openTime).toBe(candles[3]?.openTime);
    expect(points?.[0]?.signal).toBeUndefined();
    expect(points?.[0]?.histogram).toBeUndefined();
    expect(points?.[1]?.openTime).toBe(candles[4]?.openTime);
    expect(points?.[1]?.signal).toBeDefined();
    expect(points?.[1]?.histogram).toBeDefined();
  });

  it("sets histogram to macd minus signal", () => {
    const candles = indicatorCandles(["1", "2", "3", "4", "5", "6", "7"]);
    const points = computeMacd(candles, PARAMS);
    const withSignal = points?.find((point) => point.signal !== undefined);
    expect(withSignal?.histogram).toBeDefined();
    expect(withSignal?.macd).toBeDefined();
  });

  it("aligns MACD with fast and slow EMA subtraction", () => {
    const candles = indicatorCandles(["10", "11", "12", "13", "14", "15"]);
    const fast = computeEma(candles, 2);
    const slow = computeEma(candles, 4);
    const macd = computeMacd(candles, PARAMS);
    const first = macd?.[0];
    const fastAt = fast?.find((point) => point.openTime === first?.openTime);
    const slowAt = slow?.find((point) => point.openTime === first?.openTime);
    expect(first).toBeDefined();
    expect(fastAt).toBeDefined();
    expect(slowAt).toBeDefined();
  });

  it("fails closed when fast >= slow", () => {
    expect(computeMacd(indicatorCandles(["1", "2", "3", "4"]), { fast: 4, slow: 2, signal: 2 })).toBeNull();
  });

  it("fails closed on a malformed middle close", () => {
    const candles = indicatorCandles(["1", "2", "3", "4", "5", "6"]);
    candles[3] = { ...candles[3]!, close: "bad" };
    expect(computeMacd(candles, PARAMS)).toBeNull();
  });

  it("computes 10,000 candles without duplicate timestamps", () => {
    const points = computeMacd(manyIndicatorCandles(10_000), { fast: 12, slow: 26, signal: 9 });
    expect(points?.length).toBe(10_000 - 25);
    expect(new Set(points?.map((point) => point.openTime)).size).toBe(points?.length);
    const withSignal = points?.filter((point) => point.signal !== undefined);
    expect(withSignal?.length).toBe(10_000 - 25 - 8);
  }, 20_000);
});

describe("macd incremental contract", () => {
  it("replaces v1/v2/v3 from t-1 recursive state and matches full recompute", () => {
    const history = indicatorCandles(["10", "11", "12", "13", "14", "15", "16"]);
    const openTime = 1_000_000 + 420_000;
    const v1 = indicatorCandle(openTime, "17");
    const v2 = indicatorCandle(openTime, "30");
    const v3 = indicatorCandle(openTime, "8");
    const next = indicatorCandle(openTime + 60_000, "22");

    const sessionV1 = rebuildMacd([...history, v1], PARAMS);
    expect(sessionV1?.points).toEqual(computeMacd([...history, v1], PARAMS));

    const sessionV2 = replaceMacdLatest(sessionV1!, v2);
    expect(sessionV2?.points).toEqual(computeMacd([...history, v2], PARAMS));
    expect(sessionV2?.fast.emaThroughTMinus1?.eq(sessionV1!.fast.emaThroughTMinus1!)).toBe(true);
    expect(sessionV2?.slow.emaThroughTMinus1?.eq(sessionV1!.slow.emaThroughTMinus1!)).toBe(true);

    const sessionV3 = replaceMacdLatest(sessionV2!, v3);
    expect(sessionV3?.points).toEqual(computeMacd([...history, v3], PARAMS));

    const appended = appendMacd(sessionV3!, next);
    expect(appended?.points).toEqual(computeMacd([...history, v3, next], PARAMS));
  });

  it("rebuilds fully for prepended history", () => {
    const current = indicatorCandles(["8", "9", "10", "11"], 2_000_000);
    const older = indicatorCandles(["1", "2", "3", "4", "5"], 1_000_000);
    expect(rebuildMacd([...older, ...current], PARAMS)?.points).toEqual(
      computeMacd([...older, ...current], PARAMS),
    );
  });
});
