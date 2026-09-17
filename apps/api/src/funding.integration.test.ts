import type { PerpFundingHistoryResponse } from "@notional/contracts";
import {
  db,
  ensurePerpFundingSourceState,
  ensurePosition,
  findAccountSettlementByAccountAndTime,
  findPaperAccountByUserId,
  findPositionByAccountAndInstrument,
  fromDbDecimal,
  insertReadyFundingCycle,
  listExecutionsByPaperAccountId,
  lockPaperAccountById,
  updateMarginSettingsForFlatPosition,
  updatePaperAccountBalance,
  updatePositionState,
  upsertInstrumentBySymbol,
  MoneyDecimal,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { env } from "./env.js";
import type { MarketDataAccess } from "./market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "./market-data/market-data-store.js";
import { createLimitOrderMatcher } from "./services/limit-matcher.js";
import { liquidateCrossAccount } from "./services/liquidation.js";
import { settleDueFundingForAccountInTx } from "./services/funding-settlement.js";
import {
  futureFundingTimeFrom,
  getDatabaseNow,
  liveScheduleProofFrom,
} from "./services/funding-test-fixtures.js";
import {
  clearLiveScheduleProofs,
  setLiveScheduleProof,
} from "./services/funding-sync.js";

const password = "correct-horse-battery";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PAST_T = new Date("2026-09-14T16:00:00.000Z");
const PAST_CURSOR = new Date("2026-09-14T08:00:00.000Z");

describe("perp funding HTTP and mutation integration", () => {
  let store = createMarketDataStore({ now: () => 1_000 });
  let app: FastifyInstance;
  let marketData: MarketDataAccess;

  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
    store = createMarketDataStore({ now: () => 1_000 });
    marketData = accessFromStore(store);
    app = await buildApp({ marketData });
    seedQuote(store, "BTCUSDT", {
      mark: "100",
      bid: "99",
      ask: "101",
      id: 1,
      nextFundingTime: futureFundingTimeFrom(await getDatabaseNow()).getTime(),
    });
  });

  afterEach(async () => {
    clearLiveScheduleProofs();
    await app.close();
  });

  afterAll(async () => {
    await endTestPool();
  });

  it("rejects uninitialized GET /api/funding and invalid pagination", async () => {
    const signup = await signUp(app, "funding-uninit@example.com");
    const cookies = cookieHeader(signup);
    const uninitialized = await app.inject({
      method: "GET",
      url: "/api/funding",
      headers: authHeaders(cookies),
    });
    expect(uninitialized.statusCode).toBe(409);
    const { cookies: ready } = await initializeUser(app, "funding-page@example.com");
    const bad = await app.inject({
      method: "GET",
      url: "/api/funding?limit=0",
      headers: authHeaders(ready),
    });
    expect(bad.statusCode).toBe(400);
  });

  it("returns newest-first own history with canonical decimals and UTC timestamps", async () => {
    const { cookies, accountId } = await initializeUser(app, "funding-hist@example.com");
    const other = await initializeUser(app, "funding-other@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    await seedOpen(accountId, btc.id, "1", "CROSS", "0");
    await seedOpen(accountId, eth.id, "1", "ISOLATED", "100");
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: PAST_T,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: eth.id,
        fundingTime: new Date("2026-09-14T12:00:00.000Z"),
        fundingRate: "-0.01",
        markPrice: "100",
      }),
    );
    await prove(btc.id);
    await prove(eth.id);
    await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [],
        sampleNow: async () => new Date("2026-09-14T16:00:00.001Z"),
      });
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/funding?limit=1",
      headers: authHeaders(cookies),
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as PerpFundingHistoryResponse;
    expect(body.funding).toHaveLength(1);
    expect(body.funding[0]?.symbol).toBe("BTCUSDT");
    expect(body.funding[0]?.marginMode).toBe("CROSS");
    expect(body.funding[0]?.fundingTime).toBe("2026-09-14T16:00:00.000Z");
    expect(body.funding[0]?.fundingTime).toMatch(ISO_PATTERN);
    expect(body.funding[0]?.createdAt).toMatch(ISO_PATTERN);
    expect(body.funding[0]).not.toHaveProperty("isolatedMarginBefore");
    expect(fromDbDecimal(body.funding[0]?.fundingPayment ?? "0").eq("-1")).toBe(true);

    const pageTwo = await app.inject({
      method: "GET",
      url: "/api/funding?limit=1&offset=1",
      headers: authHeaders(cookies),
    });
    const second = (pageTwo.json() as PerpFundingHistoryResponse).funding[0];
    expect(second?.symbol).toBe("ETHUSDT");
    expect(second?.marginMode).toBe("ISOLATED");
    expect(fromDbDecimal(second?.fundingPayment ?? "0").eq("1")).toBe(true);

    const otherHistory = await app.inject({
      method: "GET",
      url: "/api/funding",
      headers: authHeaders(other.cookies),
    });
    expect((otherHistory.json() as PerpFundingHistoryResponse).funding).toEqual([]);
  });

  it("does not charge older cycles on a first-ever OPEN and sets cursor to financialNow", async () => {
    const { cookies, accountId } = await initializeUser(app, "funding-first@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: PAST_T,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    const opened = await postOrder(app, cookies, "first", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.1",
    });
    expect(opened.statusCode).toBe(201);
    expect(await findAccountSettlementByAccountAndTime(db, accountId, PAST_T)).toBeNull();
    const position = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(position?.fundingCursorAt.getTime()).toBeGreaterThan(PAST_T.getTime());
  });

  it("returns 503 FUNDING_DATA_UNAVAILABLE on user, faucet, and matcher OPEN until the window is proven", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    const { cookies, accountId } = await initializeUser(app, "funding-503@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpen(accountId, btc.id, "1", "CROSS", "0");
    const rejected = await postOrder(app, cookies, "blocked", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      reduceOnly: true,
    });
    expect(rejected.statusCode).toBe(503);
    expect(rejected.json()).toEqual({ error: "FUNDING_DATA_UNAVAILABLE" });

    const faucet = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeaders(cookies),
    });
    expect(faucet.statusCode).toBe(503);
    expect(faucet.json()).toEqual({ error: "FUNDING_DATA_UNAVAILABLE" });

    await prove(btc.id);
    const resting = await postOrder(app, cookies, "rest", {
      type: "LIMIT",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.1",
      limitPrice: "110",
      reduceOnly: true,
    });
    expect(resting.statusCode).toBe(201);
    clearLiveScheduleProofs();
    const matcher = createLimitOrderMatcher({ marketData });
    seedQuote(store, "BTCUSDT", {
      mark: "100",
      bid: "110",
      ask: "111",
      id: 2,
      nextFundingTime: futureFundingTimeFrom(await getDatabaseNow()).getTime(),
    });
    await matcher.processSymbol("BTCUSDT");
    expect(await listExecutionsByPaperAccountId(db, accountId, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );
  });

  it("does not let liquidation bypass an unproven window, then liquidates after READY proof", async () => {
    const { accountId } = await initializeUser(app, "funding-liq@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpen(accountId, btc.id, "1", "CROSS", "0");
    await db.transaction((tx) =>
      updatePaperAccountBalance(tx, accountId, new MoneyDecimal("0.5")),
    );
    const skipped = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(skipped).toEqual({
      kind: "noop",
      reason: "funding_data_unavailable",
      settledFunding: false,
    });
    const stillOpen = await findPositionByAccountAndInstrument(db, accountId, btc.id);
    expect(fromDbDecimal(stillOpen?.quantity ?? "0").eq("1")).toBe(true);

    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: PAST_T,
        fundingRate: "0.001",
        markPrice: "100",
      }),
    );
    await prove(btc.id);
    const liquidated = await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    expect(liquidated.kind).toBe("liquidated");
  });

  it("settles due funding before a faucet credit", async () => {
    const { cookies, accountId } = await initializeUser(app, "funding-faucet@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await seedOpen(accountId, btc.id, "1", "CROSS", "0");
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: PAST_T,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await prove(btc.id);
    const claimed = await app.inject({
      method: "POST",
      url: "/api/account/faucet",
      headers: authHeaders(cookies),
    });
    expect(claimed.statusCode).toBe(200);
    expect(await findAccountSettlementByAccountAndTime(db, accountId, PAST_T)).not.toBeNull();
    const body = claimed.json() as { balance: string };
    expect(fromDbDecimal(body.balance).eq(new MoneyDecimal("999").plus(env.FAUCET_AMOUNT))).toBe(
      true,
    );
  });

  it("rejects isolated INCREASE after funding drains collateral below required IM", async () => {
    const { cookies, accountId } = await initializeUser(app, "funding-iso-inc@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const settings = await app.inject({
      method: "PUT",
      url: "/api/margin-settings/BTCUSDT",
      headers: authHeaders(cookies),
      payload: { marginMode: "ISOLATED", leverage: 1 },
    });
    expect(settings.statusCode).toBe(200);
    expect(
      (
        await postOrder(app, cookies, "iso-open", {
          type: "MARKET",
          symbol: "BTCUSDT",
          side: "BUY",
          quantity: "1",
        })
      ).statusCode,
    ).toBe(201);
    await db.transaction(async (tx) => {
      const position = await findPositionByAccountAndInstrument(tx, accountId, btc.id);
      if (!position) {
        throw new Error("missing isolated position");
      }
      await updatePositionState(tx, position.id, {
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        realizedPnl: position.realizedPnl,
        isolatedMargin: position.isolatedMargin,
        fundingCursorAt: PAST_CURSOR,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: PAST_CURSOR,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: PAST_T,
        fundingRate: "0.5",
        markPrice: "100",
      }),
    );
    await prove(btc.id);
    const increased = await postOrder(app, cookies, "iso-inc", {
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "1",
    });
    expect(increased.statusCode).toBe(409);
    expect(increased.json()).toEqual({ error: "INSUFFICIENT_MARGIN" });
  });
});

async function seedOpen(
  accountId: string,
  instrumentId: string,
  quantity: string,
  marginMode: "CROSS" | "ISOLATED",
  isolatedMargin: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await ensurePosition(tx, accountId, instrumentId);
    if (marginMode === "ISOLATED") {
      await updateMarginSettingsForFlatPosition(tx, position.id, {
        marginMode: "ISOLATED",
        leverage: 1,
      });
    }
    await updatePositionState(tx, position.id, {
      quantity,
      entryPrice: "100",
      realizedPnl: "0",
      isolatedMargin,
      fundingCursorAt: PAST_CURSOR,
    });
    await ensurePerpFundingSourceState(tx, {
      instrumentId,
      activationFloorAt: PAST_CURSOR,
    });
  });
}

async function prove(instrumentId: string): Promise<void> {
  setLiveScheduleProof(
    instrumentId,
    liveScheduleProofFrom({
      validFrom: PAST_CURSOR,
      observedAt: PAST_T,
      nextFundingTime: futureFundingTimeFrom(await getDatabaseNow()),
    }),
  );
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
  quote: { mark: string; bid: string; ask: string; id: number; nextFundingTime: number },
) {
  store.applyMark({
    symbol,
    markPrice: quote.mark,
    indexPrice: quote.mark,
    fundingRate: "0",
    nextFundingTime: quote.nextFundingTime,
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
  const signup = await signUp(instance, email);
  const cookies = cookieHeader(signup);
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

async function signUp(instance: FastifyInstance, email: string) {
  return instance.inject({
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
