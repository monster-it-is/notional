import { afterEach, describe, expect, it } from "vitest";

import { createMarketDataStore } from "../market-data/market-data-store.js";
import { FakeScheduler } from "../market-data/test-helpers.js";
import { MAX_INBOUND_PAYLOAD_BYTES, MAX_MARKET_SUBSCRIPTIONS } from "./constants.js";
import { createRealtimeRuntime, latestFromStore, type InstrumentLookup } from "./runtime.js";
import { FakeRealtimeSocket } from "./test-helpers.js";

describe("realtime runtime", () => {
  const runtimes: Array<{ shutdown(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
  });

  it("sends hello first, snapshots on subscribe, and coalesces later updates", async () => {
    const scheduler = new FakeScheduler();
    const store = createMarketDataStore(scheduler);
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "100",
      bestBidQty: "1",
      bestAskPrice: "101",
      bestAskQty: "2",
      bookUpdateId: 1,
      bookEventTime: 10,
    });
    store.applyMark({
      symbol: "BTCUSDT",
      markPrice: "100.5",
      indexPrice: "100.4",
      fundingRate: "0.0001",
      nextFundingTime: 20,
      markEventTime: 10,
    });
    const runtime = runtimeWith(scheduler, store, ["BTCUSDT"]);
    const socket = new FakeRealtimeSocket();
    runtime.attachMarketSocket(socket);
    expect(socket.parsed()[0]).toMatchObject({
      type: "hello",
      protocolVersion: 1,
      channel: "market",
    });
    await subscribe(socket, "BTCUSDT");
    expect(socket.parsed().filter((row) => (row as { type: string }).type === "market.bbo")).toHaveLength(1);
    expect(socket.parsed()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "market.bbo", bestBidPrice: "100", bestAskPrice: "101" }),
        expect.objectContaining({ type: "market.mark", markPrice: "100.5", indexPrice: "100.4" }),
      ]),
    );
    await subscribe(socket, "BTCUSDT");
    expect(socket.parsed().filter((row) => (row as { type: string }).type === "market.bbo")).toHaveLength(2);
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "103",
      bestBidQty: "1",
      bestAskPrice: "104",
      bestAskQty: "2",
      bookUpdateId: 2,
      bookEventTime: 11,
    });
    runtime.noteBook("BTCUSDT");
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "105",
      bestBidQty: "1",
      bestAskPrice: "106",
      bestAskQty: "2",
      bookUpdateId: 3,
      bookEventTime: 12,
    });
    runtime.noteBook("BTCUSDT");
    store.applyMark({
      symbol: "BTCUSDT",
      markPrice: "105.5",
      indexPrice: "105.4",
      fundingRate: "0.0002",
      nextFundingTime: 30,
      markEventTime: 12,
    });
    runtime.noteMark("BTCUSDT");
    const beforeFlush = socket.parsed().filter((row) => (row as { type: string }).type.startsWith("market."));
    scheduler.advance(100);
    const afterFlush = socket.parsed().filter((row) => (row as { type: string }).type.startsWith("market."));
    expect(afterFlush.length).toBe(beforeFlush.length + 2);
    expect(afterFlush.at(-2)).toMatchObject({ type: "market.bbo", bestBidPrice: "105", bestAskPrice: "106" });
    expect(afterFlush.at(-1)).toMatchObject({ type: "market.mark", markPrice: "105.5" });
  });

  it("rejects unknown symbols and treats unsubscribe as idempotent", async () => {
    const scheduler = new FakeScheduler();
    const runtime = runtimeWith(scheduler, createMarketDataStore(scheduler), ["BTCUSDT"]);
    const socket = new FakeRealtimeSocket();
    runtime.attachMarketSocket(socket);
    await subscribe(socket, "UNKNOWN");
    expect(socket.parsed().some((row) => (row as { code?: string }).code === "INVALID_SYMBOL")).toBe(true);
    expect(socket.closed).toBeNull();
    socket.emit(JSON.stringify({ type: "market.unsubscribe", symbol: "UNKNOWN" }));
    await drain(socket);
    expect(socket.closed).toBeNull();
    socket.emit(JSON.stringify({ type: "market.unsubscribe", symbol: "BTCUSDT" }));
    await drain(socket);
    expect(socket.closed).toBeNull();
  });

  it("enforces the subscription cap", async () => {
    const scheduler = new FakeScheduler();
    const symbols = Array.from({ length: MAX_MARKET_SUBSCRIPTIONS + 1 }, (_, i) => `S${i}USDT`);
    const runtime = runtimeWith(scheduler, createMarketDataStore(scheduler), symbols);
    const socket = new FakeRealtimeSocket();
    runtime.attachMarketSocket(socket);
    for (const symbol of symbols.slice(0, MAX_MARKET_SUBSCRIPTIONS)) {
      await subscribe(socket, symbol);
    }
    await subscribe(socket, symbols.at(-1) ?? "S50USDT");
    expect(socket.parsed().some((row) => (row as { code?: string }).code === "SUBSCRIBE_LIMIT")).toBe(true);
  });

  it("resubscribes from the current store snapshot after reconnect", async () => {
    const scheduler = new FakeScheduler();
    const store = createMarketDataStore(scheduler);
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "100",
      bestBidQty: "1",
      bestAskPrice: "101",
      bestAskQty: "1",
      bookUpdateId: 1,
      bookEventTime: 1,
    });
    const runtime = runtimeWith(scheduler, store, ["BTCUSDT"]);
    const first = new FakeRealtimeSocket();
    runtime.attachMarketSocket(first);
    await subscribe(first, "BTCUSDT");
    first.close(1000, "client");
    store.applyBook({
      symbol: "BTCUSDT",
      bestBidPrice: "110",
      bestBidQty: "1",
      bestAskPrice: "111",
      bestAskQty: "1",
      bookUpdateId: 2,
      bookEventTime: 2,
    });
    const second = new FakeRealtimeSocket();
    runtime.attachMarketSocket(second);
    await subscribe(second, "BTCUSDT");
    expect(second.parsed()[0]).toMatchObject({ type: "hello" });
    expect(second.parsed()).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "market.bbo", bestBidPrice: "110" })]),
    );
  });

  it("closes oversized and non-JSON frames, and times out idle connections", async () => {
    const scheduler = new FakeScheduler();
    const runtime = runtimeWith(scheduler, createMarketDataStore(scheduler), [], 1_000);
    const oversized = new FakeRealtimeSocket();
    runtime.attachMarketSocket(oversized);
    oversized.emit("x".repeat(MAX_INBOUND_PAYLOAD_BYTES + 1));
    await flush();
    expect(oversized.closed).toEqual({ code: 1009, reason: "MESSAGE_TOO_BIG" });

    const malformed = new FakeRealtimeSocket();
    runtime.attachMarketSocket(malformed);
    malformed.emit("{");
    await flush();
    expect(malformed.parsed().at(-1)).toMatchObject({ type: "error", code: "INVALID_JSON" });
    expect(malformed.closed?.code).toBe(1003);

    const idle = new FakeRealtimeSocket();
    runtime.attachMarketSocket(idle);
    scheduler.advance(1_000);
    await flush();
    expect(idle.closed).toEqual({ code: 4408, reason: "HEARTBEAT_TIMEOUT" });
  });

  it("closes private sockets on expired session and ignores market messages on account sockets", async () => {
    const scheduler = new FakeScheduler();
    let valid = true;
    const runtime = createRealtimeRuntime({
      latest: latestFromStore(createMarketDataStore(scheduler)),
      scheduler,
      coalesceMs: 100,
      idleTimeoutMs: 45_000,
      async getSession() {
        return valid ? { userId: "user-1" } : null;
      },
      findInstrument: catalog(["BTCUSDT"]),
    });
    runtimes.push(runtime);
    const socket = new FakeRealtimeSocket();
    runtime.attachAccountSocket(socket, {
      userId: "user-1",
      paperAccountId: "acct-1",
      handshakeHeaders: { cookie: "better-auth.session_token=x" },
    });
    expect(socket.parsed()[0]).toMatchObject({ type: "hello", channel: "account" });
    socket.emit(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" }));
    await drain(socket);
    expect(socket.parsed().at(-2)).toMatchObject({ type: "error", code: "WRONG_CHANNEL" });
    valid = false;
    socket.emit(JSON.stringify({ type: "ping" }));
    await drain(socket);
    expect(socket.closed).toEqual({ code: 4401, reason: "AUTH_EXPIRED" });
  });

  it("closes an idle private socket with AUTH_EXPIRED when the session is gone", async () => {
    const scheduler = new FakeScheduler();
    const runtime = createRealtimeRuntime({
      latest: latestFromStore(createMarketDataStore(scheduler)),
      scheduler,
      coalesceMs: 100,
      idleTimeoutMs: 1_000,
      async getSession() {
        return null;
      },
    });
    runtimes.push(runtime);
    const socket = new FakeRealtimeSocket();
    runtime.attachAccountSocket(socket, {
      userId: "user-1",
      paperAccountId: "acct-1",
      handshakeHeaders: { cookie: "better-auth.session_token=x" },
    });
    scheduler.advance(1_000);
    await waitUntil(() => socket.closed !== null);
    expect(socket.closed).toEqual({ code: 4401, reason: "AUTH_EXPIRED" });
  });

  it("becomes a no-op publisher after shutdown", async () => {
    const scheduler = new FakeScheduler();
    const runtime = createRealtimeRuntime({
      latest: latestFromStore(createMarketDataStore(scheduler)),
      scheduler,
      coalesceMs: 100,
      idleTimeoutMs: 45_000,
    });
    const socket = new FakeRealtimeSocket();
    runtime.attachAccountSocket(socket, {
      userId: "user-1",
      paperAccountId: "acct-1",
      handshakeHeaders: {},
    });
    await runtime.shutdown();
    expect(socket.closed?.code).toBe(1001);
    expect(() =>
      runtime.onPrivateCommitted({
        paperAccountId: "acct-1",
        reason: "ORDER_PLACED",
        resources: ["orders"],
      }),
    ).not.toThrow();
  });

  function runtimeWith(
    scheduler: FakeScheduler,
    store: ReturnType<typeof createMarketDataStore>,
    symbols: string[],
    idleTimeoutMs = 45_000,
  ) {
    const runtime = createRealtimeRuntime({
      latest: latestFromStore(store),
      scheduler,
      coalesceMs: 100,
      idleTimeoutMs,
      findInstrument: catalog(symbols),
    });
    runtimes.push(runtime);
    return runtime;
  }
});

function catalog(symbols: string[]): InstrumentLookup {
  const known = new Set(symbols);
  return async (symbol) => (known.has(symbol) ? { symbol } : null);
}

async function subscribe(socket: FakeRealtimeSocket, symbol: string): Promise<void> {
  socket.emit(JSON.stringify({ type: "market.subscribe", symbol }));
  await drain(socket);
}

async function drain(socket: FakeRealtimeSocket): Promise<void> {
  pingSeq += 1;
  const ts = pingSeq;
  if (socket.closed) {
    return;
  }
  socket.emit(JSON.stringify({ type: "ping", ts }));
  await waitUntil(
    () =>
      socket.closed !== null ||
      socket.parsed().some((row) => (row as { type?: string; ts?: number }).type === "pong" && (row as { ts?: number }).ts === ts),
  );
}

let pingSeq = 0;

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error("condition not met");
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
