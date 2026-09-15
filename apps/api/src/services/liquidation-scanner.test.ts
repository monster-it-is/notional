import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  listLiquidationEventsByPaperAccountId,
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
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./funding-test-fixtures.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { FakeScheduler } from "../market-data/test-helpers.js";
import { createLiquidationScanner } from "./liquidation-scanner.js";

const password = "correct-horse-battery";

describe("liquidation scanner", () => {
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
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await endTestPool();
  });

  it("does not overlap in-flight scans", async () => {
    const { accountId } = await initializeUser(app, "overlap@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
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
    const scanner = createLiquidationScanner({ marketData, intervalMs: 1_000 });
    await Promise.all([scanner.scanOnce(), scanner.scanOnce()]);
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("skips stale marks and stale BBO without creating events", async () => {
    const { accountId } = await initializeUser(app, "stale-scan@example.com");
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
    const scanner = createLiquidationScanner({ marketData, intervalMs: 1_000 });
    await scanner.scanOnce();
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(0);

    store.applyMark({
      symbol: "BTCUSDT",
      markPrice: "100",
      indexPrice: "100",
      fundingRate: "0",
      nextFundingTime: 1,
      markEventTime: 1,
    });
    await scanner.scanOnce();
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(0);
  });

  it("processes isolated candidates before re-evaluating CROSS", async () => {
    const { accountId } = await initializeUser(app, "iso-first@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "1", bid: "1", ask: "1.1", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "1", bid: "1", ask: "1.1", id: 1 });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "100",
      entryPrice: "1",
      isolatedMargin: "0.4",
      walletBalance: "1",
    });
    await seedOpenPosition({
      accountId,
      instrumentId: eth.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "1.6",
      isolatedMargin: "0",
    });

    const scanner = createLiquidationScanner({ marketData, intervalMs: 1_000 });
    await scanner.scanOnce();
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
    expect((await findPositionByAccountAndInstrument(db, accountId, eth.id))?.quantity).toBe("1");
    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.marginMode).toBe("ISOLATED");
  });

  it("does not repeat a successful liquidation", async () => {
    const { accountId } = await initializeUser(app, "once@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
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
    const scanner = createLiquidationScanner({ marketData, intervalMs: 1_000 });
    await scanner.scanOnce();
    await scanner.scanOnce();
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("keeps scanning after a committed liquidation if realtime publication throws", async () => {
    const { accountId } = await initializeUser(app, "scan-rt-throw@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
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
    const scanner = createLiquidationScanner({
      marketData,
      intervalMs: 1_000,
      onPrivateCommitted: () => {
        throw new Error("ws down");
      },
    });
    await scanner.scanOnce();
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("logs an unexpected account error and continues the next account", async () => {
    const first = await initializeUser(app, "err-a@example.com");
    const second = await initializeUser(app, "err-b@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    await seedOpenPosition({
      accountId: first.accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    await seedOpenPosition({
      accountId: second.accountId,
      instrumentId: eth.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0",
      walletBalance: "0.5",
    });
    const logs: string[] = [];
    const throwing: MarketDataAccess = {
      ...marketData,
      getFreshBook(symbol) {
        if (symbol === "BTCUSDT") {
          throw new Error("book exploded");
        }

        return marketData.getFreshBook(symbol);
      },
    };
    const scanner = createLiquidationScanner({
      marketData: throwing,
      intervalMs: 1_000,
      logger: {
        info() {},
        warn() {},
        error(message) {
          logs.push(message);
        },
      },
    });
    await scanner.scanOnce();
    expect(logs).toContain("liquidation scanner account failed");
    expect(
      await listLiquidationEventsByPaperAccountId(db, second.accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("clears the timer on stop and does not scan after stop", async () => {
    const scheduler = new FakeScheduler();
    const scans: number[] = [];
    const scanner = createLiquidationScanner({
      marketData,
      intervalMs: 1_000,
      scheduler,
      logger: {
        info() {},
        warn() {},
        error() {
          scans.push(1);
        },
      },
    });
    scanner.start();
    scanner.stop();
    scheduler.advance(5_000);
    expect(
      await listLiquidationEventsByPaperAccountId(db, "00000000-0000-4000-8000-000000000001", {
        limit: 10,
        offset: 0,
      }),
    ).toHaveLength(0);
  });

  it("is not started by buildApp", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app.ts"), "utf8");
    expect(source).not.toContain("createLiquidationScanner");
    expect(source).not.toContain("liquidation-scanner");
    expect(source).not.toContain("createRealtimeRuntime");
    expect(source).not.toContain("createMarketDataRuntime");
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
