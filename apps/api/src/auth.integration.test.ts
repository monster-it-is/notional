import { account, db, pool, resetAuthTables, session, user } from "@notional/db";
import type { MeResponse } from "@notional/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const password = "correct-horse-battery";

describe("authentication", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetAuthTables();
  });

  it("reports database health", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("signs up a user, persists a session, and returns a UUID user id", async () => {
    const response = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(300);
    expect(cookieHeader(response).length).toBeGreaterThan(0);

    const payload = response.json() as {
      user?: { id?: string; email?: string; password?: unknown };
    };

    expect(payload.user?.id).toMatch(UUID_PATTERN);
    expect(payload.user?.email).toBe("ada@example.com");
    expect(payload).not.toHaveProperty("password");
    expect(payload.user).not.toHaveProperty("password");

    const [dbUser] = await db.select().from(user);
    const sessions = await db.select().from(session);
    const accounts = await db.select().from(account);

    expect(dbUser?.id).toBe(payload.user?.id);
    expect(sessions).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(accounts[0]?.password);
  });

  it("rejects a duplicate signup", async () => {
    await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const duplicate = await signUp(app, {
      name: "Ada Clone",
      email: "ada@example.com",
      password,
    });

    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);
    expect(duplicate.statusCode).toBeLessThan(500);

    const users = await db.select().from(user);
    expect(users).toHaveLength(1);
  });

  it("logs in with valid credentials", async () => {
    await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    await db.delete(session);

    const response = await signIn(app, {
      email: "ada@example.com",
      password,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(300);
    expect(cookieHeader(response).length).toBeGreaterThan(0);

    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(1);
  });

  it("rejects invalid credentials without exposing password details", async () => {
    await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const response = await signIn(app, {
      email: "ada@example.com",
      password: "wrong-password-value",
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.body.toLowerCase()).not.toContain("hash");
    expect(response.body).not.toContain("wrong-password-value");
    expect(response.body.toLowerCase()).not.toMatch(/scrypt|bcrypt|argon/);
  });

  it("returns 401 for unauthenticated /api/me", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns a safe user DTO from authenticated /api/me", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: cookieHeader(signup),
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as MeResponse;

    expect(body.user).toEqual({
      id: expect.stringMatching(UUID_PATTERN),
      email: "ada@example.com",
      name: "Ada Lovelace",
      emailVerified: expect.any(Boolean),
      createdAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(body.user.createdAt))).toBe(false);
    expect(body).not.toHaveProperty("session");
    expect(body.user).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("password");

    const [credential] = await db.select({ password: account.password }).from(account);
    expect(credential?.password).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(credential?.password);
  });

  it("invalidates the session on logout", async () => {
    const signup = await signUp(app, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password,
    });

    const cookies = cookieHeader(signup);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
      },
      payload: {},
    });

    expect(logout.statusCode).toBeGreaterThanOrEqual(200);
    expect(logout.statusCode).toBeLessThan(300);

    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(0);

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
      },
    });

    expect(me.statusCode).toBe(401);
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

async function signIn(
  app: FastifyInstance,
  body: { email: string; password: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: {
      origin: process.env.WEB_ORIGIN,
    },
    payload: body,
  });
}

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
