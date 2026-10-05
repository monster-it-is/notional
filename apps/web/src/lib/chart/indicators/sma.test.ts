import { describe, expect, it } from "vitest";

import { appendSma, computeSma, rebuildSma, replaceSmaLatest } from "./sma.ts";
import { indicatorCandle, indicatorCandles, manyIndicatorCandles } from "./test-candles.ts";

describe("computeSma", () => {
  it("emits nothing until the period is filled", () => {
    expect(computeSma(indicatorCandles(["1", "2"]), 3)).toEqual([]);
  });

  it("emits the exact first value at index period - 1", () => {
    expect(computeSma(indicatorCandles(["1", "2", "3", "4"]), 3)).toEqual([
      { openTime: 1_000_000 + 120_000, value: "2" },
      { openTime: 1_000_000 + 180_000, value: "3" },
    ]);
  });

  it("allows period 1 as the close itself", () => {
    expect(computeSma(indicatorCandles(["1.5", "2.5"]), 1)).toEqual([
      { openTime: 1_000_000, value: "1.5" },
      { openTime: 1_000_000 + 60_000, value: "2.5" },
    ]);
  });

  it("uses a rolling Decimal sum", () => {
    const points = computeSma(indicatorCandles(["10", "20", "30", "40"]), 2);
    expect(points).toEqual([
      { openTime: 1_000_000 + 60_000, value: "15" },
      { openTime: 1_000_000 + 120_000, value: "25" },
      { openTime: 1_000_000 + 180_000, value: "35" },
    ]);
  });

  it("serializes high-precision closes without scientific notation", () => {
    const close = "12345678901234567890.123456789012345678";
    const points = computeSma(indicatorCandles([close, close, close]), 3);
    expect(points).toHaveLength(1);
    expect(points?.[0]?.value).toBe(close);
    expect(points?.[0]?.value).not.toMatch(/e/i);
    expect(points?.[0]?.value.split(".")[1]?.length).toBeLessThanOrEqual(18);
  });

  it("normalizes a zero mean to 0", () => {
    expect(computeSma(indicatorCandles(["1", "-1"]), 2)).toEqual([
      { openTime: 1_000_000 + 60_000, value: "0" },
    ]);
  });

  it("fails closed on a malformed close in the middle", () => {
    const candles = indicatorCandles(["1", "2", "3"]);
    candles[1] = { ...candles[1]!, close: "not-a-price" };
    expect(computeSma(candles, 2)).toBeNull();
  });

  it("does not skip a malformed middle candle", () => {
    const valid = computeSma(indicatorCandles(["1", "3"]), 2);
    const malformed = indicatorCandles(["1", "2", "3"]);
    malformed[1] = { ...malformed[1]!, close: "??" };
    expect(computeSma(malformed, 2)).toBeNull();
    expect(valid).not.toBeNull();
    expect(valid).toHaveLength(1);
  });

  it("computes 10,000 candles without duplicate timestamps", () => {
    const points = computeSma(manyIndicatorCandles(10_000), 20);
    expect(points).toHaveLength(10_000 - 19);
    const times = new Set(points?.map((point) => point.openTime));
    expect(times.size).toBe(points?.length);
  }, 20_000);

  it("rejects an invalid period", () => {
    expect(computeSma(indicatorCandles(["1"]), 0)).toBeNull();
    expect(computeSma(indicatorCandles(["1"]), 501)).toBeNull();
  });
});

describe("sma incremental contract", () => {
  it("matches full recompute across v1/v2/v3 replacement and append", () => {
    const history = indicatorCandles(["10", "11", "12", "13"]);
    const openTime = 1_000_000 + 240_000;
    const v1 = indicatorCandle(openTime, "14");
    const v2 = indicatorCandle(openTime, "18");
    const v3 = indicatorCandle(openTime, "9.5");
    const next = indicatorCandle(openTime + 60_000, "20");

    const sessionV1 = rebuildSma([...history, v1], 3);
    expect(sessionV1?.points).toEqual(computeSma([...history, v1], 3));

    const sessionV2 = replaceSmaLatest(sessionV1!, v2);
    expect(sessionV2?.points).toEqual(computeSma([...history, v2], 3));

    const sessionV3 = replaceSmaLatest(sessionV2!, v3);
    expect(sessionV3?.points).toEqual(computeSma([...history, v3], 3));

    const appended = appendSma(sessionV3!, next);
    expect(appended?.points).toEqual(computeSma([...history, v3, next], 3));
  });

  it("rebuilds fully for prepended history", () => {
    const current = indicatorCandles(["4", "5", "6", "7"], 2_000_000);
    const older = indicatorCandles(["1", "2", "3"], 1_000_000);
    expect(rebuildSma([...older, ...current], 3)?.points).toEqual(
      computeSma([...older, ...current], 3),
    );
  });

  it("rebuilds 10,000 candles linearly matching computeSma", () => {
    const candles = manyIndicatorCandles(10_000);
    const session = rebuildSma(candles, 20);
    expect(session?.points).toEqual(computeSma(candles, 20));
    expect(session?.latestPoint?.openTime).toBe(candles[candles.length - 1]?.openTime);

    const replaced = replaceSmaLatest(session!, {
      ...candles[candles.length - 1]!,
      close: "250",
    });
    expect(replaced?.points).toEqual(
      computeSma([...candles.slice(0, -1), { ...candles[candles.length - 1]!, close: "250" }], 20),
    );
  }, 20_000);
});
