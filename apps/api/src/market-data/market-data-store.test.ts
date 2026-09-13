import { describe, expect, it } from "vitest";

import { createMarketDataStore } from "./market-data-store.js";
import type { BookTick, Clock, MarkTick } from "./types.js";

describe("MarketDataStore", () => {
  it("accepts the first mark and book snapshots", () => {
    const store = createMarketDataStore(clock(0));
    expect(store.applyMark(mark(10))).toBe(true);
    expect(store.applyBook(book(5, 10))).toBe(true);
    expect(store.getReadySnapshot("BTCUSDT", 1000, 1000, 0)).not.toBeNull();
  });

  it("replaces mark only when the event time is strictly newer", () => {
    const store = createMarketDataStore(clock(0));
    store.applyMark(mark(10, "1.0"), 0);
    expect(store.applyMark(mark(10, "1.1"), 5)).toBe(false);
    expect(store.getState("BTCUSDT")?.mark?.markPrice).toBe("1.0");
    expect(store.getState("BTCUSDT")?.mark?.markReceivedAt).toBe(0);

    expect(store.applyMark(mark(9, "0.9"), 6)).toBe(false);
    expect(store.applyMark(mark(11, "1.2"), 7)).toBe(true);
    expect(store.getState("BTCUSDT")?.mark?.markPrice).toBe("1.2");
    expect(store.getState("BTCUSDT")?.mark?.markReceivedAt).toBe(7);
  });

  it("orders BBO by bookUpdateId, not event timestamps", () => {
    const store = createMarketDataStore(clock(0));
    expect(store.applyBook(book(10, 100, "1"), 0)).toBe(true);
    expect(store.applyBook(book(10, 200, "2"), 1)).toBe(false);
    expect(store.applyBook(book(9, 300, "3"), 2)).toBe(false);
    expect(store.applyBook(book(11, 50, "4"), 3)).toBe(true);
    expect(store.getState("BTCUSDT")?.book?.bestBidPrice).toBe("4");
    expect(store.getState("BTCUSDT")?.book?.bookUpdateId).toBe(11);
    expect(store.getState("BTCUSDT")?.book?.bookEventTime).toBe(50);
  });

  it("does not let a late REST BBO overwrite a newer WS BBO", () => {
    const store = createMarketDataStore(clock(0));
    store.applyBook(book(50, 10, "ws"), 5);
    expect(store.applyBook(book(40, 999, "rest"), 20)).toBe(false);
    expect(store.getState("BTCUSDT")?.book?.bestBidPrice).toBe("ws");
  });

  it("keeps mark and book freshness independent", () => {
    const store = createMarketDataStore(clock(0));
    store.applyMark(mark(1), 0);
    store.applyBook(book(1, 1), 0);

    expect(store.isMarkFresh("BTCUSDT", 10, 10)).toBe(true);
    expect(store.isBookFresh("BTCUSDT", 5, 10)).toBe(false);
    expect(store.getFreshMark("BTCUSDT", 10, 10)?.markPrice).toBe("1.0");
    expect(store.getFreshBook("BTCUSDT", 5, 10)).toBeNull();
    expect(store.getReadySnapshot("BTCUSDT", 10, 5, 10)).toBeNull();

    expect(store.isMarkFresh("BTCUSDT", 5, 10)).toBe(false);
    expect(store.isBookFresh("BTCUSDT", 20, 10)).toBe(true);
    expect(store.getFreshMark("BTCUSDT", 5, 10)).toBeNull();
    expect(store.getFreshBook("BTCUSDT", 20, 10)?.bestAskPrice).toBe("2");
    expect(store.getReadySnapshot("BTCUSDT", 5, 20, 10)).toBeNull();

    expect(store.getReadySnapshot("BTCUSDT", 10, 20, 10)).not.toBeNull();
  });

  it("treats missing sides as partial/unavailable, not ready", () => {
    const store = createMarketDataStore(clock(0));
    expect(store.getReadySnapshot("BTCUSDT", 10, 10, 0)).toBeNull();
    store.applyMark(mark(1), 0);
    expect(store.getReadySnapshot("BTCUSDT", 10, 10, 0)).toBeNull();
    expect(store.isMarkFresh("BTCUSDT", 10, 0)).toBe(true);
    expect(store.isBookFresh("BTCUSDT", 10, 0)).toBe(false);
  });

  it("ages cached values stale after disconnect without wiping them", () => {
    const time = clock(0);
    const store = createMarketDataStore(time);
    store.applyMark(mark(1), 0);
    store.applyBook(book(1, 1), 0);

    time.nowMs = 50;
    expect(store.getReadySnapshot("BTCUSDT", 10, 10)).toBeNull();
    expect(store.getState("BTCUSDT")?.mark?.markPrice).toBe("1.0");

    store.applyMark(mark(2), 50);
    store.applyBook(book(2, 2), 50);
    expect(store.getReadySnapshot("BTCUSDT", 10, 10)).not.toBeNull();
  });
});

function clock(nowMs: number): Clock & { nowMs: number } {
  return {
    nowMs,
    now() {
      return this.nowMs;
    },
  };
}

function mark(eventTime: number, markPrice = "1.0"): MarkTick {
  return {
    symbol: "BTCUSDT",
    markPrice,
    indexPrice: "1.1",
    fundingRate: "0.0",
    nextFundingTime: eventTime + 8,
    markEventTime: eventTime,
  };
}

function book(updateId: number, eventTime: number, bestBidPrice = "1"): BookTick {
  return {
    symbol: "BTCUSDT",
    bestBidPrice,
    bestBidQty: "1",
    bestAskPrice: "2",
    bestAskQty: "1",
    bookUpdateId: updateId,
    bookEventTime: eventTime,
  };
}
