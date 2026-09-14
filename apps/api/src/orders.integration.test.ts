import type {
  AccountNotInitializedError,
  InvalidQueryError,
  OrderListResponse,
  OrderNotFoundError,
  OrderResponse,
} from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  upsertInstrumentBySymbol,
} from "@notional/db";
import { endTestPool, resetTestTables, setPaperAccountStatusForTests } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const password = "correct-horse-battery";

describe("order api", () => {
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

  it("returns 401 for unauthenticated order reads", async () => {
    const list = await app.inject({ method: "GET", url: "/api/orders" });
    const one = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-4000-8000-000000000001",
    });

    expect(list.statusCode).toBe(401);
    expect(one.statusCode).toBe(401);
    expect(list.json()).toEqual({ error: "Unauthorized" });
    expect(one.json()).toEqual({ error: "Unauthorized" });
  });

  it("requires an Idempotency-Key for public placement and does not accept DELETE", async () => {
    const { cookies } = await initializeUser(app, "no-post@example.com");

    const post = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: authHeadersFromCookie(cookies),
      payload: { type: "MARKET", symbol: "BTCUSDT", side: "BUY", quantity: "1" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/api/orders/00000000-0000-4000-8000-000000000001",
      headers: authHeadersFromCookie(cookies),
    });

    expect(post.statusCode).toBe(400);
    expect(post.json()).toEqual({ error: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(del.statusCode).toBe(404);
  });

  it("rejects uninitialized accounts", async () => {
    const signup = await signUp(app, "uninit-orders@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
  });

  it("lists only the caller's orders newest first with canonical decimal strings", async () => {
    const ada = await initializeUser(app, "ada-orders@example.com");
    const bob = await initializeUser(app, "bob-orders@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const older = await insertOpenLimitOrder(
      db,
      limitInput(ada.accountId, btc.id, {
        quantity: "1.00",
        limitPrice: "65000.10",
        idempotencyKey: "older",
      }),
    );
    const newer = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(ada.accountId, btc.id, {
          quantity: "0.010",
          idempotencyKey: "newer",
        }),
      ),
    );
    await insertOpenLimitOrder(
      db,
      limitInput(bob.accountId, btc.id, { idempotencyKey: "bob" }),
    );

    expect(older.kind).toBe("created");
    expect(newer.kind).toBe("created_filled");
    if (older.kind !== "created" || newer.kind !== "created_filled") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: authHeadersFromCookie(ada.cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as OrderListResponse;
    expect(body.orders.map((row) => row.id)).toEqual([newer.order.id, older.order.id]);
    expect(body.orders[0]).toEqual({
      id: newer.order.id,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.01",
      limitPrice: null,
      reduceOnly: false,
      status: "FILLED",
      createdAt: expect.stringMatching(ISO_PATTERN),
      updatedAt: expect.stringMatching(ISO_PATTERN),
    } satisfies OrderResponse);
    expect(body.orders[1]?.quantity).toBe("1");
    expect(body.orders[1]?.limitPrice).toBe("65000.1");
    expect(JSON.stringify(body)).not.toContain("idempotency");
    expect(JSON.stringify(body)).not.toContain("paperAccount");
    expect(body.orders[0]).not.toHaveProperty("instrumentId");
    expect(body.orders[0]).not.toHaveProperty("paperAccountId");
    expect(body.orders[0]).not.toHaveProperty("idempotencyKey");
  });

  it("does not expose another user's order", async () => {
    const ada = await initializeUser(app, "ada-hidden@example.com");
    const bob = await initializeUser(app, "bob-hidden@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const created = await insertOpenLimitOrder(db, limitInput(ada.accountId, btc.id));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: `/api/orders/${created.order.id}`,
      headers: authHeadersFromCookie(bob.cookies),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "ORDER_NOT_FOUND",
    } satisfies OrderNotFoundError);
  });

  it("returns 404 for an unknown order id and non-uuid path", async () => {
    const { cookies } = await initializeUser(app, "unknown-order@example.com");

    const missing = await app.inject({
      method: "GET",
      url: "/api/orders/00000000-0000-4000-8000-000000000001",
      headers: authHeadersFromCookie(cookies),
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/orders/not-a-uuid",
      headers: authHeadersFromCookie(cookies),
    });

    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "ORDER_NOT_FOUND" });
    expect(invalid.json()).toEqual({ error: "ORDER_NOT_FOUND" });
  });

  it("returns a single own order by id", async () => {
    const { cookies, accountId } = await initializeUser(app, "get-one@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const created = await insertOpenLimitOrder(db, limitInput(accountId, btc.id));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: `/api/orders/${created.order.id}`,
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as OrderResponse;
    expect(body.id).toBe(created.order.id);
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.id).toMatch(UUID_PATTERN);
    expect(body).not.toHaveProperty("idempotencyKey");
  });

  it("paginates newest first", async () => {
    const { cookies, accountId } = await initializeUser(app, "page-orders@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    for (let index = 0; index < 3; index += 1) {
      const created = await insertOpenLimitOrder(
        db,
        limitInput(accountId, btc.id, { idempotencyKey: `page-${index}` }),
      );
      expect(created.kind).toBe("created");
    }

    const all = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: authHeadersFromCookie(cookies),
    });
    const page = await app.inject({
      method: "GET",
      url: "/api/orders?limit=1&offset=1",
      headers: authHeadersFromCookie(cookies),
    });

    expect(all.statusCode).toBe(200);
    expect(page.statusCode).toBe(200);
    const listed = (all.json() as OrderListResponse).orders;
    expect(listed).toHaveLength(3);
    expect((page.json() as OrderListResponse).orders).toEqual([listed[1]]);
  });

  it("filters by status and canonical symbol, and returns empty for an unknown symbol", async () => {
    const { cookies, accountId } = await initializeUser(app, "filter-orders@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    await insertOpenLimitOrder(
      db,
      limitInput(accountId, btc.id, { idempotencyKey: "open-btc" }),
    );
    await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(accountId, eth.id, { idempotencyKey: "filled-eth" }),
      ),
    );

    const open = await app.inject({
      method: "GET",
      url: "/api/orders?status=OPEN",
      headers: authHeadersFromCookie(cookies),
    });
    const btcOnly = await app.inject({
      method: "GET",
      url: "/api/orders?symbol=BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const unknown = await app.inject({
      method: "GET",
      url: "/api/orders?symbol=SOLUSDT",
      headers: authHeadersFromCookie(cookies),
    });

    expect(open.statusCode).toBe(200);
    expect((open.json() as OrderListResponse).orders).toHaveLength(1);
    expect((open.json() as OrderListResponse).orders[0]?.status).toBe("OPEN");
    expect((btcOnly.json() as OrderListResponse).orders).toHaveLength(1);
    expect((btcOnly.json() as OrderListResponse).orders[0]?.symbol).toBe("BTCUSDT");
    expect(unknown.json()).toEqual({ orders: [] });
  });

  it("rejects invalid pagination, status, and non-canonical symbols", async () => {
    const { cookies } = await initializeUser(app, "bad-query@example.com");

    const pagination = await app.inject({
      method: "GET",
      url: "/api/orders?limit=0",
      headers: authHeadersFromCookie(cookies),
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/orders?status=PENDING",
      headers: authHeadersFromCookie(cookies),
    });
    const symbol = await app.inject({
      method: "GET",
      url: "/api/orders?symbol=btcusdt",
      headers: authHeadersFromCookie(cookies),
    });

    expect(pagination.statusCode).toBe(400);
    expect(pagination.json()).toEqual({ error: "INVALID_PAGINATION" });
    expect(status.statusCode).toBe(400);
    expect(status.json()).toEqual({ error: "INVALID_QUERY" } satisfies InvalidQueryError);
    expect(symbol.statusCode).toBe(400);
    expect(symbol.json()).toEqual({ error: "INVALID_QUERY" });
  });

  it("allows a suspended account to read existing orders", async () => {
    const { cookies, accountId } = await initializeUser(app, "suspended-read@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await insertOpenLimitOrder(db, limitInput(accountId, btc.id));
    await setPaperAccountStatusForTests(accountId, "SUSPENDED");

    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as OrderListResponse).orders).toHaveLength(1);
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

function limitInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: {
    quantity?: string;
    limitPrice?: string;
    idempotencyKey?: string;
  } = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: "BUY" as const,
    orderType: "LIMIT" as const,
    quantity: overrides.quantity ?? "0.001",
    limitPrice: overrides.limitPrice ?? "65000",
    reservedMargin: "1",
    idempotencyKey: overrides.idempotencyKey ?? "limit-1",
  };
}

function marketInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: { quantity?: string; idempotencyKey?: string } = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: "BUY" as const,
    orderType: "MARKET" as const,
    quantity: overrides.quantity ?? "0.001",
    executionPrice: "65000",
    idempotencyKey: overrides.idempotencyKey ?? "market-1",
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
