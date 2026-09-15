import { WS_CLOSE_AUTH_EXPIRED } from "@notional/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSocketManager } from "./account-socket.ts";
import { FakeWebSocket } from "../test/fake-websocket.ts";

function hello() {
  return {
    type: "hello",
    protocolVersion: 1,
    channel: "account",
    serverTime: "2026-01-01T00:00:00.000Z",
  };
}

describe("account socket", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not construct a socket until acquire", () => {
    const manager = createManager();
    expect(manager.constructorCount).toBe(0);
    manager.acquire();
    expect(manager.constructorCount).toBe(1);
  });

  it("is a singleton constructor per acquire cycle", () => {
    const manager = createManager();
    manager.acquire();
    manager.acquire();
    expect(manager.constructorCount).toBe(1);
  });

  it("does not resync on native open", () => {
    const onReconnectReady = vi.fn();
    const onInvalidate = vi.fn();
    const manager = createManager({ onReconnectReady, onInvalidate });
    manager.acquire();
    FakeWebSocket.instances[0]?.open();
    expect(onReconnectReady).not.toHaveBeenCalled();
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("marks READY after a valid hello and resyncs only on reconnect hello", () => {
    const onReconnectReady = vi.fn();
    const statuses: string[] = [];
    const manager = createManager({
      onReconnectReady,
      setStatus: (status) => statuses.push(status),
    });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    expect(statuses).toContain("ready");
    expect(onReconnectReady).not.toHaveBeenCalled();

    socket.close(1006, "");
    vi.runOnlyPendingTimers();
    const next = FakeWebSocket.instances[1]!;
    next.open();
    next.emit(hello());
    expect(onReconnectReady).toHaveBeenCalledTimes(1);
  });

  it("maps private.invalidate only after hello", () => {
    const onInvalidate = vi.fn();
    const manager = createManager({ onInvalidate });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit({
      type: "private.invalidate",
      eventId: "1",
      occurredAt: "t",
      resources: ["orders"],
      reason: "ORDER_PLACED",
    });
    expect(onInvalidate).not.toHaveBeenCalled();
    socket.emit(hello());
    socket.emit({
      type: "private.invalidate",
      eventId: "2",
      occurredAt: "t",
      resources: ["orders", "account"],
      reason: "ORDER_FILLED",
    });
    expect(onInvalidate).toHaveBeenCalledWith(["orders", "account"]);
  });

  it("re-checks session on 4401 and does not blindly reconnect", async () => {
    const getSession = vi.fn(async () => false);
    const onSignedOut = vi.fn();
    const manager = createManager({ getSession, onSignedOut });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit(hello());
    socket.close(WS_CLOSE_AUTH_EXPIRED, "AUTH_EXPIRED");
    await Promise.resolve();
    await Promise.resolve();
    expect(getSession).toHaveBeenCalled();
    expect(onSignedOut).toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("does not inspect unavailable HTTP status on pre-upgrade failure", async () => {
    const getSession = vi.fn(async () => true);
    const probeAccount = vi.fn(async () => "ok" as const);
    const manager = createManager({ getSession, probeAccount });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.error();
    socket.close(1006, "");
    await Promise.resolve();
    await Promise.resolve();
    expect(getSession).toHaveBeenCalled();
    expect(probeAccount).toHaveBeenCalled();
  });

  it("runs REST uninitialized handling when pre-ready probe is 409-equivalent", async () => {
    const onUninitialized = vi.fn();
    const manager = createManager({
      getSession: async () => true,
      probeAccount: async () => "uninitialized",
      onUninitialized,
    });
    manager.acquire();
    FakeWebSocket.instances[0]?.close(1006, "");
    await Promise.resolve();
    await Promise.resolve();
    expect(onUninitialized).toHaveBeenCalled();
  });

  it("stops on protocol mismatch and does not process invalidations", () => {
    const onInvalidate = vi.fn();
    const manager = createManager({ onInvalidate });
    manager.acquire();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.emit({
      type: "hello",
      protocolVersion: 2,
      channel: "account",
      serverTime: "t",
    });
    socket.emit({
      type: "private.invalidate",
      eventId: "1",
      occurredAt: "t",
      resources: ["orders"],
      reason: "ORDER_PLACED",
    });
    expect(onInvalidate).not.toHaveBeenCalled();
  });
});

function createManager(
  overrides: Partial<ConstructorParameters<typeof AccountSocketManager>[0]> = {},
) {
  return new AccountSocketManager({
    url: () => "ws://localhost:3000/ws/account",
    createWebSocket: (url) => new FakeWebSocket(url),
    getSession: async () => true,
    probeAccount: async () => "ok",
    onInvalidate: () => {},
    onReconnectReady: () => {},
    onSignedOut: () => {},
    onUninitialized: () => {},
    setStatus: () => {},
    random: () => 0,
    ...overrides,
  });
}
