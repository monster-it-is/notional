import type { InstrumentResponse } from "@notional/contracts";
import { describe, expect, it } from "vitest";

import { filterInstruments } from "./filter-instruments.ts";

const btc = sample("BTCUSDT", "BTC");
const eth = sample("ETHUSDT", "ETH");
const sol = sample("SOLUSDT", "SOL");

describe("filterInstruments", () => {
  it("returns the original array and order when the query is empty or whitespace", () => {
    const instruments = [btc, eth, sol];

    expect(filterInstruments(instruments, "")).toBe(instruments);
    expect(filterInstruments(instruments, "   ")).toBe(instruments);
    expect(filterInstruments(instruments, "").map((row) => row.symbol)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
    ]);
  });

  it("matches a symbol substring without changing order", () => {
    expect(filterInstruments([btc, eth, sol], "USDT").map((row) => row.symbol)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
    ]);
    expect(filterInstruments([btc, eth, sol], "ETH").map((row) => row.symbol)).toEqual(["ETHUSDT"]);
  });

  it("matches a baseAsset substring", () => {
    expect(filterInstruments([btc, eth, sol], "SOL").map((row) => row.symbol)).toEqual(["SOLUSDT"]);
  });

  it("trims the query and matches case-insensitively", () => {
    expect(filterInstruments([btc, eth], "  btc  ").map((row) => row.symbol)).toEqual(["BTCUSDT"]);
    expect(filterInstruments([btc, eth], "ethusdt").map((row) => row.symbol)).toEqual(["ETHUSDT"]);
    expect(filterInstruments([btc, eth], "BtC").map((row) => row.symbol)).toEqual(["BTCUSDT"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterInstruments([btc, eth], "DOGE")).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const instruments: readonly InstrumentResponse[] = [btc, eth];
    const snapshot = instruments.map((row) => row.symbol);

    const filtered = filterInstruments(instruments, "ETH");
    expect(filtered.map((row) => row.symbol)).toEqual(["ETHUSDT"]);
    expect(instruments.map((row) => row.symbol)).toEqual(snapshot);

    const emptyQuery = filterInstruments(instruments, "");
    expect(emptyQuery).toBe(instruments);
    expect(instruments.map((row) => row.symbol)).toEqual(snapshot);
  });
});

function sample(symbol: string, baseAsset: string): InstrumentResponse {
  return {
    id: symbol,
    symbol,
    baseAsset,
    quoteAsset: "USDT",
    contractType: "PERPETUAL",
    status: "ACTIVE",
    tickSize: "0.1",
    minPrice: "0.1",
    maxPrice: "1000000",
    stepSize: "0.001",
    minQty: "0.001",
    maxQty: "1000",
    marketStepSize: "0.001",
    marketMinQty: "0.001",
    marketMaxQty: "120",
    minNotional: "5",
  };
}
