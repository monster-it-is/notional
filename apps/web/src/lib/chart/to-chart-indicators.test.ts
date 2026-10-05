import { describe, expect, it } from "vitest";

import { toChartUtcTimestamp } from "./to-chart-candles.ts";
import {
  toChartBollingerLines,
  toChartBollingerPoint,
  toChartIndicatorLine,
  toChartMacdHistogram,
  toChartMacdPoint,
} from "./to-chart-indicators.ts";

describe("toChartIndicatorLine", () => {
  it("reuses candle UTC seconds conversion and Number for geometry only", () => {
    const openTime = 1_499_040_000_000;
    const points = toChartIndicatorLine([{ openTime, value: "124200.52" }]);
    expect(points).toEqual([{ time: toChartUtcTimestamp(openTime), value: 124200.52 }]);
    expect(typeof points[0]?.value).toBe("number");
  });

  it("skips non-finite rendered coordinates", () => {
    expect(
      toChartIndicatorLine([
        { openTime: Number.NaN, value: "1" },
        { openTime: 1_000, value: "not-a-number" },
      ]),
    ).toEqual([]);
  });
});

describe("toChartBollingerLines", () => {
  it("keeps upper/middle/lower timestamps aligned", () => {
    const lines = toChartBollingerLines([
      { openTime: 1_000_000, middle: "10", upper: "12", lower: "8" },
    ]);
    expect(lines.upper[0]?.time).toBe(lines.middle[0]?.time);
    expect(lines.lower[0]?.time).toBe(lines.middle[0]?.time);
  });
});

describe("toChartBollingerPoint", () => {
  it("maps one exact band triple through the line adapter", () => {
    const mapped = toChartBollingerPoint({
      openTime: 1_000_000,
      middle: "10",
      upper: "12",
      lower: "8",
    });
    expect(mapped?.middle).toEqual({ time: toChartUtcTimestamp(1_000_000), value: 10 });
    expect(mapped?.upper.value).toBe(12);
    expect(mapped?.lower.value).toBe(8);
  });
});

describe("toChartMacdHistogram", () => {
  it("colors bars from the exact histogram string, not Number sign", () => {
    const points = toChartMacdHistogram(
      [
        { openTime: 1_000_000, macd: "1", signal: "0.5", histogram: "0.5" },
        { openTime: 1_060_000, macd: "1", signal: "1.5", histogram: "-0.5" },
        { openTime: 1_120_000, macd: "1", signal: "1", histogram: "0" },
      ],
      { positive: "#pos", negative: "#neg" },
    );

    expect(points[0]?.color).toBe("#pos");
    expect(points[1]?.color).toBe("#neg");
    expect(points[2]?.color).toBeUndefined();
  });
});

describe("toChartMacdPoint", () => {
  it("omits missing signal and histogram instead of emitting zeros", () => {
    const mapped = toChartMacdPoint(
      { openTime: 1_000_000, macd: "1.5" },
      { positive: "#pos", negative: "#neg" },
    );
    expect(mapped?.macd.value).toBe(1.5);
    expect(mapped?.signal).toBeNull();
    expect(mapped?.histogram).toBeNull();
  });

  it("colors a single histogram bar from the exact-string sign", () => {
    const negative = toChartMacdPoint(
      { openTime: 1_000_000, macd: "1", signal: "1.5", histogram: "-0.5" },
      { positive: "#pos", negative: "#neg" },
    );
    expect(negative?.histogram?.color).toBe("#neg");
    expect(negative?.signal?.value).toBe(1.5);
  });
});
