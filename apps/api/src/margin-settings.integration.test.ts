import type {
  AccountNotInitializedError,
  AccountSuspendedError,
  InstrumentInactiveError,
  InstrumentNotFoundError,
  InvalidMarginSettingsError,
  MarginSettingsResponse,
  OpenOrdersExistError,
  PositionNotFlatError,
} from "@notional/contracts";
import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  tradingPosition,
} from "@notional/db";
import { endTestPool, resetTestTables, setPaperAccountStatusForTests } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./services/funding-test-fixtures.js";
import { applyPositionForFillResult } from "./services/position-application.js";

const password = "correct-horse-battery";

describe("margin settings api", () => {
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

  it("returns 401 for unauthenticated margin settings", async () => {
    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      payload: { marginMode: "CROSS", leverage: 1 },
    });

    expect(get.statusCode).toBe(401);
    expect(put.statusCode).toBe(401);
    expect(get.json()).toEqual({ error: "Unauthorized" });
    expect(put.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects uninitialized accounts", async () => {
    const signup = await signUp(app, "uninit-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(signup),
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(signup),
      payload: { marginMode: "CROSS", leverage: 5 },
    });

    expect(get.statusCode).toBe(409);
    expect(put.statusCode).toBe(409);
    expect(get.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
    expect(put.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
  });

  it("returns 404 for an unknown instrument", async () => {
    const { cookies } = await initializeUser(app, "unknown-margin@example.com");

    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "CROSS", leverage: 5 },
    });
    const lowercase = await app.inject({
      method: "GET",
      url: "/api/margin-settings/btcusdt",
      headers: authHeadersFromCookie(cookies),
    });

    expect(get.statusCode).toBe(404);
    expect(put.statusCode).toBe(404);
    expect(lowercase.statusCode).toBe(404);
    expect(get.json()).toEqual({
      error: "INSTRUMENT_NOT_FOUND",
    } satisfies InstrumentNotFoundError);
  });

  it("returns CROSS/1 defaults without inserting a position row", async () => {
    const { cookies, accountId } = await initializeUser(app, "default-margin@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const response = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 1,
    } satisfies MarginSettingsResponse);
    expect(await findPositionByAccountAndInstrument(db, accountId, btc.id)).toBeNull();
    expect(await db.select().from(tradingPosition)).toHaveLength(0);
    expect(JSON.stringify(response.json())).not.toContain(accountId);
    expect(response.json()).not.toHaveProperty("isolatedMargin");
  });

  it("returns stored settings for an existing row", async () => {
    const { cookies } = await initializeUser(app, "stored-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "ISOLATED", leverage: 20 },
    });
    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(put.statusCode).toBe(200);
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "ISOLATED",
      leverage: 20,
    } satisfies MarginSettingsResponse);
  });

  it("allows a suspended account to read settings", async () => {
    const { cookies, accountId } = await initializeUser(app, "suspended-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "CROSS", leverage: 7 },
    });
    await setPaperAccountStatusForTests(accountId, "SUSPENDED");

    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "ISOLATED", leverage: 8 },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 7,
    } satisfies MarginSettingsResponse);
    expect(put.statusCode).toBe(409);
    expect(put.json()).toEqual({
      error: "ACCOUNT_SUSPENDED",
    } satisfies AccountSuspendedError);
  });

  it("allows GET and rejects PUT for an INACTIVE instrument", async () => {
    const { cookies } = await initializeUser(app, "inactive-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));

    const get = await app.inject({
      method: "GET",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "CROSS", leverage: 3 },
    });

    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 1,
    } satisfies MarginSettingsResponse);
    expect(put.statusCode).toBe(409);
    expect(put.json()).toEqual({
      error: "INSTRUMENT_INACTIVE",
    } satisfies InstrumentInactiveError);
  });

  it("rejects malformed PUT bodies with strict validation", async () => {
    const { cookies } = await initializeUser(app, "invalid-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const headers = authHeadersFromCookie(cookies);

    const mode = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "HEDGE", leverage: 10 },
    });
    const low = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: 0 },
    });
    const high = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: 101 },
    });
    const asString = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: "10" },
    });
    const fractional = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: 10.5 },
    });
    const extra = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: 10, extra: true },
    });
    const isolatedMargin = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers,
      payload: { marginMode: "CROSS", leverage: 10, isolatedMargin: "999" },
    });

    expect(mode.statusCode).toBe(400);
    expect(mode.json()).toEqual({
      error: "INVALID_MARGIN_SETTINGS",
      reason: "INVALID_MARGIN_MODE",
    } satisfies InvalidMarginSettingsError);
    expect(low.statusCode).toBe(400);
    expect(high.statusCode).toBe(400);
    expect(asString.statusCode).toBe(400);
    expect(fractional.statusCode).toBe(400);
    expect(asString.json()).toEqual({
      error: "INVALID_MARGIN_SETTINGS",
      reason: "INVALID_LEVERAGE",
    } satisfies InvalidMarginSettingsError);
    expect(extra.statusCode).toBe(400);
    expect(isolatedMargin.statusCode).toBe(400);
    expect(isolatedMargin.json()).toEqual({
      error: "INVALID_MARGIN_SETTINGS",
      reason: "UNEXPECTED_FIELD",
    } satisfies InvalidMarginSettingsError);
  });

  it("creates and updates a flat row without leaking ids", async () => {
    const { cookies, accountId } = await initializeUser(app, "put-margin@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const created = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "ISOLATED", leverage: 15 },
    });
    const updated = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "CROSS", leverage: 4 },
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "ISOLATED",
      leverage: 15,
    } satisfies MarginSettingsResponse);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 4,
    } satisfies MarginSettingsResponse);

    const row = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(row?.quantity).toBe("0");
    expect(row?.isolatedMargin).toBe("0");
    expect(JSON.stringify(created.json())).not.toContain(accountId);
    expect(JSON.stringify(created.json())).not.toContain(btc.id);
    expect(created.json()).not.toHaveProperty("id");
    expect(created.json()).not.toHaveProperty("isolatedMargin");
  });

  it("rejects settings mutation on a non-flat position", async () => {
    const { cookies, accountId } = await initializeUser(app, "open-margin@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await openCrossPosition(accountId, btc.id);

    const response = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "ISOLATED", leverage: 10 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "POSITION_NOT_FLAT",
    } satisfies PositionNotFlatError);
  });

  it("rejects settings mutation while an OPEN order exists for the symbol", async () => {
    const { cookies, accountId } = await initializeUser(app, "open-order-margin@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await insertOpenLimitOrder(db, {
      paperAccountId: accountId,
      instrumentId: btc.id,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "0.1",
      limitPrice: "90",
      reservedMargin: "9",
      idempotencyKey: "open-settings",
    });
    expect(resting.kind).toBe("created");

    const response = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeadersFromCookie(cookies),
      payload: { marginMode: "CROSS", leverage: 10 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "OPEN_ORDERS_EXIST",
    } satisfies OpenOrdersExistError);
  });
});

async function openCrossPosition(paperAccountId: string, instrumentId: string) {
  return db.transaction(async (tx) => {
    await lockPaperAccountById(tx, paperAccountId);
    await ensurePosition(tx, paperAccountId, instrumentId);
    const position = await lockPositionByAccountAndInstrument(tx, paperAccountId, instrumentId);
    const fill = await insertFilledOrderWithExecution(tx, {
      paperAccountId,
      instrumentId,
      side: "BUY",
      orderType: "MARKET",
      quantity: "1",
      executionPrice: "100",
      idempotencyKey: "open-for-settings",
    });
    if (fill.kind !== "created_filled" && fill.kind !== "replayed_filled") {
      throw new Error(`unexpected fill kind ${fill.kind}`);
    }
    return applyPositionForFillResult(tx, position, fill);
  });
}

function sample(
  symbol: string,
  baseAsset: string,
  overrides: { status?: "ACTIVE" | "INACTIVE" } = {},
) {
  return {
    symbol,
    baseAsset,
    status: overrides.status ?? ("ACTIVE" as const),
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
