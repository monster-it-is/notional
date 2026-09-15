import { describe, expect, it } from "vitest";

import { inboundByteLength, inboundText, parseClientMessage } from "./protocol.js";

describe("realtime protocol", () => {
  it("parses strict client messages", () => {
    expect(parseClientMessage(JSON.stringify({ type: "ping" }))).toEqual({
      ok: true,
      message: { type: "ping" },
    });
    expect(parseClientMessage(JSON.stringify({ type: "ping", ts: 12 }))).toEqual({
      ok: true,
      message: { type: "ping", ts: 12 },
    });
    expect(
      parseClientMessage(JSON.stringify({ type: "market.subscribe", symbol: "BTCUSDT" })),
    ).toEqual({
      ok: true,
      message: { type: "market.subscribe", symbol: "BTCUSDT" },
    });
    expect(
      parseClientMessage(JSON.stringify({ type: "market.unsubscribe", symbol: "ETHUSDT" })),
    ).toEqual({
      ok: true,
      message: { type: "market.unsubscribe", symbol: "ETHUSDT" },
    });
  });

  it("rejects extra keys, invalid JSON, and non-canonical symbols", () => {
    expect(parseClientMessage("{")).toEqual({
      ok: false,
      code: "INVALID_JSON",
      message: "malformed JSON",
    });
    expect(parseClientMessage(JSON.stringify({ type: "ping", extra: true })).ok).toBe(false);
    expect(
      parseClientMessage(JSON.stringify({ type: "market.subscribe", symbol: "btc-usdt" })).ok,
    ).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "unknown" })).ok).toBe(false);
  });

  it("measures inbound bytes", () => {
    expect(inboundByteLength("abc")).toBe(3);
    expect(inboundByteLength(Buffer.from("abcd"))).toBe(4);
    expect(inboundText(Buffer.from("hi"))).toBe("hi");
    expect(inboundText({ not: "text" })).toBeNull();
  });
});
