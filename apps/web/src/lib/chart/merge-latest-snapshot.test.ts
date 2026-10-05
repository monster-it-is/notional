import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle, CandleListResponse } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { TRADE_CHART_MAX_CANDLES } from "../api/candles.ts";
import { mergeLatestSnapshot } from "./merge-latest-snapshot.ts";

const base: Candle = {
  openTime: 2_000,
  closeTime: 2_899,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

const current: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [
    { ...base, openTime: 1_000, closeTime: 1_899, close: "101.00" },
    { ...base, close: "106.00" },
  ],
};

describe("mergeLatestSnapshot", () => {
  it("lets the latest snapshot win on overlapping openTime", () => {
    const snapshot: CandleListResponse = {
      ...current,
      candles: [{ ...base, close: "98.00" }],
    };

    expect(mergeLatestSnapshot(current, snapshot, TRADE_CHART_MAX_CANDLES)?.candles).toEqual([
      { ...base, openTime: 1_000, closeTime: 1_899, close: "101.00" },
      { ...base, close: "98.00" },
    ]);
    expect(current.candles[1]?.close).toBe("106.00");
  });

  it("preserves candles older than the latest snapshot", () => {
    const snapshot: CandleListResponse = {
      ...current,
      candles: [base],
    };

    expect(
      mergeLatestSnapshot(current, snapshot, TRADE_CHART_MAX_CANDLES)?.candles.map(
        (candle) => candle.openTime,
      ),
    ).toEqual([1_000, 2_000]);
  });

  it("includes newer right-side candles from the snapshot", () => {
    const snapshot: CandleListResponse = {
      ...current,
      candles: [
        { ...base, close: "98.00" },
        { ...base, openTime: 3_000, closeTime: 3_899, close: "109.00" },
      ],
    };

    expect(mergeLatestSnapshot(current, snapshot, TRADE_CHART_MAX_CANDLES)?.candles).toEqual([
      { ...base, openTime: 1_000, closeTime: 1_899, close: "101.00" },
      { ...base, close: "98.00" },
      { ...base, openTime: 3_000, closeTime: 3_899, close: "109.00" },
    ]);
  });

  it("trims oldest candles when reconnect growth exceeds the max window", () => {
    const filled: CandleListResponse = {
      ...current,
      candles: Array.from({ length: TRADE_CHART_MAX_CANDLES }, (_, index) => ({
        ...base,
        openTime: index * 1_000,
        closeTime: index * 1_000 + 899,
      })),
    };
    const snapshot: CandleListResponse = {
      ...current,
      candles: [
        {
          ...base,
          openTime: TRADE_CHART_MAX_CANDLES * 1_000,
          closeTime: TRADE_CHART_MAX_CANDLES * 1_000 + 899,
          close: "9.00",
        },
      ],
    };

    const next = mergeLatestSnapshot(filled, snapshot, TRADE_CHART_MAX_CANDLES);
    expect(next?.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(next?.candles[0]?.openTime).toBe(1_000);
    expect(next?.candles.at(-1)?.close).toBe("9.00");
    expect(typeof next?.candles.at(-1)?.close).toBe("string");
  });

  it("returns the current cache unchanged on identity mismatch", () => {
    expect(
      mergeLatestSnapshot(current, { ...current, symbol: "ETHUSDT" }, TRADE_CHART_MAX_CANDLES),
    ).toBe(current);
    expect(
      mergeLatestSnapshot(current, { ...current, interval: "1h" }, TRADE_CHART_MAX_CANDLES),
    ).toBe(current);
  });

  it("uses the snapshot when no current cache exists", () => {
    expect(mergeLatestSnapshot(undefined, current, TRADE_CHART_MAX_CANDLES)).toEqual(current);
  });

  it("does not convert OHLCV with Number or parseFloat", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/merge-latest-snapshot.ts"), "utf8");
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(/);
  });
});
