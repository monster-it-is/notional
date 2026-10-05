import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Candle, CandleListResponse } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { TRADE_CHART_MAX_CANDLES } from "../api/candles.ts";
import { prependOlderCandles } from "./prepend-older-candles.ts";

const live: Candle = {
  openTime: 3_000,
  closeTime: 3_899,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "106.00",
  volume: "12.5",
};

const currentBar: Candle = {
  ...live,
  openTime: 2_000,
  closeTime: 2_899,
  close: "105.00",
};

const current: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [currentBar, live],
};

function bar(openTime: number, close = "105.00"): Candle {
  return {
    ...currentBar,
    openTime,
    closeTime: openTime + 899,
    close,
  };
}

function series(count: number, startOpenTime = 1_000): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const openTime = startOpenTime + index * 1_000;
    const isLast = index === count - 1;
    return bar(openTime, isLast ? "106.00" : "105.00");
  });
}

describe("prependOlderCandles", () => {
  it("prepends older candles in ascending openTime order", () => {
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [
        { ...currentBar, openTime: 1_000, closeTime: 1_899, close: "101.00" },
        { ...currentBar, openTime: 0, closeTime: 899, close: "100.00" },
      ],
    };

    const next = prependOlderCandles(current, older, TRADE_CHART_MAX_CANDLES);

    expect(next?.candles.map((candle) => candle.openTime)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(next?.candles.map((candle) => candle.close)).toEqual([
      "100.00",
      "101.00",
      "105.00",
      "106.00",
    ]);
  });

  it("keeps the current cache on overlapping openTime", () => {
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [{ ...currentBar, close: "99.00" }, { ...live, close: "90.00" }],
    };

    expect(prependOlderCandles(current, older, TRADE_CHART_MAX_CANDLES)?.candles).toEqual(
      current.candles,
    );
    expect(current.candles[1]?.close).toBe("106.00");
  });

  it("returns the current cache unchanged on identity mismatch", () => {
    expect(
      prependOlderCandles(
        current,
        { ...current, symbol: "ETHUSDT", candles: [] },
        TRADE_CHART_MAX_CANDLES,
      ),
    ).toBe(current);
    expect(
      prependOlderCandles(
        current,
        { ...current, interval: "1h", candles: [] },
        TRADE_CHART_MAX_CANDLES,
      ),
    ).toBe(current);
    expect(
      prependOlderCandles(undefined, { ...current, candles: [] }, TRADE_CHART_MAX_CANDLES),
    ).toBeUndefined();
  });

  it("keeps fetched history when the merge stays within max", () => {
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [bar(1_000, "101.00")],
    };

    const next = prependOlderCandles(current, older, TRADE_CHART_MAX_CANDLES);

    expect(next?.candles).toHaveLength(3);
    expect(next?.candles.map((candle) => candle.openTime)).toEqual([1_000, 2_000, 3_000]);
    expect(next?.candles[0]?.close).toBe("101.00");
  });

  it("discards only the excess oldest bars when concurrency filled the cap", () => {
    const filled: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: series(3, 3_000),
    };
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [bar(1_000, "1.00"), bar(2_000, "2.00")],
    };

    const next = prependOlderCandles(filled, older, 4);

    expect(next?.candles).toHaveLength(4);
    expect(next?.candles.map((candle) => candle.openTime)).toEqual([2_000, 3_000, 4_000, 5_000]);
    expect(next?.candles[0]?.close).toBe("2.00");
    expect(next?.candles.at(-1)?.close).toBe("106.00");
  });

  it("keeps a 9999-plus-one historical merge at exactly TRADE_CHART_MAX_CANDLES", () => {
    const filled: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: series(9_999, 1_000),
    };
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [bar(0, "1.00")],
    };

    const next = prependOlderCandles(filled, older, TRADE_CHART_MAX_CANDLES);

    expect(next?.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(next?.candles[0]?.openTime).toBe(0);
    expect(next?.candles[0]?.close).toBe("1.00");
    expect(next?.candles.at(-1)?.close).toBe("106.00");
  });

  it("caps a full cache plus one older bar without dropping the live candle", () => {
    const filled: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: series(TRADE_CHART_MAX_CANDLES, 1_000),
    };
    const older: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [bar(0, "1.00")],
    };

    const next = prependOlderCandles(filled, older, TRADE_CHART_MAX_CANDLES);

    expect(next?.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(next?.candles[0]?.openTime).toBe(1_000);
    expect(next?.candles.at(-1)?.openTime).toBe(TRADE_CHART_MAX_CANDLES * 1_000);
    expect(next?.candles.at(-1)?.close).toBe("106.00");
  });

  it("does not convert OHLCV with Number or parseFloat", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/prepend-older-candles.ts"), "utf8");
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bNumber\s*\(/);
  });
});
