import { describe, expect, it } from "vitest";

import {
  isBlockedHistorySymbol,
  isCanonicalSymbol,
  normalizeSymbolInput,
} from "./canonical-symbol.ts";

describe("canonical symbol", () => {
  it("uppercases and trims input without inventing a symbol", () => {
    expect(normalizeSymbolInput(" btcusdt ")).toBe("BTCUSDT");
  });

  it("accepts only canonical exchange symbols", () => {
    expect(isCanonicalSymbol("BTCUSDT")).toBe(true);
    expect(isCanonicalSymbol("BTCUSDT2")).toBe(true);
    expect(isCanonicalSymbol("")).toBe(false);
    expect(isCanonicalSymbol("BTC-USDT")).toBe(false);
    expect(isCanonicalSymbol("BTC USDT")).toBe(false);
    expect(isCanonicalSymbol("btcusdt")).toBe(false);
  });

  it("blocks only non-empty invalid symbols", () => {
    expect(isBlockedHistorySymbol("")).toBe(false);
    expect(isBlockedHistorySymbol("BTCUSDT")).toBe(false);
    expect(isBlockedHistorySymbol("BTC-USDT")).toBe(true);
  });
});
