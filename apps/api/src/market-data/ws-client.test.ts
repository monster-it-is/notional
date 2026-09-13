import { describe, expect, it } from "vitest";

import { createReconnectingWsClient } from "./ws-client.js";
import { computeReconnectDelay } from "./ws-transport.js";
import { FakeScheduler, FakeTransport } from "./test-helpers.js";

describe("createReconnectingWsClient", () => {
  it("connects and delivers messages from the current generation", () => {
    const transport = new FakeTransport();
    const messages: string[] = [];
    const scheduler = new FakeScheduler();
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 8_000,
      onMessage(data) {
        messages.push(data);
      },
    });

    client.start();
    expect(transport.sockets).toHaveLength(1);
    transport.sockets[0]?.open();
    expect(client.isConnected()).toBe(true);
    transport.sockets[0]?.emit("hello");
    expect(messages).toEqual(["hello"]);
  });

  it("reconnects with exponential backoff capped by max delay", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 4_000,
      backoffBaseMs: 1_000,
      onMessage() {},
    });

    client.start();
    expect(transport.sockets).toHaveLength(1);

    transport.sockets[0]?.close();
    expect(transport.sockets).toHaveLength(1);

    scheduler.advance(1_000);
    expect(transport.sockets).toHaveLength(2);

    transport.sockets[1]?.close();
    scheduler.advance(1_999);
    expect(transport.sockets).toHaveLength(2);
    scheduler.advance(1);
    expect(transport.sockets).toHaveLength(3);

    transport.sockets[2]?.close();
    scheduler.advance(4_000);
    expect(transport.sockets).toHaveLength(4);
  });

  it("ignores messages from a superseded generation", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const messages: string[] = [];
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 8_000,
      backoffBaseMs: 1_000,
      onMessage(data) {
        messages.push(data);
      },
    });

    client.start();
    const first = transport.sockets[0]!;
    first.open();
    first.close();
    scheduler.advance(1_000);
    const second = transport.sockets[1]!;
    second.open();

    first.emit("stale");
    second.emit("fresh");
    expect(messages).toEqual(["fresh"]);
  });

  it("does not open a second concurrent generation while one is live", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 8_000,
      onMessage() {},
    });

    client.start();
    client.start();
    expect(transport.sockets).toHaveLength(1);
  });

  it("rotates the connection before the 24h lifetime", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 1_000,
      backoffBaseMs: 1_000,
      connectionMaxMs: 5_000,
      onMessage() {},
    });

    client.start();
    transport.sockets[0]?.open();
    scheduler.advance(5_000);
    expect(transport.sockets).toHaveLength(1);
    scheduler.advance(1_000);
    expect(transport.sockets).toHaveLength(2);
  });

  it("cancels reconnect work on shutdown", () => {
    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const client = createReconnectingWsClient({
      url: "wss://example.test/ws",
      transport,
      scheduler,
      random: () => 1,
      reconnectMaxMs: 8_000,
      backoffBaseMs: 1_000,
      onMessage() {},
    });

    client.start();
    transport.sockets[0]?.open();
    transport.sockets[0]?.close();
    client.stop();
    scheduler.advance(10_000);
    expect(transport.sockets).toHaveLength(1);
  });
});

describe("computeReconnectDelay", () => {
  it("applies jitter between half and full exponential delay", () => {
    expect(
      computeReconnectDelay({ attempt: 0, random: () => 0, baseMs: 1_000, maxMs: 8_000 }),
    ).toBe(500);
    expect(
      computeReconnectDelay({ attempt: 0, random: () => 1, baseMs: 1_000, maxMs: 8_000 }),
    ).toBe(1_000);
    expect(
      computeReconnectDelay({ attempt: 4, random: () => 1, baseMs: 1_000, maxMs: 8_000 }),
    ).toBe(8_000);
  });
});
