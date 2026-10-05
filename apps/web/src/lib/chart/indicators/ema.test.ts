import { describe, expect, it } from "vitest";

import { IndicatorDecimal } from "./decimal.ts";
import { appendEma, computeEma, rebuildEma, replaceEmaLatest } from "./ema.ts";
import { indicatorCandle, indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

describe("computeEma", () => {
  it("emits nothing until the SMA seed is complete", () => {
    expect(computeEma(indicatorCandles(["1", "2"]), 3)).toEqual([]);
  });

  it("seeds with SMA of the first period closes", () => {
    const points = computeEma(indicatorCandles(["1", "2", "3"]), 3);
    expect(points).toEqual([{ openTime: 1_000_000 + 120_000, value: "2" }]);
  });

  it("applies the recurrence from EMA_(t-1) after the seed", () => {
    const points = computeEma(indicatorCandles(["1", "2", "3", "4", "5"]), 3);
    expect(points?.[0]?.value).toBe("2");
    expect(points?.[1]?.value).toBe("3");
    expect(points?.[2]?.value).toBe("4");
  });

  it("does not seed from the first close alone when period > 1", () => {
    const points = computeEma(indicatorCandles(["100", "1", "1"]), 3);
    expect(points).toEqual([{ openTime: 1_000_000 + 120_000, value: "34" }]);
  });

  it("keeps high precision without scientific notation", () => {
    const close = "9999999999999999999.123456789012345678";
    const points = computeEma(indicatorCandles([close, close, close, close]), 3);
    expect(points?.every((point) => !/e/i.test(point.value))).toBe(true);
    expect(points?.every((point) => (point.value.split(".")[1]?.length ?? 0) <= 18)).toBe(true);
  });

  it("fails closed on a malformed middle close", () => {
    const candles = indicatorCandles(["1", "2", "3", "4"]);
    candles[2] = { ...candles[2]!, close: "1e2" };
    expect(computeEma(candles, 2)).toBeNull();
  });

  it("computes 10,000 candles without duplicate timestamps", () => {
    const points = computeEma(manyIndicatorCandles(10_000), 20);
    expect(points).toHaveLength(10_000 - 19);
    expect(new Set(points?.map((point) => point.openTime)).size).toBe(points?.length);
  }, 20_000);
});

describe("ema incremental contract", () => {
  it("replaces v1/v2/v3 from the same EMA_(t-1) and matches full recompute", () => {
    const history = indicatorCandles(["10", "11", "12", "13", "14"]);
    const openTime = 1_000_000 + 300_000;
    const v1 = indicatorCandle(openTime, "15");
    const v2 = indicatorCandle(openTime, "25");
    const v3 = indicatorCandle(openTime, "5");
    const next = indicatorCandle(openTime + 60_000, "40");

    const sessionV1 = rebuildEma([...history, v1], 3);
    expect(sessionV1?.points).toEqual(computeEma([...history, v1], 3));
    expect(sessionV1?.emaThroughTMinus1).toBeTruthy();

    const sessionV2 = replaceEmaLatest(sessionV1!, v2);
    expect(sessionV2?.points).toEqual(computeEma([...history, v2], 3));
    expect(sessionV2?.emaThroughTMinus1?.eq(sessionV1!.emaThroughTMinus1!)).toBe(true);

    const sessionV3 = replaceEmaLatest(sessionV2!, v3);
    expect(sessionV3?.points).toEqual(computeEma([...history, v3], 3));
    expect(sessionV3?.emaThroughTMinus1?.eq(sessionV1!.emaThroughTMinus1!)).toBe(true);
    expect(sessionV3?.latestEma instanceof IndicatorDecimal).toBe(true);

    const appended = appendEma(sessionV3!, next);
    expect(appended?.points).toEqual(computeEma([...history, v3, next], 3));
  });

  it("rebuilds fully for prepended history", () => {
    const current = indicatorCandles(["8", "9", "10"], 2_000_000);
    const older = indicatorCandles(["1", "2", "3", "4"], 1_000_000);
    expect(rebuildEma([...older, ...current], 3)?.points).toEqual(
      computeEma([...older, ...current], 3),
    );
  });

  it("rebuilds 10,000 candles linearly matching computeEma", () => {
    const candles = manyIndicatorCandles(10_000);
    const session = rebuildEma(candles, 20);
    expect(session?.points).toEqual(computeEma(candles, 20));
    expect(session?.emaThroughTMinus1).toBeTruthy();

    const replaced = replaceEmaLatest(session!, {
      ...candles[candles.length - 1]!,
      close: "250",
    });
    expect(replaced?.points).toEqual(
      computeEma([...candles.slice(0, -1), { ...candles[candles.length - 1]!, close: "250" }], 20),
    );
    expect(replaced?.emaThroughTMinus1?.eq(session!.emaThroughTMinus1!)).toBe(true);
  }, 20_000);
});
