import {
  advanceLastRealizedFundingTime,
  db,
  ensurePaperAccount,
  ensurePerpFundingSourceState,
  ensurePosition,
  findAccountSettlementByAccountAndTime,
  findInstrumentById,
  findPaperAccountById,
  findPositionByAccountAndInstrument,
  findSourceStateByInstrumentId,
  fromDbDecimal,
  insertReadyFundingCycle,
  ledgerTransaction,
  lockPaperAccountById,
  MoneyDecimal,
  updateMarginSettingsForFlatPosition,
  updatePaperAccountBalance,
  updatePositionState,
  upsertInstrumentBySymbol,
  user,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import {
  FundingDataUnavailableError,
  settleDueFundingForAccountInTx,
} from "./funding-settlement.js";
import {
  clearLiveScheduleProofs,
  createFundingSync,
  setLiveScheduleProof,
} from "./funding-sync.js";

afterAll(async () => {
  await endTestPool();
});

describe("funding settlement barrier", () => {
  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
  });

  afterEach(() => {
    clearLiveScheduleProofs();
  });

  it("charges an open-before position and skips a flat-through reopen", async () => {
    const { accountId, btcId } = await seedAccount();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "10",
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
      observedAt: "2026-09-15T16:00:01.000Z",
    });

    const first = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [btcId],
        sampleNow: async () => new Date("2026-09-15T16:00:00.001Z"),
      });
    });

    expect(first.settledBatches).toHaveLength(1);
    const position = await findPositionByAccountAndInstrument(db, accountId, btcId);
    expect(position?.fundingCursorAt.toISOString()).toBe(fundingTime.toISOString());
    expect(fromDbDecimal(first.account.balance).eq("990")).toBe(true);

    await db.transaction(async (tx) => {
      const row = await findPositionByAccountAndInstrument(tx, accountId, btcId);
      if (!row) {
        throw new Error("missing position");
      }
      await updatePositionState(tx, row.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        fundingCursorAt: fundingTime,
      });
      await updatePositionState(tx, row.id, {
        quantity: "10",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: new Date("2026-09-15T16:00:00.002Z"),
      });
    });

    const second = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [btcId],
        sampleNow: async () => new Date("2026-09-15T16:05:00.000Z"),
      });
    });
    expect(second.settledBatches).toHaveLength(0);
    expect(await findAccountSettlementByAccountAndTime(db, accountId, fundingTime)).not.toBeNull();
  });

  it("fails closed after restart when nextFundingTime cannot prove a missed window", async () => {
    const { accountId, btcId } = await seedAccount();
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
      await advanceLastRealizedFundingTime(tx, btcId, cursor);
    });

    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T16:05:00.000Z"),
          getLiveScheduleProof: () => null,
        });
      }),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);
  });

  it("does not bypass FUNDING_DATA_UNAVAILABLE because NODE_ENV is test", async () => {
    expect(process.env.NODE_ENV).toBe("test");
    const { accountId, btcId } = await seedAccount();
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: new Date("2026-09-15T08:00:00.000Z"),
      });
    });

    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T16:05:00.000Z"),
        });
      }),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);
    expect(await findSourceStateByInstrumentId(db, btcId)).toBeNull();
  });

  it("fails closed after restart when last_realized is still null", async () => {
    const { accountId, btcId } = await seedAccount();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: floor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: floor,
      });
    });
    clearLiveScheduleProofs();

    await createFundingSync({
      rest: {
        async getFundingRate() {
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
    }).reconcileInstrument(
      await requireInstrument(btcId),
      Date.parse("2026-09-15T16:00:00.000Z"),
    );

    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T14:00:00.000Z"),
        });
      }),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);
  });

  it("settles the recovered 16:00 mark once history closes the restart gap", async () => {
    const { accountId, btcId } = await seedAccount();
    const t0800 = new Date("2026-09-15T08:00:00.000Z");
    const t1600 = Date.parse("2026-09-15T16:00:00.000Z");
    const t2400 = Date.parse("2026-09-16T00:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: t0800,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: t0800,
      });
      await advanceLastRealizedFundingTime(tx, btcId, t0800);
    });
    clearLiveScheduleProofs();

    const empty = createFundingSync({
      rest: {
        async getFundingRate() {
          return [];
        },
        async getMarkPriceKlines() {
          return [];
        },
      },
    });
    await empty.reconcileInstrument(await requireInstrument(btcId), t2400);
    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [btcId],
          sampleNow: async () => new Date("2026-09-15T16:05:00.000Z"),
        });
      }),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);

    const recovered = createFundingSync({
      rest: {
        async getFundingRate() {
          return [{ symbol: "BTCUSDT", fundingTime: t1600, fundingRate: "0.01" }];
        },
        async getMarkPriceKlines() {
          const closeTime = Math.floor(t1600 / 60_000) * 60_000 - 1;
          const openTime = closeTime - 59_999;
          return [[openTime, "100", "100", "100", "100", "0", closeTime]];
        },
      },
    });
    await recovered.reconcileInstrument(await requireInstrument(btcId), t2400);
    const result = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [btcId],
        sampleNow: async () => new Date("2026-09-15T16:05:00.000Z"),
      });
    });
    expect(result.settledBatches).toHaveLength(1);
    expect(
      await findAccountSettlementByAccountAndTime(db, accountId, new Date(t1600)),
    ).not.toBeNull();
  });

  it("proves the first Phase-15 interval when lastRealized is null after history then observe", async () => {
    const { accountId, btcId } = await seedAccount();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: floor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: floor,
      });
    });
    setLiveScheduleProof(btcId, {
      validFrom: floor.toISOString(),
      nextFundingTime: "2026-09-15T16:00:00.000Z",
      observedAt: "2026-09-15T12:00:01.000Z",
    });

    const result = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [btcId],
        sampleNow: async () => new Date("2026-09-15T14:00:00.000Z"),
      });
    });
    expect(result.settledBatches).toHaveLength(0);
  });

  it("does not settle BTC at T while ETH with cursor < T is unproven", async () => {
    const { accountId, btcId, ethId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const btc = await ensurePosition(tx, accountId, btcId);
      const eth = await ensurePosition(tx, accountId, ethId);
      await updatePositionState(tx, btc.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await updatePositionState(tx, eth.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: ethId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    setLiveScheduleProof(btcId, {
      validFrom: cursor.toISOString(),
      nextFundingTime: "2026-09-16T00:00:00.000Z",
      observedAt: t.toISOString(),
    });

    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, accountId);
        return settleDueFundingForAccountInTx(tx, {
          accountId,
          extraInstrumentIds: [],
          sampleNow: async () => new Date("2026-09-15T16:00:00.001Z"),
        });
      }),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);
  });

  it("settles BTC only at T once ETH is proven with no event at T", async () => {
    const { accountId, btcId, ethId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const btc = await ensurePosition(tx, accountId, btcId);
      const eth = await ensurePosition(tx, accountId, ethId);
      await updatePositionState(tx, btc.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await updatePositionState(tx, eth.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: ethId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    setLiveScheduleProof(btcId, {
      validFrom: cursor.toISOString(),
      nextFundingTime: "2026-09-16T00:00:00.000Z",
      observedAt: t.toISOString(),
    });
    setLiveScheduleProof(ethId, {
      validFrom: cursor.toISOString(),
      nextFundingTime: "2026-09-16T00:00:00.000Z",
      observedAt: t.toISOString(),
    });

    const result = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, accountId);
      return settleDueFundingForAccountInTx(tx, {
        accountId,
        extraInstrumentIds: [],
        sampleNow: async () => new Date("2026-09-15T16:00:00.001Z"),
      });
    });
    expect(result.settledBatches).toHaveLength(1);
    const eth = await findPositionByAccountAndInstrument(db, accountId, ethId);
    expect(eth?.fundingCursorAt.toISOString()).toBe(cursor.toISOString());
  });

  it("does not let a position with cursor >= T block or pay T", async () => {
    const { accountId, btcId, ethId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const btc = await ensurePosition(tx, accountId, btcId);
      const eth = await ensurePosition(tx, accountId, ethId);
      await updatePositionState(tx, btc.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await updatePositionState(tx, eth.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: t,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: ethId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    prove(ethId, cursor);
    const result = await settleAccount(accountId, [btcId, ethId], new Date("2026-09-15T16:00:00.001Z"));
    expect(result.settledBatches).toHaveLength(1);
    const eth = await findPositionByAccountAndInstrument(db, accountId, ethId);
    expect(eth?.fundingCursorAt.toISOString()).toBe(t.toISOString());
  });

  it("settles BTC and ETH together at T once ETH T is later discovered", async () => {
    const { accountId, btcId, ethId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const btc = await ensurePosition(tx, accountId, btcId);
      const eth = await ensurePosition(tx, accountId, ethId);
      await updatePositionState(tx, btc.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await updatePositionState(tx, eth.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: cursor,
      });
      await ensurePerpFundingSourceState(tx, {
        instrumentId: ethId,
        activationFloorAt: cursor,
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    setLiveScheduleProof(btcId, {
      validFrom: cursor.toISOString(),
      nextFundingTime: "2026-09-16T00:00:00.000Z",
      observedAt: t.toISOString(),
    });
    await expect(
      settleAccount(accountId, [], new Date("2026-09-15T16:00:00.001Z")),
    ).rejects.toBeInstanceOf(FundingDataUnavailableError);

    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: ethId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      advanceLastRealizedFundingTime(tx, ethId, t),
    );
    prove(ethId, cursor);
    const result = await settleAccount(accountId, [], new Date("2026-09-15T16:00:00.001Z"));
    expect(result.settledBatches).toHaveLength(1);
    expect(fromDbDecimal(result.account.balance).eq("998")).toBe(true);
  });

  it("treats financialNow as the economic boundary, not lock acquisition time", async () => {
    const { accountId, btcId } = await seedAccount();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await openCross(accountId, btcId, "1", cursor);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    const result = await settleAccount(
      accountId,
      [btcId],
      new Date("2026-09-15T16:00:00.001Z"),
    );
    expect(result.settledBatches).toHaveLength(1);
  });

  it("charges close-after at the barrier using pre-mutation quantity", async () => {
    const { accountId, btcId } = await seedAccount();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await openCross(accountId, btcId, "10", cursor);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    const first = await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    expect(fromDbDecimal(first.account.balance).eq("990")).toBe(true);
    await db.transaction(async (tx) => {
      const row = await findPositionByAccountAndInstrument(tx, accountId, btcId);
      if (!row) {
        throw new Error("missing position");
      }
      await updatePositionState(tx, row.id, {
        quantity: "20",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: fundingTime,
      });
    });
    const second = await settleAccount(accountId, [btcId], new Date("2026-09-15T16:05:00.000Z"));
    expect(second.settledBatches).toHaveLength(0);
    expect(fromDbDecimal((await requireBalance(accountId)).balance).eq("990")).toBe(true);
  });

  it("skips close-before and does not block a later flat mutation", async () => {
    const { accountId, btcId } = await seedAccount();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    await openCross(accountId, btcId, "1", new Date("2026-09-15T08:00:00.000Z"));
    await db.transaction(async (tx) => {
      const row = await findPositionByAccountAndInstrument(tx, accountId, btcId);
      if (!row) {
        throw new Error("missing position");
      }
      await updatePositionState(tx, row.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        fundingCursorAt: new Date("2026-09-15T15:00:00.000Z"),
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
    const result = await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    expect(result.settledBatches).toHaveLength(0);
    expect(await findAccountSettlementByAccountAndTime(db, accountId, fundingTime)).toBeNull();
  });
});

describe("funding account/time accounting", () => {
  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
  });

  afterEach(() => {
    clearLiveScheduleProofs();
  });

  it("nets CROSS payments at one timestamp and absorbs insurance without touching isolated reserves", async () => {
    const { accountId, btcId, ethId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await openCross(accountId, btcId, "1", cursor);
    await openCross(accountId, ethId, "-1", cursor);
    await db.transaction((tx) =>
      updatePaperAccountBalance(tx, accountId, new MoneyDecimal("5")),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.1",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: ethId,
        fundingTime: t,
        fundingRate: "0.1",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    prove(ethId, cursor);
    const result = await settleAccount(accountId, [], new Date("2026-09-15T16:00:00.001Z"));
    expect(fromDbDecimal(result.account.balance).eq("5")).toBe(true);
    const settled = await findAccountSettlementByAccountAndTime(db, accountId, t);
    expect(fromDbDecimal(settled?.totalFundingPayment ?? "1").eq("0")).toBe(true);
  });

  it("keeps isolated funding from changing free CROSS cash and contains isolated bankruptcy", async () => {
    const { accountId, btcId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, accountId, btcId);
      await updateMarginSettingsForFlatPosition(tx, position.id, {
        marginMode: "ISOLATED",
        leverage: 1,
      });
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        isolatedMargin: "50",
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
        fundingTime: t,
        fundingRate: "0.8",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    const result = await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    const position = await findPositionByAccountAndInstrument(db, accountId, btcId);
    expect(fromDbDecimal(position?.isolatedMargin ?? "1").eq("0")).toBe(true);
    expect(fromDbDecimal(result.account.balance).eq("950")).toBe(true);
    const settled = await findAccountSettlementByAccountAndTime(db, accountId, t);
    expect(fromDbDecimal(settled?.insuranceAbsorption ?? "0").eq("30")).toBe(true);
    expect(fromDbDecimal(settled?.userWalletDelta ?? "0").eq("-50")).toBe(true);
  });

  it("settles T1 then T2 independently so a later credit cannot rewrite earlier insurance", async () => {
    const { accountId, btcId } = await seedAccount();
    const cursor = new Date("2026-09-15T00:00:00.000Z");
    const t1 = new Date("2026-09-15T08:00:00.000Z");
    const t2 = new Date("2026-09-15T16:00:00.000Z");
    const t3 = new Date("2026-09-16T00:00:00.000Z");
    await db.transaction((tx) => updatePaperAccountBalance(tx, accountId, new MoneyDecimal("100")));
    await openCross(accountId, btcId, "10", cursor);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t1,
        fundingRate: "0.15",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t2,
        fundingRate: "-0.1",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t3,
        fundingRate: "0.001",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    const result = await settleAccount(accountId, [btcId], new Date("2026-09-16T00:00:00.001Z"));
    expect(result.settledBatches).toHaveLength(3);
    const first = await findAccountSettlementByAccountAndTime(db, accountId, t1);
    const second = await findAccountSettlementByAccountAndTime(db, accountId, t2);
    const third = await findAccountSettlementByAccountAndTime(db, accountId, t3);
    expect(fromDbDecimal(first?.insuranceAbsorption ?? "0").eq("50")).toBe(true);
    expect(fromDbDecimal(second?.insuranceAbsorption ?? "1").eq("0")).toBe(true);
    expect(fromDbDecimal(third?.insuranceAbsorption ?? "1").eq("0")).toBe(true);
    expect(fromDbDecimal(result.account.balance).eq("99")).toBe(true);
  });

  it("skips the FUNDING_PAYMENT ledger when every amount is zero", async () => {
    const { accountId, btcId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await openCross(accountId, btcId, "1", cursor);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    expect(await findAccountSettlementByAccountAndTime(db, accountId, t)).not.toBeNull();
    const posted = await db.select().from(ledgerTransaction);
    expect(posted.filter((row) => row.eventType === "FUNDING_PAYMENT")).toHaveLength(0);
  });

  it("is a no-op when the same account/time is settled again", async () => {
    const { accountId, btcId } = await seedAccount();
    const t = new Date("2026-09-15T16:00:00.000Z");
    const cursor = new Date("2026-09-15T08:00:00.000Z");
    await openCross(accountId, btcId, "1", cursor);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: t,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    prove(btcId, cursor);
    await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    const replay = await settleAccount(accountId, [btcId], new Date("2026-09-15T16:00:00.001Z"));
    expect(replay.settledBatches).toHaveLength(0);
    expect(fromDbDecimal(replay.account.balance).eq("999")).toBe(true);
    expect(await findAccountSettlementByAccountAndTime(db, accountId, t)).not.toBeNull();
  });
});

describe("GET /api/funding", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("returns 401 when unauthenticated and does not register POST", async () => {
    const app = await buildApp();
    try {
      const unauthorized = await app.inject({ method: "GET", url: "/api/funding" });
      expect(unauthorized.statusCode).toBe(401);
      const post = await app.inject({ method: "POST", url: "/api/funding" });
      expect(post.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

async function seedAccount() {
  const [created] = await db
    .insert(user)
    .values({ name: "Ada", email: `funding-${crypto.randomUUID()}@example.com` })
    .returning({ id: user.id });
  if (!created) {
    throw new Error("user insert failed");
  }
  const account = await ensurePaperAccount(db, created.id);
  await db.transaction((tx) =>
    updatePaperAccountBalance(tx, account.id, new MoneyDecimal("1000")),
  );
  const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
  return { accountId: account.id, btcId: btc.id, ethId: eth.id };
}

async function openCross(
  accountId: string,
  instrumentId: string,
  quantity: string,
  cursor: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await ensurePosition(tx, accountId, instrumentId);
    await updatePositionState(tx, position.id, {
      quantity,
      entryPrice: "100",
      realizedPnl: "0",
      fundingCursorAt: cursor,
    });
    await ensurePerpFundingSourceState(tx, {
      instrumentId,
      activationFloorAt: cursor,
    });
  });
}

function prove(instrumentId: string, cursor: Date): void {
  setLiveScheduleProof(instrumentId, {
    validFrom: cursor.toISOString(),
    nextFundingTime: "2026-09-17T00:00:00.000Z",
    observedAt: "2026-09-15T16:00:01.000Z",
  });
}

async function settleAccount(
  accountId: string,
  extraInstrumentIds: string[],
  financialNow: Date,
) {
  return db.transaction(async (tx) => {
    await lockPaperAccountById(tx, accountId);
    return settleDueFundingForAccountInTx(tx, {
      accountId,
      extraInstrumentIds,
      sampleNow: async () => financialNow,
    });
  });
}

async function requireBalance(accountId: string) {
  const account = await findPaperAccountById(db, accountId);
  if (!account) {
    throw new Error("missing account");
  }
  return account;
}

async function requireInstrument(instrumentId: string) {
  const row = await findInstrumentById(db, instrumentId);
  if (!row) {
    throw new Error("missing instrument");
  }
  return row;
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
