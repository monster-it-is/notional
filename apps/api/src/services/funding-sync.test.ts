import {
  advanceLastRealizedFundingTime,
  db,
  ensurePaperAccount,
  ensurePerpFundingSourceState,
  ensurePosition,
  findFundingCycleByInstrumentAndTime,
  findSourceStateByInstrumentId,
  FundingCycleIntegrityError,
  insertReadyFundingCycle,
  insertScheduledFundingCycle,
  updatePositionState,
  upsertInstrumentBySymbol,
  user,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { windowProven } from "@notional/trading";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { FundingSourceError } from "../market-data/funding-source.js";
import {
  clearLiveScheduleProofs,
  createFundingSync,
  getLiveScheduleProof,
  nextHistoryStartTime,
} from "./funding-sync.js";

afterAll(async () => {
  await endTestPool();
});

describe("funding sync", () => {
  beforeEach(async () => {
    await resetTestTables();
    clearLiveScheduleProofs();
  });

  afterEach(() => {
    clearLiveScheduleProofs();
  });

  it("discovers T1 after T2 when recovering from last_realized watermark, not MAX(cycle)", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const t1 = Date.parse("2026-09-15T08:00:00.000Z");
    const t2 = Date.parse("2026-09-15T16:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: new Date(t2),
        fundingRate: "0.02",
        markPrice: "110",
      }),
    );
    const rest = fakeRest({
      rates: [
        { symbol: "BTCUSDT", fundingTime: t1, fundingRate: "0.01" },
        { symbol: "BTCUSDT", fundingTime: t2, fundingRate: "0.02" },
      ],
      marks: {
        [t1]: kline(t1, "100"),
        [t2]: kline(t2, "110"),
      },
    });
    const sync = createFundingSync({ rest });
    await sync.reconcileInstrument(btc, Date.parse("2026-09-16T00:00:00.000Z"));

    const first = await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(t1));
    const second = await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(t2));
    expect(first?.status).toBe("READY");
    expect(second?.status).toBe("READY");
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source?.lastRealizedFundingTime?.toISOString()).toBe(new Date(t2).toISOString());
    expect(getLiveScheduleProof(btc.id)?.validFrom).toBe(new Date(t2).toISOString());
  });

  it("does not let a post-restart empty history and nextFundingTime prove a missed window", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const t0800 = new Date("2026-09-15T08:00:00.000Z");
    const t1600 = Date.parse("2026-09-15T16:00:00.000Z");
    const t2400 = Date.parse("2026-09-16T00:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: t0800,
      }),
    );
    await db.transaction((tx) => advanceLastRealizedFundingTime(tx, btc.id, t0800));
    clearLiveScheduleProofs();

    const sync = createFundingSync({
      rest: fakeRest({ rates: [], marks: {} }),
    });
    await sync.reconcileInstrument(btc, t2400);
    expect(getLiveScheduleProof(btc.id)).toBeNull();
    expect(
      windowProven({
        cursorAt: t0800.toISOString(),
        financialNow: "2026-09-15T16:05:00.000Z",
        activationFloorAt: t0800.toISOString(),
        lastRealizedFundingTime: t0800.toISOString(),
        unresolvedScheduledTimes: [],
        liveScheduleProof: getLiveScheduleProof(btc.id),
      }),
    ).toBe(false);

    const recovered = createFundingSync({
      rest: fakeRest({
        rates: [{ symbol: "BTCUSDT", fundingTime: t1600, fundingRate: "0.01" }],
        marks: { [t1600]: kline(t1600, "100") },
      }),
    });
    await recovered.reconcileInstrument(btc, t2400);
    expect(
      (await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(t1600)))?.status,
    ).toBe("READY");
    expect(getLiveScheduleProof(btc.id)?.validFrom).toBe(new Date(t1600).toISOString());
    expect(getLiveScheduleProof(btc.id)?.nextFundingTime).toBe(new Date(t2400).toISOString());
    expect(
      windowProven({
        cursorAt: t0800.toISOString(),
        financialNow: "2026-09-15T16:05:00.000Z",
        activationFloorAt: t0800.toISOString(),
        lastRealizedFundingTime: new Date(t1600).toISOString(),
        unresolvedScheduledTimes: [],
        liveScheduleProof: getLiveScheduleProof(btc.id),
      }),
    ).toBe(true);
  });

  it("does not prove from activation floor after restart when last_realized is still null", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const floor = new Date("2026-09-15T12:00:00.000Z");
    const next = Date.parse("2026-09-15T16:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: floor,
      }),
    );
    clearLiveScheduleProofs();

    await createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) }).reconcileInstrument(
      btc,
      next,
    );
    expect(getLiveScheduleProof(btc.id)).toBeNull();
    expect(
      windowProven({
        cursorAt: floor.toISOString(),
        financialNow: "2026-09-15T14:00:00.000Z",
        activationFloorAt: floor.toISOString(),
        lastRealizedFundingTime: null,
        unresolvedScheduledTimes: [],
        liveScheduleProof: getLiveScheduleProof(btc.id),
      }),
    ).toBe(false);
  });

  it("allows prospective proof from activation floor only when source-state is created in this process", async () => {
    const { account, btc } = await seedAccountWithInstrument();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    const next = Date.parse("2026-09-15T16:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, account.id, btc.id);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: floor,
      });
    });

    await createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) }).reconcileInstrument(
      btc,
      next,
    );
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source?.activationFloorAt.toISOString()).toBe(floor.toISOString());
    expect(source?.lastRealizedFundingTime).toBeNull();
    expect(getLiveScheduleProof(btc.id)?.validFrom).toBe(floor.toISOString());
    expect(getLiveScheduleProof(btc.id)?.nextFundingTime).toBe(new Date(next).toISOString());
    expect(getLiveScheduleProof(btc.id)?.observedAt).not.toBe(new Date(next).toISOString());
    expect(
      windowProven({
        cursorAt: floor.toISOString(),
        financialNow: "2026-09-15T14:00:00.000Z",
        activationFloorAt: floor.toISOString(),
        lastRealizedFundingTime: null,
        unresolvedScheduledTimes: [],
        liveScheduleProof: getLiveScheduleProof(btc.id),
      }),
    ).toBe(true);
  });

  it("invalidates prospective proof when fresh nextFundingTime is missing and does not restore old validFrom", async () => {
    const { account, btc } = await seedAccountWithInstrument();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    const next = Date.parse("2026-09-15T16:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, account.id, btc.id);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: floor,
      });
    });
    const sync = createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) });
    await sync.reconcileInstrument(btc, next);
    expect(getLiveScheduleProof(btc.id)?.validFrom).toBe(floor.toISOString());

    await sync.reconcileInstrument(btc, null);
    expect(getLiveScheduleProof(btc.id)).toBeNull();

    await sync.reconcileInstrument(btc, next);
    expect(getLiveScheduleProof(btc.id)).toBeNull();
    expect(
      windowProven({
        cursorAt: floor.toISOString(),
        financialNow: "2026-09-15T14:00:00.000Z",
        activationFloorAt: floor.toISOString(),
        lastRealizedFundingTime: null,
        unresolvedScheduledTimes: [],
        liveScheduleProof: getLiveScheduleProof(btc.id),
      }),
    ).toBe(false);
  });

  it("establishes a new proof from a realized event recovered after schedule continuity loss", async () => {
    const { account, btc } = await seedAccountWithInstrument();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    const recovered = Date.parse("2026-09-15T14:00:00.000Z");
    const next = Date.parse("2026-09-15T16:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, account.id, btc.id);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: floor,
      });
    });
    const empty = createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) });
    await empty.reconcileInstrument(btc, next);
    await empty.reconcileInstrument(btc, null);
    expect(getLiveScheduleProof(btc.id)).toBeNull();

    const restored = createFundingSync({
      rest: fakeRest({
        rates: [{ symbol: "BTCUSDT", fundingTime: recovered, fundingRate: "0.01" }],
        marks: { [recovered]: kline(recovered, "100") },
      }),
    });
    await restored.reconcileInstrument(btc, next);
    expect(
      (await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(recovered)))?.status,
    ).toBe("READY");
    expect(getLiveScheduleProof(btc.id)?.validFrom).toBe(new Date(recovered).toISOString());
    expect(getLiveScheduleProof(btc.id)?.nextFundingTime).toBe(new Date(next).toISOString());
  });

  it("keeps a due SCHEDULED cycle when the exact 09:59 candle is missing and does not accept 09:58", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const fundingTime = Date.parse("2026-09-15T10:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    const rest = fakeRest({
      rates: [{ symbol: "BTCUSDT", fundingTime, fundingRate: "0.01" }],
      marks: {
        [fundingTime]: [
          Date.parse("2026-09-15T09:58:00.000Z"),
          "99",
          "99",
          "99",
          "99",
          "0",
          Date.parse("2026-09-15T09:58:59.999Z"),
        ],
      },
    });
    const sync = createFundingSync({ rest });
    await sync.reconcileInstrument(btc);
    const cycle = await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(fundingTime));
    expect(cycle?.status).toBe("SCHEDULED");
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source?.lastRealizedFundingTime).toBeNull();
  });

  it("does not advance last_realized on an empty history fetch", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    const rest = fakeRest({ rates: [], marks: {} });
    const sync = createFundingSync({ rest });
    await sync.reconcileInstrument(btc, Date.parse("2026-09-15T16:00:00.000Z"));
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source?.lastRealizedFundingTime).toBeNull();
    expect(getLiveScheduleProof(btc.id)).toBeNull();
  });

  it("does not delete a due SCHEDULED cycle when early history is empty", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const due = new Date("2026-09-15T10:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: btc.id, fundingTime: due }),
    );
    const sync = createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) });
    await sync.reconcileInstrument(btc, Date.parse("2026-09-15T16:00:00.000Z"));
    const cycle = await findFundingCycleByInstrumentAndTime(db, btc.id, due);
    expect(cycle?.status).toBe("SCHEDULED");
  });

  it("deletes a stale predicted SCHEDULED once a later realized event is fully reconciled", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const predicted = Date.parse("2026-09-15T16:00:00.000Z");
    const actual = Date.parse("2026-09-16T00:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: new Date(predicted),
      }),
    );
    const rest = fakeRest({
      rates: [{ symbol: "BTCUSDT", fundingTime: actual, fundingRate: "0.01" }],
      marks: { [actual]: kline(actual, "100") },
    });
    await createFundingSync({ rest }).reconcileInstrument(
      btc,
      Date.parse("2026-09-16T08:00:00.000Z"),
    );
    expect(await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(predicted))).toBeNull();
    expect(
      (await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(actual)))?.status,
    ).toBe("READY");
  });

  it("accepts variable intervals rather than an 8h grid", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const times = [
      Date.parse("2026-09-15T00:00:00.000Z"),
      Date.parse("2026-09-15T08:00:00.000Z"),
      Date.parse("2026-09-15T12:00:00.000Z"),
    ];
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-14T00:00:00.000Z"),
      }),
    );
    const rest = fakeRest({
      rates: times.map((fundingTime, index) => ({
        symbol: "BTCUSDT",
        fundingTime,
        fundingRate: `0.00${index + 1}`,
      })),
      marks: Object.fromEntries(times.map((time) => [time, kline(time, "100")])),
    });
    await createFundingSync({ rest }).reconcileInstrument(btc);
    for (const time of times) {
      expect(
        (await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(time)))?.status,
      ).toBe("READY");
    }
  });

  it("fails closed when a malformed row appears in a full page instead of advancing proof", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const base = Date.parse("2026-09-15T00:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-14T00:00:00.000Z"),
      }),
    );
    const page = Array.from({ length: 1000 }, (_, index) => ({
      symbol: "BTCUSDT",
      fundingTime: base + index + 1,
      fundingRate: index === 999 ? "1e-4" : "0.0001",
    }));
    const rest = {
      async getFundingRate() {
        return page;
      },
      async getMarkPriceKlines() {
        return [];
      },
    };
    await expect(createFundingSync({ rest }).reconcileInstrument(btc)).rejects.toBeInstanceOf(
      FundingSourceError,
    );
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source?.lastRealizedFundingTime).toBeNull();
    expect(getLiveScheduleProof(btc.id)).toBeNull();
  });

  it("paginates from proofBase+1 so a persisted watermark row cannot occupy page slot 1", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const base = Date.parse("2026-09-15T00:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-14T00:00:00.000Z"),
      }),
    );
    await db.transaction((tx) =>
      advanceLastRealizedFundingTime(tx, btc.id, new Date(base)),
    );
    const rates = [
      { symbol: "BTCUSDT", fundingTime: base, fundingRate: "0.0001" },
      ...Array.from({ length: 1001 }, (_, index) => ({
        symbol: "BTCUSDT",
        fundingTime: base + index + 1,
        fundingRate: "0.0001",
      })),
    ];
    const starts: number[] = [];
    const rest = {
      async getFundingRate(query: { startTime?: number; limit?: number }) {
        starts.push(query.startTime ?? 0);
        return rates
          .filter((row) => row.fundingTime >= (query.startTime ?? 0))
          .slice(0, query.limit ?? 1000);
      },
      async getMarkPriceKlines() {
        return [];
      },
    };
    await createFundingSync({ rest }).reconcileInstrument(btc);
    expect(starts[0]).toBe(nextHistoryStartTime(base));
    expect(starts).toHaveLength(2);
  });

  it("rejects an unordered fundingRate page instead of skipping or looping", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    const rest = {
      async getFundingRate() {
        return [
          { symbol: "BTCUSDT", fundingTime: 8_000, fundingRate: "0.01" },
          { symbol: "BTCUSDT", fundingTime: 4_000, fundingRate: "0.02" },
        ];
      },
      async getMarkPriceKlines() {
        return [];
      },
    };
    await expect(createFundingSync({ rest }).reconcileInstrument(btc)).rejects.toBeInstanceOf(
      FundingSourceError,
    );
  });

  it("does not let BTC activation inherit ETH's open funding cursor", async () => {
    const ada = await db
      .insert(user)
      .values({ name: "Ada", email: `funding-floor-${crypto.randomUUID()}@example.com` })
      .returning({ id: user.id });
    const created = ada[0];
    if (!created) {
      throw new Error("user insert failed");
    }
    const account = await ensurePaperAccount(db, created.id);
    const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const ethCursor = new Date("2020-01-01T00:00:00.000Z");
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, account.id, eth.id);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: ethCursor,
      });
    });
    await createFundingSync({ rest: fakeRest({ rates: [], marks: {} }) }).reconcileInstrument(btc);
    const source = await findSourceStateByInstrumentId(db, btc.id);
    expect(source).not.toBeNull();
    expect(source?.activationFloorAt.getTime()).toBeGreaterThan(ethCursor.getTime());
  });

  it("rejects a proof-base overflow instead of wrapping startTime", () => {
    expect(() => nextHistoryStartTime(Number.MAX_SAFE_INTEGER)).toThrow(FundingSourceError);
  });

  it("persists a >18-scale rate with HALF_EVEN before settlement payload use", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const fundingTime = Date.parse("2026-09-15T08:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    const rest = fakeRest({
      rates: [
        { symbol: "BTCUSDT", fundingTime, fundingRate: "0.00012345678901234567" },
      ],
      marks: { [fundingTime]: kline(fundingTime, "100") },
    });
    await createFundingSync({ rest }).reconcileInstrument(btc);
    const cycle = await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(fundingTime));
    expect(cycle?.fundingRate).toBe("0.000123456789012346");
  });

  it("replays identical READY payload and conflicts on a different payload", async () => {
    const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
    const fundingTime = Date.parse("2026-09-15T08:00:00.000Z");
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btc.id,
        activationFloorAt: new Date("2026-09-15T00:00:00.000Z"),
      }),
    );
    await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: btc.id, fundingTime: new Date(fundingTime) }),
    );
    const rest = fakeRest({
      rates: [{ symbol: "BTCUSDT", fundingTime, fundingRate: "0.01" }],
      marks: { [fundingTime]: kline(fundingTime, "100") },
    });
    const sync = createFundingSync({ rest });
    await sync.reconcileInstrument(btc);
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btc.id,
        fundingTime: new Date(fundingTime),
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    const cycle = await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(fundingTime));
    expect(cycle?.status).toBe("READY");
    expect(cycle?.fundingRate).toBe("0.01");

    await expect(
      db.transaction((tx) =>
        insertReadyFundingCycle(tx, {
          instrumentId: btc.id,
          fundingTime: new Date(fundingTime),
          fundingRate: "0.02",
          markPrice: "100",
        }),
      ),
    ).rejects.toBeInstanceOf(FundingCycleIntegrityError);
    expect(
      (await findFundingCycleByInstrumentAndTime(db, btc.id, new Date(fundingTime)))?.fundingRate,
    ).toBe("0.01");
  });
});

async function seedAccountWithInstrument() {
  const [created] = await db
    .insert(user)
    .values({ name: "Ada", email: `funding-sync-${crypto.randomUUID()}@example.com` })
    .returning({ id: user.id });
  if (!created) {
    throw new Error("user insert failed");
  }
  const account = await ensurePaperAccount(db, created.id);
  const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  return { account, btc };
}

function kline(fundingTimeMs: number, close: string) {
  const closeTime = Math.floor(fundingTimeMs / 60_000) * 60_000 - 1;
  const openTime = closeTime - 59_999;
  return [openTime, close, close, close, close, "0", closeTime];
}

function fakeRest(options: {
  rates: Array<{ symbol: string; fundingTime: number; fundingRate: string }>;
  marks: Record<number, unknown>;
}) {
  return {
    async getFundingRate() {
      return options.rates;
    },
    async getMarkPriceKlines(query: { startTime?: number; endTime?: number }) {
      const match = Object.entries(options.marks).find(([, candle]) => {
        if (!Array.isArray(candle)) {
          return false;
        }
        const closeTime = candle[6];
        return typeof query.endTime === "number" && closeTime === query.endTime;
      });
      if (match) {
        const candle = match[1];
        return Array.isArray(candle) && Array.isArray(candle[0]) ? candle : [candle];
      }
      const first = Object.values(options.marks)[0];
      return first ? [first] : [];
    },
  };
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
