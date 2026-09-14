import type {
  AccountNotInitializedError,
  ExecutionListResponse,
  ExecutionNotFoundError,
  ExecutionResponse,
  InvalidQueryError,
} from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  upsertInstrumentBySymbol,
} from "@notional/db";
import { endTestPool, resetTestTables, setExecutionExecutedAtUtc } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const password = "correct-horse-battery";

describe("execution api", () => {
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

  it("returns 401 for unauthenticated execution reads", async () => {
    const list = await app.inject({ method: "GET", url: "/api/executions" });
    const one = await app.inject({
      method: "GET",
      url: "/api/executions/00000000-0000-4000-8000-000000000001",
    });

    expect(list.statusCode).toBe(401);
    expect(one.statusCode).toBe(401);
    expect(list.json()).toEqual({ error: "Unauthorized" });
    expect(one.json()).toEqual({ error: "Unauthorized" });
  });

  it("does not register public execution mutation routes", async () => {
    const { cookies } = await initializeUser(app, "no-post-exec@example.com");

    const post = await app.inject({
      method: "POST",
      url: "/api/executions",
      headers: authHeadersFromCookie(cookies),
      payload: { orderId: "00000000-0000-4000-8000-000000000001", price: "100" },
    });

    expect(post.statusCode).toBe(404);
  });

  it("rejects uninitialized accounts", async () => {
    const signup = await signUp(app, "uninit-exec@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeaders(signup),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "ACCOUNT_NOT_INITIALIZED",
    } satisfies AccountNotInitializedError);
  });

  it("lists only the caller's executions newest first with canonical decimals and orderId", async () => {
    const ada = await initializeUser(app, "ada-exec@example.com");
    const bob = await initializeUser(app, "bob-exec@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const older = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(ada.accountId, btc.id, {
          quantity: "1.00",
          executionPrice: "65000.10",
          idempotencyKey: "older",
        }),
      ),
    );
    const newer = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(ada.accountId, btc.id, {
          quantity: "0.010",
          executionPrice: "65100.00",
          idempotencyKey: "newer",
        }),
      ),
    );
    await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(bob.accountId, btc.id, { idempotencyKey: "bob" }),
      ),
    );

    expect(older.kind).toBe("created_filled");
    expect(newer.kind).toBe("created_filled");
    if (older.kind !== "created_filled" || newer.kind !== "created_filled") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeadersFromCookie(ada.cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ExecutionListResponse;
    expect(body.executions.map((row) => row.id)).toEqual([
      newer.execution.id,
      older.execution.id,
    ]);
    expect(body.executions[0]).toEqual({
      id: newer.execution.id,
      orderId: newer.order.id,
      symbol: "BTCUSDT",
      side: "BUY",
      orderType: "MARKET",
      quantity: "0.01",
      price: "65100",
      executedAt: expect.stringMatching(ISO_PATTERN),
    } satisfies ExecutionResponse);
    expect(body.executions[1]?.quantity).toBe("1");
    expect(body.executions[1]?.price).toBe("65000.1");
    expect(JSON.stringify(body)).not.toContain("paperAccount");
    expect(JSON.stringify(body)).not.toContain("instrumentId");
    expect(body.executions[0]).not.toHaveProperty("paperAccountId");
    expect(body.executions[0]).not.toHaveProperty("instrumentId");
  });

  it("does not expose another user's execution", async () => {
    const ada = await initializeUser(app, "ada-hidden-exec@example.com");
    const bob = await initializeUser(app, "bob-hidden-exec@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const created = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, marketInput(ada.accountId, btc.id)),
    );
    expect(created.kind).toBe("created_filled");
    if (created.kind !== "created_filled") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: `/api/executions/${created.execution.id}`,
      headers: authHeadersFromCookie(bob.cookies),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "EXECUTION_NOT_FOUND",
    } satisfies ExecutionNotFoundError);
  });

  it("returns 404 for an unknown execution id and non-uuid path", async () => {
    const { cookies } = await initializeUser(app, "unknown-exec@example.com");

    const missing = await app.inject({
      method: "GET",
      url: "/api/executions/00000000-0000-4000-8000-000000000001",
      headers: authHeadersFromCookie(cookies),
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/executions/not-a-uuid",
      headers: authHeadersFromCookie(cookies),
    });

    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "EXECUTION_NOT_FOUND" });
    expect(invalid.json()).toEqual({ error: "EXECUTION_NOT_FOUND" });
  });

  it("returns a single own execution by id", async () => {
    const { cookies, accountId } = await initializeUser(app, "get-one-exec@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const created = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, marketInput(accountId, btc.id)),
    );
    expect(created.kind).toBe("created_filled");
    if (created.kind !== "created_filled") {
      return;
    }

    const response = await app.inject({
      method: "GET",
      url: `/api/executions/${created.execution.id}`,
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as ExecutionResponse;
    expect(body.id).toBe(created.execution.id);
    expect(body.orderId).toBe(created.order.id);
    expect(body.symbol).toBe("BTCUSDT");
    expect(body.id).toMatch(UUID_PATTERN);
    expect(body).not.toHaveProperty("paperAccountId");
  });

  it("paginates newest first and filters by symbol and orderId", async () => {
    const { cookies, accountId } = await initializeUser(app, "page-exec@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));

    const first = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(accountId, btc.id, { idempotencyKey: "btc-1" }),
      ),
    );
    await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        marketInput(accountId, eth.id, { idempotencyKey: "eth-1" }),
      ),
    );
    expect(first.kind).toBe("created_filled");
    if (first.kind !== "created_filled") {
      return;
    }

    const all = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeadersFromCookie(cookies),
    });
    const page = await app.inject({
      method: "GET",
      url: "/api/executions?limit=1&offset=1",
      headers: authHeadersFromCookie(cookies),
    });
    const btcOnly = await app.inject({
      method: "GET",
      url: "/api/executions?symbol=BTCUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const byOrder = await app.inject({
      method: "GET",
      url: `/api/executions?orderId=${first.order.id}`,
      headers: authHeadersFromCookie(cookies),
    });
    const unknown = await app.inject({
      method: "GET",
      url: "/api/executions?symbol=SOLUSDT",
      headers: authHeadersFromCookie(cookies),
    });
    const openOrder = await insertOpenLimitOrder(
      db,
      limitInput(accountId, btc.id, { idempotencyKey: "still-open" }),
    );
    expect(openOrder.kind).toBe("created");
    const openFilter = await app.inject({
      method: "GET",
      url: `/api/executions?orderId=${openOrder.kind === "created" ? openOrder.order.id : ""}`,
      headers: authHeadersFromCookie(cookies),
    });

    expect(all.statusCode).toBe(200);
    const listed = (all.json() as ExecutionListResponse).executions;
    expect(listed).toHaveLength(2);
    expect((page.json() as ExecutionListResponse).executions).toEqual([listed[1]]);
    expect((btcOnly.json() as ExecutionListResponse).executions).toHaveLength(1);
    expect((btcOnly.json() as ExecutionListResponse).executions[0]?.symbol).toBe("BTCUSDT");
    expect((byOrder.json() as ExecutionListResponse).executions).toHaveLength(1);
    expect((byOrder.json() as ExecutionListResponse).executions[0]?.orderId).toBe(
      first.order.id,
    );
    expect(unknown.json()).toEqual({ executions: [] });
    expect(openFilter.json()).toEqual({ executions: [] });
  });

  it("rejects invalid pagination and query filters", async () => {
    const { cookies } = await initializeUser(app, "bad-exec-query@example.com");

    const pagination = await app.inject({
      method: "GET",
      url: "/api/executions?limit=0",
      headers: authHeadersFromCookie(cookies),
    });
    const symbol = await app.inject({
      method: "GET",
      url: "/api/executions?symbol=btcusdt",
      headers: authHeadersFromCookie(cookies),
    });
    const orderId = await app.inject({
      method: "GET",
      url: "/api/executions?orderId=not-a-uuid",
      headers: authHeadersFromCookie(cookies),
    });

    expect(pagination.statusCode).toBe(400);
    expect(pagination.json()).toEqual({ error: "INVALID_PAGINATION" });
    expect(symbol.statusCode).toBe(400);
    expect(symbol.json()).toEqual({ error: "INVALID_QUERY" } satisfies InvalidQueryError);
    expect(orderId.statusCode).toBe(400);
    expect(orderId.json()).toEqual({ error: "INVALID_QUERY" });
  });

  it("emits a known UTC-naive executed_at as an unshifted ISO UTC timestamp", async () => {
    const { cookies, accountId } = await initializeUser(app, "tz-exec@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const created = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, marketInput(accountId, btc.id)),
    );
    expect(created.kind).toBe("created_filled");
    if (created.kind !== "created_filled") {
      return;
    }

    await setExecutionExecutedAtUtc(created.execution.id, "2024-06-15 12:30:00");

    const response = await app.inject({
      method: "GET",
      url: `/api/executions/${created.execution.id}`,
      headers: authHeadersFromCookie(cookies),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as ExecutionResponse).executedAt).toBe(
      "2024-06-15T12:30:00.000Z",
    );
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

function marketInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: { quantity?: string; executionPrice?: string; idempotencyKey?: string } = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: "BUY" as const,
    orderType: "MARKET" as const,
    quantity: overrides.quantity ?? "0.001",
    executionPrice: overrides.executionPrice ?? "65000",
    idempotencyKey: overrides.idempotencyKey ?? "market-1",
  };
}

function limitInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: { idempotencyKey?: string } = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: "BUY" as const,
    orderType: "LIMIT" as const,
    quantity: "0.001",
    limitPrice: "65000",
    idempotencyKey: overrides.idempotencyKey ?? "limit-1",
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
