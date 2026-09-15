import { describe, expect, it } from "vitest";

import { FakeScheduler } from "../market-data/test-helpers.js";
import { createMarketFanout, type MarketClient } from "./market-fanout.js";

function client(id: string, bufferedAmount = 0): MarketClient & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    id,
    subscriptions: new Set(),
    sent,
    bufferedAmount: () => bufferedAmount,
    sendJson(payload) {
      sent.push(payload);
    },
  };
}

describe("market fanout", () => {
  it("coalesces accepted updates to the latest frame", () => {
    const scheduler = new FakeScheduler();
    const books = new Map<string, { bestBidPrice: string }>();
    const fanout = createMarketFanout({
      scheduler,
      coalesceMs: 100,
      latest: {
        getLatestBook(symbol) {
          const book = books.get(symbol);
          if (!book) {
            return null;
          }
          return {
            symbol,
            bestBidPrice: book.bestBidPrice,
            bestBidQty: "1",
            bestAskPrice: "101",
            bestAskQty: "1",
            bookEventTime: 1,
          };
        },
        getLatestMark() {
          return null;
        },
      },
    });
    const subscriber = client("a");
    subscriber.subscriptions.add("BTCUSDT");
    fanout.addClient(subscriber);
    books.set("BTCUSDT", { bestBidPrice: "100" });
    fanout.noteBook("BTCUSDT");
    books.set("BTCUSDT", { bestBidPrice: "102" });
    fanout.noteBook("BTCUSDT");
    expect(subscriber.sent).toEqual([]);
    scheduler.advance(100);
    expect(subscriber.sent).toEqual([
      {
        type: "market.bbo",
        symbol: "BTCUSDT",
        bestBidPrice: "102",
        bestBidQty: "1",
        bestAskPrice: "101",
        bestAskQty: "1",
        bookEventTime: 1,
      },
    ]);
  });

  it("skips a slow client without delaying a healthy client", () => {
    const scheduler = new FakeScheduler();
    const fanout = createMarketFanout({
      scheduler,
      coalesceMs: 100,
      backpressureBytes: 10,
      latest: {
        getLatestBook(symbol) {
          return {
            symbol,
            bestBidPrice: "100",
            bestBidQty: "1",
            bestAskPrice: "101",
            bestAskQty: "1",
            bookEventTime: 1,
          };
        },
        getLatestMark() {
          return null;
        },
      },
    });
    const healthy = client("healthy");
    const slow = client("slow", 50);
    healthy.subscriptions.add("BTCUSDT");
    slow.subscriptions.add("BTCUSDT");
    fanout.addClient(healthy);
    fanout.addClient(slow);
    fanout.noteBook("BTCUSDT");
    scheduler.advance(100);
    expect(healthy.sent).toHaveLength(1);
    expect(slow.sent).toHaveLength(0);
  });

  it("contains a send failure so a healthy subscriber still receives the frame", () => {
    const scheduler = new FakeScheduler();
    const fanout = createMarketFanout({
      scheduler,
      coalesceMs: 100,
      latest: {
        getLatestBook(symbol) {
          return {
            symbol,
            bestBidPrice: "100",
            bestBidQty: "1",
            bestAskPrice: "101",
            bestAskQty: "1",
            bookEventTime: 1,
          };
        },
        getLatestMark() {
          return null;
        },
      },
    });
    const healthy = client("healthy");
    const broken = client("broken");
    broken.sendJson = () => {
      throw new Error("send failed");
    };
    healthy.subscriptions.add("BTCUSDT");
    broken.subscriptions.add("BTCUSDT");
    fanout.addClient(healthy);
    fanout.addClient(broken);
    fanout.noteBook("BTCUSDT");
    scheduler.advance(100);
    expect(healthy.sent).toHaveLength(1);
    expect(broken.sent).toHaveLength(0);
  });

  it("sends a current snapshot on demand", () => {
    const scheduler = new FakeScheduler();
    const fanout = createMarketFanout({
      scheduler,
      coalesceMs: 100,
      latest: {
        getLatestBook(symbol) {
          return {
            symbol,
            bestBidPrice: "1",
            bestBidQty: "1",
            bestAskPrice: "2",
            bestAskQty: "1",
            bookEventTime: 8,
          };
        },
        getLatestMark(symbol) {
          return {
            symbol,
            markPrice: "1.5",
            indexPrice: "1.5",
            fundingRate: "0.0001",
            nextFundingTime: 9,
            markEventTime: 8,
          };
        },
      },
    });
    const subscriber = client("a");
    fanout.sendSnapshot(subscriber, "BTCUSDT");
    expect(subscriber.sent).toHaveLength(2);
    expect((subscriber.sent[0] as { type: string }).type).toBe("market.bbo");
    expect((subscriber.sent[1] as { type: string }).type).toBe("market.mark");
  });
});
