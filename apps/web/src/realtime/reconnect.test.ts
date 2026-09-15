import { describe, expect, it } from "vitest";

import { reconnectDelay } from "./reconnect.ts";

describe("reconnect delay", () => {
  it("is bounded exponential with jitter", () => {
    expect(reconnectDelay(0, { random: () => 0 })).toBe(1000);
    expect(reconnectDelay(10, { random: () => 0 })).toBe(30000);
    expect(reconnectDelay(0, { random: () => 1 })).toBe(1251);
  });
});
