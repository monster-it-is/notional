import { describe, expect, it } from "vitest";

import { createKlineFeed, klineStream } from "./kline-feed.js";
import { FakeScheduler, FakeTransport } from "./test-helpers.js";

describe("createKlineFeed", () => {
  it("acquires one upstream kline stream for the first browser", () => {
    const { feed, transport } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();

    expect(parseParams(transport.sockets[0]?.sent[0])).toEqual(["btcusdt@kline_15m"]);
    expect(feed.refCount("BTCUSDT", "15m")).toBe(1);
  });

  it("shares one Binance stream across two browsers of the same pair", () => {
    const { feed, transport } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    feed.acquire("BTCUSDT", "15m");

    expect(feed.refCount("BTCUSDT", "15m")).toBe(2);
    expect(subscribeCount(transport, "btcusdt@kline_15m")).toBe(1);
  });

  it("keeps the upstream stream after the first browser leaves", () => {
    const { feed, transport } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    feed.release("BTCUSDT", "15m");

    expect(feed.refCount("BTCUSDT", "15m")).toBe(1);
    expect(unsubscribeCount(transport, "btcusdt@kline_15m")).toBe(0);
  });

  it("unsubscribes the upstream stream when the last browser leaves", () => {
    const { feed, transport } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    feed.release("BTCUSDT", "15m");

    expect(feed.refCount("BTCUSDT", "15m")).toBe(0);
    expect(unsubscribeCount(transport, "btcusdt@kline_15m")).toBe(1);
  });

  it("treats extra release as harmless", () => {
    const { feed } = startFeed();
    feed.release("BTCUSDT", "15m");
    expect(feed.refCount("BTCUSDT", "15m")).toBe(0);
  });

  it("keeps symbol/interval combinations distinct", () => {
    const { feed, transport } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    feed.acquire("ETHUSDT", "15m");
    feed.acquire("BTCUSDT", "1h");
    transport.sockets[0]?.open();

    expect(parseParams(transport.sockets[0]?.sent[0])?.sort()).toEqual([
      "btcusdt@kline_15m",
      "btcusdt@kline_1h",
      "ethusdt@kline_15m",
    ].sort());
    expect(feed.refCount("BTCUSDT", "15m")).toBe(1);
    expect(feed.refCount("ETHUSDT", "15m")).toBe(1);
    expect(feed.refCount("BTCUSDT", "1h")).toBe(1);
  });

  it("resubscribes desired streams after an upstream disconnect", () => {
    const { feed, transport, scheduler } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    expect(parseParams(transport.sockets[0]?.sent[0])).toEqual(["btcusdt@kline_15m"]);

    transport.sockets[0]?.close();
    scheduler.advance(1_000);
    transport.sockets[1]?.open();

    expect(feed.refCount("BTCUSDT", "15m")).toBe(1);
    expect(parseParams(transport.sockets[1]?.sent[0])).toEqual(["btcusdt@kline_15m"]);
  });

  it("still releases after reconnect", () => {
    const { feed, transport, scheduler } = startFeed();
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    transport.sockets[0]?.close();
    scheduler.advance(1_000);
    transport.sockets[1]?.open();
    feed.release("BTCUSDT", "15m");

    expect(feed.refCount("BTCUSDT", "15m")).toBe(0);
    expect(unsubscribeCount(transport, "btcusdt@kline_15m")).toBe(1);
  });

  it("drops malformed frames and delivers a closed candle", () => {
    const received: Array<{ symbol: string; isClosed: boolean }> = [];
    const { feed, transport } = startFeed((kline) => {
      received.push({ symbol: kline.symbol, isClosed: kline.isClosed });
    });
    feed.acquire("BTCUSDT", "15m");
    transport.sockets[0]?.open();
    transport.sockets[0]?.emit("{");
    transport.sockets[0]?.emit(JSON.stringify({ result: null, id: 1 }));
    transport.sockets[0]?.emit(
      JSON.stringify({
        e: "kline",
        s: "BTCUSDT",
        k: {
          t: 1,
          T: 2,
          s: "BTCUSDT",
          i: "15m",
          o: "1",
          h: "1",
          l: "1",
          c: "1",
          v: "0",
          x: true,
        },
      }),
    );

    expect(received).toEqual([{ symbol: "BTCUSDT", isClosed: true }]);
  });

  it("spreads unique streams across connections under the stream cap", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const feed = createKlineFeed({
      publicWsBaseUrl: "wss://example.test/public",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 1_000,
      maxStreamsPerConnection: 2,
      subscribeChunkSize: 10,
      onKline() {},
    });
    feed.acquire("BTCUSDT", "15m");
    feed.acquire("ETHUSDT", "15m");
    feed.acquire("SOLUSDT", "15m");
    feed.start();
    expect(transport.sockets).toHaveLength(2);
  });
});

describe("kline helpers", () => {
  it("builds the Binance kline stream name", () => {
    expect(klineStream("BTCUSDT|15m")).toBe("btcusdt@kline_15m");
  });
});

function startFeed(onKline: Parameters<typeof createKlineFeed>[0]["onKline"] = () => {}) {
  const transport = new FakeTransport();
  const scheduler = new FakeScheduler();
  const feed = createKlineFeed({
    publicWsBaseUrl: "wss://fstream.binance.com/public",
    transport,
    scheduler,
    random: () => 1,
    reconnectMaxMs: 1_000,
    onKline,
  });
  feed.start();
  return { feed, transport, scheduler };
}

function parseParams(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as { method?: string; params?: string[] };
  return parsed.params ?? [];
}

function subscribeCount(transport: FakeTransport, stream: string): number {
  return transport.sockets.reduce((count, socket) => {
    return (
      count +
      socket.sent.filter((row) => {
        const parsed = JSON.parse(row) as { method?: string; params?: string[] };
        return parsed.method === "SUBSCRIBE" && parsed.params?.includes(stream);
      }).length
    );
  }, 0);
}

function unsubscribeCount(transport: FakeTransport, stream: string): number {
  return transport.sockets.reduce((count, socket) => {
    return (
      count +
      socket.sent.filter((row) => {
        const parsed = JSON.parse(row) as { method?: string; params?: string[] };
        return parsed.method === "UNSUBSCRIBE" && parsed.params?.includes(stream);
      }).length
    );
  }, 0);
}
