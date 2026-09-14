import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelOpenLimitOrder,
  completeOpenLimitOrder,
  db,
  ensurePaperAccount,
  hasOpenOrdersForAccountInstrument,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  listOpenLimitOrdersByInstrumentId,
  sumOpenOrderReservedMarginByPaperAccountId,
  tradeOrder,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

describe("trade_order reserved_margin", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("persists a positive reservation for OPEN non-reduce LIMIT and zeros it on cancel and fill", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "0.001",
      limitPrice: "65000",
      reservedMargin: "6.5",
      idempotencyKey: "reserve",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    expect(created.order.reservedMargin).toBe("6.5");
    expect(await sumOpenOrderReservedMarginByPaperAccountId(db, account.id)).toBe("6.5");
    expect(await hasOpenOrdersForAccountInstrument(db, account.id, btcId)).toBe(true);

    const listed = await listOpenLimitOrdersByInstrumentId(db, btcId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.order.id);

    const cancelled = await db.transaction((tx) =>
      cancelOpenLimitOrder(tx, account.id, created.order.id),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.reservedMargin).toBe("0");
    expect(await sumOpenOrderReservedMarginByPaperAccountId(db, account.id)).toBe("0");
  });

  it("requires reserved_margin 0 for reduce-only OPEN LIMIT and MARKET fills", async () => {
    const { account, btcId } = await seed();
    const reduceOnly = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "SELL",
      orderType: "LIMIT",
      quantity: "0.001",
      limitPrice: "65000",
      reservedMargin: "0",
      reduceOnly: true,
      idempotencyKey: "reduce",
    });
    expect(reduceOnly.kind).toBe("created");
    if (reduceOnly.kind !== "created") {
      return;
    }

    expect(reduceOnly.order.reservedMargin).toBe("0");

    await expect(
      insertOpenLimitOrder(db, {
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.001",
        limitPrice: "65000",
        reservedMargin: "0",
        idempotencyKey: "non-reduce-zero",
      }),
    ).rejects.toThrow("non-reduce OPEN LIMIT reserved_margin must be positive");

    const filled = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, {
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "BUY",
        orderType: "MARKET",
        quantity: "0.001",
        executionPrice: "65000",
        idempotencyKey: "market-fill",
      }),
    );
    expect(filled.kind).toBe("created_filled");
    if (filled.kind !== "created_filled") {
      return;
    }

    expect(filled.order.reservedMargin).toBe("0");
  });

  it("zeros reserved_margin when completing an OPEN LIMIT", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "0.001",
      limitPrice: "100",
      reservedMargin: "10",
      idempotencyKey: "complete",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const filled = await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "99"),
    );
    expect(filled.kind).toBe("created_filled");
    if (filled.kind !== "created_filled") {
      return;
    }

    expect(filled.order.status).toBe("FILLED");
    expect(filled.order.reservedMargin).toBe("0");
  });

  it("rejects OPEN non-reduce LIMIT with reserved_margin 0 at the database", async () => {
    const { account, btcId } = await seed();

    await expect(
      db.insert(tradeOrder).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.001",
        limitPrice: "65000",
        reduceOnly: false,
        reservedMargin: "0",
        status: "OPEN",
        idempotencyKey: "check-zero",
      }),
    ).rejects.toSatisfy(
      (error: unknown) => postgresConstraint(error) === "trade_order_reserved_margin_lifecycle",
    );
  });
});

async function seed() {
  const [created] = await db
    .insert(user)
    .values({ name: "Ada", email: "reserve@example.com" })
    .returning({ id: user.id });
  const account = await ensurePaperAccount(db, created!.id);
  const btc = await upsertInstrumentBySymbol(db, {
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
  return { account, btcId: btc.id };
}
