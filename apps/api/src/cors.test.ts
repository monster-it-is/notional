import { afterAll, describe, expect, it } from "vitest";
import { endTestPool } from "@notional/db/test";

import { buildApp } from "./app.js";
import { env } from "./env.js";

afterAll(async () => {
  await endTestPool();
});

describe("CORS", () => {
  it("reflects the configured WEB_ORIGIN and rejects untrusted origins", async () => {
    const app = await buildApp();

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: env.WEB_ORIGIN },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/account",
      headers: {
        origin: env.WEB_ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");

    const evil = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
    expect(evil.headers["access-control-allow-origin"]).not.toBe("https://evil.example");

    const evilPreflight = await app.inject({
      method: "OPTIONS",
      url: "/api/account",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET",
      },
    });
    expect(evilPreflight.headers["access-control-allow-origin"]).not.toBe(
      "https://evil.example",
    );

    await app.close();
  });
});
