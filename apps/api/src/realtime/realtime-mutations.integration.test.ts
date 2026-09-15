import type { OrderResponse } from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { claimFaucet } from "../services/faucet.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "../services/funding-test-fixtures.js";
import { updateMarginSettings } from "../services/margin-settings.js";
import { cancelUserOrder, placeOrder } from "../services/order-placement.js";
import { provisionSignupAllocation } from "../services/signup-allocation.js";
import type { CommittedPrivateEffect } from "./effects.js";

const password = "correct-horse-battery";

describe("post-commit private invalidation mutations", () => {
  let now = 1_000;
  let store = createMarketDataStore({ now: () => now });
  let app: FastifyInstance;
  const marketData: MarketDataAccess = {
    getFreshMark(symbol) {
      return store.getFreshMark(symbol, 60_000);
    },
    getFreshBook(symbol) {
      return store.getFreshBook(symbol, 60_000);
    },
    getReadySnapshot() {
      return null;
    },
    getStatus() {
      return {
        catalogSyncOk: true,
        catalogSyncedAt: 1,
        marketWsConnected: true,
        publicWsConnected: true,
        readySymbolCount: 1,
      };
    },
  };

  beforeAll(async () => {
    app = await buildApp({ marketData });
  });

  afterAll(async () => {
    await app.close();
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
    now = 1_000;
    store = createMarketDataStore({ now: () => now });
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
  });

  it("emits the approved order, cancel, faucet, margin, and signup invalidations", async () => {
    const events: CommittedPrivateEffect[] = [];
    const capture = (effect: CommittedPrivateEffect) => {
      events.push(effect);
    };
    const { userId, cookies } = await signUpUser(app, "rt-mutations@example.com");
    const initialized = await provisionSignupAllocation(userId, capture);
    expect(events).toEqual([
      expect.objectContaining({
        paperAccountId: initialized.id,
        reason: "ACCOUNT_INITIALIZED",
        resources: ["account", "walletFunding"],
      }),
    ]);
    events.length = 0;
    await provisionSignupAllocation(userId, capture);
    expect(events).toEqual([]);

    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await updateMarginSettings(
      userId,
      "BTCUSDT",
      { marginMode: "CROSS", leverage: 5 },
      capture,
    );
    expect(events).toEqual([
      expect.objectContaining({
        reason: "MARGIN_SETTINGS_CHANGED",
        resources: ["marginSettings"],
      }),
    ]);
    events.length = 0;
    const open = await placeOrder({
      userId,
      idempotencyKey: "limit-1",
      body: {
        type: "LIMIT",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.1",
        limitPrice: "90",
      },
      marketData,
      onPrivateCommitted: capture,
    });
    expect(open.created).toBe(true);
    expect(open.order.status).toBe("OPEN");
    expect(events).toEqual([
      expect.objectContaining({ reason: "ORDER_PLACED", resources: ["orders"] }),
    ]);
    events.length = 0;
    const replay = await placeOrder({
      userId,
      idempotencyKey: "limit-1",
      body: {
        type: "LIMIT",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.1",
        limitPrice: "90",
      },
      marketData,
      onPrivateCommitted: capture,
    });
    expect(replay.created).toBe(false);
    expect(events).toEqual([]);

    await cancelUserOrder({
      userId,
      orderId: open.order.id,
      onPrivateCommitted: capture,
    });
    expect(events).toEqual([
      expect.objectContaining({ reason: "ORDER_CANCELLED", resources: ["orders"] }),
    ]);
    events.length = 0;
    await cancelUserOrder({
      userId,
      orderId: open.order.id,
      onPrivateCommitted: capture,
    });
    expect(events).toEqual([]);

    const filled = await placeOrder({
      userId,
      idempotencyKey: "mkt-1",
      body: {
        type: "MARKET",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.1",
      },
      marketData,
      onPrivateCommitted: capture,
    });
    expect(filled.created).toBe(true);
    expect(filled.order.status).toBe("FILLED");
    expect(events[0]).toMatchObject({
      reason: "ORDER_FILLED",
      resources: expect.arrayContaining(["orders", "executions", "positions", "account"]),
    });
    events.length = 0;

    await claimFaucet(userId, capture);
    expect(events).toEqual([
      expect.objectContaining({
        reason: "FAUCET_CLAIMED",
        resources: expect.arrayContaining(["account", "walletFunding"]),
      }),
    ]);
    expect(cookies).toBeTruthy();
  });

  it("does not emit after a rolled-back order and still succeeds if realtime throws", async () => {
    const { userId } = await signUpUser(app, "rt-isolation@example.com");
    await provisionSignupAllocation(userId);
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    let calls = 0;
    const margin = await updateMarginSettings(
      userId,
      "BTCUSDT",
      { marginMode: "CROSS", leverage: 3 },
      () => {
        calls += 1;
        throw new Error("ws down");
      },
    );
    expect(margin.leverage).toBe(3);
    expect(calls).toBe(1);

    const rollbackEvents: CommittedPrivateEffect[] = [];
    await expect(
      placeOrder({
        userId,
        idempotencyKey: "too-big",
        body: {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1000",
        },
        marketData,
        onPrivateCommitted: (effect) => rollbackEvents.push(effect),
      }),
    ).rejects.toThrow();
    expect(rollbackEvents).toEqual([]);

    const filled = await placeOrder({
      userId,
      idempotencyKey: "ok-fill",
      body: {
        type: "MARKET",
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: "0.1",
      },
      marketData,
      onPrivateCommitted: () => {
        calls += 1;
        throw new Error("ws down");
      },
    });
    expect(filled.created).toBe(true);
    expect(filled.order.status).toBe("FILLED");
    expect(calls).toBe(2);

    const faucet = await claimFaucet(userId, () => {
      calls += 1;
      throw new Error("ws down");
    });
    expect(faucet.id).toBeTruthy();
    expect(calls).toBe(3);

    const again = await provisionSignupAllocation(userId, () => {
      throw new Error("ws down");
    });
    expect(again.id).toBeTruthy();
  });

  it("keeps HTTP order placement successful when the injected realtime callback throws", async () => {
    const events: CommittedPrivateEffect[] = [];
    const throwingApp = await buildApp({
      marketData,
      onPrivateCommitted: (effect) => {
        events.push(effect);
        throw new Error("ws down");
      },
    });
    try {
      const { cookies } = await initializeUser(throwingApp, "rt-http-throw@example.com");
      await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
      const response = await throwingApp.inject({
        method: "POST",
        url: "/api/orders",
        headers: {
          cookie: cookies,
          origin: process.env.WEB_ORIGIN,
          "Idempotency-Key": "http-1",
        },
        payload: {
          type: "LIMIT",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.1",
          limitPrice: "90",
        },
      });
      expect(response.statusCode).toBe(201);
      expect((response.json() as OrderResponse).status).toBe("OPEN");
      expect(events.some((row) => row.reason === "ORDER_PLACED")).toBe(true);
    } finally {
      await throwingApp.close();
    }
  });
});

function seedQuote(
  current: MarketDataStore,
  symbol: string,
  quote: { mark: string; bid: string; ask: string; id: number },
) {
  current.applyMark({
    symbol,
    markPrice: quote.mark,
    indexPrice: quote.mark,
    fundingRate: "0",
    nextFundingTime: 1,
    markEventTime: quote.id,
  });
  current.applyBook({
    symbol,
    bestBidPrice: quote.bid,
    bestAskPrice: quote.ask,
    bestBidQty: "1",
    bestAskQty: "1",
    bookUpdateId: quote.id,
    bookEventTime: quote.id,
  });
}

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

async function signUpUser(app: FastifyInstance, email: string) {
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { name: "Ada Lovelace", email, password },
  });
  const cookies = signup.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const userId = (signup.json() as { user: { id: string } }).user.id;
  return { cookies, userId };
}

async function initializeUser(app: FastifyInstance, email: string) {
  const signed = await signUpUser(app, email);
  const initialized = await app.inject({
    method: "POST",
    url: "/api/account/initialize",
    headers: { cookie: signed.cookies, origin: process.env.WEB_ORIGIN },
  });
  expect(initialized.statusCode).toBe(200);
  const account = await findPaperAccountByUserId(db, signed.userId);
  if (!account) {
    throw new Error("expected initialized paper account");
  }
  return { ...signed, accountId: account.id };
}
