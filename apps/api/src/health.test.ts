import { PassThrough } from "node:stream";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { endTestPool } from "@notional/db/test";
import Fastify from "fastify";
import helmet from "@fastify/helmet";

import { buildApp, helmetOptions, JSON_BODY_LIMIT_BYTES } from "./app.js";
import { errorLooksSafe } from "./error-handler.js";
import {
  beginShutdownStatus,
  markRuntimeReady,
  resetRuntimeStatusForTests,
} from "./runtime-status.js";
import { unavailableMarketDataAccess } from "./market-data/coordinator.js";

afterAll(async () => {
  await endTestPool();
});

afterEach(() => {
  resetRuntimeStatusForTests();
});

describe("health and readiness", () => {
  it("serves liveness without querying the database", async () => {
    let checks = 0;
    const app = await buildApp({
      databaseHealthCheck: async () => {
        checks += 1;
        throw new Error("postgresql://user:password@db.internal/notional select 1 /var/lib/postgresql");
      },
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(checks).toBe(0);
    await app.close();
  });

  it("is not ready before startup completes and not ready after shutdown starts", async () => {
    const app = await buildApp();
    const before = await app.inject({ method: "GET", url: "/ready" });
    expect(before.statusCode).toBe(503);
    expect(before.json()).toEqual({ status: "not_ready" });
    expect(JSON.stringify(before.json()).toLowerCase()).not.toContain("postgres");

    markRuntimeReady();
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ok" });

    beginShutdownStatus();
    const draining = await app.inject({ method: "GET", url: "/ready" });
    expect(draining.statusCode).toBe(503);
    expect(draining.json()).toEqual({ status: "not_ready" });
    await app.close();
  });

  it("returns 503 from /ready without leaking a database failure", async () => {
    const app = await buildApp({
      databaseHealthCheck: async () => {
        throw new Error("postgresql://user:password@db.internal/notional select 1 /var/lib/postgresql");
      },
    });
    markRuntimeReady();
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "not_ready" });
    expect(ready.body.toLowerCase()).not.toContain("postgres");
    expect(ready.body.toLowerCase()).not.toContain("password");
    expect(ready.body.toLowerCase()).not.toContain("stack");
    expect(ready.body.toLowerCase()).not.toContain("select ");
    expect(ready.body).not.toContain("/var/lib");
    await app.close();
  });

  it("does not gate global readiness on Binance market-data freshness", async () => {
    const app = await buildApp({
      databaseHealthCheck: async () => ({ ok: true }),
      marketData: {
        ...unavailableMarketDataAccess(),
        getStatus() {
          return {
            catalogSyncOk: false,
            catalogSyncedAt: null,
            marketWsConnected: false,
            publicWsConnected: false,
            readySymbolCount: 0,
          };
        },
      },
    });
    markRuntimeReady();
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("error mapping", () => {
  it("hides internal exception details and maps oversize bodies", async () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const marker = "select 1 from postgresql://probe-user:probe-pass@db.internal/notional /var/lib/postgresql";
    const app = await buildApp({ loggerDestination: stream });
    app.get("/boom", async () => {
      throw new Error(marker);
    });

    const boom = await app.inject({ method: "GET", url: "/boom" });
    expect(boom.statusCode).toBe(500);
    expect(boom.json()).toEqual({ error: "INTERNAL_ERROR" });
    expect(errorLooksSafe(boom.json())).toBe(true);
    expect(boom.body).not.toContain("/var/lib");
    expect(boom.body.toLowerCase()).not.toContain("stack");
    const logs = Buffer.concat(chunks).toString("utf8");
    expect(logs).not.toContain(marker);
    expect(logs).not.toContain("probe-pass");
    expect(logs).toContain("unhandled error");
    expect(logs).toContain("Error");

    const oversize = await app.inject({
      method: "POST",
      url: "/api/account/initialize",
      headers: { "content-type": "application/json" },
      payload: { padding: "x".repeat(JSON_BODY_LIMIT_BYTES + 16) },
    });
    expect(oversize.statusCode).toBe(413);
    expect(oversize.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    await app.close();
  });

  it("maps Fastify schema validation to INVALID_REQUEST and leaves domain 401 replies", async () => {
    const app = await buildApp();
    app.post(
      "/validate-probe",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: { type: "string" },
            },
          },
        },
      },
      async () => ({ ok: true }),
    );

    const invalid = await app.inject({
      method: "POST",
      url: "/validate-probe",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "INVALID_REQUEST" });

    const unauthorized = await app.inject({ method: "GET", url: "/api/me" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "Unauthorized" });
    await app.close();
  });
});

describe("log redaction", () => {
  it("redacts configured secret paths and keeps request-completion logs header-free", async () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const app = await buildApp({ loggerDestination: stream });
    app.get("/log-headers", async (request) => {
      request.log.info(
        {
          req: {
            headers: {
              cookie: "COOKIE_MARKER_xyz",
              authorization: "AUTH_MARKER_xyz",
            },
          },
          res: {
            headers: {
              "set-cookie": "SETCOOKIE_MARKER_xyz",
            },
          },
          password: "PASSWORD_MARKER_xyz",
          token: "TOKEN_MARKER_xyz",
          secret: "SECRET_MARKER_xyz",
          BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET_MARKER_xyz",
          DATABASE_URL: "postgres://user:dbpass@host/DATABASE_URL_MARKER_xyz",
        },
        "probe",
      );
      return { ok: true };
    });

    await app.inject({
      method: "GET",
      url: "/log-headers?token=QUERY_SECRET_xyz",
      headers: {
        cookie: "COOKIE_HEADER_xyz",
        authorization: "Bearer AUTH_HEADER_xyz",
      },
    });

    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("[Redacted]");
    expect(text).not.toContain("COOKIE_MARKER_xyz");
    expect(text).not.toContain("AUTH_MARKER_xyz");
    expect(text).not.toContain("SETCOOKIE_MARKER_xyz");
    expect(text).not.toContain("PASSWORD_MARKER_xyz");
    expect(text).not.toContain("TOKEN_MARKER_xyz");
    expect(text).not.toContain("SECRET_MARKER_xyz");
    expect(text).not.toContain("BETTER_AUTH_SECRET_MARKER_xyz");
    expect(text).not.toContain("DATABASE_URL_MARKER_xyz");
    expect(text).not.toContain("COOKIE_HEADER_xyz");
    expect(text).not.toContain("AUTH_HEADER_xyz");
    expect(text).not.toContain("QUERY_SECRET_xyz");
    expect(text).toContain("request completed");
    await app.close();
  });
});

describe("auth handler failure logging", () => {
  it("returns INTERNAL_ERROR and logs only the safe diagnostic", async () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const marker =
      "postgresql://probe-user:probe-pass@db.internal/notional BETTER_AUTH_SECRET=/internal/private/path";
    const app = await buildApp({
      loggerDestination: stream,
      handleAuthRequest: async () => {
        const error = new Error(marker);
        error.name = "AuthProbeError";
        (error as Error & { code: string }).code = "AUTH_PROBE";
        throw error;
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: process.env.WEB_ORIGIN, "content-type": "application/json" },
      payload: { email: "ada@example.com", password: "correct-horse-battery" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "INTERNAL_ERROR" });
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("unhandled authentication error");
    expect(text).toContain("AuthProbeError");
    expect(text).toContain("AUTH_PROBE");
    expect(text).not.toContain(marker);
    expect(text).not.toContain("probe-pass");
    expect(text).not.toContain("BETTER_AUTH_SECRET=");
    expect(text).not.toContain("/internal/private/path");
    await app.close();
  });
});

describe("security headers", () => {
  it("omits HSTS locally and does not apply CSP to the JSON API", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => {
      warnings.push(`${warning.name}:${warning.message}`);
    };
    process.on("warning", onWarning);
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      String(response.headers["x-frame-options"] ?? response.headers["content-security-policy"] ?? ""),
    ).not.toBe("");
    expect(response.headers["x-frame-options"]).toBeDefined();
    expect(response.headers["referrer-policy"]).toBeDefined();
    expect(warnings.some((row) => row.includes("FSTDEP023"))).toBe(false);
    process.off("warning", onWarning);
    await app.close();
  });

  it("enables HSTS only when helmetOptions says so", async () => {
    const disabled = Fastify({ logger: false });
    await disabled.register(helmet, helmetOptions(false));
    disabled.get("/x", async () => ({ ok: true }));
    const off = await disabled.inject({ method: "GET", url: "/x" });
    expect(off.headers["strict-transport-security"]).toBeUndefined();
    expect(off.headers["content-security-policy"]).toBeUndefined();
    await disabled.close();

    const enabled = Fastify({ logger: false });
    await enabled.register(helmet, helmetOptions(true));
    enabled.get("/x", async () => ({ ok: true }));
    const on = await enabled.inject({ method: "GET", url: "/x" });
    expect(String(on.headers["strict-transport-security"] ?? "")).toContain("max-age=15552000");
    expect(on.headers["content-security-policy"]).toBeUndefined();
    expect(on.headers["x-content-type-options"]).toBe("nosniff");
    expect(on.headers["x-frame-options"]).toBeDefined();
    expect(on.headers["referrer-policy"]).toBeDefined();
    await enabled.close();
  });
});
