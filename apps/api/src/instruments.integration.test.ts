import type {
  InstrumentListResponse,
  InstrumentNotFoundError,
  InstrumentResponse,
} from "@notional/contracts";
import { db, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const password = "correct-horse-battery";

describe("instrument api", () => {
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

  it("returns 401 for unauthenticated GET /api/instruments", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 for unauthenticated GET /api/instruments/:symbol", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/instruments/BTCUSDT",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("lists ACTIVE instruments by symbol ASC and omits INACTIVE", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await upsertInstrumentBySymbol(
      db,
      sample("SOLUSDT", "SOL", { status: "INACTIVE" }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as InstrumentListResponse;
    expect(body.instruments.map((row) => row.symbol)).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
    expect(body.instruments[0]).toEqual(
      expect.objectContaining({
        symbol: "BTCUSDT",
        quoteAsset: "USDT",
        contractType: "PERPETUAL",
        status: "ACTIVE",
        tickSize: "0.1",
        minNotional: "5",
      }),
    );
    expect(body.instruments[0]).not.toHaveProperty("createdAt");
    expect(body.instruments[0]).not.toHaveProperty("updatedAt");
  });

  it("returns an empty list when no instruments exist", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/instruments",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ instruments: [] });
  });

  it("returns INACTIVE instruments by symbol and 404 for unknown symbols", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    await upsertInstrumentBySymbol(
      db,
      sample("SOLUSDT", "SOL", { status: "INACTIVE" }),
    );

    const found = await app.inject({
      method: "GET",
      url: "/api/instruments/SOLUSDT",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(found.statusCode).toBe(200);
    const body = found.json() as InstrumentResponse;
    expect(body.symbol).toBe("SOLUSDT");
    expect(body.status).toBe("INACTIVE");
    expect(body).not.toHaveProperty("createdAt");
    expect(body).not.toHaveProperty("updatedAt");

    const missing = await app.inject({
      method: "GET",
      url: "/api/instruments/BTCUSDT",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: "INSTRUMENT_NOT_FOUND",
    } satisfies InstrumentNotFoundError);
  });
});

function sample(
  symbol: string,
  baseAsset: string,
  overrides: { status?: "ACTIVE" | "INACTIVE" } = {},
) {
  return {
    symbol,
    baseAsset,
    status: overrides.status ?? "ACTIVE",
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

async function signUp(
  app: FastifyInstance,
  body: { name: string; email: string; password: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: {
      origin: process.env.WEB_ORIGIN,
    },
    payload: body,
  });
}

function cookieHeader(response: {
  cookies: Array<{ name: string; value: string }>;
}): string {
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
