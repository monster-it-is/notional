import type { MarketCandleMessage } from "@notional/contracts";
import { describe, expect, it, vi } from "vitest";

import { createCandleFanout } from "./candle-fanout.js";
import type { MarketClient } from "./market-fanout.js";

function client(id: string): MarketClient & {
  sent: unknown[];
  setBuffered(bytes: number): void;
} {
  const sent: unknown[] = [];
  let buffered = 0;
  return {
    id,
    subscriptions: new Set(),
    candleSubscriptions: new Set(),
    sent,
    setBuffered(bytes) {
      buffered = bytes;
    },
    bufferedAmount: () => buffered,
    sendJson(payload) {
      sent.push(payload);
    },
  };
}

function candle(overrides: Partial<MarketCandleMessage> = {}): MarketCandleMessage {
  return {
    type: "market.candle",
    symbol: "BTCUSDT",
    interval: "15m",
    openTime: 1,
    closeTime: 2,
    open: "1",
    high: "1",
    low: "1",
    close: "1",
    volume: "0",
    isClosed: false,
    ...overrides,
  };
}

describe("candle fanout", () => {
  it("sends immediately to the exact symbol and interval subscriber", () => {
    const fanout = createCandleFanout();
    const subscriber = client("a");
    const otherSymbol = client("b");
    const otherInterval = client("c");
    const quoteOnly = client("d");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    otherSymbol.candleSubscriptions.add("ETHUSDT|15m");
    otherInterval.candleSubscriptions.add("BTCUSDT|1h");
    quoteOnly.subscriptions.add("BTCUSDT");
    fanout.addClient(subscriber);
    fanout.addClient(otherSymbol);
    fanout.addClient(otherInterval);
    fanout.addClient(quoteOnly);
    const frame = candle({ isClosed: true });
    fanout.noteCandle(frame);

    expect(subscriber.sent).toEqual([frame]);
    expect(otherSymbol.sent).toEqual([]);
    expect(otherInterval.sent).toEqual([]);
    expect(quoteOnly.sent).toEqual([]);
  });

  it("sends ordinary current-candle updates while writable", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    const first = candle({ close: "1" });
    const second = candle({ close: "2" });
    fanout.noteCandle(first);
    fanout.noteCandle(second);
    expect(subscriber.sent).toEqual([first, second]);
  });

  it("collapses replaceable current updates while backpressured", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    fanout.noteCandle(candle({ close: "1" }));
    fanout.noteCandle(candle({ close: "2" }));
    fanout.noteCandle(candle({ close: "3" }));
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    const flushed = candle({ close: "4" });
    fanout.noteCandle(flushed);
    expect(subscriber.sent).toEqual([flushed]);
  });

  it("retains a closed candle received while backpressured", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const closed = candle({ isClosed: true, close: "9" });
    fanout.noteCandle(closed);
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    fanout.noteCandle(candle({ close: "9" }));
    expect(subscriber.sent[0]).toEqual(closed);
  });

  it("delivers a retained closed candle before a newer candle once writable", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const closed = candle({ isClosed: true, openTime: 1, closeTime: 2, close: "1" });
    const next = candle({ openTime: 3, closeTime: 4, close: "2" });
    fanout.noteCandle(closed);
    fanout.noteCandle(next);
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    fanout.noteCandle(candle({ openTime: 3, closeTime: 4, close: "3" }));
    expect(subscriber.sent).toEqual([
      closed,
      candle({ openTime: 3, closeTime: 4, close: "3" }),
    ]);
  });

  it("keeps pending state bounded to one closed and one latest current", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    fanout.noteCandle(candle({ isClosed: true, openTime: 1, closeTime: 2, close: "closed" }));
    for (let index = 0; index < 20; index += 1) {
      fanout.noteCandle(
        candle({ openTime: 3, closeTime: 4, close: String(index), volume: String(index) }),
      );
    }
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    fanout.noteCandle(candle({ openTime: 3, closeTime: 4, close: "final" }));
    expect(subscriber.sent).toHaveLength(2);
    expect(subscriber.sent[0]).toEqual(
      candle({ isClosed: true, openTime: 1, closeTime: 2, close: "closed" }),
    );
    expect(subscriber.sent[1]).toEqual(candle({ openTime: 3, closeTime: 4, close: "final" }));
  });

  it("does not retain a third pending pair beyond the subscription cap", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    subscriber.candleSubscriptions.add("ETHUSDT|15m");
    subscriber.candleSubscriptions.add("SOLUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    fanout.noteCandle(candle({ symbol: "BTCUSDT", isClosed: true, close: "btc" }));
    fanout.noteCandle(candle({ symbol: "ETHUSDT", isClosed: true, close: "eth" }));
    fanout.noteCandle(candle({ symbol: "SOLUSDT", isClosed: true, close: "sol" }));
    subscriber.setBuffered(0);
    fanout.noteCandle(candle({ symbol: "BTCUSDT", close: "btc-open" }));
    const symbols = subscriber.sent.map((row) => (row as MarketCandleMessage).symbol);
    expect(symbols).toContain("BTCUSDT");
    expect(symbols).toContain("ETHUSDT");
    expect(symbols).not.toContain("SOLUSDT");
  });

  it("keeps two finalized candles while backpressured without discarding either", () => {
    const overflow = vi.fn();
    const fanout = createCandleFanout({ backpressureBytes: 10, onOverflow: overflow });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const closed1 = candle({ isClosed: true, openTime: 1, closeTime: 2, close: "1" });
    const current2 = candle({ openTime: 3, closeTime: 4, close: "2" });
    const closed2 = candle({ isClosed: true, openTime: 3, closeTime: 4, close: "2" });
    fanout.noteCandle(closed1);
    fanout.noteCandle(current2);
    fanout.noteCandle(closed2);
    expect(overflow).not.toHaveBeenCalled();
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    fanout.noteCandle(closed2);
    expect(subscriber.sent).toEqual([closed1, closed2]);
    expect(overflow).not.toHaveBeenCalled();
  });

  it("closes on overflow instead of overwriting a retained finalized candle", () => {
    const overflow = vi.fn();
    const fanout = createCandleFanout({ backpressureBytes: 10, onOverflow: overflow });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const closed1 = candle({ isClosed: true, openTime: 1, closeTime: 2, close: "1" });
    const closed2 = candle({ isClosed: true, openTime: 3, closeTime: 4, close: "2" });
    const current3 = candle({ openTime: 5, closeTime: 6, close: "3" });
    fanout.noteCandle(closed1);
    fanout.noteCandle(candle({ openTime: 3, closeTime: 4, close: "2" }));
    fanout.noteCandle(closed2);
    fanout.noteCandle(current3);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(overflow).toHaveBeenCalledWith(subscriber);
    expect(subscriber.sent).toEqual([]);
    subscriber.setBuffered(0);
    fanout.noteCandle(closed2);
    expect(subscriber.sent).toEqual([closed1, closed2]);
    expect(subscriber.sent).not.toContainEqual(current3);
  });

  it("recovers a single closed-to-current rollover without disconnect", () => {
    const overflow = vi.fn();
    const fanout = createCandleFanout({ backpressureBytes: 10, onOverflow: overflow });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const closed = candle({ isClosed: true, openTime: 1, closeTime: 2, close: "1" });
    fanout.noteCandle(closed);
    fanout.noteCandle(candle({ openTime: 3, closeTime: 4, close: "2" }));
    fanout.noteCandle(candle({ openTime: 3, closeTime: 4, close: "2.5" }));
    expect(overflow).not.toHaveBeenCalled();
    subscriber.setBuffered(0);
    const current = candle({ openTime: 3, closeTime: 4, close: "3" });
    fanout.noteCandle(current);
    expect(subscriber.sent).toEqual([closed, current]);
    expect(overflow).not.toHaveBeenCalled();
  });

  it("drops pending state for an unsubscribed pair without flushing it later", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    subscriber.candleSubscriptions.add("ETHUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    const btc = candle({ symbol: "BTCUSDT", isClosed: true, close: "btc" });
    fanout.noteCandle(btc);
    subscriber.candleSubscriptions.delete("BTCUSDT|15m");
    fanout.removeSubscription(subscriber, "BTCUSDT", "15m");
    fanout.removeSubscription(subscriber, "BTCUSDT", "15m");
    subscriber.setBuffered(0);
    const eth = candle({ symbol: "ETHUSDT", close: "eth" });
    fanout.noteCandle(eth);
    expect(subscriber.sent).toEqual([eth]);
    expect(subscriber.sent).not.toContainEqual(btc);
  });

  it("clears pending state on removeClient and shutdown", () => {
    const fanout = createCandleFanout({ backpressureBytes: 10 });
    const subscriber = client("a");
    subscriber.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(subscriber);
    subscriber.setBuffered(100);
    fanout.noteCandle(candle({ isClosed: true, close: "lost" }));
    fanout.removeClient(subscriber);
    subscriber.setBuffered(0);
    fanout.addClient(subscriber);
    fanout.noteCandle(candle({ close: "fresh" }));
    expect(subscriber.sent).toEqual([candle({ close: "fresh" })]);

    const other = client("b");
    other.candleSubscriptions.add("BTCUSDT|15m");
    fanout.addClient(other);
    other.setBuffered(100);
    fanout.noteCandle(candle({ isClosed: true, close: "shutdown" }));
    fanout.shutdown();
    other.setBuffered(0);
    fanout.noteCandle(candle({ close: "after-stop" }));
    expect(other.sent).toEqual([]);
  });
});
