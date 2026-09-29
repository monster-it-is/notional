import type { CandlestickData } from "lightweight-charts";
import { describe, expect, it } from "vitest";

import { classifyChartSeriesMutation } from "./classify-series-mutation.ts";

function point(time: number, close = 1): CandlestickData {
  return { time: time as CandlestickData["time"], open: 1, high: 1, low: 1, close };
}

describe("classifyChartSeriesMutation", () => {
  it("uses update when only the last candle OHLC changes", () => {
    const previous = [point(1), point(2, 2)];
    const next = [point(1), point(2, 3)];
    expect(classifyChartSeriesMutation(previous, next)).toBe("update");
  });

  it("uses update when one new candle is appended", () => {
    const previous = [point(1)];
    const next = [point(1), point(2)];
    expect(classifyChartSeriesMutation(previous, next)).toBe("update");
  });

  it("uses setData for a 500-window rollover", () => {
    const previous = Array.from({ length: 500 }, (_, index) => point(index + 1));
    const next = [...previous.slice(1), point(501)];
    expect(classifyChartSeriesMutation(previous, next)).toBe("setData");
  });

  it("uses setData when an earlier bar changes", () => {
    const previous = [point(1, 1), point(2, 2)];
    const next = [point(1, 9), point(2, 2)];
    expect(classifyChartSeriesMutation(previous, next)).toBe("setData");
  });
});
