import { db, upsertInstrumentBySymbol } from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createMarketDataRuntime } from "./coordinator.js";
import { parseEnv } from "../env.js";
import { coin } from "./exchange-info-fixtures.js";
import { FakeScheduler, FakeTransport } from "./test-helpers.js";

describe("book ticker universe", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("subscribes ACTIVE and INACTIVE known catalog symbols", async () => {
    await upsertInstrumentBySymbol(db, {
      symbol: "SOLUSDT",
      baseAsset: "SOL",
      status: "INACTIVE",
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
    });

    const transport = new FakeTransport();
    const scheduler = new FakeScheduler();
    const runtime = createMarketDataRuntime({
      env: parseEnv(process.env),
      transport,
      scheduler,
      random: () => 1,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.includes("exchangeInfo")) {
          return jsonResponse({ symbols: [coin("BTCUSDT")] });
        }

        if (path.includes("premiumIndex") || path.includes("bookTicker")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      },
    });

    await runtime.start();
    const publicSocket = transport.sockets.find((_, index) =>
      transport.urls[index]?.includes("/public/ws"),
    );
    publicSocket?.open();

    const subscribed = transport.sockets.flatMap((socket) =>
      socket.sent.flatMap((message) => {
        const parsed = JSON.parse(message) as { method?: string; params?: string[] };
        return parsed.method === "SUBSCRIBE" ? parsed.params ?? [] : [];
      }),
    );
    expect(subscribed).toEqual(expect.arrayContaining(["btcusdt@bookTicker", "solusdt@bookTicker"]));
    expect(new Set(subscribed).size).toBe(subscribed.length);
    await runtime.stop();
  });

  it("drains an in-flight catalog sync and does not start another cycle after stopScheduling", async () => {
    let release: () => void = () => {};
    let markEntered: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const runtime = createMarketDataRuntime({
      env: parseEnv(process.env),
      transport: new FakeTransport(),
      scheduler: new FakeScheduler(),
      random: () => 1,
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.includes("exchangeInfo")) {
          markEntered();
          await gate;
          return jsonResponse({ symbols: [coin("BTCUSDT")] });
        }

        if (path.includes("premiumIndex") || path.includes("bookTicker")) {
          return jsonResponse([]);
        }

        return jsonResponse({});
      },
    });

    const started = runtime.start();
    await entered;
    runtime.stopScheduling();
    let idle = false;
    const waiting = runtime.waitForSyncIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await waiting;
    expect(idle).toBe(true);
    await started;
    await runtime.stop();
  });

  it("contains a scheduled catalog rejection, logs a safe diagnostic, and reschedules until stopped", async () => {
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      leaked.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const logs: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const scheduler = new FakeScheduler();
    let catalogPasses = 0;
    const secret = "postgresql://probe-user:probe-pass@db.internal/notional";
    const runtime = createMarketDataRuntime({
      env: { ...parseEnv(process.env), INSTRUMENT_SYNC_INTERVAL_MS: 1_000 },
      transport: new FakeTransport(),
      scheduler,
      random: () => 1,
      logger: {
        info() {},
        warn() {},
        error(message, extra) {
          logs.push({ message, extra });
        },
      },
      fetchImpl: async (url) => {
        const path = String(url);
        if (path.includes("exchangeInfo")) {
          return jsonResponse({ symbols: [coin("BTCUSDT")] });
        }
        if (path.includes("premiumIndex") || path.includes("bookTicker")) {
          return jsonResponse([]);
        }
        return jsonResponse({});
      },
      async afterSuccessfulCatalogSync() {
        catalogPasses += 1;
        if (catalogPasses >= 2) {
          const error = new Error(secret);
          error.name = "CatalogProbeError";
          (error as Error & { code: string }).code = "CATALOG_PROBE";
          throw error;
        }
      },
    });

    try {
      await runtime.start();
      expect(catalogPasses).toBe(1);
      expect(scheduler.pendingCount).toBe(1);

      scheduler.advance(1_000);
      await runtime.waitForSyncIdle();
      await Promise.resolve();

      expect(catalogPasses).toBe(2);
      expect(leaked).toEqual([]);
      expect(logs).toEqual([
        {
          message: "catalog sync cycle failed",
          extra: { name: "CatalogProbeError", code: "CATALOG_PROBE" },
        },
      ]);
      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(scheduler.pendingCount).toBe(1);

      runtime.stopScheduling();
      expect(scheduler.pendingCount).toBe(0);
      scheduler.advance(1_000);
      await runtime.waitForSyncIdle();
      await Promise.resolve();
      expect(catalogPasses).toBe(2);
      expect(leaked).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await runtime.stop();
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
