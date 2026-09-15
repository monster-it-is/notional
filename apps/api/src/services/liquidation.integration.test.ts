import type { OrderResponse } from "@notional/contracts";
import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  insertOpenLimitOrder,
  ledgerAccount,
  ledgerEntry,
  ledgerTransaction,
  listExecutionsByPaperAccountId,
  listLiquidationEventsByPaperAccountId,
  listOrdersByPaperAccountId,
  lockInstrumentByIdForTrading,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  paperAccount,
  updateMarginSettingsForFlatPosition,
  updatePaperAccountBalance,
  updatePositionState,
} from "@notional/db";
import { endTestPool, resetTestTables, setPaperAccountStatusForTests } from "@notional/db/test";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./funding-test-fixtures.js";
import { liquidateCrossAccount, liquidateIsolatedPosition } from "./liquidation.js";

const password = "correct-horse-battery";

describe("liquidation transactions", () => {
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

  it("liquidates a CROSS equality trigger with a LIQUIDATION MARKET fill", async () => {
    const { cookies, accountId } = await initializeUser(app, "cross-eq@example.com");
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

    const result = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(result).toEqual({ kind: "liquidated", eventId: expect.any(String) });

    const position = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(position?.quantity).toBe("0");
    const orders = await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.origin).toBe("LIQUIDATION");
    expect(orders[0]?.status).toBe("FILLED");
    expect(orders[0]?.reduceOnly).toBe(true);
    const listed = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: authHeaders(cookies),
    });
    expect((listed.json() as { orders: OrderResponse[] }).orders[0]?.origin).toBe("LIQUIDATION");
    expect((listed.json() as { orders: OrderResponse[] }).orders[0]).not.toHaveProperty(
      "liquidationEventId",
    );
    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.marginMode).toBe("CROSS");
    expect(events[0]?.instrumentId).toBeNull();
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("0");
  });

  it("closes every CROSS position in one event with one aggregate REALIZED_PNL ledger", async () => {
    const { accountId } = await initializeUser(app, "cross-multi@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    const sol = await upsertInstrumentBySymbol(db, sample("SOLUSDT", "SOL"));
    seedQuote(store, "BTCUSDT", { mark: "1", bid: "50", ask: "51", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "1", bid: "200", ask: "201", id: 1 });
    seedQuote(store, "SOLUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });

    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "200",
      isolatedMargin: "0",
      walletBalance: "100",
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
    await seedOpenPosition({
      accountId,
      instrumentId: sol.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "10",
    });
    await db.transaction(async (tx) => {
      await insertOpenLimitOrder(tx, {
        paperAccountId: accountId,
        instrumentId: btc.id,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.1",
        limitPrice: "90",
        reservedMargin: "0.45",
        idempotencyKey: "cross-rest",
      });
      await insertOpenLimitOrder(tx, {
        paperAccountId: accountId,
        instrumentId: sol.id,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.1",
        limitPrice: "90",
        reservedMargin: "0.9",
        idempotencyKey: "iso-rest",
      });
    });

    const result = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(result.kind).toBe("liquidated");

    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
    expect((await findPositionByAccountAndInstrument(db, accountId, eth.id))?.quantity).toBe("0");
    const isolated = await findPositionByAccountAndInstrument(db, accountId, sol.id);
    expect(isolated?.quantity).toBe("1");
    expect(isolated?.isolatedMargin).toBe("10");

    const orders = await listOrdersByPaperAccountId(db, accountId, { limit: 20, offset: 0 });
    const liq = orders.filter((row) => row.origin === "LIQUIDATION");
    expect(liq).toHaveLength(2);
    expect(orders.find((row) => row.idempotencyKey === "cross-rest")?.status).toBe("CANCELLED");
    expect(orders.find((row) => row.idempotencyKey === "iso-rest")?.status).toBe("OPEN");

    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    const transactions = (await db.select().from(ledgerTransaction)).filter(
      (row) => row.eventType === "REALIZED_PNL",
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.idempotencyKey).toBe(`liquidation-realized:${events[0]?.id}`);
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("50");
    expect(await realizedByKind()).toEqual({
      USER_CASH: "-50",
      SYSTEM_TRADING_PNL: "50",
    });
  });

  it("produces the same wallet and insurance regardless of CROSS position processing order", async () => {
    const first = await liquidateTwoCross("order-a@example.com", ["BTCUSDT", "ETHUSDT"]);
    const second = await liquidateTwoCross("order-b@example.com", ["ETHUSDT", "BTCUSDT"]);
    expect(first.wallet).toBe(second.wallet);
    expect(first.byKind).toEqual(second.byKind);
  });

  it("does not partially liquidate CROSS when any BBO is missing", async () => {
    const { accountId } = await initializeUser(app, "missing-bbo@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "1", bid: "50", ask: "51", id: 1 });
    store.applyMark({
      symbol: "ETHUSDT",
      markPrice: "1",
      indexPrice: "1",
      fundingRate: "0",
      nextFundingTime: 1,
      markEventTime: 1,
    });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "200",
      isolatedMargin: "0",
      walletBalance: "100",
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

    const result = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(result).toEqual({ kind: "noop", reason: "stale_bbo" });
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("1");
    expect((await findPositionByAccountAndInstrument(db, accountId, eth.id))?.quantity).toBe("1");
    expect(
      await listLiquidationEventsByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(0);
  });

  it("liquidates only the breached isolated position at BBO and contains the loss", async () => {
    const { accountId } = await initializeUser(app, "iso-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "1", ask: "1.1", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0.5",
      walletBalance: "1000",
    });
    await seedOpenPosition({
      accountId,
      instrumentId: eth.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "10",
    });
    await db.transaction(async (tx) => {
      await insertOpenLimitOrder(tx, {
        paperAccountId: accountId,
        instrumentId: btc.id,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.1",
        limitPrice: "90",
        reservedMargin: "0.9",
        idempotencyKey: "btc-rest",
      });
    });

    const result = await liquidateIsolatedPosition({
      paperAccountId: accountId,
      instrumentId: btc.id,
      marketData,
    });
    expect(result.kind).toBe("liquidated");
    const btcPosition = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(btcPosition?.quantity).toBe("0");
    expect(btcPosition?.isolatedMargin).toBe("0");
    const ethPosition = await findPositionByAccountAndInstrument(db, accountId, eth.id);
    expect(ethPosition?.quantity).toBe("1");
    expect(ethPosition?.isolatedMargin).toBe("10");
    const orders = await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 });
    expect(orders.find((row) => row.idempotencyKey === "btc-rest")?.status).toBe("CANCELLED");
    const liq = orders.find((row) => row.origin === "LIQUIDATION");
    expect(liq?.side).toBe("SELL");
    const executions = await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 });
    expect(executions[0]?.price).toBe("1");
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("999.5");
    const byKind = await realizedByKind();
    expect(byKind.USER_CASH).toBe("-0.5");
    expect(fromDbDecimal(byKind.SYSTEM_INSURANCE ?? "0").isNegative()).toBe(true);
    const events = await listLiquidationEventsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(events[0]?.marginMode).toBe("ISOLATED");
    expect(events[0]?.instrumentId).toBe(btc.id);
  });

  it("buys the ask when liquidating an isolated short", async () => {
    const { accountId } = await initializeUser(app, "iso-short@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "199", ask: "200", id: 1 });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "-1",
      entryPrice: "100",
      isolatedMargin: "0.5",
      walletBalance: "1000",
    });
    const result = await liquidateIsolatedPosition({
      paperAccountId: accountId,
      instrumentId: btc.id,
      marketData,
    });
    expect(result.kind).toBe("liquidated");
    const orders = await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 });
    expect(orders[0]?.side).toBe("BUY");
    const executions = await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 });
    expect(executions[0]?.price).toBe("200");
  });

  it("liquidates a SUSPENDED account and an INACTIVE instrument when BBO is fresh", async () => {
    const { accountId } = await initializeUser(app, "suspended-liq@example.com");
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
    await setPaperAccountStatusForTests(accountId, "SUSPENDED");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    const result = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(result.kind).toBe("liquidated");
    expect((await findPositionByAccountAndInstrument(db, accountId, btc.id))?.quantity).toBe("0");
  });

  async function liquidateTwoCross(email: string, symbols: string[]) {
    const { accountId } = await initializeUser(app, email);
    for (const symbol of symbols) {
      await upsertInstrumentBySymbol(
        db,
        sample(symbol, symbol.replace("USDT", "")),
      );
    }
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "1", bid: "50", ask: "51", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "1", bid: "200", ask: "201", id: 1 });
    await seedOpenPosition({
      accountId,
      instrumentId: btc.id,
      marginMode: "CROSS",
      leverage: 20,
      quantity: "1",
      entryPrice: "200",
      isolatedMargin: "0",
      walletBalance: "100",
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
    await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    return {
      wallet: toCanonicalDecimalString(account?.balance ?? "0"),
      byKind: await realizedByKind(),
    };
  }
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

function sample(symbol: string, baseAsset: string, overrides: { status?: "ACTIVE" | "INACTIVE" } = {}) {
  return {
    symbol,
    baseAsset,
    status: overrides.status ?? ("ACTIVE" as const),
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
    headers: authHeaders(cookies),
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

function authHeaders(cookies: string) {
  return { cookie: cookies, origin: process.env.WEB_ORIGIN };
}

async function realizedByKind() {
  const transactions = (await db.select().from(ledgerTransaction)).filter(
    (row) => row.eventType === "REALIZED_PNL",
  );
  const txnIds = new Set(transactions.map((row) => row.id));
  const accounts = await db.select().from(ledgerAccount);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const byKind: Record<string, string> = {};
  for (const row of await db.select().from(ledgerEntry)) {
    if (!txnIds.has(row.ledgerTransactionId)) {
      continue;
    }

    byKind[accountById.get(row.ledgerAccountId)?.kind ?? "UNKNOWN"] = toCanonicalDecimalString(
      row.amount,
    );
  }
  return byKind;
}
