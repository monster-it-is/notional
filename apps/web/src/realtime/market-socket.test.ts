import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketSocketManager } from "./market-socket.ts";
import { FakeWebSocket } from "../test/fake-websocket.ts";

function hello() {
  return {
    type: "hello",
    protocolVersion: 1,
    channel: "market",
    serverTime: "2026-01-01T00:00:00.000Z",
  };
}

describe("market socket", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not subscribe on native open", () => {
    const manager = createManager();
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    FakeWebSocket.instances[0]?.open();
    expect(FakeWebSocket.instances[0]?.sent).toEqual([]);
  });

  it("subscribes after a valid market hello", () => {
    const manager = createManager();
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    expect(socket.sent).toContain(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" }));
  });

  it("unsubscribes the previous symbol and subscribes the next", () => {
    const manager = createManager();
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    manager.setDesiredSymbol("ETHUSDT");
    expect(socket.sent).toContain(JSON.stringify({ type: "market.unsubscribe", symbol: "BTCUSDT" }));
    expect(socket.sent).toContain(JSON.stringify({ type: "market.subscribe", symbol: "ETHUSDT" }));
  });

  it("resubscribes after reconnect hello", () => {
    const manager = createManager();
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.emit(hello());
    FakeWebSocket.instances[0]?.close(1006, "");
    vi.runOnlyPendingTimers();
    const next = FakeWebSocket.instances[1]!;
    next.open();
    next.emit(hello());
    expect(next.sent).toContain(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" }));
  });

  it("applies bbo and mark to handlers after hello", () => {
    const onBbo = vi.fn();
    const onMark = vi.fn();
    const manager = createManager({ onBbo, onMark });
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit({
      type: "market.bbo",
      symbol: "BTCUSDT",
      bestBidPrice: "1",
      bestBidQty: "1",
      bestAskPrice: "2",
      bestAskQty: "1",
      bookEventTime: 1,
    });
    expect(onBbo).not.toHaveBeenCalled();
    socket.emit(hello());
    socket.emit({
      type: "market.bbo",
      symbol: "BTCUSDT",
      bestBidPrice: "1",
      bestBidQty: "1",
      bestAskPrice: "2",
      bestAskQty: "1",
      bookEventTime: 1,
    });
    socket.emit({
      type: "market.mark",
      symbol: "BTCUSDT",
      markPrice: "1.5",
      indexPrice: "1.4",
      fundingRate: "0.0001",
      nextFundingTime: 1,
      markEventTime: 1,
    });
    expect(onBbo).toHaveBeenCalled();
    expect(onMark).toHaveBeenCalled();
  });

  it("rejects frames after protocol mismatch", () => {
    const onBbo = vi.fn();
    const manager = createManager({ onBbo });
    manager.setDesiredSymbol("BTCUSDT");
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit({
      type: "hello",
      protocolVersion: 9,
      channel: "market",
      serverTime: "t",
    });
    socket.emit({
      type: "market.bbo",
      symbol: "BTCUSDT",
      bestBidPrice: "1",
      bestBidQty: "1",
      bestAskPrice: "2",
      bestAskQty: "1",
      bookEventTime: 1,
    });
    expect(onBbo).not.toHaveBeenCalled();
  });

  it("reuses one constructor while acquired", () => {
    const manager = createManager();
    manager.acquire();
    manager.acquire();
    expect(manager.constructorCount).toBe(1);
  });

  it("subscribes the desired candle after a valid market hello", () => {
    const manager = createManager();
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    expect(socket.sent).toContain(
      JSON.stringify({ type: "market.candles.subscribe", symbol: "BTCUSDT", interval: "15m" }),
    );
    expect(socket.sent.some((row) => row.includes("market.subscribe"))).toBe(false);
  });

  it("resubscribes the desired candle after reconnect hello", () => {
    const manager = createManager();
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.emit(hello());
    FakeWebSocket.instances[0]?.close(1006, "");
    vi.runOnlyPendingTimers();
    const next = FakeWebSocket.instances[1]!;
    next.open();
    next.emit(hello());
    expect(next.sent).toContain(
      JSON.stringify({ type: "market.candles.subscribe", symbol: "BTCUSDT", interval: "15m" }),
    );
  });

  it("unsubscribes the previous candle pair then subscribes the next", () => {
    const manager = createManager();
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    manager.setDesiredCandle({ symbol: "ETHUSDT", interval: "15m" });
    const sent = socket.sent.filter((row) => row.includes("market.candles"));
    expect(sent).toEqual([
      JSON.stringify({ type: "market.candles.subscribe", symbol: "BTCUSDT", interval: "15m" }),
      JSON.stringify({ type: "market.candles.unsubscribe", symbol: "BTCUSDT", interval: "15m" }),
      JSON.stringify({ type: "market.candles.subscribe", symbol: "ETHUSDT", interval: "15m" }),
    ]);
  });

  it("clears the desired candle with unsubscribe", () => {
    const manager = createManager();
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    manager.setDesiredCandle(null);
    expect(socket.sent).toContain(
      JSON.stringify({ type: "market.candles.unsubscribe", symbol: "BTCUSDT", interval: "15m" }),
    );
  });

  it("ignores a candle frame that is not the desired pair", () => {
    const listener = vi.fn();
    const manager = createManager();
    manager.subscribeMarketCandles(listener);
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    socket.emit({
      type: "market.candle",
      symbol: "ETHUSDT",
      interval: "15m",
      openTime: 1,
      closeTime: 2,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "0",
      isClosed: false,
    });
    expect(listener).not.toHaveBeenCalled();
    socket.emit({
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
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps quote desired-symbol subscription independent of candles", () => {
    const manager = createManager();
    manager.setDesiredSymbol("BTCUSDT");
    manager.setDesiredCandle({ symbol: "ETHUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    expect(socket.sent).toContain(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" }));
    expect(socket.sent).toContain(
      JSON.stringify({ type: "market.candles.subscribe", symbol: "ETHUSDT", interval: "15m" }),
    );
    expect(socket.sent.some((row) => row.includes('"interval":"15m"') && row.includes("market.subscribe"))).toBe(
      false,
    );
  });

  it("notifies reconnect listeners only after a prior successful hello", () => {
    const reconnect = vi.fn();
    const manager = createManager();
    manager.subscribeReconnectReady(reconnect);
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.emit(hello());
    expect(reconnect).not.toHaveBeenCalled();
    FakeWebSocket.instances[0]?.close(1006, "");
    vi.runOnlyPendingTimers();
    FakeWebSocket.instances[1]?.open();
    FakeWebSocket.instances[1]?.emit(hello());
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("does not leak candle listeners after unsubscribe", () => {
    const listener = vi.fn();
    const manager = createManager();
    const stop = manager.subscribeMarketCandles(listener);
    manager.setDesiredCandle({ symbol: "BTCUSDT", interval: "15m" });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    stop();
    socket.emit({
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
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

function createManager(
  overrides: Partial<ConstructorParameters<typeof MarketSocketManager>[0]> = {},
) {
  return new MarketSocketManager({
    url: () => "ws://localhost:3000/ws/market",
    createWebSocket: (url) => new FakeWebSocket(url),
    onBbo: () => {},
    onMark: () => {},
    setStatus: () => {},
    random: () => 0,
    ...overrides,
  });
}
