import type { CreateOrderRequest } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { resolveOrderIntent } from "./idempotency.ts";

const market: CreateOrderRequest = {
  type: "MARKET",
  symbol: "BTCUSDT",
  side: "BUY",
  quantity: "0.001",
};

describe("order idempotency", () => {
  it("reuses the same key for the same fingerprint", () => {
    const first = resolveOrderIntent(null, market, () => "key-1");
    const second = resolveOrderIntent(first.intent, market, () => "key-2");
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.intent.key).toBe("key-1");
  });

  it("mints a new key when the fingerprint changes", () => {
    const first = resolveOrderIntent(null, market, () => "key-1");
    const second = resolveOrderIntent(
      first.intent,
      { ...market, quantity: "0.002" },
      () => "key-2",
    );
    expect(second.reused).toBe(false);
    expect(second.intent.key).toBe("key-2");
  });
});
