import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createLiquidationEvent,
  db,
  ensurePaperAccount,
  findLiquidationEventById,
  insertFilledOrderWithExecution,
  insertLiquidationFilledOrderWithExecution,
  insertOpenLimitOrder,
  listLiquidationEventsByPaperAccountId,
  liquidationEvent,
  paperAccount,
  tradeOrder,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

describe("liquidation_event", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("accepts CROSS with a null instrument and ISOLATED with an instrument", async () => {
    const { account, btcId } = await seed();

    const cross = await db.transaction((tx) =>
      createLiquidationEvent(tx, {
        paperAccountId: account.id,
        marginMode: "CROSS",
        instrumentId: null,
        equity: "-12.5",
        maintenanceMargin: "5",
      }),
    );
    const isolated = await db.transaction((tx) =>
      createLiquidationEvent(tx, {
        paperAccountId: account.id,
        marginMode: "ISOLATED",
        instrumentId: btcId,
        equity: "1",
        maintenanceMargin: "2",
      }),
    );

    expect(cross.instrumentId).toBeNull();
    expect(cross.equity).toBe("-12.5");
    expect(isolated.instrumentId).toBe(btcId);
    expect(isolated.createdAt).toBeInstanceOf(Date);

    const listed = await listLiquidationEventsByPaperAccountId(db, account.id, {
      limit: 50,
      offset: 0,
    });
    expect(listed.map((row) => row.id)).toEqual([isolated.id, cross.id]);
    expect(listed[0]?.symbol).toBe("BTCUSDT");
    expect(listed[1]?.symbol).toBeNull();
  });

  it("rejects invalid mode/instrument combinations and negative maintenance", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(liquidationEvent).values({
        paperAccountId: account.id,
        marginMode: "CROSS",
        instrumentId: btcId,
        equity: "1",
        maintenanceMargin: "1",
        createdAt: new Date(),
      }),
      "liquidation_event_instrument_by_mode",
    );

    await expectRejectedConstraint(
      db.insert(liquidationEvent).values({
        paperAccountId: account.id,
        marginMode: "ISOLATED",
        instrumentId: null,
        equity: "1",
        maintenanceMargin: "1",
        createdAt: new Date(),
      }),
      "liquidation_event_instrument_by_mode",
    );

    await expectRejectedConstraint(
      db.insert(liquidationEvent).values({
        paperAccountId: account.id,
        marginMode: "CROSS",
        instrumentId: null,
        equity: "1",
        maintenanceMargin: "-0.01",
        createdAt: new Date(),
      }),
      "liquidation_event_maintenance_non_negative",
    );
  });

  it("restricts deleting a paper account that has liquidation history", async () => {
    const { account } = await seed();
    await db.transaction((tx) =>
      createLiquidationEvent(tx, {
        paperAccountId: account.id,
        marginMode: "CROSS",
        instrumentId: null,
        equity: "0",
        maintenanceMargin: "0",
      }),
    );

    await expect(db.delete(paperAccount).where(eq(paperAccount.id, account.id))).rejects.toSatisfy(
      (error: unknown) => postgresConstraint(error) !== undefined,
    );
  });
});

describe("trade_order origin", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("defaults user helpers to USER without an event", async () => {
    const { account, btcId } = await seed();
    const open = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "0.001",
      limitPrice: "65000",
      reservedMargin: "1",
      idempotencyKey: "user-limit",
    });
    expect(open.kind).toBe("created");
    if (open.kind !== "created") {
      return;
    }

    expect(open.order.origin).toBe("USER");
    expect(open.order.liquidationEventId).toBeNull();

    const filled = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, {
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "BUY",
        orderType: "MARKET",
        quantity: "0.001",
        executionPrice: "65000",
        idempotencyKey: "user-market",
      }),
    );
    expect(filled.kind).toBe("created_filled");
    if (filled.kind !== "created_filled") {
      return;
    }

    expect(filled.order.origin).toBe("USER");
    expect(filled.order.liquidationEventId).toBeNull();
  });

  it("rejects USER with an event and LIQUIDATION without one", async () => {
    const { account, btcId } = await seed();
    const event = await db.transaction((tx) =>
      createLiquidationEvent(tx, {
        paperAccountId: account.id,
        marginMode: "CROSS",
        instrumentId: null,
        equity: "1",
        maintenanceMargin: "1",
      }),
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "SELL",
        orderType: "MARKET",
        quantity: "0.001",
        reduceOnly: true,
        reservedMargin: "0",
        origin: "USER",
        liquidationEventId: event.id,
        status: "FILLED",
        idempotencyKey: "user-event",
      }),
      "trade_order_origin_event",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "SELL",
        orderType: "MARKET",
        quantity: "0.001",
        reduceOnly: true,
        reservedMargin: "0",
        origin: "LIQUIDATION",
        liquidationEventId: null,
        status: "FILLED",
        idempotencyKey: "liq-missing",
      }),
      "trade_order_origin_event",
    );
  });

  it("creates a liquidation MARKET fill and treats key reuse as a hard error", async () => {
    const { account, btcId } = await seed();
    const event = await db.transaction((tx) =>
      createLiquidationEvent(tx, {
        paperAccountId: account.id,
        marginMode: "ISOLATED",
        instrumentId: btcId,
        equity: "1",
        maintenanceMargin: "1",
      }),
    );
    const positionId = "11111111-1111-4111-8111-111111111111";

    const created = await db.transaction((tx) =>
      insertLiquidationFilledOrderWithExecution(tx, {
        paperAccountId: account.id,
        instrumentId: btcId,
        positionId,
        liquidationEventId: event.id,
        side: "SELL",
        quantity: "0.5",
        executionPrice: "99",
      }),
    );

    expect(created.order.origin).toBe("LIQUIDATION");
    expect(created.order.liquidationEventId).toBe(event.id);
    expect(created.order.reduceOnly).toBe(true);
    expect(created.order.status).toBe("FILLED");
    expect(created.execution.price).toBe("99");
    expect(await findLiquidationEventById(db, event.id)).not.toBeNull();

    await expect(
      db.transaction((tx) =>
        insertLiquidationFilledOrderWithExecution(tx, {
          paperAccountId: account.id,
          instrumentId: btcId,
          positionId,
          liquidationEventId: event.id,
          side: "SELL",
          quantity: "0.5",
          executionPrice: "99",
        }),
      ),
    ).rejects.toThrow("liquidation order idempotency conflict");
  });
});

afterAll(async () => {
  await endTestPool();
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
  const [created] = await db
    .insert(user)
    .values({ name: "Ada Lovelace", email: "ada-liq@example.com" })
    .returning({ id: user.id });

  if (!created) {
    throw new Error("failed to insert user");
  }

  const account = await ensurePaperAccount(db, created.id);
  const btcRow = await upsertInstrumentBySymbol(db, {
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
  return { account, btcId: btcRow.id };
}
