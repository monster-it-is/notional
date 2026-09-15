import type { OrderResponse } from "@notional/contracts";
import {
  db,
  findOrderById,
  findPaperAccountByUserId,
  listExecutionsByPaperAccountId,
  listOrdersByPaperAccountId,
  paperAccount,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import type { Logger } from "../market-data/types.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./funding-test-fixtures.js";
import { createLimitOrderMatcher } from "./limit-matcher.js";

const password = "correct-horse-battery";

describe("in-process LIMIT matcher", () => {
  let now = 1_000;
  let store: MarketDataStore;
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

  it("fills a marketable resting LIMIT and leaves a non-marketable order OPEN", async () => {
    const { cookies, accountId } = await initializeUser(app, "match-fill@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const marketable = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    const resting = await postOrder(app, cookies, "buy-80", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "80",
    });
    expect((marketable.json() as OrderResponse).status).toBe("OPEN");
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    const matcher = createLimitOrderMatcher({ marketData });
    await matcher.processSymbol("BTCUSDT");

    const filled = await findOrderById(db, accountId, (marketable.json() as OrderResponse).id);
    const stillOpen = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(filled?.status).toBe("FILLED");
    expect(filled?.reservedMargin).toBe("0");
    expect(stillOpen?.status).toBe("OPEN");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );
  });

  it("does not fill when the post-lock BBO re-read is stale", async () => {
    const { cookies, accountId } = await initializeUser(app, "stale-match@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    now = 100_000;
    const matcher = createLimitOrderMatcher({ marketData });
    await matcher.processSymbol("BTCUSDT");
    const row = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(row?.status).toBe("OPEN");
    expect(row?.reservedMargin).toBe("9");
  });

  it("fills older createdAt/id first", async () => {
    const { cookies, accountId } = await initializeUser(app, "fifo@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const first = await postOrder(app, cookies, "first", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    const second = await postOrder(app, cookies, "second", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const executions = await listExecutionsByPaperAccountId(db, accountId, {
      limit: 10,
      offset: 0,
    });
    expect(executions).toHaveLength(2);
    expect(executions[1]?.orderId).toBe((first.json() as OrderResponse).id);
    expect(executions[0]?.orderId).toBe((second.json() as OrderResponse).id);
  });

  it("coalesces dirty ticks and does not execute an order twice", async () => {
    const { cookies, accountId } = await initializeUser(app, "dirty@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    const matcher = createLimitOrderMatcher({ marketData });
    matcher.schedule("BTCUSDT");
    matcher.schedule("BTCUSDT");
    matcher.schedule("BTCUSDT");
    await matcher.waitForIdle();
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );
    expect((await findOrderById(db, accountId, (resting.json() as OrderResponse).id))?.status).toBe(
      "FILLED",
    );
  });

  it("re-classifies reduceOnly against the locked position and leaves OPEN when invalid", async () => {
    const { cookies, accountId } = await initializeUser(app, "ro-recheck@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await postOrder(app, cookies, "long", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    const reduce = await postOrder(app, cookies, "ro", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "110",
      reduceOnly: true,
    });
    await postOrder(app, cookies, "flat", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      reduceOnly: true,
    });
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "110", ask: "111", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const row = await findOrderById(db, accountId, (reduce.json() as OrderResponse).id);
    expect(row?.status).toBe("OPEN");
    expect(row?.reservedMargin).toBe("0");
  });

  it("rolls back a SELL LIMIT price-improvement fill that fails post-fill margin and keeps the original reservation", async () => {
    const { cookies, accountId } = await initializeUser(app, "sell-130@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "sell-100", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "10",
      limitPrice: "100",
    });
    expect(resting.statusCode).toBe(201);
    const order = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(order?.status).toBe("OPEN");
    expect(order?.reservedMargin).toBe("1000");

    seedQuote(store, "BTCUSDT", { mark: "130", bid: "130", ask: "131", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");

    const after = await findOrderById(db, accountId, order!.id);
    expect(after?.status).toBe("OPEN");
    expect(after?.reservedMargin).toBe("1000");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );
    const account = (await db.select().from(paperAccount)).find((row) => row.id === accountId);
    expect(toCanonicalDecimalString(account?.balance ?? "0")).toBe("1000");
  });

  it("does not fill or release reservation for an INACTIVE instrument", async () => {
    const { cookies, accountId } = await initializeUser(app, "inactive-match@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const row = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(row?.status).toBe("OPEN");
    expect(row?.reservedMargin).toBe("9");
  });

  it("fills an INACTIVE reduceOnly REDUCE/CLOSE LIMIT with a fresh BBO", async () => {
    const { cookies, accountId } = await initializeUser(app, "inactive-ro-match@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const opened = await postOrder(app, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(opened.statusCode).toBe(201);
    const resting = await postOrder(app, cookies, "exit-limit", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "110",
      reduceOnly: true,
    });
    expect((resting.json() as OrderResponse).status).toBe("OPEN");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "110", ask: "111", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");
    const row = await findOrderById(db, accountId, (resting.json() as OrderResponse).id);
    expect(row?.status).toBe("FILLED");
    expect(row?.reservedMargin).toBe("0");
  });

  it("serializes cancel versus matcher to one terminal outcome", async () => {
    const { cookies, accountId } = await initializeUser(app, "cancel-race@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    const id = (resting.json() as OrderResponse).id;
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    const matcher = createLimitOrderMatcher({ marketData });
    const [cancel] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/orders/${id}/cancel`,
        headers: authHeaders(cookies),
      }),
      matcher.processSymbol("BTCUSDT"),
    ]);
    const row = await findOrderById(db, accountId, id);
    expect(row?.status === "CANCELLED" || row?.status === "FILLED").toBe(true);
    if (row?.status === "CANCELLED") {
      expect(row.reservedMargin).toBe("0");
      expect(cancel.statusCode).toBe(200);
    } else {
      expect(row?.reservedMargin).toBe("0");
      expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
        1,
      );
    }
    expect(await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(1);
  });

  it("continues the symbol cycle when post-fill CROSS risk lacks a fresh mark", async () => {
    const accountA = await initializeUser(app, "stale-mark-a@example.com");
    const accountB = await initializeUser(app, "stale-mark-b@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });

    const eth = await postOrder(app, accountA.cookies, "eth-open", {
      type: "MARKET",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(eth.statusCode).toBe(201);

    const candidateA = await postOrder(app, accountA.cookies, "btc-a", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    const candidateB = await postOrder(app, accountB.cookies, "btc-b", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(candidateA.statusCode).toBe(201);
    expect(candidateB.statusCode).toBe(201);

    now = 100_000;
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    await createLimitOrderMatcher({ marketData }).processSymbol("BTCUSDT");

    const orderA = await findOrderById(
      db,
      accountA.accountId,
      (candidateA.json() as OrderResponse).id,
    );
    const orderB = await findOrderById(
      db,
      accountB.accountId,
      (candidateB.json() as OrderResponse).id,
    );
    expect(orderA?.status).toBe("OPEN");
    expect(orderA?.reservedMargin).toBe("9");
    expect(orderB?.status).toBe("FILLED");
    expect(
      await listExecutionsByPaperAccountId(db, accountA.accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
    expect(
      await listExecutionsByPaperAccountId(db, accountB.accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(1);
  });

  it("logs unexpected cycle errors and stays usable for a later tick", async () => {
    const { cookies, accountId } = await initializeUser(app, "matcher-log@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(resting.statusCode).toBe(201);

    let fail = true;
    const throwing: MarketDataAccess = {
      ...marketData,
      getFreshBook(symbol) {
        if (fail) {
          throw new Error("matcher boom");
        }

        return store.getFreshBook(symbol, 60_000);
      },
    };
    const logs: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const logger: Logger = {
      info() {},
      warn() {},
      error(message, extra) {
        logs.push({ message, extra });
      },
    };
    const matcher = createLimitOrderMatcher({ marketData: throwing, logger });

    await expect(matcher.processSymbol("BTCUSDT")).rejects.toThrow("matcher boom");
    matcher.schedule("BTCUSDT");
    await matcher.waitForIdle();
    expect(logs).toEqual([
      {
        message: "limit matcher cycle failed",
        extra: { symbol: "BTCUSDT", detail: "matcher boom" },
      },
    ]);
    expect((await findOrderById(db, accountId, (resting.json() as OrderResponse).id))?.status).toBe(
      "OPEN",
    );

    fail = false;
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
    matcher.schedule("BTCUSDT");
    await matcher.waitForIdle();
    expect((await findOrderById(db, accountId, (resting.json() as OrderResponse).id))?.status).toBe(
      "FILLED",
    );
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );
  });

  it("schedules matcher after a new OPEN LIMIT commits so a newer store BBO still fills", async () => {
    await app.close();
    let observedPlacementBook = false;
    const racing: MarketDataAccess = {
      ...accessFromStore(store),
      getFreshBook(symbol) {
        const book = store.getFreshBook(symbol, 60_000);
        if (!observedPlacementBook) {
          observedPlacementBook = true;
          seedQuote(store, "BTCUSDT", { mark: "100", bid: "89", ask: "90", id: 2 });
        }
        return book;
      },
    };
    const matcher = createLimitOrderMatcher({ marketData: racing });
    app = await buildApp({
      marketData: racing,
      onOpenOrderCommitted: (symbol) => matcher.schedule(symbol),
    });
    const { cookies, accountId } = await initializeUser(app, "commit-race@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const response = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as OrderResponse).status).toBe("OPEN");
    await matcher.waitForIdle();

    const filled = await findOrderById(db, accountId, (response.json() as OrderResponse).id);
    expect(filled?.status).toBe("FILLED");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );

    const replay = await postOrder(app, cookies, "buy-90", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as OrderResponse).status).toBe("FILLED");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );
  });

  it("leaves an ordinary nonmarketable OPEN LIMIT open after the post-commit matcher cycle", async () => {
    await app.close();
    const matcher = createLimitOrderMatcher({ marketData });
    app = await buildApp({
      marketData,
      onOpenOrderCommitted: (symbol) => matcher.schedule(symbol),
    });
    const { cookies, accountId } = await initializeUser(app, "post-commit-open@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const response = await postOrder(app, cookies, "buy-80", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "80",
    });
    expect(response.statusCode).toBe(201);
    await matcher.waitForIdle();

    const row = await findOrderById(db, accountId, (response.json() as OrderResponse).id);
    expect(row?.status).toBe("OPEN");
    expect(row?.reservedMargin).toBe("8");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );

    const replay = await postOrder(app, cookies, "buy-80", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "80",
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as OrderResponse).status).toBe("OPEN");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );
    expect(await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(1);
  });
});

function accessFromStore(store: MarketDataStore, staleMs = 60_000): MarketDataAccess {
  return {
    getFreshMark(symbol) {
      return store.getFreshMark(symbol, staleMs);
    },
    getFreshBook(symbol) {
      return store.getFreshBook(symbol, staleMs);
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
  store.applyMark(markTick(symbol, quote.mark, quote.id));
  store.applyBook(bookTick(symbol, quote.bid, quote.ask, quote.id));
}

function markTick(symbol: string, markPrice: string, markEventTime: number) {
  return {
    symbol,
    markPrice,
    indexPrice: markPrice,
    fundingRate: "0",
    nextFundingTime: 1,
    markEventTime,
  };
}

function bookTick(symbol: string, bid: string, ask: string, bookUpdateId: number) {
  return {
    symbol,
    bestBidPrice: bid,
    bestAskPrice: ask,
    bestBidQty: "1",
    bestAskQty: "1",
    bookUpdateId,
    bookEventTime: bookUpdateId,
  };
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

async function postOrder(
  app: FastifyInstance,
  cookies: string,
  key: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/api/orders",
    headers: {
      ...authHeaders(cookies),
      "Idempotency-Key": key,
    },
    payload,
  });
}

async function initializeUser(app: FastifyInstance, email: string) {
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { name: "Ada Lovelace", email, password },
  });
  const cookies = signup.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const initialized = await app.inject({
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
