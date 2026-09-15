import {
  db,
  ensurePaperAccount,
  ensurePerpFundingSourceState,
  ensurePosition,
  findAccountSettlementByAccountAndTime,
  insertReadyFundingCycle,
  advanceLastRealizedFundingTime,
  lockPaperAccountById,
  MoneyDecimal,
  updatePaperAccountBalance,
  updatePositionState,
  upsertInstrumentBySymbol,
  user,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { settleDueFundingForAccountInTx } from "./funding-settlement.js";
import { createFundingScanner } from "./funding-scanner.js";
import {
  clearLiveScheduleProofs,
  setLiveScheduleProof,
} from "./funding-sync.js";

afterAll(async () => {
  await endTestPool();
});

describe("funding settlement concurrency", () => {
  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
  });

  afterEach(() => {
    clearLiveScheduleProofs();
  });

  it("lets two concurrent settlers produce one account/time batch", async () => {
    const { accountId, btcId } = await seed();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
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
        fundingTime,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    setLiveScheduleProof(btcId, {
      validFrom: cursor.toISOString(),
      nextFundingTime: "2026-09-16T00:00:00.000Z",
      observedAt: fundingTime.toISOString(),
    });

    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T16:00:00.001Z"),
        });
      }),
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T16:00:00.001Z"),
        });
      }),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const settled = await findAccountSettlementByAccountAndTime(db, accountId, fundingTime);
    expect(settled).not.toBeNull();
  });

  it("lets scanner retries and scanner-plus-barrier settle once", async () => {
    const { accountId, btcId } = await seed();
    const fundingTime = new Date("2026-09-14T16:00:00.000Z");
    const cursor = new Date("2026-09-14T08:00:00.000Z");
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
        fundingTime,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      advanceLastRealizedFundingTime(tx, btcId, new Date("2026-09-16T00:00:00.000Z")),
    );
    const scanner = createFundingScanner({
      rest: {
        async getFundingRate() {
          return [];
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
            catalogSyncOk: true,
            catalogSyncedAt: 1,
            marketWsConnected: true,
            publicWsConnected: true,
            readySymbolCount: 0,
          };
        },
      },
      intervalMs: 5_000,
    });
    await Promise.all([
      scanner.scanOnce(),
      scanner.scanOnce(),
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-14T16:00:00.001Z"),
        });
      }),
    ]);
    const settled = await findAccountSettlementByAccountAndTime(db, accountId, fundingTime);
    expect(settled).not.toBeNull();
  });
});

async function seed() {
  const [created] = await db
    .insert(user)
    .values({ name: "Ada", email: `funding-cc-${crypto.randomUUID()}@example.com` })
    .returning({ id: user.id });
  if (!created) {
    throw new Error("user insert failed");
  }
  const account = await ensurePaperAccount(db, created.id);
  await db.transaction((tx) =>
    updatePaperAccountBalance(tx, account.id, new MoneyDecimal("1000")),
  );
  const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  return { accountId: account.id, btcId: btc.id };
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
