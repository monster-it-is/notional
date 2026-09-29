import { describe, expect, it } from "vitest";

import { parseLiveKline } from "./parse-live-kline.js";

const OPEN_TIME = 1_499_040_000_000;
const CLOSE_TIME = 1_499_040_899_999;

function klineEvent(overrides: Record<string, unknown> = {}) {
  return {
    e: "kline",
    E: OPEN_TIME,
    s: "BTCUSDT",
    k: {
      t: OPEN_TIME,
      T: CLOSE_TIME,
      s: "BTCUSDT",
      i: "15m",
      o: "100.00",
      h: "110.00",
      l: "90.00",
      c: "105.00",
      v: "12.5",
      x: false,
      ...overrides,
    },
  };
}

describe("parseLiveKline", () => {
  it("parses a Binance USD-M kline event and preserves decimal strings", () => {
    expect(parseLiveKline(klineEvent())).toEqual({
      symbol: "BTCUSDT",
      interval: "15m",
      openTime: OPEN_TIME,
      closeTime: CLOSE_TIME,
      open: "100.00",
      high: "110.00",
      low: "90.00",
      close: "105.00",
      volume: "12.5",
      isClosed: false,
    });
  });

  it("canonicalizes a lowercase symbol", () => {
    expect(parseLiveKline(klineEvent({ s: "btcusdt" }))?.symbol).toBe("BTCUSDT");
  });

  it("unwraps a combined stream payload", () => {
    expect(parseLiveKline({ stream: "btcusdt@kline_15m", data: klineEvent() })?.symbol).toBe(
      "BTCUSDT",
    );
  });

  it("accepts zero volume and a closed candle", () => {
    expect(parseLiveKline(klineEvent({ v: "0", x: true }))).toMatchObject({
      volume: "0",
      isClosed: true,
    });
  });

  it("rejects non-kline events", () => {
    expect(parseLiveKline({ ...klineEvent(), e: "bookTicker" })).toBeNull();
    expect(parseLiveKline({ result: null, id: 1 })).toBeNull();
    expect(parseLiveKline("{")).toBeNull();
  });

  it("rejects invalid interval, times, and decimals", () => {
    expect(parseLiveKline(klineEvent({ i: "3m" }))).toBeNull();
    expect(parseLiveKline(klineEvent({ t: 1.5 }))).toBeNull();
    expect(parseLiveKline(klineEvent({ T: OPEN_TIME - 1 }))).toBeNull();
    expect(parseLiveKline(klineEvent({ o: "0" }))).toBeNull();
    expect(parseLiveKline(klineEvent({ v: "-1" }))).toBeNull();
    expect(parseLiveKline(klineEvent({ x: "true" }))).toBeNull();
    expect(parseLiveKline(klineEvent({ s: "btc-usdt" }))).toBeNull();
  });
});
