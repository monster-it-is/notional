import type { Candle, CandleListResponse } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { mergeLiveCandle } from "./merge-live-candle.ts";

const base: Candle = {
  openTime: 1_000,
  closeTime: 1_899,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

const history: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [base],
};

describe("mergeLiveCandle", () => {
  it("replaces the current candle with the same openTime", () => {
    const next = mergeLiveCandle(
      history,
      { ...base, symbol: "BTCUSDT", interval: "15m", close: "106.00" },
      500,
    );
    expect(next?.candles).toEqual([{ ...base, close: "106.00" }]);
    expect(history.candles[0]?.close).toBe("105.00");
  });

  it("replaces a closed current candle instead of duplicating it", () => {
    const next = mergeLiveCandle(
      history,
      { ...base, symbol: "BTCUSDT", interval: "15m", close: "107.00", volume: "13.0" },
      500,
    );
    expect(next?.candles).toHaveLength(1);
    expect(next?.candles[0]).toEqual({ ...base, close: "107.00", volume: "13.0" });
  });

  it("appends a newer openTime", () => {
    const incoming = {
      ...base,
      symbol: "BTCUSDT" as const,
      interval: "15m" as const,
      openTime: 2_000,
      closeTime: 2_899,
      close: "108.00",
    };
    const next = mergeLiveCandle(history, incoming, 500);
    expect(next?.candles).toEqual([base, { ...base, openTime: 2_000, closeTime: 2_899, close: "108.00" }]);
    expect(history.candles).toHaveLength(1);
  });

  it("ignores a stale older openTime", () => {
    expect(
      mergeLiveCandle(
        history,
        { ...base, symbol: "BTCUSDT", interval: "15m", openTime: 500, closeTime: 900 },
        500,
      ),
    ).toBeUndefined();
  });

  it("ignores events when no historical cache exists", () => {
    expect(
      mergeLiveCandle(undefined, { ...base, symbol: "BTCUSDT", interval: "15m" }, 500),
    ).toBeUndefined();
  });

  it("ignores a mismatched symbol or interval", () => {
    expect(
      mergeLiveCandle(history, { ...base, symbol: "ETHUSDT", interval: "15m" }, 500),
    ).toBeUndefined();
    expect(
      mergeLiveCandle(history, { ...base, symbol: "BTCUSDT", interval: "1h" }, 500),
    ).toBeUndefined();
  });

  it("keeps at most the historical window", () => {
    const filled: CandleListResponse = {
      ...history,
      candles: Array.from({ length: 500 }, (_, index) => ({
        ...base,
        openTime: index * 1_000,
        closeTime: index * 1_000 + 899,
      })),
    };
    const next = mergeLiveCandle(
      filled,
      {
        ...base,
        symbol: "BTCUSDT",
        interval: "15m",
        openTime: 500_000,
        closeTime: 500_899,
        close: "9.00",
      },
      500,
    );
    expect(next?.candles).toHaveLength(500);
    expect(next?.candles[0]?.openTime).toBe(1_000);
    expect(next?.candles.at(-1)?.close).toBe("9.00");
    expect(typeof next?.candles.at(-1)?.close).toBe("string");
    expect(filled.candles).toHaveLength(500);
    expect(filled.candles[0]?.openTime).toBe(0);
  });

  it("appends into an empty cached series", () => {
    const empty: CandleListResponse = { ...history, candles: [] };
    expect(
      mergeLiveCandle(empty, { ...base, symbol: "BTCUSDT", interval: "15m" }, 500)?.candles,
    ).toEqual([base]);
  });
});
