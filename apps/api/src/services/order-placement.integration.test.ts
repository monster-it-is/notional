import type {
  ExecutionListResponse,
  OrderResponse,
} from "@notional/contracts";
import {
  db,
  ensurePosition,
  findOrderById,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  insertFilledOrderWithExecution,
  ledgerAccount,
  ledgerEntry,
  ledgerTransaction,
  listExecutionsByPaperAccountId,
  listFundingEventsByPaperAccountId,
  listOrdersByPaperAccountId,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  paperAccount,
  upsertInstrumentBySymbol,
} from "@notional/db";
import { endTestPool, resetTestTables, setPaperAccountStatusForTests } from "@notional/db/test";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { MarketDataAccess } from "../market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "../market-data/market-data-store.js";
import { applyCreatedFillEffectsInTx } from "./order-placement.js";

const password = "correct-horse-battery";

describe("atomic CROSS order placement", () => {
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

  it("fills a MARKET BUY at the ask and a MARKET SELL at the bid", async () => {
    const { cookies } = await initializeUser(app, "market-fill@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const buy = await postOrder(app, cookies, "buy-1", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(buy.statusCode).toBe(201);
    const buyBody = buy.json() as OrderResponse;
    expect(buyBody.status).toBe("FILLED");
    expect(buyBody).not.toHaveProperty("reservedMargin");

    const executions = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeaders(cookies),
    });
    expect((executions.json() as ExecutionListResponse).executions[0]?.price).toBe("101");

    const sell = await postOrder(app, cookies, "sell-1", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
    });
    expect(sell.statusCode).toBe(201);
    const listed = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeaders(cookies),
    });
    const prices = (listed.json() as ExecutionListResponse).executions.map((row) => row.price);
    expect(prices).toContain("99");
  });

  it("uses mark for MARKET MIN_NOTIONAL and BBO for the fill price", async () => {
    const { cookies } = await initializeUser(app, "min-notional@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(store, "BTCUSDT", { mark: "40", bid: "39", ask: "101", id: 2 });

    const rejected = await postOrder(app, cookies, "too-small", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: "INVALID_ORDER", reason: "MIN_NOTIONAL" });

    seedQuote(store, "BTCUSDT", { mark: "100", bid: "39", ask: "40", id: 3 });
    const filled = await postOrder(app, cookies, "bbo-fill", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(filled.statusCode).toBe(201);
    const executions = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeaders(cookies),
    });
    expect((executions.json() as ExecutionListResponse).executions[0]?.price).toBe("40");
  });

  it("fails closed on stale book and stale CROSS marks", async () => {
    const { cookies } = await initializeUser(app, "stale@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    now = 100_000;

    const staleBook = await postOrder(app, cookies, "stale-book", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(staleBook.statusCode).toBe(503);
    expect(staleBook.json()).toEqual({ error: "MARKET_DATA_UNAVAILABLE" });

    now = 1_000;
    await postOrder(app, cookies, "open-btc", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "99", ask: "101", id: 4 });
    now = 100_000;
    store.applyMark(markTick("ETHUSDT", "100", 5), 100_000);
    store.applyBook(bookTick("ETHUSDT", "99", "101", 5), 100_000);

    const staleMark = await postOrder(app, cookies, "eth-rest", {
      type: "LIMIT",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    expect(staleMark.statusCode).toBe(503);
    expect(staleMark.json()).toEqual({ error: "MARKET_DATA_UNAVAILABLE" });
  });

  it("rejects ISOLATED trading even while flat", async () => {
    const { cookies } = await initializeUser(app, "isolated@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const settings = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "ISOLATED", leverage: 5 },
    });
    expect(settings.statusCode).toBe(200);

    const response = await postOrder(app, cookies, "iso", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ISOLATED_TRADING_NOT_AVAILABLE" });
  });

  it("rejects INACTIVE instruments for new placement", async () => {
    const { cookies, accountId } = await initializeUser(app, "inactive-place@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    const response = await postOrder(app, cookies, "inactive", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "INSTRUMENT_INACTIVE" });
    expect(
      await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 }),
    ).toHaveLength(0);
  });

  it("allows reduceOnly off-step, below-minQty, below-MIN_NOTIONAL exits and rejects the same qty without reduceOnly", async () => {
    const { cookies } = await initializeUser(app, "exit@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await postOrder(app, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });

    const invalidMarket = await postOrder(app, cookies, "bad-qty", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0004",
    });
    expect(invalidMarket.statusCode).toBe(400);
    expect((invalidMarket.json() as { error: string }).error).toBe("INVALID_ORDER");

    const invalidLimit = await postOrder(app, cookies, "bad-limit", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0004",
      limitPrice: "110",
    });
    expect(invalidLimit.statusCode).toBe(400);

    const exit = await postOrder(app, cookies, "exit", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0004",
      reduceOnly: true,
    });
    expect(exit.statusCode).toBe(201);

    const limitExit = await postOrder(app, cookies, "limit-exit", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0004",
      limitPrice: "110",
      reduceOnly: true,
    });
    expect(limitExit.statusCode).toBe(201);
    expect((limitExit.json() as OrderResponse).status).toBe("OPEN");
  });

  it("rejects reduceOnly OPEN/INCREASE/REVERSE and still enforces PRICE_FILTER on reduceOnly LIMIT", async () => {
    const { cookies } = await initializeUser(app, "reduce-open@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const open = await postOrder(app, cookies, "ro-open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      reduceOnly: true,
    });
    expect(open.statusCode).toBe(409);
    expect(open.json()).toEqual({ error: "REDUCE_ONLY_VIOLATION" });

    await postOrder(app, cookies, "long", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    const increase = await postOrder(app, cookies, "ro-inc", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      reduceOnly: true,
    });
    expect(increase.statusCode).toBe(409);
    expect(increase.json()).toEqual({ error: "REDUCE_ONLY_VIOLATION" });

    const reverse = await postOrder(app, cookies, "ro-rev", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.2",
      reduceOnly: true,
    });
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json()).toEqual({ error: "REDUCE_ONLY_VIOLATION" });

    const badTick = await postOrder(app, cookies, "bad-tick", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "100.05",
      reduceOnly: true,
    });
    expect(badTick.statusCode).toBe(400);
    expect(badTick.json()).toEqual({ error: "INVALID_ORDER", reason: "INVALID_PRICE" });
  });

  it("does not require a fresh mark for MARKET reduceOnly CLOSE", async () => {
    const bookOnly = createMarketDataStore();
    const access: MarketDataAccess = {
      ...accessFromStore(bookOnly),
      getFreshMark: (symbol) => bookOnly.getFreshMark(symbol, 60_000),
    };
    const bookApp = await buildApp({ marketData: access });
    const { cookies } = await initializeUser(bookApp, "no-mark@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    seedQuote(bookOnly, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    await postOrder(bookApp, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });

    const closedBook = createMarketDataStore();
    closedBook.applyBook(bookTick("BTCUSDT", "99", "101", 2));
    const closeApp = await buildApp({
      marketData: {
        ...accessFromStore(closedBook),
        getFreshMark() {
          return null;
        },
      },
    });
    const close = await postOrder(closeApp, cookies, "close", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      reduceOnly: true,
    });
    expect(close.statusCode).toBe(201);

    const nonReduce = await postOrder(closeApp, cookies, "needs-mark", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(nonReduce.statusCode).toBe(503);
    await bookApp.close();
    await closeApp.close();
  });

  it("rests a non-marketable LIMIT with ROUND_UP reservation and reduceOnly with 0", async () => {
    const { cookies, accountId } = await initializeUser(app, "rest@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const leverage = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "CROSS", leverage: 3 },
    });
    expect(leverage.statusCode).toBe(200);

    const resting = await postOrder(app, cookies, "rest", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "1",
      limitPrice: "10",
    });
    expect(resting.statusCode).toBe(201);
    const body = resting.json() as OrderResponse;
    expect(body.status).toBe("OPEN");
    expect(body).not.toHaveProperty("reservedMargin");
    const row = await findOrderById(db, accountId, body.id);
    expect(row?.reservedMargin).toBe("3.333333333333333334");

    await app.inject({
      method: "POST",
      url: `/api/orders/${body.id}/cancel`,
      headers: authHeaders(cookies),
    });
    await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "CROSS", leverage: 1 },
    });
    await postOrder(app, cookies, "long", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    const reduceRest = await postOrder(app, cookies, "ro-rest", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "110",
      reduceOnly: true,
    });
    expect(reduceRest.statusCode).toBe(201);
    const reduceRow = await findOrderById(db, accountId, (reduceRest.json() as OrderResponse).id);
    expect(reduceRow?.reservedMargin).toBe("0");
  });

  it("fills a marketable LIMIT at the improved BBO with reserved_margin 0", async () => {
    const { cookies, accountId } = await initializeUser(app, "improve@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const filled = await postOrder(app, cookies, "mkt-limit", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "110",
    });
    expect(filled.statusCode).toBe(201);
    expect((filled.json() as OrderResponse).status).toBe("FILLED");
    const row = await findOrderById(db, accountId, (filled.json() as OrderResponse).id);
    expect(row?.reservedMargin).toBe("0");
    const executions = await app.inject({
      method: "GET",
      url: "/api/executions",
      headers: authHeaders(cookies),
    });
    expect((executions.json() as ExecutionListResponse).executions[0]?.price).toBe("101");
  });

  it("rejects a resting LIMIT when available balance is below the reservation", async () => {
    const { cookies, accountId } = await initializeUser(app, "no-margin@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const rejected = await postOrder(app, cookies, "too-big", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "20",
      limitPrice: "90",
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({ error: "INSUFFICIENT_MARGIN" });
    expect(await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(0);
  });

  it("rejects OPEN/INCREASE that fail post-fill CROSS risk and allows REDUCE/CLOSE with negative available", async () => {
    const { cookies } = await initializeUser(app, "risk@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));

    const tooBig = await postOrder(app, cookies, "open-fail", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "20",
    });
    expect(tooBig.statusCode).toBe(409);
    expect(tooBig.json()).toEqual({ error: "INSUFFICIENT_MARGIN" });

    const leverage = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "CROSS", leverage: 10 },
    });
    expect(leverage.statusCode).toBe(200);
    await postOrder(app, cookies, "open-ok", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "50",
    });
    seedQuote(store, "BTCUSDT", { mark: "80", bid: "79", ask: "81", id: 8 });

    const close = await postOrder(app, cookies, "close-neg", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "50",
      reduceOnly: true,
    });
    expect(close.statusCode).toBe(201);
    expect((close.json() as OrderResponse).status).toBe("FILLED");
  });

  it("settles profit, ordinary loss, and bankruptcy with balanced REALIZED_PNL ledger entries", async () => {
    const profit = await roundTripPnl("profit@example.com", { openBid: "100", closeAsk: "80" });
    expect(profit.wallet).toBe("1020");
    expect(profit.byKind).toEqual({
      USER_CASH: "20",
      SYSTEM_TRADING_PNL: "-20",
    });
    expect(profit.sum).toBe("0");
    expect(profit.fundingCount).toBe(1);
    expect(profit.positionPnl).toBe("20");

    const loss = await roundTripPnl("loss@example.com", { openBid: "100", closeAsk: "130" });
    expect(loss.wallet).toBe("970");
    expect(loss.byKind).toEqual({
      USER_CASH: "-30",
      SYSTEM_TRADING_PNL: "30",
    });
    expect(loss.sum).toBe("0");
    expect(loss.positionPnl).toBe("-30");

    const bust = await roundTripPnl("bust@example.com", {
      quantity: "10",
      openBid: "100",
      closeAsk: "250",
    });
    expect(bust.wallet).toBe("0");
    expect(bust.byKind).toEqual({
      USER_CASH: "-1000",
      SYSTEM_INSURANCE: "-500",
      SYSTEM_TRADING_PNL: "1500",
    });
    expect(bust.sum).toBe("0");
    expect(bust.positionPnl).toBe("-1500");
  });

  it("does not post REALIZED_PNL or mutate the wallet on a zero-delta OPEN", async () => {
    const { cookies, accountId } = await initializeUser(app, "zero-delta@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await postOrder(app, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    const account = await requireAccount(accountId);
    expect(toCanonicalDecimalString(account.balance)).toBe("1000");
    expect(await realizedPnlTransactions()).toHaveLength(0);
  });

  it("rolls back order, execution, position, wallet, and ledger when fill effects throw", async () => {
    const { cookies, accountId } = await initializeUser(app, "rollback@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await postOrder(app, cookies, "open", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });

    await expect(
      db.transaction(async (tx) => {
        const account = await lockPaperAccountById(tx, accountId);
        await ensurePosition(tx, accountId, btc.id);
        const position = await lockPositionByAccountAndInstrument(tx, accountId, btc.id);
        const fill = await insertFilledOrderWithExecution(tx, {
          paperAccountId: accountId,
          instrumentId: btc.id,
          side: "SELL",
          orderType: "MARKET",
          quantity: "0.1",
          reduceOnly: true,
          executionPrice: "90",
          idempotencyKey: "forced-close",
        });
        if (fill.kind !== "created_filled") {
          throw new Error(`unexpected ${fill.kind}`);
        }
        await applyCreatedFillEffectsInTx(tx, {
          account,
          lockedPosition: position,
          fill,
          marketData: accessFromStore(store),
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const account = await requireAccount(accountId);
    expect(toCanonicalDecimalString(account.balance)).toBe("1000");
    const position = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(position?.quantity).toBe("0.1");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );
    expect(await realizedPnlTransactions()).toHaveLength(0);
  });

  it("replays the same idempotency key without a second effect after suspend, inactivity, stale market, and leverage change", async () => {
    const { cookies, accountId } = await initializeUser(app, "idem@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const payload = {
      type: "MARKET" as const,
      symbol: "BTCUSDT",
      side: "BUY" as const,
      quantity: "0.1",
    };
    const first = await postOrder(app, cookies, "same", payload);
    const second = await postOrder(app, cookies, "same", payload);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as OrderResponse).id).toBe((first.json() as OrderResponse).id);
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      1,
    );

    await postOrder(app, cookies, "flat", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      reduceOnly: true,
    });
    await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "CROSS", leverage: 9 },
    });
    expect((await postOrder(app, cookies, "same", payload)).statusCode).toBe(200);

    await setPaperAccountStatusForTests(accountId, "SUSPENDED");
    expect((await postOrder(app, cookies, "same", payload)).statusCode).toBe(200);

    await setPaperAccountStatusForTests(accountId, "ACTIVE");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    expect((await postOrder(app, cookies, "same", payload)).statusCode).toBe(200);

    now = 100_000;
    expect((await postOrder(app, cookies, "same", payload)).statusCode).toBe(200);

    const reused = await postOrder(app, cookies, "same", { ...payload, quantity: "0.2" });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({ error: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("creates only one order under concurrent same-key submissions", async () => {
    const { cookies, accountId } = await initializeUser(app, "race@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const payload = {
      type: "LIMIT" as const,
      symbol: "BTCUSDT",
      side: "BUY" as const,
      quantity: "0.1",
      limitPrice: "90",
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => postOrder(app, cookies, "race-key", payload)),
    );
    const ids = new Set(
      results
        .filter((row) => row.statusCode === 200 || row.statusCode === 201)
        .map((row) => (row.json() as OrderResponse).id),
    );
    expect(ids.size).toBe(1);
    expect(results.some((row) => row.statusCode === 201)).toBe(true);
    expect(results.filter((row) => row.statusCode === 201)).toHaveLength(1);
    expect(await listOrdersByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(1);
  });

  it("cancels OPEN orders, is idempotent, rejects FILLED, and works while suspended or INACTIVE", async () => {
    const { cookies, accountId } = await initializeUser(app, "cancel@example.com");
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const resting = await postOrder(app, cookies, "c1", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    const id = (resting.json() as OrderResponse).id;
    const first = await app.inject({
      method: "POST",
      url: `/api/orders/${id}/cancel`,
      headers: authHeaders(cookies),
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/orders/${id}/cancel`,
      headers: authHeaders(cookies),
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as OrderResponse).status).toBe("CANCELLED");
    expect(second.statusCode).toBe(200);
    expect((await findOrderById(db, accountId, id))?.reservedMargin).toBe("0");

    const filled = await postOrder(app, cookies, "filled", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    const cancelFilled = await app.inject({
      method: "POST",
      url: `/api/orders/${(filled.json() as OrderResponse).id}/cancel`,
      headers: authHeaders(cookies),
    });
    expect(cancelFilled.statusCode).toBe(409);
    expect(cancelFilled.json()).toEqual({ error: "ORDER_NOT_CANCELLABLE" });

    await postOrder(app, cookies, "flat", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      reduceOnly: true,
    });
    const another = await postOrder(app, cookies, "c2", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    await setPaperAccountStatusForTests(accountId, "SUSPENDED");
    const suspended = await app.inject({
      method: "POST",
      url: `/api/orders/${(another.json() as OrderResponse).id}/cancel`,
      headers: authHeaders(cookies),
    });
    expect(suspended.statusCode).toBe(200);

    await setPaperAccountStatusForTests(accountId, "ACTIVE");
    const inactiveRest = await postOrder(app, cookies, "c3", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
      limitPrice: "90",
    });
    await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC", { status: "INACTIVE" }));
    const inactiveCancel = await app.inject({
      method: "POST",
      url: `/api/orders/${(inactiveRest.json() as OrderResponse).id}/cancel`,
      headers: authHeaders(cookies),
    });
    expect(inactiveCancel.statusCode).toBe(200);
  });
});

async function roundTripPnl(
  email: string,
  params: { quantity?: string; openBid: string; closeAsk: string },
) {
  const quantity = params.quantity ?? "1";
  let clock = 1_000;
  const store = createMarketDataStore({ now: () => clock });
  const app = await buildApp({ marketData: accessFromStore(store) });
  const { cookies, accountId } = await initializeUser(app, email);
  const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  seedQuote(store, "BTCUSDT", {
    mark: params.openBid,
    bid: params.openBid,
    ask: nextTick(params.openBid, "1"),
    id: 1,
  });
  const opened = await postOrder(app, cookies, "open-short", {
    type: "MARKET",
    symbol: "BTCUSDT",
    side: "SELL",
    quantity,
  });
  expect(opened.statusCode).toBe(201);
  clock = 2_000;
  seedQuote(store, "BTCUSDT", {
    mark: params.closeAsk,
    bid: nextTick(params.closeAsk, "-1"),
    ask: params.closeAsk,
    id: 2,
  });
  const closed = await postOrder(app, cookies, "close-short", {
    type: "MARKET",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity,
    reduceOnly: true,
  });
  expect(closed.statusCode).toBe(201);
  const account = await requireAccount(accountId);
  const executions = await listExecutionsByPaperAccountId(db, accountId, { limit: 50, offset: 0 });
  const keys = new Set(executions.map((row) => `realized-pnl:${row.id}`));
  const transactions = (await db.select().from(ledgerTransaction)).filter((row) =>
    keys.has(row.idempotencyKey),
  );
  const txnIds = new Set(transactions.map((row) => row.id));
  const accounts = await db.select().from(ledgerAccount);
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const realized = (await db.select().from(ledgerEntry))
    .filter((row) => txnIds.has(row.ledgerTransactionId))
    .map((row) => ({
      amount: row.amount,
      kind: accountById.get(row.ledgerAccountId)?.kind ?? "UNKNOWN",
    }));
  const byKind: Record<string, string> = {};
  let sum = fromDbDecimal("0");
  for (const row of realized) {
    byKind[row.kind] = asMoney(row.amount);
    sum = sum.plus(fromDbDecimal(row.amount));
  }
  const fundingCount = (
    await listFundingEventsByPaperAccountId(db, accountId, { limit: 50, offset: 0 })
  ).length;
  const position = await findPositionByAccountAndInstrument(db, accountId, btc.id);
  await app.close();
  return {
    wallet: asMoney(account.balance),
    byKind,
    sum: sum.isZero() ? "0" : sum.toFixed(),
    fundingCount,
    positionPnl: position?.realizedPnl,
  };
}

function nextTick(price: string, delta: string) {
  return asMoney(fromDbDecimal(price).plus(fromDbDecimal(delta)).toFixed());
}

function asMoney(value: string) {
  return toCanonicalDecimalString(value);
}

async function realizedPnlTransactions() {
  return (await db.select().from(ledgerTransaction)).filter(
    (row) => row.eventType === "REALIZED_PNL",
  );
}

async function requireAccount(accountId: string) {
  const row = (await db.select().from(paperAccount)).find((account) => account.id === accountId);
  if (!row) {
    throw new Error("missing paper account");
  }
  return row;
}

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
  const signup = await signUp(app, email);
  const cookies = cookieHeader(signup);
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

async function signUp(app: FastifyInstance, email: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: process.env.WEB_ORIGIN },
    payload: { name: "Ada Lovelace", email, password },
  });
}

function cookieHeader(response: { cookies: Array<{ name: string; value: string }> }) {
  return response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function authHeaders(cookies: string) {
  return { cookie: cookies, origin: process.env.WEB_ORIGIN };
}
