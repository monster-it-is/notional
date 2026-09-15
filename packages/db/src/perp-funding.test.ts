import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  ensurePaperAccount,
  ensurePerpFundingSourceState,
  ensurePosition,
  ensureSystemFundingLedgerAccount,
  ensureSystemInsuranceAccount,
  ensureUserCashLedgerAccount,
  findAccountSettlementByAccountAndTime,
  findFundingCycleByInstrumentAndTime,
  FundingCycleIntegrityError,
  insertPerpFundingAccountSettlement,
  insertPerpFundingSettlement,
  insertReadyFundingCycle,
  insertScheduledFundingCycle,
  listScheduledFundingCyclesBefore,
  listUnpaidReadyFundingBatches,
  markFundingCycleReady,
  minOpenFundingCursorAt,
  MoneyDecimal,
  persistNextFundingTimeObservation,
  postLedgerTransaction,
  tradingPosition,
  updatePositionState,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { instrument } from "./schema/instrument.js";
import { perpFundingCycle, perpFundingSourceState } from "./schema/perp-funding.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

afterAll(async () => {
  await endTestPool();
});

describe("perp funding schema", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("enforces cycle payload CHECKs, unique instrument/time, and signed READY rates", async () => {
    const { btcId } = await seed();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");

    const scheduled = await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: btcId, fundingTime }),
    );
    expect(scheduled.status).toBe("SCHEDULED");
    expect(scheduled.fundingRate).toBeNull();
    expect(scheduled.markPrice).toBeNull();
    expect(scheduled.readyAt).toBeNull();

    await expectRejectedConstraint(
      db.insert(perpFundingCycle).values({
        instrumentId: btcId,
        fundingTime: new Date("2026-09-16T00:00:00.000Z"),
        status: "READY",
        fundingRate: "0.01",
        markPrice: null,
        createdAt: new Date("2026-09-15T12:00:00.000Z"),
        readyAt: new Date("2026-09-15T12:00:00.000Z"),
      }),
      "perp_funding_cycle_payload_by_status",
    );

    const ready = await db.transaction((tx) =>
      markFundingCycleReady(tx, scheduled.id, { fundingRate: "-0.0001", markPrice: "100" }),
    );
    expect(ready.kind).toBe("transitioned");
    expect(ready.cycle.fundingRate).toBe("-0.0001");
    expect(ready.cycle.markPrice).toBe("100");

    await expectRejectedConstraint(
      db.insert(perpFundingCycle).values({
        instrumentId: btcId,
        fundingTime,
        status: "SCHEDULED",
        createdAt: new Date("2026-09-15T12:00:00.000Z"),
      }),
      "perp_funding_cycle_instrument_funding_time_unique",
    );
  });

  it("marks READY idempotently for the same payload and conflicts on a different payload", async () => {
    const { btcId } = await seed();
    const fundingTime = new Date("2026-09-15T08:00:00.000Z");
    const scheduled = await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: btcId, fundingTime }),
    );

    const first = await db.transaction((tx) =>
      markFundingCycleReady(tx, scheduled.id, { fundingRate: "0.01", markPrice: "100" }),
    );
    const same = await db.transaction((tx) =>
      markFundingCycleReady(tx, scheduled.id, { fundingRate: "0.01", markPrice: "100" }),
    );
    expect(first.kind).toBe("transitioned");
    expect(same.kind).toBe("already_ready_same");
    expect(same.cycle.fundingRate).toBe("0.01");
    expect(same.cycle.markPrice).toBe("100");

    await expect(
      db.transaction((tx) =>
        markFundingCycleReady(tx, scheduled.id, { fundingRate: "0.02", markPrice: "100" }),
      ),
    ).rejects.toBeInstanceOf(FundingCycleIntegrityError);

    const unchanged = await findFundingCycleByInstrumentAndTime(db, btcId, fundingTime);
    expect(unchanged?.fundingRate).toBe("0.01");
    expect(unchanged?.markPrice).toBe("100");
  });

  it("inserts READY directly and no-ops an identical recovery replay", async () => {
    const { btcId } = await seed();
    const fundingTime = new Date("2026-09-15T00:00:00.000Z");
    const first = await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime,
        fundingRate: "0.001",
        markPrice: "25000",
      }),
    );
    const replay = await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime,
        fundingRate: "0.001",
        markPrice: "25000",
      }),
    );
    expect(first.kind).toBe("transitioned");
    expect(replay.kind).toBe("already_ready_same");
  });

  it("restricts deleting an instrument that still has source state", async () => {
    const { btcId } = await seed();
    await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, {
        instrumentId: btcId,
        activationFloorAt: new Date("2026-09-15T12:00:00.000Z"),
      }),
    );

    await expect(db.delete(instrument).where(eq(instrument.id, btcId))).rejects.toSatisfy(
      (error: unknown) => postgresConstraint(error) !== undefined,
    );
  });

  it("stores activation_floor separately from nullable last_realized and observed next time", async () => {
    const { btcId } = await seed();
    const floor = new Date("2026-09-15T12:00:00.000Z");
    const created = await db.transaction((tx) =>
      ensurePerpFundingSourceState(tx, { instrumentId: btcId, activationFloorAt: floor }),
    );
    expect(created.activationFloorAt.toISOString()).toBe(floor.toISOString());
    expect(created.lastRealizedFundingTime).toBeNull();
    expect(created.nextFundingTime).toBeNull();
    expect(created.nextFundingTimeObservedAt).toBeNull();

    const observed = await db.transaction((tx) =>
      persistNextFundingTimeObservation(tx, btcId, new Date("2026-09-15T16:00:00.000Z")),
    );
    expect(observed.nextFundingTime?.toISOString()).toBe("2026-09-15T16:00:00.000Z");
    expect(observed.nextFundingTimeObservedAt).toBeInstanceOf(Date);
    expect(observed.lastRealizedFundingTime).toBeNull();

    await expectRejectedConstraint(
      db.insert(perpFundingSourceState).values({
        instrumentId: (await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"))).id,
        activationFloorAt: floor,
        nextFundingTime: new Date("2026-09-15T16:00:00.000Z"),
        nextFundingTimeObservedAt: null,
        updatedAt: floor,
      }),
      "perp_funding_source_state_next_observed",
    );
  });

  it("allows isolated nonflat zero collateral and rejects negative and CROSS nonzero isolated", async () => {
    const { account, btcId, ethId } = await seed();
    const [zero] = await db
      .insert(tradingPosition)
      .values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        marginMode: "ISOLATED",
        isolatedMargin: "0",
      })
      .returning({ id: tradingPosition.id });
    expect(zero).toBeDefined();

    await expect(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: ethId,
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        marginMode: "ISOLATED",
        isolatedMargin: "-1",
      }),
    ).rejects.toSatisfy((error: unknown) => postgresConstraint(error) !== undefined);

    await expect(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: ethId,
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        marginMode: "CROSS",
        isolatedMargin: "1",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return postgresConstraint(error) === "trading_position_isolated_margin_by_mode";
    });
  });

  it("enforces account/time uniqueness and CROSS/ISOLATED settlement nullability", async () => {
    const { account, btcId } = await seed();
    const fundingTime = new Date("2026-09-15T16:00:00.000Z");
    const position = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    await db.transaction((tx) =>
      updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
      }),
    );
    const cycle = await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    const accountSettlement = await db.transaction((tx) =>
      insertPerpFundingAccountSettlement(tx, {
        paperAccountId: account.id,
        fundingTime,
        totalFundingPayment: "-1",
        userWalletDelta: "-1",
        insuranceAbsorption: "0",
      }),
    );

    const cross = await db.transaction((tx) =>
      insertPerpFundingSettlement(tx, {
        fundingCycleId: cycle.cycle.id,
        paperAccountId: account.id,
        positionId: position.id,
        fundingAccountSettlementId: accountSettlement.id,
        marginMode: "CROSS",
        quantity: "1",
        fundingPayment: "-1",
        isolatedMarginBefore: null,
        isolatedMarginAfter: null,
      }),
    );
    expect(cross.isolatedMarginBefore).toBeNull();

    await expect(
      db.transaction((tx) =>
        insertPerpFundingAccountSettlement(tx, {
          paperAccountId: account.id,
          fundingTime,
          totalFundingPayment: "0",
          userWalletDelta: "0",
          insuranceAbsorption: "0",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return postgresConstraint(error) === "perp_funding_account_settlement_account_time_unique";
    });

    const found = await findAccountSettlementByAccountAndTime(db, account.id, fundingTime);
    expect(found?.id).toBe(accountSettlement.id);
  });

  it("posts a balanced FUNDING_PAYMENT and skips ledger when all amounts are zero", async () => {
    const { account } = await seed();
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const funding = await ensureSystemFundingLedgerAccount(db);
    const insurance = await ensureSystemInsuranceAccount(db);

    const posted = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "FUNDING_PAYMENT",
        idempotencyKey: "funding-payment:nonzero",
        entries: [
          { ledgerAccountId: userCash.id, amount: new MoneyDecimal("-100") },
          { ledgerAccountId: funding.id, amount: new MoneyDecimal("150") },
          { ledgerAccountId: insurance.id, amount: new MoneyDecimal("-50") },
        ],
      }),
    );
    expect(posted.eventType).toBe("FUNDING_PAYMENT");

    await expect(
      db.transaction((tx) =>
        postLedgerTransaction(tx, {
          eventType: "FUNDING_PAYMENT",
          idempotencyKey: "funding-payment:zero",
          entries: [],
        }),
      ),
    ).rejects.toThrow("ledger transaction requires at least two entries");
  });
});

describe("unpaid funding batches", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("lists unpaid READY batches oldest funding time first", async () => {
    const { account, btcId } = await seed();
    await db.transaction(async (tx) => {
      const position = await ensurePosition(tx, account.id, btcId);
      await updatePositionState(tx, position.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: new Date("2026-09-14T00:00:00.000Z"),
      });
    });
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: new Date("2026-09-14T16:00:00.000Z"),
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: new Date("2026-09-14T08:00:00.000Z"),
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    const batches = await listUnpaidReadyFundingBatches(db);
    expect(batches.map((row) => row.fundingTime.toISOString())).toEqual([
      "2026-09-14T08:00:00.000Z",
      "2026-09-14T16:00:00.000Z",
    ]);
  });
});

describe("perp funding source helpers", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("scopes the open funding cursor min to the requested instrument", async () => {
    const { account, btcId, ethId } = await seed();
    await db.transaction(async (tx) => {
      const eth = await ensurePosition(tx, account.id, ethId);
      await updatePositionState(tx, eth.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: new Date("2020-01-01T00:00:00.000Z"),
      });
      await ensurePosition(tx, account.id, btcId);
    });

    expect(await db.transaction((tx) => minOpenFundingCursorAt(tx, btcId))).toBeNull();
    expect(
      (await db.transaction((tx) => minOpenFundingCursorAt(tx, ethId)))?.toISOString(),
    ).toBe("2020-01-01T00:00:00.000Z");

    await db.transaction(async (tx) => {
      const btc = await ensurePosition(tx, account.id, btcId);
      await updatePositionState(tx, btc.id, {
        quantity: "2",
        entryPrice: "100",
        realizedPnl: "0",
        fundingCursorAt: new Date("2026-09-15T08:00:00.000Z"),
      });
    });
    expect(
      (await db.transaction((tx) => minOpenFundingCursorAt(tx, btcId)))?.toISOString(),
    ).toBe("2026-09-15T08:00:00.000Z");
  });

  it("lists scheduled cycles strictly before a later realized time", async () => {
    const { btcId } = await seed();
    const predicted = new Date("2026-09-15T16:00:00.000Z");
    const actual = new Date("2026-09-16T00:00:00.000Z");
    await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: btcId, fundingTime: predicted }),
    );
    await db.transaction((tx) =>
      insertReadyFundingCycle(tx, {
        instrumentId: btcId,
        fundingTime: actual,
        fundingRate: "0.01",
        markPrice: "100",
      }),
    );
    const scheduled = await db.transaction((tx) =>
      listScheduledFundingCyclesBefore(tx, btcId, actual),
    );
    expect(scheduled.map((row) => row.fundingTime.toISOString())).toEqual([
      predicted.toISOString(),
    ]);
  });
});

async function expectRejectedConstraint(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    return postgresConstraint(error) === constraint;
  });
}

async function seed() {
  const ada = await insertUser("funding-schema@example.com");
  const account = await ensurePaperAccount(db, ada.id);
  const btc = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  const eth = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
  return { account, btcId: btc.id, ethId: eth.id };
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

async function insertUser(email: string) {
  const [created] = await db
    .insert(user)
    .values({
      name: "Ada Lovelace",
      email,
    })
    .returning({ id: user.id });

  if (!created) {
    throw new Error("failed to insert user");
  }

  return created;
}
