import type { Candle } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  toChartCandle,
  toChartCandles,
  toChartLinePoint,
  toChartLinePoints,
  toChartVolumePoint,
  toChartVolumePoints,
} from "./to-chart-candles.ts";

const sample: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_644_799_999,
  open: "0.01634790",
  high: "0.80000000",
  low: "0.01575800",
  close: "0.01577100",
  volume: "148976.11427815",
};

const volumeColors = { up: "#2ebd85", down: "#f0544c" };

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

  it("exposes a single-candle adapter with the same Number boundary", () => {
    expect(toChartCandle(sample)).toEqual(toChartCandles([sample])[0]);
    expect(toChartCandle({ ...sample, open: "not-a-price" })).toBeNull();
  });
});

describe("toChartLinePoints", () => {
  it("maps close strings to line values at the same UTC time", () => {
    expect(toChartLinePoints([sample])).toEqual([
      { time: 1_499_040_000, value: 0.015771 },
    ]);
    expect(typeof toChartLinePoints([sample])[0]?.value).toBe("number");
  });

  it("uses the same skip rules as candlesticks", () => {
    expect(toChartLinePoint({ ...sample, close: "not-a-price" })).toBeNull();
    expect(toChartLinePoint(sample)).toEqual(toChartLinePoints([sample])[0]);
  });

  it("does not mutate canonical candle strings", () => {
    const candles: Candle[] = [{ ...sample }];
    toChartLinePoints(candles);
    expect(typeof candles[0]?.close).toBe("string");
  });
});

describe("toChartVolumePoints", () => {
  it("maps volume strings to histogram values", () => {
    expect(toChartVolumePoints([sample])).toEqual([
      { time: 1_499_040_000, value: 148976.11427815 },
    ]);
    expect(typeof toChartVolumePoints([sample])[0]?.value).toBe("number");
  });

  it("colors down candles with the negative token and up candles with the positive token", () => {
    expect(toChartVolumePoint(sample, volumeColors)?.color).toBe(volumeColors.down);
    expect(toChartVolumePoint({ ...sample, close: "0.01000000" }, volumeColors)?.color).toBe(
      volumeColors.down,
    );
    expect(toChartVolumePoint({ ...sample, close: "0.02000000" }, volumeColors)?.color).toBe(
      volumeColors.up,
    );
  });

  it("skips non-finite volume without mutating the source", () => {
    const candles: Candle[] = [{ ...sample, volume: "not-a-volume" }, sample];
    expect(toChartVolumePoints(candles).map((row) => row.time)).toEqual([1_499_040_000]);
    expect(typeof candles[0]?.volume).toBe("string");
    expect(toChartVolumePoint({ ...sample, volume: "Infinity" })).toBeNull();
  });
});

describe("toAlignedChartPoints", () => {
  it("keeps candle, line, and volume series on the same times", () => {
    const later: Candle = { ...sample, openTime: 1_499_644_800_000, close: "0.02000000" };
    const aligned = toAlignedChartPoints([sample, later]);

    expect(aligned.candles.map((row) => row.time)).toEqual(aligned.line.map((row) => row.time));
    expect(aligned.line.map((row) => row.time)).toEqual(aligned.volume.map((row) => row.time));
    expect(aligned.line.map((row) => row.value)).toEqual(aligned.candles.map((row) => row.close));
    expect(aligned.volume.map((row) => row.value)).toEqual([148976.11427815, 148976.11427815]);
  });

  it("drops a row from every series when volume cannot be plotted", () => {
    const invalidVolume: Candle = { ...sample, volume: "nope" };
    const aligned = toAlignedChartPoints([invalidVolume, sample]);

    expect(aligned.candles).toHaveLength(1);
    expect(aligned.line).toHaveLength(1);
    expect(aligned.volume).toHaveLength(1);
    expect(aligned.candles[0]?.time).toBe(1_499_040_000);
  });

  it("applies directional colors onto aligned volume points", () => {
    const down: Candle = { ...sample, close: "0.01000000" };
    const aligned = toAlignedChartPoints([sample, down]);
    const colored = colorChartVolumePoints(aligned.volume, aligned.candles, volumeColors);

    expect(colored.map((row) => row.color)).toEqual([volumeColors.down, volumeColors.down]);
  });
});
