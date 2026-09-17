import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  db,
  ensurePaperAccount,
  ensurePerpFundingSourceState,
  ensurePosition,
  findAccountSettlementByAccountAndTime,
  insertReadyFundingCycle,
  advanceLastRealizedFundingTime,
  updatePaperAccountBalance,
  updatePositionState,
  upsertInstrumentBySymbol,
  user,
  MoneyDecimal,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeScheduler } from "../market-data/test-helpers.js";
import { createFundingScanner } from "./funding-scanner.js";
import {
  clearLiveScheduleProofs,
} from "./funding-sync.js";

afterAll(async () => {
  await endTestPool();
});

describe("funding scanner", () => {
  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
  });

  afterEach(() => {
    clearLiveScheduleProofs();
  });

  it("does not overlap in-flight scans, start is idempotent, and stop clears the timer", async () => {
    const scheduler = new FakeScheduler();
    const rest = {
      async getFundingRate() {
        return [];
      },
      async getMarkPriceKlines() {
        return [];
      },
    };
    const marketData = {
      getFreshMark() {
        return null;
      },
      getFreshBook() {
        return null;
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
          readySymbolCount: 0,
        };
      },
    };
    const scanner = createFundingScanner({
      rest,
      marketData,
      intervalMs: 5_000,
      scheduler,
    });
    await Promise.all([scanner.scanOnce(), scanner.scanOnce()]);
    scanner.start();
    scanner.start();
    scanner.stop();
  });

  it("does not start from buildApp", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../app.ts"),
      "utf8",
    );
    expect(source).not.toContain("createFundingScanner");
    expect(source).not.toContain("fundingScanner.start");
    expect(source).not.toContain("createRealtimeRuntime");
  });

  it("continues after a source failure", async () => {
    await upsertInstrumentBySymbol(db, {
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      status: "ACTIVE",
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
    const errors: string[] = [];
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          throw new Error("network");
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
      marketData: {
        getFreshMark() {
          return null;
        },
        getFreshBook() {
          return null;
        },
        getReadySnapshot() {
          return null;
        },
        getStatus() {
          return {
            catalogSyncOk: false,
            catalogSyncedAt: null,
            marketWsConnected: false,
            publicWsConnected: false,
            readySymbolCount: 0,
          };
        },
      },
      intervalMs: 5_000,
      logger: {
        info() {},
        warn() {},
        error(message) {
          errors.push(message);
        },
      },
    });
    await scanner.scanOnce();
    expect(errors.some((row) => row.includes("source failed"))).toBe(true);
  });

  it("settles oldest unpaid times first, does not repeat, and requests a liq recheck", async () => {
    const { accountId, btcId } = await seedScannerAccount();
    const t1 = new Date("2026-09-14T08:00:00.000Z");
    const t2 = new Date("2026-09-14T16:00:00.000Z");
    const cursor = new Date("2026-09-14T00:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t2,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t1,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) => advanceLastRealizedFundingTime(tx, btcId, t2));
    let rechecks = 0;
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
      marketData: emptyMarketData(),
      intervalMs: 5_000,
      onSettled: () => {
        rechecks += 1;
      },
    });
    await scanner.scanOnce();
    const first = await findAccountSettlementByAccountAndTime(db, accountId, t1);
    const second = await findAccountSettlementByAccountAndTime(db, accountId, t2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first && second && first.createdAt.getTime() <= second.createdAt.getTime()).toBe(true);
    expect(rechecks).toBeGreaterThan(0);
    await scanner.scanOnce();
    expect(await findAccountSettlementByAccountAndTime(db, accountId, t1)).not.toBeNull();
    expect(rechecks).toBeGreaterThan(0);
  });

  it("keeps a committed funding settlement if realtime publication throws", async () => {
    const { accountId, btcId } = await seedScannerAccount("scan-rt@example.com");
    const t1 = new Date("2026-09-14T08:00:00.000Z");
    const cursor = new Date("2026-09-14T00:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t1,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) => advanceLastRealizedFundingTime(tx, btcId, t1));
    const events: Array<{ reason: string }> = [];
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
      marketData: emptyMarketData(),
      intervalMs: 5_000,
      onPrivateCommitted: (effect) => {
        events.push(effect);
        throw new Error("ws down");
      },
    });
    await scanner.scanOnce();
    expect(await findAccountSettlementByAccountAndTime(db, accountId, t1)).not.toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        paperAccountId: accountId,
        reason: "FUNDING_SETTLED",
      }),
    ]);
  });

  it("continues after an account data-unavailable skip", async () => {
    const first = await seedScannerAccount("scan-a@example.com");
    const second = await seedScannerAccount("scan-b@example.com");
    const t = new Date("2026-09-14T16:00:00.000Z");
    const cursor = new Date("2026-09-14T08:00:00.000Z");
    for (const row of [first, second]) {
      await db.transaction(async (tx) => {
        const position = await ensurePosition(tx, row.accountId, row.btcId);
        await updatePositionState(tx, position.id, {
          quantity: "1",
          entryPrice: "100",
          realizedPnl: "0",
          fundingCursorAt: cursor,
        });
        await ensurePerpFundingSourceState(tx, {
          instrumentId: row.btcId,
          activationFloorAt: cursor,
        });
      });
      await db.transaction((tx) =>
        insertReadyFundingCycle(tx, {
          instrumentId: row.btcId,
          fundingTime: t,
          fundingRate: "0.01",
          markPrice: "100",
        }),
      );
    }
    await db.transaction((tx) => advanceLastRealizedFundingTime(tx, second.btcId, t));
    const warnings: string[] = [];
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
      marketData: emptyMarketData(),
      intervalMs: 5_000,
      logger: {
        info() {},
        warn(message) {
          warnings.push(message);
        },
        error() {},
      },
    });
    await scanner.scanOnce();
    expect(warnings.some((row) => row.includes("data unavailable"))).toBe(true);
    expect(await findAccountSettlementByAccountAndTime(db, second.accountId, t)).not.toBeNull();
  });

  it("drains an in-flight scan and does not start a new timer cycle after stop", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          await gate;
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
      marketData: emptyMarketData(),
      intervalMs: 5_000,
    });
    const running = scanner.scanOnce();
    scanner.stop();
    let idle = false;
    const waiting = scanner.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await running;
    await waiting;
    expect(idle).toBe(true);
  });
});

function emptyMarketData() {
  return {
    getFreshMark() {
      return null;
    },
    getFreshBook() {
      return null;
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
        readySymbolCount: 0,
      };
    },
  };
}

async function seedScannerAccount(email = `scan-${crypto.randomUUID()}@example.com`) {
  const [created] = await db
    .insert(user)
    .values({ name: "Ada", email })
    .returning({ id: user.id });
  if (!created) {
    throw new Error("user insert failed");
  }
  const account = await ensurePaperAccount(db, created.id);
  await db.transaction((tx) =>
    updatePaperAccountBalance(tx, account.id, new MoneyDecimal("1000")),
  );
  const btc = await upsertInstrumentBySymbol(db, {
    symbol: email.startsWith("scan-b") ? "ETHUSDT" : "BTCUSDT",
    baseAsset: email.startsWith("scan-b") ? "ETH" : "BTC",
    status: "ACTIVE",
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
  return { accountId: account.id, btcId: btc.id };
}
