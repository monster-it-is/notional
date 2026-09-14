import type { OrderResponse } from "@notional/contracts";
import {
  db,
  findOrderById,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  ledgerAccount,
  ledgerEntry,
  ledgerTransaction,
  listExecutionsByPaperAccountId,
  paperAccount,
  upsertInstrumentBySymbol,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { createLimitOrderMatcher } from "./limit-matcher.js";

const password = "correct-horse-battery";

describe("ISOLATED trading", () => {
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

  it("opens an isolated MARKET allocation without mutating wallet", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-open@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 5);

    const opened = await postOrder(app, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(opened.statusCode).toBe(201);
    const instrument = await requireInstrument("BTCUSDT");
    const position = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(position?.marginMode).toBe("ISOLATED");
    expect(position?.isolatedMargin).toBe("2.02");
    expect(toCanonicalDecimalString(position?.quantity ?? "0")).toBe("0.1");
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("1000");
  });

  it("increases isolated allocation on INCREASE and decreases it on REDUCE with contained loss", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-reduce@example.com");
    const instrument = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);

    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    const opened = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(opened?.isolatedMargin).toBe("10.1");

    expect(
      (
        await postOrder(app, cookies, "increase", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    const increased = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(increased?.isolatedMargin).toBe("20.2");

    seedQuote(store, "BTCUSDT", { mark: "50", bid: "49", ask: "51", id: 2 });
    expect(
      (
        await postOrder(app, cookies, "reduce", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    const reduced = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(toCanonicalDecimalString(reduced?.quantity ?? "0")).toBe("1");
    expect(fromDbDecimal(reduced?.isolatedMargin ?? "0").lt(fromDbDecimal("20.2"))).toBe(true);
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(fromDbDecimal(account?.balance ?? "0").gte(fromDbDecimal("900"))).toBe(true);
  });

  it("closes isolated exposure with loss limited to the former allocation", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-close@example.com");
    const instrument = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    seedQuote(store, "BTCUSDT", { mark: "1", bid: "1", ask: "1.1", id: 2 });
    expect(
      (
        await postOrder(app, cookies, "close", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: "1",
          reduceOnly: true,
        })
      ).statusCode,
    ).toBe(201);
    const closed = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(closed?.quantity).toBe("0");
    expect(closed?.isolatedMargin).toBe("0");
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("989.9");
    const realized = await realizedByKind();
    expect(realized.USER_CASH).toBe("-10.1");
    expect(fromDbDecimal(realized.SYSTEM_INSURANCE ?? "0").isNegative()).toBe(true);
  });

  it("credits isolated close profit in full", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-profit@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    seedQuote(store, "BTCUSDT", { mark: "120", bid: "119", ask: "121", id: 2 });
    expect(
      (
        await postOrder(app, cookies, "close", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "SELL",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("1018");
  });

  it("rejects isolated REVERSE immediately", async () => {
    const { cookies } = await initializeUser(app, "iso-reverse@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.1",
        })
      ).statusCode,
    ).toBe(201);
    const reverse = await postOrder(app, cookies, "reverse", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "1",
    });
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json()).toEqual({ error: "ISOLATED_REVERSE_NOT_SUPPORTED" });
  });

  it("rejects a resting isolated order that is already REVERSE at placement", async () => {
    const { cookies } = await initializeUser(app, "iso-reverse-rest@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.1",
        })
      ).statusCode,
    ).toBe(201);
    const reverse = await postOrder(app, cookies, "reverse-limit", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "1",
      limitPrice: "90",
    });
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json()).toEqual({ error: "ISOLATED_REVERSE_NOT_SUPPORTED" });
  });

  it("leaves a later-REVERSE isolated LIMIT OPEN in the matcher", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-later-reverse@example.com");
    const instrument = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    const resting = await postOrder(app, cookies, "sell-200", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "200",
    });
    expect((resting.json() as OrderResponse).status).toBe("OPEN");
    expect(
      (
        await postOrder(app, cookies, "open-long", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.05",
        })
      ).statusCode,
    ).toBe(201);
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "200", ask: "201", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const row = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(row?.status).toBe("OPEN");
    const position = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(toCanonicalDecimalString(position?.quantity ?? "0")).toBe("0.05");
  });

  it("turns a resting isolated LIMIT reservation into isolated allocation on fill", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-rest@example.com");
    const instrument = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect((resting.json() as OrderResponse).status).toBe("OPEN");
    const open = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(open?.reservedMargin).toBe("0.9");
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const filled = await findOrderById(db, accountId, open!.id);
    expect(filled?.status).toBe("FILLED");
    expect(filled?.reservedMargin).toBe("0");
    const position = await findPositionByAccountAndInstrument(db, accountId, instrument.id);
    expect(position?.isolatedMargin).toBe("0.9");
  });

  it("rolls back an isolated SELL price-improvement fill and restores the OPEN reservation", async () => {
    const { cookies, accountId } = await initializeUser(app, "iso-improve@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    const resting = await postOrder(app, cookies, "sell-100", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "1",
      limitPrice: "100",
    });
    expect(resting.statusCode).toBe(201);
    const order = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(order?.status).toBe("OPEN");
    expect(order?.reservedMargin).toBe("10");
    seedQuote(store, "BTCUSDT", { mark: "10000", bid: "10000.1", ask: "10000.2", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const after = await findOrderById(db, accountId, order!.id);
    expect(after?.status).toBe("OPEN");
    expect(after?.reservedMargin).toBe("10");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );
  });

  it("still allows isolated reduceOnly exit-safety filters", async () => {
    const { cookies } = await initializeUser(app, "iso-exit@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await putIsolated(app, cookies, 10);
    expect(
      (
        await postOrder(app, cookies, "open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "0.1",
        })
      ).statusCode,
    ).toBe(201);
    const exit = await postOrder(app, cookies, "exit", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0004",
      reduceOnly: true,
    });
    expect(exit.statusCode).toBe(201);
  });
});

async function putIsolated(instance: FastifyInstance, cookies: string, leverage: number) {
  const settings = await instance.inject({
    method: "PUT",
    url: "/api/margin-settings/BTCUSDT",
    headers: authHeaders(cookies),
    payload: { marginMode: "ISOLATED", leverage },
  });
  expect(settings.statusCode).toBe(200);
}

async function requireInstrument(symbol: string) {
  const row = await upsertInstrumentBySymbol(db, sample(symbol, symbol.replace("USDT", "")));
  return row;
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

async function postOrder(
  instance: FastifyInstance,
  cookies: string,
  key: string,
  payload: Record<string, unknown>,
) {
  return instance.inject({
    method: "POST",
    url: "/api/orders",
    headers: {
      ...authHeaders(cookies),
      "Idempotency-Key": key,
    },
    payload,
  });
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
