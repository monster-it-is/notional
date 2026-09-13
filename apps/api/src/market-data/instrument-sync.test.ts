import { db, findInstrumentBySymbol, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { coin } from "./exchange-info-fixtures.js";
import { syncInstrumentCatalog } from "./instrument-sync.js";

describe("syncInstrumentCatalog", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("upserts eligible instruments and inactivates missing known symbols", async () => {
    const existingBtc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const existingSol = await upsertInstrumentBySymbol(db, sample("SOLUSDT", "SOL"));

    const result = await syncInstrumentCatalog({
      fetchExchangeInfo: async () => ({
        symbols: [
          coin("BTCUSDT", {
            filters: [
              { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "1000000", tickSize: "0.01" },
              { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
              { filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "120", stepSize: "0.001" },
              { filterType: "MIN_NOTIONAL", notional: "50" },
            ],
          }),
          coin("ETHUSDT", { baseAsset: "ETH" }),
        ],
      }),
    });

    expect(result).toEqual({ ok: true, upserted: 2, inactivated: 1 });

    const btc = await findInstrumentBySymbol(db, "BTCUSDT");
    const eth = await findInstrumentBySymbol(db, "ETHUSDT");
    const sol = await findInstrumentBySymbol(db, "SOLUSDT");

    expect(btc?.id).toBe(existingBtc.id);
    expect(btc?.tickSize).toBe("0.01");
    expect(eth?.status).toBe("ACTIVE");
    expect(sol?.status).toBe("INACTIVE");
    expect(sol?.id).toBe(existingSol.id);
  });

  it("preserves existing UUIDs", async () => {
    const created = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    await syncInstrumentCatalog({
      fetchExchangeInfo: async () => ({ symbols: [coin("BTCUSDT")] }),
    });

    expect((await findInstrumentBySymbol(db, "BTCUSDT"))?.id).toBe(created.id);
  });

  it("leaves PostgreSQL unchanged when an eligible candidate is malformed", async () => {
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const result = await syncInstrumentCatalog({
      fetchExchangeInfo: async () => ({
        symbols: [
          coin("ETHUSDT", { baseAsset: "ETH" }),
          coin("BTCUSDT", {
            filters: [
              { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
            ],
          }),
        ],
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed_candidate");
    }

    expect((await findInstrumentBySymbol(db, "BTCUSDT"))?.status).toBe("ACTIVE");
    expect(await findInstrumentBySymbol(db, "ETHUSDT")).toBeNull();
  });

  it("does not mass-inactivate when mapping yields no eligible instruments", async () => {
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const result = await syncInstrumentCatalog({
      fetchExchangeInfo: async () => ({
        symbols: [
          coin("MSTRUSDT", {
            contractType: "TRADIFI_PERPETUAL",
            underlyingType: "EQUITY",
          }),
        ],
      }),
    });

    expect(result).toEqual({
      ok: false,
      reason: "empty",
      detail: "exchangeInfo contained no eligible COIN USDT perpetuals",
    });
    expect((await findInstrumentBySymbol(db, "BTCUSDT"))?.status).toBe("ACTIVE");
  });

  it("does not mass-inactivate a malformed top-level snapshot", async () => {
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const result = await syncInstrumentCatalog({
      fetchExchangeInfo: async () => ({ timezone: "UTC" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_snapshot");
    }

    expect((await findInstrumentBySymbol(db, "BTCUSDT"))?.status).toBe("ACTIVE");
  });

  it("leaves the catalog unchanged when exchangeInfo fetch fails", async () => {
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const result = await syncInstrumentCatalog({
      fetchExchangeInfo: async () => {
        throw new Error("network down");
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: "fetch",
      detail: "network down",
    });
    expect((await findInstrumentBySymbol(db, "BTCUSDT"))?.status).toBe("ACTIVE");
  });
});

function sample(symbol: string, baseAsset: string) {
  return {
    symbol,
    baseAsset,
    status: "ACTIVE" as const,
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
