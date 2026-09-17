import { afterAll, afterEach, describe, expect, it } from "vitest";
import { endTestPool, resetTestTables } from "@notional/db/test";

import { buildApp } from "./app.js";
import {
  resetRateLimitPolicyForTests,
  setRateLimitPolicyForTests,
} from "./rate-limit.js";

const password = "correct-horse-battery-staple";

afterAll(async () => {
  await endTestPool();
});

afterEach(() => {
  resetRateLimitPolicyForTests();
});

describe("rate limits", () => {
  it("separates signup and signin IP buckets", async () => {
    setRateLimitPolicyForTests({
      signupMax: 1,
      signupWindowMs: 60_000,
      signinMax: 5,
      signinWindowMs: 60_000,
    });
    const app = await buildApp({ enableRateLimit: true });
    await resetTestTables();

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: { name: "Ada", email: "ada@example.com", password },
    });
    expect(first.statusCode).toBeLessThan(300);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: { name: "Ada", email: "ada2@example.com", password },
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "RATE_LIMITED" });

    const signin = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: { email: "ada@example.com", password },
    });
    expect(signin.statusCode).toBeLessThan(300);
    await app.close();
  });

  it("keys authenticated trading limits by user id", async () => {
    setRateLimitPolicyForTests({
      ordersMax: 1,
      ordersWindowMs: 60_000,
      readsMax: 100,
      readsWindowMs: 60_000,
    });
    const app = await buildApp({ enableRateLimit: true });
    await resetTestTables();

    const ada = await signUp(app, "ada@example.com");
    const alonzo = await signUp(app, "alonzo@example.com");

    const first = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        cookie: cookieHeader(ada),
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "11111111-1111-1111-1111-111111111111",
      },
      payload: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: "0.001",
      },
    });
    expect(first.statusCode).not.toBe(429);

    const adaBlocked = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        cookie: cookieHeader(ada),
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "22222222-2222-2222-2222-222222222222",
      },
      payload: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: "0.001",
      },
    });
    expect(adaBlocked.statusCode).toBe(429);
    expect(adaBlocked.json()).toEqual({ error: "RATE_LIMITED" });

    const alonzoAttempt = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        cookie: cookieHeader(alonzo),
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "33333333-3333-3333-3333-333333333333",
      },
      payload: {
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quantity: "0.001",
      },
    });
    expect(alonzoAttempt.statusCode).not.toBe(429);
    await app.close();
  });

  it("exhausts the sign-in IP bucket independently of signup", async () => {
    setRateLimitPolicyForTests({
      signupMax: 5,
      signupWindowMs: 60_000,
      signinMax: 1,
      signinWindowMs: 60_000,
    });
    const app = await buildApp({ enableRateLimit: true });
    await resetTestTables();

    const signup = await signUp(app, "ada@example.com");
    expect(signup.statusCode).toBeLessThan(300);

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: { email: "ada@example.com", password },
    });
    expect(first.statusCode).toBeLessThan(300);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: process.env.WEB_ORIGIN },
      payload: { email: "ada@example.com", password },
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: "RATE_LIMITED" });
    await app.close();
  });

  it("returns 401 for unauthenticated orders without running the user limiter", async () => {
    setRateLimitPolicyForTests({
      ordersMax: 1,
      ordersWindowMs: 60_000,
    });
    const app = await buildApp({ enableRateLimit: true });
    await resetTestTables();

    const payload = {
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.001",
    };
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "44444444-4444-4444-4444-444444444444",
      },
      payload,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toEqual({ error: "Unauthorized" });

    const ada = await signUp(app, "ada@example.com");
    const first = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        cookie: cookieHeader(ada),
        origin: process.env.WEB_ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "55555555-5555-5555-5555-555555555555",
      },
      payload,
    });
    expect(first.statusCode).not.toBe(429);
    expect(first.statusCode).not.toBe(401);
    await app.close();
  });

  it("does not rate-limit health or ready", async () => {
    setRateLimitPolicyForTests({ readsMax: 1, readsWindowMs: 60_000 });
    const app = await buildApp({ enableRateLimit: true });
    for (let i = 0; i < 5; i += 1) {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      const ready = await app.inject({ method: "GET", url: "/ready" });
      expect(ready.statusCode).not.toBe(429);
    }
    await app.close();
  });
});

async function signUp(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { name: "Trader", email, password },
  });
}

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }): string {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
