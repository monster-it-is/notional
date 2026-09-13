import { db, paperAccount } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { AccountResponse } from "@notional/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ZERO_DECIMAL = /^0(?:\.0+)?$/;

const password = "correct-horse-battery";

describe("paper account api", () => {
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

  it("returns 401 for unauthenticated /api/account", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/account",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns a safe account DTO from authenticated /api/account", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const signupBody = signup.json() as { user?: { id?: string } };

    const response = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as AccountResponse;

    expect(body).toEqual({
      id: expect.stringMatching(UUID_PATTERN),
      userId: signupBody.user?.id,
      currency: "USDT",
      balance: expect.stringMatching(ZERO_DECIMAL),
      status: "ACTIVE",
      lastFaucetClaimAt: null,
      createdAt: expect.any(String),
    });
    expect(typeof body.balance).toBe("string");
    expect(body.balance).not.toBe("1000");
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    expect(body).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("password");

    const rows = await db.select().from(paperAccount);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(body.id);
    expect(typeof rows[0]?.balance).toBe("string");
  });

  it("returns the same account id on repeated authenticated GET", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const cookies = cookieHeader(signup);

    const first = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    const second = await app.inject({
      method: "GET",
      url: "/api/account",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstBody = first.json() as AccountResponse;
    const secondBody = second.json() as AccountResponse;

    expect(secondBody.id).toBe(firstBody.id);

    const rows = await db.select().from(paperAccount);
    expect(rows).toHaveLength(1);
  });
});

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
