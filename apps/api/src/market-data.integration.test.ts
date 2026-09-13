import type {
  MarketDataResponse,
  MarketDataStatusResponse,
  MarketDataUnavailableError,
} from "@notional/contracts";
import { db, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { MarketDataAccess } from "./market-data/coordinator.js";

const password = "correct-horse-battery";

const readySnapshot: MarketDataResponse = {
  symbol: "BTCUSDT",
  markPrice: "77241.80000000",
  indexPrice: "77268.98456522",
  bestBidPrice: "77241.70",
  bestBidQty: "21.549",
  bestAskPrice: "77241.80",
  bestAskQty: "0.703",
  fundingRate: "0.00007415",
  nextFundingTime: 1789344000000,
  markEventTime: 1789327702000,
  bookEventTime: 1789327703233,
};

describe("market-data api", () => {
  let app: FastifyInstance;
  let snapshots: Map<string, MarketDataResponse | null>;

  beforeAll(async () => {
    snapshots = new Map();
    const marketData: MarketDataAccess = {
      getReadySnapshot(symbol) {
        return snapshots.get(symbol) ?? null;
      },
      getFreshMark(symbol) {
        const snapshot = snapshots.get(symbol);
        return snapshot ? { symbol, markPrice: snapshot.markPrice } : null;
      },
      getFreshBook(symbol) {
        const snapshot = snapshots.get(symbol);
        return snapshot
          ? {
              symbol,
              bestBidPrice: snapshot.bestBidPrice,
              bestAskPrice: snapshot.bestAskPrice,
            }
          : null;
      },
      getStatus(): MarketDataStatusResponse {
        return {
          catalogSyncOk: true,
          catalogSyncedAt: 1,
          marketWsConnected: true,
          publicWsConnected: true,
          readySymbolCount: 1,
        };
      },
    };
    app = await buildApp({ marketData });
  });

  afterAll(async () => {
    await app.close();
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
    snapshots.clear();
  });

  it("returns 401 for unauthenticated market-data routes", async () => {
    const data = await app.inject({ method: "GET", url: "/api/market-data/BTCUSDT" });
    const status = await app.inject({ method: "GET", url: "/api/market-data/status" });

    expect(data.statusCode).toBe(401);
    expect(status.statusCode).toBe(401);
    expect(data.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 for an unknown instrument", async () => {
    const signup = await signUp(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "INSTRUMENT_NOT_FOUND" });
  });

  it("returns 503 when the snapshot is missing, partial, or stale", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "MARKET_DATA_UNAVAILABLE",
    } satisfies MarketDataUnavailableError);
  });

  it("returns a ready snapshot with decimal strings and no raw Binance fields", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));
    snapshots.set("BTCUSDT", readySnapshot);

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as MarketDataResponse;
    expect(body).toEqual(readySnapshot);
    expect(typeof body.markPrice).toBe("string");
    expect(typeof body.bestAskPrice).toBe("string");
    expect(body).not.toHaveProperty("p");
    expect(body).not.toHaveProperty("u");
    expect(body).not.toHaveProperty("bookUpdateId");
    expect(body).not.toHaveProperty("lastUpdateId");
    expect(body).not.toHaveProperty("st");
  });

  it("returns a ready snapshot for a known INACTIVE instrument", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "INACTIVE"));
    snapshots.set("BTCUSDT", readySnapshot);

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(readySnapshot);
  });

  it("returns market-data status without changing /health", async () => {
    const signup = await signUp(app);

    const status = await app.inject({
      method: "GET",
      url: "/api/market-data/status",
      headers: authHeaders(signup),
    });
    const health = await app.inject({ method: "GET", url: "/health" });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      catalogSyncOk: true,
      catalogSyncedAt: 1,
      marketWsConnected: true,
      publicWsConnected: true,
      readySymbolCount: 1,
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });
  });
});

function sample(symbol: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  return {
    symbol,
    baseAsset: "BTC",
    status,
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
  } as const;
}

async function signUp(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin: process.env.WEB_ORIGIN,
    },
    payload: {
      name: "Ada Lovelace",
      email: `ada-${Math.random().toString(16).slice(2)}@example.com`,
      password,
    },
  });
}

function authHeaders(response: { cookies: Array<{ name: string; value: string }> }) {
  return {
    cookie: response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    origin: process.env.WEB_ORIGIN,
  };
}
