import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  insertOpenLimitOrder,
  listLiquidationEventsByPaperAccountId,
  lockExistingInstrumentsForCatalogSync,
  lockInstrumentByIdForTrading,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  updateMarginSettingsForFlatPosition,
  updatePaperAccountBalance,
  updatePositionState,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { syncInstrumentCatalog } from "../market-data/instrument-sync.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./funding-test-fixtures.js";
import { coin } from "../market-data/exchange-info-fixtures.js";
import { createLimitOrderMatcher } from "./limit-matcher.js";
import { liquidateCrossAccount } from "./liquidation.js";

const password = "correct-horse-battery";

describe("liquidation concurrency", () => {
  let now = 1_000;
  let store = createMarketDataStore({ now: () => now });
  let app: FastifyInstance;
  let marketData: MarketDataAccess;

  beforeEach(async () => {
    await resetTestTables();
    now = 1_000;
    store = createMarketDataStore({ now: () => now });
    marketData = accessFromStore(store);
    app = await buildApp({ marketData });
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await endTestPool();
  });

  it("serializes a user close against CROSS liquidation to one flat outcome", async () => {
    const { cookies, accountId } = await initializeUser(app, "close-vs-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    const [liq] = await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      app.inject({
        method: "POST",
        url: "/api/orders",
        headers: {
          cookie: cookies,
          origin: process.env.WEB_ORIGIN,
          "Idempotency-Key": "user-close",
        },
        payload: {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: "1",
          reduceOnly: true,
        },
      }),
    ]);
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events.length === 0 || events.length === 1).toBe(true);
    expect(liq.kind === "liquidated" || liq.kind === "noop").toBe(true);
  });

  it("serializes matcher fill against CROSS liquidation", async () => {
    const { cookies, accountId } = await initializeUser(app, "match-vs-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    const resting = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: {
        cookie: cookies,
        origin: process.env.WEB_ORIGIN,
        "Idempotency-Key": "exit",
      },
      payload: {
        type: "LIMIT",
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: "1",
        limitPrice: "90",
        reduceOnly: true,
      },
    });
    expect(resting.statusCode).toBe(201);
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "90", ask: "91", id: 2 });
    const matcher = createLimitOrderMatcher({ marketData });
    await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      matcher.processSymbol("BTCUSDT"),
    ]);
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
  });

  it("serializes placement against CROSS liquidation", async () => {
    const { cookies, accountId } = await initializeUser(app, "place-vs-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      app.inject({
        method: "POST",
        url: "/api/orders",
        headers: {
          cookie: cookies,
          origin: process.env.WEB_ORIGIN,
          "Idempotency-Key": "place",
        },
        payload: {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: "0.001",
          reduceOnly: true,
        },
      }),
    ]);
    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("lets only one of two concurrent liquidation attempts commit", async () => {
    const { accountId } = await initializeUser(app, "two-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    const [first, second] = await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
    ]);
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["liquidated", "noop"]);
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("does not deadlock cancel versus liquidation", async () => {
    const { cookies, accountId } = await initializeUser(app, "cancel-vs-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    const resting = await db.transaction(async (tx) =>
      insertOpenLimitOrder(tx, {
        paperAccountId: accountId,
        instrumentId: btc.id,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.1",
        limitPrice: "90",
        reservedMargin: "0.45",
        idempotencyKey: "rest",
      }),
    );
    expect(resting.kind).toBe("created");
    if (resting.kind !== "created") {
      return;
    }

    await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      app.inject({
        method: "POST",
        url: `/api/orders/${resting.order.id}/cancel`,
        headers: { cookie: cookies, origin: process.env.WEB_ORIGIN },
      }),
    ]);
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
  });

  it("does not deadlock INACTIVE catalog sync against CROSS liquidation", async () => {
    const { accountId } = await initializeUser(app, "catalog-vs-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    await seedOpenPosition({
      accountId,
      instrumentId: eth.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
    });

    await Promise.all([
      liquidateCrossAccount({ paperAccountId: accountId, marketData }),
      syncInstrumentCatalog({
        fetchExchangeInfo: async () => ({
          symbols: [coin("BTCUSDT", { status: "CLOSE" }), coin("ETHUSDT")],
        }),
      }),
      db.transaction(async (tx) => {
        await lockExistingInstrumentsForCatalogSync(tx);
      }),
    ]);
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
    expect((await findPositionByAccountAndInstrument(db, accountId, eth.id))?.quantity).toBe("0");
  });
});

async function seedOpenPosition(params: {
  accountId: string;
  instrumentId: string;
  marginMode: "CROSS" | "ISOLATED";
  leverage: number;
  quantity: string;
  entryPrice: string;
  isolatedMargin: string;
  walletBalance?: string;
}) {
  await db.transaction(async (tx) => {
    await lockPaperAccountById(tx, params.accountId);
    await lockInstrumentByIdForTrading(tx, params.instrumentId);
    await ensurePosition(tx, params.accountId, params.instrumentId);
    const position = await lockPositionByAccountAndInstrument(
      tx,
      params.accountId,
      params.instrumentId,
    );
    await updateMarginSettingsForFlatPosition(tx, position.id, {
      marginMode: params.marginMode,
      leverage: params.leverage,
    });
    await updatePositionState(tx, position.id, {
      quantity: params.quantity,
      entryPrice: params.entryPrice,
      realizedPnl: "0",
      isolatedMargin: params.isolatedMargin,
    });
    if (params.walletBalance !== undefined) {
      await updatePaperAccountBalance(tx, params.accountId, fromDbDecimal(params.walletBalance));
    }
  });
}

function accessFromStore(store: MarketDataStore): MarketDataAccess {
  return {
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
}

function seedQuote(
  store: MarketDataStore,
  symbol: string,
  quote: { mark: string; bid: string; ask: string; id: number },
) {
  store.applyMark({
    symbol,
    markPrice: quote.mark,
    indexPrice: quote.mark,
    fundingRate: "0",
    nextFundingTime: 1,
    markEventTime: quote.id,
  });
  store.applyBook({
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

async function initializeUser(instance: FastifyInstance, email: string) {
  const signup = await instance.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { name: "Ada Lovelace", email, password },
  });
  const cookies = signup.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const initialized = await instance.inject({
    method: "POST",
    url: "/api/account/initialize",
    headers: { cookie: cookies, origin: process.env.WEB_ORIGIN },
  });
  expect(initialized.statusCode).toBe(200);
  const account = await findPaperAccountByUserId(
    db,
    (signup.json() as { user: { id: string } }).user.id,
  );
  if (!account) {
    throw new Error("expected initialized paper account");
  }
  return { cookies, accountId: account.id };
}
