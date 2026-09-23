import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { endTestPool } from "@notional/db/test";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import { getRuntimeStatus, resetRuntimeStatusForTests } from "./runtime-status.js";
import { resetShutdownForTests, shutdownOnce } from "./shutdown.js";
import { listenThenBootstrapRuntime } from "./startup.js";

afterAll(async () => {
  await endTestPool();
});

afterEach(() => {
  resetShutdownForTests();
  resetRuntimeStatusForTests();
});

describe("listen then runtime bootstrap", () => {
  it("binds HTTP before marketData.start finishes and keeps /ready 503 until ready", async () => {
    const gate = createDeferred();
    const order: string[] = [];
    let startFinished = false;
    const app = await buildApp({
      databaseHealthCheck: async () => ({ ok: true }),
    });
    app.addHook("onReady", async () => {
      order.push("onReady");
      expect(startFinished).toBe(false);
    });

    const marketData = {
      async start() {
        order.push("market-start");
        expect(app.server.listening).toBe(true);
        expect(getRuntimeStatus().runtimeReady).toBe(false);
        await gate.promise;
        startFinished = true;
        order.push("market-done");
      },
    };
    const liquidationScanner = {
      start() {
        order.push("liquidation-start");
      },
    };
    const fundingScanner = {
      start() {
        order.push("funding-start");
      },
    };

    const bootstrap = listenThenBootstrapRuntime({
      app,
      port: 0,
      host: "127.0.0.1",
      marketData,
      liquidationScanner,
      fundingScanner,
      shutdown: async () => {
        throw new Error("shutdown should not run");
      },
      exit: () => {
        throw new Error("exit should not run");
      },
    });

    await waitUntilListening(app);
    await waitUntil(() => order.includes("market-start"));
    expect(startFinished).toBe(false);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: false, shuttingDown: false });
    expect(order).toEqual(["onReady", "market-start"]);

    const health = await fetch(listeningUrl(app, "/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const unready = await fetch(listeningUrl(app, "/ready"));
    expect(unready.status).toBe(503);
    expect(await unready.json()).toEqual({ status: "not_ready" });

    gate.resolve();
    await bootstrap;

    expect(startFinished).toBe(true);
    expect(order).toEqual([
      "onReady",
      "market-start",
      "market-done",
      "liquidation-start",
      "funding-start",
    ]);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: true, shuttingDown: false });

    const ready = await fetch(listeningUrl(app, "/ready"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("starts scanners and marks runtime ready only after successful bootstrap", async () => {
    const app = await buildApp({
      databaseHealthCheck: async () => ({ ok: true }),
    });
    const order: string[] = [];
    await listenThenBootstrapRuntime({
      app,
      port: 0,
      host: "127.0.0.1",
      marketData: {
        async start() {
          order.push("market-start");
          expect(getRuntimeStatus().runtimeReady).toBe(false);
        },
      },
      liquidationScanner: {
        start() {
          order.push("liquidation-start");
          expect(getRuntimeStatus().runtimeReady).toBe(false);
        },
      },
      fundingScanner: {
        start() {
          order.push("funding-start");
          expect(getRuntimeStatus().runtimeReady).toBe(false);
        },
      },
      shutdown: async () => {
        throw new Error("shutdown should not run");
      },
      exit: () => {
        throw new Error("exit should not run");
      },
    });

    expect(order).toEqual(["market-start", "liquidation-start", "funding-start"]);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: true, shuttingDown: false });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    await app.close();
  });

  it("leaves runtime unready and shuts down through the existing coordinator when bootstrap fails", async () => {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const app = await buildApp({
      loggerDestination: stream,
      databaseHealthCheck: async () => ({ ok: true }),
    });
    const order: string[] = [];
    const exits: number[] = [];
    let liquidationStarted = false;
    let fundingStarted = false;
    const marker =
      "postgresql://probe-user:probe-pass@db.internal/notional BETTER_AUTH_SECRET=/internal/private/path";
    const failure = new Error(marker);
    failure.name = "BootstrapError";
    Object.assign(failure, { code: "BOOTSTRAP_FAIL" });

    const failAfterProbe = createDeferred();
    const marketData = {
      async start() {
        await failAfterProbe.promise;
        throw failure;
      },
      stopScheduling() {
        order.push("catalog-stop");
      },
      async waitForSyncIdle() {
        order.push("catalog-idle");
      },
      async stop() {
        order.push("market-stop");
      },
    };

    const shutdown = () =>
      shutdownOnce({
        app,
        matcher: {
          stop() {
            order.push("matcher-stop");
          },
          async waitForIdle() {
            order.push("matcher-idle");
          },
        },
        fundingScanner: {
          start() {
            fundingStarted = true;
          },
          stop() {
            order.push("funding-stop");
          },
          async waitForIdle() {
            order.push("funding-idle");
          },
        },
        liquidationScanner: {
          start() {
            liquidationStarted = true;
          },
          stop() {
            order.push("liquidation-stop");
          },
          async waitForIdle() {
            order.push("liquidation-idle");
          },
        },
        realtime: {
          async shutdown() {
            order.push("realtime");
          },
        },
        marketData,
        disableTickScheduling: () => {
          order.push("disable-ticks");
        },
        timeoutMs: 5_000,
        logger: { info() {}, warn() {}, error() {} },
        closePool: async () => {
          order.push("pool");
        },
        exit: (code) => {
          exits.push(code);
        },
      });

    const bootstrap = listenThenBootstrapRuntime({
      app,
      port: 0,
      host: "127.0.0.1",
      marketData,
      liquidationScanner: {
        start() {
          liquidationStarted = true;
        },
      },
      fundingScanner: {
        start() {
          fundingStarted = true;
        },
      },
      shutdown,
      exit: (code) => {
        exits.push(code);
      },
    });

    await waitUntilListening(app);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: false, shuttingDown: false });
    const health = await fetch(listeningUrl(app, "/health"));
    expect(health.status).toBe(200);
    const unready = await fetch(listeningUrl(app, "/ready"));
    expect(unready.status).toBe(503);
    expect(await unready.json()).toEqual({ status: "not_ready" });

    failAfterProbe.resolve();
    await bootstrap;

    expect(liquidationStarted).toBe(false);
    expect(fundingStarted).toBe(false);
    expect(getRuntimeStatus()).toEqual({ runtimeReady: false, shuttingDown: true });
    expect(exits).toEqual([1]);
    expect(app.server.listening).toBe(false);

    expect(order.indexOf("disable-ticks")).toBeGreaterThan(-1);
    expect(order.indexOf("funding-stop")).toBeGreaterThan(-1);
    expect(order.indexOf("liquidation-stop")).toBeGreaterThan(-1);
    expect(order.indexOf("catalog-stop")).toBeGreaterThan(-1);
    expect(order.indexOf("realtime")).toBeGreaterThan(order.indexOf("funding-stop"));
    expect(order.indexOf("funding-idle")).toBeGreaterThan(order.indexOf("funding-stop"));
    expect(order.indexOf("matcher-stop")).toBeGreaterThan(order.indexOf("realtime"));
    expect(order.indexOf("matcher-idle")).toBeGreaterThan(order.indexOf("matcher-stop"));
    expect(order.indexOf("market-stop")).toBeGreaterThan(order.indexOf("matcher-idle"));
    expect(order.indexOf("pool")).toBe(order.length - 1);

    const logs = Buffer.concat(chunks).toString("utf8");
    expect(logs).toContain("api listening");
    expect(logs).toContain("runtime bootstrap starting");
    expect(logs).toContain("runtime bootstrap failed");
    expect(logs).toContain("BootstrapError");
    expect(logs).not.toContain("runtime ready");
    expect(logs).not.toContain(marker);
    expect(logs).not.toContain("probe-pass");
    expect(logs).not.toContain("BETTER_AUTH_SECRET=");
    expect(logs).not.toContain("/internal/private/path");
  });

  it("does not register runtime bootstrap on Fastify onReady", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const serverSource = readFileSync(join(root, "server.ts"), "utf8");
    const startupSource = readFileSync(join(root, "startup.ts"), "utf8");
    const appSource = readFileSync(join(root, "app.ts"), "utf8");

    expect(serverSource).not.toMatch(/addHook\(\s*["']onReady["']/);
    expect(startupSource).not.toMatch(/addHook\(\s*["']onReady["']/);
    expect(appSource).not.toMatch(/addHook\(\s*["']onReady["']/);
    expect(serverSource).toMatch(/listenThenBootstrapRuntime/);
    expect(startupSource.indexOf("api listening")).toBeLessThan(
      startupSource.indexOf("runtime bootstrap starting"),
    );
    expect(startupSource.indexOf("await resources.marketData.start()")).toBeGreaterThan(
      startupSource.indexOf("runtime bootstrap starting"),
    );
  });
});

function createDeferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitUntilListening(app: FastifyInstance): Promise<void> {
  await waitUntil(() => app.server.listening);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
}

function listeningUrl(app: FastifyInstance, path: string): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected tcp listen address");
  }
  return `http://127.0.0.1:${address.port}${path}`;
}
