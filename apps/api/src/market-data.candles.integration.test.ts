import type {
  CandleListResponse,
  InvalidQueryError,
  MarketDataUnavailableError,
} from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import { db, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { BinanceRestError } from "./market-data/rest-client.js";
import type { GetKlines } from "./market-data.js";
import type { MarketDataAccess } from "./market-data/coordinator.js";

const password = "correct-horse-battery";

const klineRow = [
  1_499_040_000_000,
  "0.01634790",
  "0.80000000",
  "0.01575800",
  "0.01577100",
  "148976.11427815",
  1_499_644_799_999,
];

describe("market-data candles api", () => {
  let app: FastifyInstance;
  let klineCalls: Array<{ symbol: string; interval: string; limit: number }>;
  let klinePayload: unknown;
  let klineError: Error | null;

  const getKlines: GetKlines = async (query) => {
    klineCalls.push(query);

    if (klineError) {
      throw klineError;
    }

    return klinePayload;
  };

  beforeAll(async () => {
    const marketData: MarketDataAccess = {
      getReadySnapshot() {
        return null;
      },
      getFreshMark() {
        return null;
      },
      getFreshBook() {
        return null;
      },
      getStatus() {
        return {
          catalogSyncOk: true,
          catalogSyncedAt: 1,
          marketWsConnected: true,
          publicWsConnected: true,
          readySymbolCount: 0,
        };
      },
    };
    app = await buildApp({ marketData, getKlines });
  });

  afterAll(async () => {
    await app.close();
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
    klineCalls = [];
    klinePayload = [klineRow];
    klineError = null;
  });

  it("returns 401 for unauthenticated candle reads", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
    expect(klineCalls).toEqual([]);
  });

  it("uses interval 15m and limit 500 by default", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(200);
    expect(klineCalls).toEqual([{ symbol: "BTCUSDT", interval: "15m", limit: 500 }]);
    expect(response.json()).toEqual({
      symbol: "BTCUSDT",
      interval: "15m",
      candles: [
        {
          openTime: 1_499_040_000_000,
          closeTime: 1_499_644_799_999,
          open: "0.01634790",
          high: "0.80000000",
          low: "0.01575800",
          close: "0.01577100",
          volume: "148976.11427815",
        },
      ],
    } satisfies CandleListResponse);
  });

  it("accepts every allowed interval", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));

    for (const interval of CANDLE_INTERVALS) {
      klineCalls = [];
      const response = await app.inject({
        method: "GET",
        url: `/api/market-data/BTCUSDT/candles?interval=${interval}`,
        headers: authHeaders(signup),
      });

      expect(response.statusCode).toBe(200);
      expect(klineCalls).toEqual([{ symbol: "BTCUSDT", interval, limit: 500 }]);
      expect((response.json() as CandleListResponse).interval).toBe(interval);
    }
  });

  it("forwards a custom valid limit", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles?interval=5m&limit=12",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(200);
    expect(klineCalls).toEqual([{ symbol: "BTCUSDT", interval: "5m", limit: 12 }]);
  });

  it("preserves OHLCV as strings", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));

    const body = (
      await app.inject({
        method: "GET",
        url: "/api/market-data/BTCUSDT/candles",
        headers: authHeaders(signup),
      })
    ).json() as CandleListResponse;
    const candle = body.candles[0];

    expect(typeof candle?.open).toBe("string");
    expect(typeof candle?.high).toBe("string");
    expect(typeof candle?.low).toBe("string");
    expect(typeof candle?.close).toBe("string");
    expect(typeof candle?.volume).toBe("string");
  });

  it("returns 400 INVALID_QUERY for an invalid interval", async () => {
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?interval=3m");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?interval=1M");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?interval=");
  });

  it("returns 400 INVALID_QUERY for invalid limits", async () => {
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=0");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=-1");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=1.5");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=1501");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=NaN");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=abc");
    await expectInvalidQuery("/api/market-data/BTCUSDT/candles?limit=");
  });

  it("returns 404 for an unknown instrument", async () => {
    const signup = await signUp(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "INSTRUMENT_NOT_FOUND" });
    expect(klineCalls).toEqual([]);
  });

  it("allows a known INACTIVE instrument", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "INACTIVE"));

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(200);
    expect(klineCalls).toEqual([{ symbol: "BTCUSDT", interval: "15m", limit: 500 }]);
  });

  it("returns 503 when Binance times out or errors", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));
    klineError = new BinanceRestError("binance request aborted");

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "MARKET_DATA_UNAVAILABLE",
    } satisfies MarketDataUnavailableError);
    expect(JSON.stringify(response.json())).not.toContain("binance");
    expect(JSON.stringify(response.json())).not.toContain("fapi");
  });

  it("returns 503 when the upstream payload is malformed", async () => {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));
    klinePayload = { not: "an-array" };

    const response = await app.inject({
      method: "GET",
      url: "/api/market-data/BTCUSDT/candles",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "MARKET_DATA_UNAVAILABLE",
    } satisfies MarketDataUnavailableError);
  });

  async function expectInvalidQuery(url: string): Promise<void> {
    const signup = await signUp(app);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT"));
    klineCalls = [];

    const response = await app.inject({
      method: "GET",
      url,
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_QUERY" } satisfies InvalidQueryError);
    expect(klineCalls).toEqual([]);
  }
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
