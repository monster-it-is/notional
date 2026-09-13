import { describe, expect, it } from "vitest";

import { bookTickerStream, chunk, createBookTickerFeed } from "./book-ticker-feed.js";
import { FakeScheduler, FakeTransport } from "./test-helpers.js";

describe("createBookTickerFeed", () => {
  it("subscribes to per-symbol bookTicker streams in chunks", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const ticks: string[] = [];
    const feed = createBookTickerFeed({
      publicWsBaseUrl: "wss://fstream.binance.com/public",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 1_000,
      subscribeChunkSize: 2,
      subscribeChunkDelayMs: 250,
      onBook(tick) {
        ticks.push(tick.symbol);
      },
    });

    feed.setSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    feed.start();
    expect(transport.urls[0]).toBe("wss://fstream.binance.com/public/ws");
    transport.sockets[0]?.open();

    expect(parseSubscribe(transport.sockets[0]?.sent[0])).toEqual([
      "btcusdt@bookTicker",
      "ethusdt@bookTicker",
    ]);

    scheduler.advance(250);
    expect(parseSubscribe(transport.sockets[0]?.sent[1])).toEqual(["solusdt@bookTicker"]);

    transport.sockets[0]?.emit(
      JSON.stringify({
        e: "bookTicker",
        u: 1,
        E: 1,
        s: "BTCUSDT",
        b: "1",
        B: "1",
        a: "2",
        A: "1",
      }),
    );
    expect(ticks).toEqual(["BTCUSDT"]);
  });

  it("spreads symbols across connections under the stream cap", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const feed = createBookTickerFeed({
      publicWsBaseUrl: "wss://example.test/public",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 1_000,
      maxStreamsPerConnection: 2,
      subscribeChunkSize: 10,
      onBook() {},
    });

    feed.setSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    feed.start();
    expect(transport.sockets).toHaveLength(2);
    transport.sockets[0]?.open();
    transport.sockets[1]?.open();
    expect(feed.isConnected()).toBe(true);
  });
});

describe("bookTicker helpers", () => {
  it("chunks subscription batches", () => {
    expect(chunk(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(bookTickerStream("BTCUSDT")).toBe("btcusdt@bookTicker");
  });
});

function parseSubscribe(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as { method?: string; params?: string[] };
  return parsed.params ?? [];
}
