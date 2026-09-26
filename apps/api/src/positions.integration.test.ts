import type {
  AccountNotInitializedError,
  PositionListResponse,
  PositionNotFoundError,
  PositionResponse,
} from "@notional/contracts";
import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  insertFilledOrderWithExecution,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  updateMarginSettingsForFlatPosition,
} from "@notional/db";
import { endTestPool, resetTestTables, setPaperAccountStatusForTests } from "@notional/db/test";
import { calculateUnrealizedPnl } from "@notional/trading";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { MarketDataAccess } from "./market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "./market-data/market-data-store.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./services/funding-test-fixtures.js";
import { applyPositionForFillResult } from "./services/position-application.js";

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const password = "correct-horse-battery";

describe("position api", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("returns 401 for unauthenticated position reads", async () => {
    const list = await app.inject({ method: "GET", url: "/api/positions" });
    const one = await app.inject({
      method: "GET",
      url: "/api/positions/BTCUSDT",
    });

    expect(list.statusCode).toBe(401);
    expect(one.statusCode).toBe(401);
    expect(list.json()).toEqual({ error: "Unauthorized" });
    expect(one.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not register public position mutation routes", async () => {
    const { cookies } = await initializeUser(app, "no-post-pos@example.com");

    const post = await app.inject({
      method: "POST",
      url: "/api/positions",
      headers: authHeadersFromCookie(cookies),
      payload: { symbol: "BTCUSDT", quantity: "1" },
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/positions/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { quantity: "1" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/api/positions/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(post.statusCode).toBe(404);
    expect(put.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
  });

  it("rejects uninitialized accounts", async () => {
    const signup = await signUp(app, "uninit-pos@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
  });

  it("lists only the caller's open positions with signed canonical decimals", async () => {
    const ada = await initializeUser(app, "ada-pos@example.com");
    const bob = await initializeUser(app, "bob-pos@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));

    await openPosition(ada.accountId, btc.id, {
      side: "BUY",
      quantity: "0.500",
      executionPrice: "65000.10",
      idempotencyKey: "ada-btc",
    });
    await openPosition(ada.accountId, eth.id, {
      side: "SELL",
      quantity: "1.250",
      executionPrice: "3000.00",
      idempotencyKey: "ada-eth",
    });
    await openPosition(bob.accountId, btc.id, {
      quantity: "9",
      executionPrice: "1",
      idempotencyKey: "bob-btc",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: authHeadersFromCookie(ada.cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as PositionListResponse;
    expect(body.positions.map((row) => row.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(body.positions[0]).toEqual({
      symbol: "BTCUSDT",
      quantity: "0.5",
      entryPrice: "65000.1",
      markPrice: null,
      unrealizedPnl: null,
      cumulativeRealizedPnl: "0",
      marginMode: "CROSS",
      leverage: 1,
      updatedAt: expect.stringMatching(ISO_PATTERN),
    } satisfies PositionResponse);
    expect(body.positions[1]?.quantity).toBe("-1.25");
    expect(body.positions[1]?.entryPrice).toBe("3000");
    expect(body.positions[1]?.markPrice).toBeNull();
    expect(body.positions[1]?.unrealizedPnl).toBeNull();
    expect(JSON.stringify(body)).not.toContain(ada.accountId);
    expect(JSON.stringify(body)).not.toContain(btc.id);
    expect(JSON.stringify(body)).not.toMatch(/"id":/);
  });

  it("omits persistent flat rows from the open list and 404s symbol lookup", async () => {
    const { cookies, accountId } = await initializeUser(app, "flat-pos@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await db.transaction((tx) => ensurePosition(tx, accountId, btc.id));

    const list = await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: authHeadersFromCookie(cookies),
    });
    const one = await app.inject({
      method: "GET",
      url: "/api/positions/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ positions: [] });
    expect(one.statusCode).toBe(404);
    expect(one.json()).toEqual({ error: "POSITION_NOT_FOUND" } satisfies PositionNotFoundError);
  });

  it("returns an open position by canonical symbol", async () => {
    const { cookies, accountId } = await initializeUser(app, "one-pos@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await openPosition(accountId, btc.id, {
      quantity: "1.00",
      executionPrice: "100",
      idempotencyKey: "one",
    });

    const found = await app.inject({
      method: "GET",
      url: "/api/positions/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/positions/ETHUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const lowercase = await app.inject({
      method: "GET",
      url: "/api/positions/btcusdt",
      headers: authHeadersFromCookie(cookies),
    });

    expect(found.statusCode).toBe(200);
    expect((found.json() as PositionResponse).quantity).toBe("1");
    expect((found.json() as PositionResponse).cumulativeRealizedPnl).toBe("0");
    expect(missing.statusCode).toBe(404);
    expect(lowercase.statusCode).toBe(404);
  });

  it("exposes cumulative realized pnl after close and reopen", async () => {
    const { cookies, accountId } = await initializeUser(app, "pnl-pos@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    await openPosition(accountId, btc.id, {
      quantity: "1",
      executionPrice: "100",
      idempotencyKey: "pnl-open",
    });
    await openPosition(accountId, btc.id, {
      side: "SELL",
      quantity: "1",
      executionPrice: "130",
      idempotencyKey: "pnl-close",
    });
    await openPosition(accountId, btc.id, {
      quantity: "1",
      executionPrice: "200",
      idempotencyKey: "pnl-reopen",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/positions/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as PositionResponse).cumulativeRealizedPnl).toBe("30");
    expect((response.json() as PositionResponse).quantity).toBe("1");
    expect((response.json() as PositionResponse).entryPrice).toBe("200");
  });

  it("allows a suspended account to read existing positions", async () => {
    const { cookies, accountId } = await initializeUser(app, "suspended-pos@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await openPosition(accountId, btc.id, { quantity: "1", executionPrice: "100" });
    await setPaperAccountStatusForTests(accountId, "SUSPENDED");

    const response = await app.inject({
      method: "GET",
      url: "/api/positions",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as PositionListResponse).positions).toHaveLength(1);
  });

  it("returns fresh long mark and server-computed unrealized pnl", async () => {
    await withMarketApp(
      (store) => {
        seedMark(store, "BTCUSDT", "110");
      },
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "long-mark@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "long-mark",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions/BTCUSDT",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionResponse;
        expect(body.quantity).toBe("1");
        expect(body.entryPrice).toBe("100");
        expect(body.markPrice).toBe("110");
        expect(body.unrealizedPnl).toBe(
          calculateUnrealizedPnl({
            positionQty: "1",
            entryPrice: "100",
            markPrice: "110",
          }),
        );
      },
    );
  });

  it("returns fresh short mark with the helper's pnl sign", async () => {
    await withMarketApp(
      (store) => {
        seedMark(store, "BTCUSDT", "110");
      },
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "short-mark@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        await openPosition(accountId, btc.id, {
          side: "SELL",
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "short-mark",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions/BTCUSDT",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionResponse;
        expect(body.quantity).toBe("-1");
        expect(body.markPrice).toBe("110");
        expect(body.unrealizedPnl).toBe(
          calculateUnrealizedPnl({
            positionQty: "-1",
            entryPrice: "100",
            markPrice: "110",
          }),
        );
      },
    );
  });

  it("keeps HTTP 200 when one listed mark is fresh and another is stale", async () => {
    await withMarketApp(
      (store) => {
        seedMark(store, "BTCUSDT", "110", 70_000);
        seedMark(store, "ETHUSDT", "3200", 1);
      },
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "mixed-mark@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "mixed-btc",
        });
        await openPosition(accountId, eth.id, {
          quantity: "1",
          executionPrice: "3000",
          idempotencyKey: "mixed-eth",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionListResponse;
        const btcRow = body.positions.find((row) => row.symbol === "BTCUSDT");
        const ethRow = body.positions.find((row) => row.symbol === "ETHUSDT");
        expect(btcRow?.markPrice).toBe("110");
        expect(btcRow?.unrealizedPnl).toBe(
          calculateUnrealizedPnl({
            positionQty: "1",
            entryPrice: "100",
            markPrice: "110",
          }),
        );
        expect(ethRow?.markPrice).toBeNull();
        expect(ethRow?.unrealizedPnl).toBeNull();
      },
      { now: 70_000 },
    );
  });

  it("returns the persisted position with null mark metrics when the symbol mark is missing", async () => {
    await withMarketApp(
      () => undefined,
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "missing-mark@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "missing-mark",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions/BTCUSDT",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionResponse;
        expect(body.symbol).toBe("BTCUSDT");
        expect(body.quantity).toBe("1");
        expect(body.entryPrice).toBe("100");
        expect(body.markPrice).toBeNull();
        expect(body.unrealizedPnl).toBeNull();
      },
    );
  });

  it("maps persisted margin mode and leverage onto the position response", async () => {
    await withMarketApp(
      () => undefined,
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "margin-pos@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        await db.transaction(async (tx) => {
          await lockPaperAccountById(tx, accountId);
          await ensurePosition(tx, accountId, btc.id);
          const position = await lockPositionByAccountAndInstrument(tx, accountId, btc.id);
          await updateMarginSettingsForFlatPosition(tx, position.id, {
            marginMode: "ISOLATED",
            leverage: 20,
          });
        });
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "margin-pos",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions/BTCUSDT",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionResponse;
        expect(body.marginMode).toBe("ISOLATED");
        expect(body.leverage).toBe(20);
      },
    );
  });

  it("keeps cumulative realized pnl unchanged when mark metrics are present", async () => {
    await withMarketApp(
      (store) => {
        seedMark(store, "BTCUSDT", "210");
      },
      async (marketApp) => {
        const { cookies, accountId } = await initializeUser(marketApp, "cum-pnl@example.com");
        const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "cum-open",
        });
        await openPosition(accountId, btc.id, {
          side: "SELL",
          quantity: "1",
          executionPrice: "130",
          idempotencyKey: "cum-close",
        });
        await openPosition(accountId, btc.id, {
          quantity: "1",
          executionPrice: "200",
          idempotencyKey: "cum-reopen",
        });

        const response = await marketApp.inject({
          method: "GET",
          url: "/api/positions/BTCUSDT",
          headers: authHeadersFromCookie(cookies),
        });

        expect(response.statusCode).toBe(200);
        const body = response.json() as PositionResponse;
        expect(body.cumulativeRealizedPnl).toBe("30");
        expect(body.quantity).toBe("1");
        expect(body.entryPrice).toBe("200");
        expect(body.markPrice).toBe("210");
        expect(body.unrealizedPnl).toBe(
          calculateUnrealizedPnl({
            positionQty: "1",
            entryPrice: "200",
            markPrice: "210",
          }),
        );
      },
    );
  });
});

async function openPosition(
  paperAccountId: string,
  instrumentId: string,
  overrides: {
    side?: "BUY" | "SELL";
    quantity?: string;
    executionPrice?: string;
    idempotencyKey?: string;
  } = {},
) {
  return db.transaction(async (tx) => {
    await lockPaperAccountById(tx, paperAccountId);
    await ensurePosition(tx, paperAccountId, instrumentId);
    const position = await lockPositionByAccountAndInstrument(tx, paperAccountId, instrumentId);
    const fill = await insertFilledOrderWithExecution(tx, {
      paperAccountId,
      instrumentId,
      side: overrides.side ?? "BUY",
      orderType: "MARKET",
      quantity: overrides.quantity ?? "0.001",
      executionPrice: overrides.executionPrice ?? "65000",
      idempotencyKey: overrides.idempotencyKey ?? "pos-fill",
    });
    if (fill.kind !== "created_filled" && fill.kind !== "replayed_filled") {
      throw new Error(`unexpected fill kind ${fill.kind}`);
    }
    return applyPositionForFillResult(tx, position, fill);
  });
}

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

async function initializeUser(app: FastifyInstance, email: string) {
  const signup = await signUp(app, email);
  const cookies = cookieHeader(signup);
  const initialized = await app.inject({
    method: "POST",
    url: "/api/account/initialize",
    headers: authHeadersFromCookie(cookies),
  });
  expect(initialized.statusCode).toBe(200);
  const account = await findPaperAccountByUserId(
    db,
    (signup.json() as { user: { id: string } }).user.id,
  );

  if (!account) {
    throw new Error("expected initialized paper account");
  }

  return { cookies, accountId: account.id };
}

async function signUp(app: FastifyInstance, email: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin: process.env.WEB_ORIGIN,
    },
    payload: {
      name: "Ada Lovelace",
      email,
      password,
    },
  });
}

function authHeaders(response: { cookies: Array<{ name: string; value: string }> }) {
  return authHeadersFromCookie(cookieHeader(response));
}

function authHeadersFromCookie(cookie: string) {
  return {
    cookie,
    origin: process.env.WEB_ORIGIN,
  };
}

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }) {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function withMarketApp(
  seed: (store: MarketDataStore) => void,
  run: (marketApp: FastifyInstance) => Promise<void>,
  options: { now?: number } = {},
) {
  const now = options.now ?? 1_000;
  const store = createMarketDataStore({ now: () => now });
  seed(store);
  const marketApp = await buildApp({ marketData: accessFromStore(store) });
  try {
    await run(marketApp);
  } finally {
    await marketApp.close();
  }
}

function accessFromStore(store: MarketDataStore): MarketDataAccess {
  return {
    getFreshMark(symbol) {
      return store.getFreshMark(symbol, 60_000);
    },
    getFreshBook(symbol) {
      return store.getFreshBook(symbol, 60_000);
    },
    getReadySnapshot() {
      return null;
    },
    getStatus() {
      return {
        catalogSyncOk: true,
        catalogSyncedAt: 1,
        marketWsConnected: true,
        publicWsConnected: true,
        readySymbolCount: 1,
      };
    },
  };
}

function seedMark(store: MarketDataStore, symbol: string, markPrice: string, receivedAt = 1_000) {
  store.applyMark(
    {
      symbol,
      markPrice,
      indexPrice: markPrice,
      fundingRate: "0",
      nextFundingTime: 1,
      markEventTime: receivedAt,
    },
    receivedAt,
  );
}
