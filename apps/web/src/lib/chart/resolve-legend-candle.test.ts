import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { resolveLegendCandle } from "./resolve-legend-candle.ts";

const first: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_040_899_999,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

const latest: Candle = {
  ...first,
  openTime: 1_499_040_900_000,
  closeTime: 1_499_041_799_999,
  close: "108.00",
};

describe("resolveLegendCandle", () => {
  it("returns null when candles are empty", () => {
    expect(
      resolveLegendCandle({
        candles: [],
        selection: null,
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBeNull();
  });

  it("returns the latest candle when selection is null", () => {
    expect(
      resolveLegendCandle({
        candles: [first, latest],
        selection: null,
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBe(latest);
  });

  it("returns the selected candle when identity, session, and openTime match", () => {
    expect(
      resolveLegendCandle({
        candles: [first, latest],
        selection: { symbol: "BTCUSDT", interval: "15m", openTime: first.openTime, session: 1 },
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBe(first);
  });

  it("ignores a stale identity and returns the current latest candle", () => {
    expect(
      resolveLegendCandle({
        candles: [first, latest],
        selection: { symbol: "ETHUSDT", interval: "15m", openTime: first.openTime, session: 1 },
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBe(latest);
    expect(
      resolveLegendCandle({
        candles: [first, latest],
        selection: { symbol: "BTCUSDT", interval: "1h", openTime: first.openTime, session: 1 },
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBe(latest);
  });

  it("ignores a prior session after returning to the same identity", () => {
    expect(
      resolveLegendCandle({
        candles: [first, latest],
        selection: { symbol: "BTCUSDT", interval: "15m", openTime: first.openTime, session: 1 },
        symbol: "BTCUSDT",
        interval: "15m",
        session: 3,
      }),
    ).toBe(latest);
  });

  it("falls back to latest when the selected candle is missing after a cap", () => {
    expect(
      resolveLegendCandle({
        candles: [latest],
        selection: { symbol: "BTCUSDT", interval: "15m", openTime: first.openTime, session: 1 },
        symbol: "BTCUSDT",
        interval: "15m",
        session: 1,
      }),
    ).toBe(latest);
  });

  it("does not convert financial candle fields", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/resolve-legend-candle.ts"), "utf8");

    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).not.toMatch(/\.toFixed\s*\(/);
  });
});
