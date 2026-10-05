import { describe, expect, it } from "vitest";

import { appendRsi, computeRsi, rebuildRsi, replaceRsiLatest } from "./rsi.ts";
import { indicatorCandle, indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

describe("computeRsi", () => {
  it("emits nothing before period + 1 closes", () => {
    expect(computeRsi(indicatorCandles(["10", "11"]), 2)).toEqual([]);
  });

  it("returns 100 when every seed change is a gain", () => {
    expect(computeRsi(indicatorCandles(["10", "11", "12"]), 2)).toEqual([
      { openTime: 1_000_000 + 120_000, value: "100" },
    ]);
  });

  it("returns 0 when every seed change is a loss", () => {
    expect(computeRsi(indicatorCandles(["12", "11", "10"]), 2)).toEqual([
      { openTime: 1_000_000 + 120_000, value: "0" },
    ]);
  });

  it("returns 50 when price is flat", () => {
    expect(computeRsi(indicatorCandles(["10", "10", "10"]), 2)).toEqual([
      { openTime: 1_000_000 + 120_000, value: "50" },
    ]);
  });

  it("applies Wilder smoothing after the seed", () => {
    const points = computeRsi(indicatorCandles(["10", "11", "12", "11"]), 2);
    expect(points?.[0]?.value).toBe("100");
    expect(points?.[1]?.value).toBe("50");
  });

  it("fails closed on a malformed middle close", () => {
    const candles = indicatorCandles(["10", "11", "12", "13"]);
    candles[1] = { ...candles[1]!, close: "NaN" };
    expect(computeRsi(candles, 2)).toBeNull();
  });

  it("rejects period 1", () => {
    expect(computeRsi(indicatorCandles(["10", "11", "12"]), 1)).toBeNull();
  });

  it("computes 10,000 candles without duplicate timestamps", () => {
    const points = computeRsi(manyIndicatorCandles(10_000), 14);
    expect(points).toHaveLength(10_000 - 14);
    expect(new Set(points?.map((point) => point.openTime)).size).toBe(points?.length);
  }, 20_000);
});

describe("rsi incremental contract", () => {
  it("replaces v1/v2/v3 from t-1 averages and matches full recompute", () => {
    const history = indicatorCandles(["10", "11", "12", "13", "14"]);
    const openTime = 1_000_000 + 300_000;
    const v1 = indicatorCandle(openTime, "15");
    const v2 = indicatorCandle(openTime, "8");
    const v3 = indicatorCandle(openTime, "20");
    const next = indicatorCandle(openTime + 60_000, "19");

    const sessionV1 = rebuildRsi([...history, v1], 2);
    expect(sessionV1?.points).toEqual(computeRsi([...history, v1], 2));

    const sessionV2 = replaceRsiLatest(sessionV1!, v2);
    expect(sessionV2?.points).toEqual(computeRsi([...history, v2], 2));
    expect(sessionV2?.avgGainThroughTMinus1?.eq(sessionV1!.avgGainThroughTMinus1!)).toBe(true);
    expect(sessionV2?.avgLossThroughTMinus1?.eq(sessionV1!.avgLossThroughTMinus1!)).toBe(true);

    const sessionV3 = replaceRsiLatest(sessionV2!, v3);
    expect(sessionV3?.points).toEqual(computeRsi([...history, v3], 2));

    const appended = appendRsi(sessionV3!, next);
    expect(appended?.points).toEqual(computeRsi([...history, v3, next], 2));
  });

  it("rebuilds fully for prepended history", () => {
    const current = indicatorCandles(["8", "9", "10"], 2_000_000);
    const older = indicatorCandles(["1", "2", "3"], 1_000_000);
    expect(rebuildRsi([...older, ...current], 2)?.points).toEqual(
      computeRsi([...older, ...current], 2),
    );
  });

  it("rebuilds 10,000 candles linearly matching computeRsi", () => {
    const candles = manyIndicatorCandles(10_000);
    const session = rebuildRsi(candles, 14);
    expect(session?.points).toEqual(computeRsi(candles, 14));
    expect(session?.avgGainThroughTMinus1).toBeTruthy();

    const replaced = replaceRsiLatest(session!, {
      ...candles[candles.length - 1]!,
      close: "250",
    });
    expect(replaced?.points).toEqual(
      computeRsi([...candles.slice(0, -1), { ...candles[candles.length - 1]!, close: "250" }], 14),
    );
    expect(replaced?.avgGainThroughTMinus1?.eq(session!.avgGainThroughTMinus1!)).toBe(true);
    expect(replaced?.avgLossThroughTMinus1?.eq(session!.avgLossThroughTMinus1!)).toBe(true);
  }, 20_000);
});
