import { describe, expect, it } from "vitest";

import { toChartUtcTimestamp } from "./to-chart-candles.ts";
import {
  toChartBollingerLines,
  toChartIndicatorLine,
  toChartMacdHistogram,
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
