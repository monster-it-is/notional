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
