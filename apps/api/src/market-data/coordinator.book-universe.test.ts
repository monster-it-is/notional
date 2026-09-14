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
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
