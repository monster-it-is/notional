import type { LiquidationListResponse } from "@notional/contracts";
import {
  db,
  ensurePosition,
  findPaperAccountByUserId,
  fromDbDecimal,
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

import { buildApp } from "./app.js";
import type { MarketDataAccess } from "./market-data/coordinator.js";
import { createMarketDataStore, type MarketDataStore } from "./market-data/market-data-store.js";
import { upsertInstrumentWithFundingEvidence as upsertInstrumentBySymbol } from "./services/funding-test-fixtures.js";
import { liquidateCrossAccount, liquidateIsolatedPosition } from "./services/liquidation.js";

const password = "correct-horse-battery";
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("liquidation history API", () => {
  let store = createMarketDataStore({ now: () => 1_000 });
  let app: FastifyInstance;
  let marketData: MarketDataAccess;

  beforeEach(async () => {
    await resetTestTables();
    store = createMarketDataStore({ now: () => 1_000 });
    marketData = accessFromStore(store);
    app = await buildApp({ marketData });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await endTestPool();
  });

  it("returns 401 without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/liquidations" });
    expect(response.statusCode).toBe(401);
  });

  it("lists newest first with CROSS symbol null and isolated symbol set", async () => {
    const { cookies, accountId } = await initializeUser(app, "history@example.com");
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    seedQuote(store, "BTCUSDT", { mark: "100", bid: "99", ask: "101", id: 1 });
    seedQuote(store, "ETHUSDT", { mark: "100", bid: "1", ask: "1.1", id: 1 });
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
    await liquidateCrossAccount({ paperAccountId: accountId, marketData });
    await seedOpenPosition({
      accountId,
      instrumentId: eth.id,
      marginMode: "ISOLATED",
      leverage: 10,
      quantity: "1",
      entryPrice: "100",
      isolatedMargin: "0.5",
      walletBalance: "1000",
    });
    await liquidateIsolatedPosition({
      paperAccountId: accountId,
      instrumentId: eth.id,
      marketData,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/liquidations",
      headers: authHeaders(cookies),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as LiquidationListResponse;
    expect(body.liquidations).toHaveLength(2);
    expect(body.liquidations[0]?.marginMode).toBe("ISOLATED");
    expect(body.liquidations[0]?.symbol).toBe("ETHUSDT");
    expect(body.liquidations[1]?.marginMode).toBe("CROSS");
    expect(body.liquidations[1]?.symbol).toBeNull();
    expect(body.liquidations[0]?.createdAt).toMatch(ISO_PATTERN);
    expect(body.liquidations[0]).not.toHaveProperty("paperAccountId");
    expect(body.liquidations[0]).not.toHaveProperty("instrumentId");

    const page = await app.inject({
      method: "GET",
      url: "/api/liquidations?limit=1&offset=1",
      headers: authHeaders(cookies),
    });
    expect((page.json() as LiquidationListResponse).liquidations).toHaveLength(1);
    expect((page.json() as LiquidationListResponse).liquidations[0]?.marginMode).toBe("CROSS");
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
    if (position.quantity === "0" || fromDbDecimal(position.quantity).isZero()) {
      await updateMarginSettingsForFlatPosition(tx, position.id, {
        marginMode: params.marginMode,
        leverage: params.leverage,
      });
    }
    await updatePositionState(tx, position.id, {
      quantity: params.quantity,
      entryPrice: params.entryPrice,
      realizedPnl: position.realizedPnl,
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
