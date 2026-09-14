import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelOpenLimitOrder,
  completeOpenLimitOrder,
  db,
  ensurePaperAccount,
  ExecutionMutationError,
  findAccountExecutionById,
  findExecutionByOrderId,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  listExecutionsByPaperAccountId,
  tradeOrder,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { execution } from "./schema/execution.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("execution", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("inserts a valid execution for an immediate MARKET fill", async () => {
    const { account, btcId } = await seed();
    const result = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, {
          quantity: "0.001",
          executionPrice: "65000.10",
        }),
      ),
    );

    expect(result.kind).toBe("created_filled");
    if (result.kind !== "created_filled") {
      return;
    }

    expect(result.order.status).toBe("FILLED");
    expect(result.order.orderType).toBe("MARKET");
    expect(result.order.limitPrice).toBeNull();
    expect(result.execution.id).toMatch(UUID_PATTERN);
    expect(result.execution.orderId).toBe(result.order.id);
    expect(result.execution.quantity).toBe("0.001");
    expect(result.execution.price).toBe("65000.1");
    expect(result.execution.executedAt).toBeInstanceOf(Date);
    expect(typeof result.execution.quantity).toBe("string");
    expect(typeof result.execution.price).toBe("string");
  });

  it("inserts a valid execution for an immediate LIMIT fill using order quantity", async () => {
    const { account, btcId } = await seed();
    const result = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledLimitInput(account.id, btcId, {
          quantity: "1.250",
          limitPrice: "100",
          executionPrice: "98.5",
        }),
      ),
    );

    expect(result.kind).toBe("created_filled");
    if (result.kind !== "created_filled") {
      return;
    }

    expect(result.order.quantity).toBe("1.25");
    expect(result.execution.quantity).toBe(result.order.quantity);
    expect(result.execution.price).toBe("98.5");
  });

  it("completes an OPEN LIMIT using the persisted order quantity", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, { quantity: "0.500", limitPrice: "100" }),
    );
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const filled = await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "99.1"),
    );

    expect(filled.kind).toBe("created_filled");
    expect(filled.order.status).toBe("FILLED");
    expect(filled.execution.quantity).toBe("0.5");
    expect(filled.execution.quantity).toBe(filled.order.quantity);
    expect(filled.execution.price).toBe("99.1");
    expect(await findExecutionByOrderId(db, created.order.id)).toEqual(filled.execution);
  });

  it("rejects non-positive quantity and price at the database", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await expectRejectedConstraint(
      db.insert(execution).values({
        orderId: created.order.id,
        quantity: "0",
        price: "100",
        executedAt: new Date("2024-06-15T12:30:00.000Z"),
      }),
      "execution_quantity_positive",
    );

    await expectRejectedConstraint(
      db.insert(execution).values({
        orderId: created.order.id,
        quantity: "0.001",
        price: "0",
        executedAt: new Date("2024-06-15T12:30:00.000Z"),
      }),
      "execution_price_positive",
    );
  });

  it("restricts deleting an order that still has an execution and enforces unique order_id", async () => {
    const { account, btcId } = await seed();
    const result = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, filledMarketInput(account.id, btcId)),
    );
    expect(result.kind).toBe("created_filled");
    if (result.kind !== "created_filled") {
      return;
    }

    await expectRejectedConstraint(
      db.delete(tradeOrder).where(eq(tradeOrder.id, result.order.id)),
      "execution_order_id_trade_order_id_fk",
    );

    await expectRejectedConstraint(
      db.insert(execution).values({
        orderId: result.order.id,
        quantity: "0.001",
        price: "1",
        executedAt: new Date("2024-06-15T12:30:00.000Z"),
      }),
      "execution_order_id_unique",
    );
  });

  it("persists exact high-precision numeric strings", async () => {
    const { account, btcId } = await seed();
    const quantity = "1.123456789012345678";
    const price = "9.876543210987654321";
    const result = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, { quantity, executionPrice: price }),
      ),
    );

    expect(result.kind).toBe("created_filled");
    if (result.kind !== "created_filled") {
      return;
    }

    expect(result.execution.quantity).toBe(quantity);
    expect(result.execution.price).toBe(price);
  });

  it("rejects an execution price that does not fit NUMERIC(38,18) without rounding", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await expect(
      db.transaction((tx) =>
        completeOpenLimitOrder(tx, account.id, created.order.id, "100.1234567890123456789"),
      ),
    ).rejects.toThrow("financial value exceeds 18 decimal places");

    expect(await findExecutionByOrderId(db, created.order.id)).toBeNull();
  });

  it("rejects a worse-than-limit BUY or SELL execution price", async () => {
    const { account, btcId } = await seed();
    const buy = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, {
        side: "BUY",
        limitPrice: "100",
        idempotencyKey: "buy-limit",
      }),
    );
    const sell = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, {
        side: "SELL",
        limitPrice: "100",
        idempotencyKey: "sell-limit",
      }),
    );
    expect(buy.kind).toBe("created");
    expect(sell.kind).toBe("created");
    if (buy.kind !== "created" || sell.kind !== "created") {
      return;
    }

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, buy.order.id, "100.01")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "ORDER_NOT_EXECUTABLE",
    );

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, sell.order.id, "99.99")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "ORDER_NOT_EXECUTABLE",
    );

    expect(await findExecutionByOrderId(db, buy.order.id)).toBeNull();
    expect((await db.select().from(tradeOrder)).map((row) => row.status)).toEqual([
      "OPEN",
      "OPEN",
    ]);
  });

  it("rolls back a new LIMIT fill when executionPrice is worse than the limit", async () => {
    const { account, btcId } = await seed();

    await expect(
      db.transaction((tx) =>
        insertFilledOrderWithExecution(
          tx,
          filledLimitInput(account.id, btcId, {
            limitPrice: "100",
            executionPrice: "105",
          }),
        ),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "ORDER_NOT_EXECUTABLE",
    );

    expect(await db.select().from(tradeOrder)).toHaveLength(0);
    expect(await db.select().from(execution)).toHaveLength(0);
  });

  it("does not fill a CANCELLED order", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, created.order.id));

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, created.order.id, "100")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "ORDER_ALREADY_CANCELLED",
    );

    expect(await findExecutionByOrderId(db, created.order.id)).toBeNull();
  });

  it("returns the original execution and price on a second complete fill", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const first = await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "100"),
    );
    const second = await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "105"),
    );

    expect(second.kind).toBe("replayed_filled");
    expect(first.kind).toBe("created_filled");
    expect(second.execution.id).toBe(first.execution.id);
    expect(second.execution.price).toBe("100");
    expect(await db.select().from(execution)).toHaveLength(1);
  });

  it("replays a FILLED insert without re-pricing when the current executionPrice differs", async () => {
    const { account, btcId } = await seed();
    const input = filledMarketInput(account.id, btcId, { executionPrice: "100" });
    const first = await db.transaction((tx) => insertFilledOrderWithExecution(tx, input));
    const replay = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, { ...input, executionPrice: "105" }),
    );

    expect(first.kind).toBe("created_filled");
    expect(replay.kind).toBe("replayed_filled");
    if (first.kind !== "created_filled" || replay.kind !== "replayed_filled") {
      return;
    }

    expect(replay.order.id).toBe(first.order.id);
    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.execution.price).toBe("100");
    expect(await db.select().from(execution)).toHaveLength(1);
  });

  it("replays a BUY LIMIT fill at 98 when the retry supplies worse-than-limit 105", async () => {
    const { account, btcId } = await seed();
    const input = filledLimitInput(account.id, btcId, {
      limitPrice: "100",
      executionPrice: "98",
      idempotencyKey: "limit-improve",
    });
    const first = await db.transaction((tx) => insertFilledOrderWithExecution(tx, input));
    const replay = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, { ...input, executionPrice: "105" }),
    );

    expect(first.kind).toBe("created_filled");
    expect(replay.kind).toBe("replayed_filled");
    if (first.kind !== "created_filled" || replay.kind !== "replayed_filled") {
      return;
    }

    expect(replay.execution.id).toBe(first.execution.id);
    expect(replay.execution.price).toBe("98");
    expect(await db.select().from(execution)).toHaveLength(1);
  });

  it("does not validate executionPrice when replaying an OPEN same-key order", async () => {
    const { account, btcId } = await seed();
    const open = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, {
        quantity: "0.001",
        limitPrice: "100",
        idempotencyKey: "open-no-price-check",
      }),
    );
    expect(open.kind).toBe("created");

    const replay = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledLimitInput(account.id, btcId, {
          quantity: "0.001",
          limitPrice: "100",
          executionPrice: "not-a-price",
          idempotencyKey: "open-no-price-check",
        }),
      ),
    );

    expect(replay.kind).toBe("replayed_order");
    if (replay.kind !== "replayed_order") {
      return;
    }

    expect(replay.order.status).toBe("OPEN");
    expect(await findExecutionByOrderId(db, replay.order.id)).toBeNull();
  });

  it("replays a same-key existing OPEN order without filling it", async () => {
    const { account, btcId } = await seed();
    const open = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, {
        quantity: "0.001",
        limitPrice: "100",
        idempotencyKey: "same-key",
      }),
    );
    expect(open.kind).toBe("created");

    const replay = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledLimitInput(account.id, btcId, {
          quantity: "0.001",
          limitPrice: "100",
          executionPrice: "99",
          idempotencyKey: "same-key",
        }),
      ),
    );

    expect(replay.kind).toBe("replayed_order");
    if (replay.kind !== "replayed_order") {
      return;
    }

    expect(replay.order.status).toBe("OPEN");
    expect(await findExecutionByOrderId(db, replay.order.id)).toBeNull();
  });

  it("replays a same-key existing CANCELLED order without filling it", async () => {
    const { account, btcId } = await seed();
    const open = await insertOpenLimitOrder(
      db,
      openLimitInput(account.id, btcId, { idempotencyKey: "cancelled-key" }),
    );
    expect(open.kind).toBe("created");
    if (open.kind !== "created") {
      return;
    }

    await db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, open.order.id));

    const replay = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledLimitInput(account.id, btcId, {
          executionPrice: "100",
          idempotencyKey: "cancelled-key",
        }),
      ),
    );

    expect(replay.kind).toBe("replayed_order");
    if (replay.kind !== "replayed_order") {
      return;
    }

    expect(replay.order.status).toBe("CANCELLED");
    expect(await findExecutionByOrderId(db, replay.order.id)).toBeNull();
  });

  it("conflicts when the same key is reused with a different fingerprint", async () => {
    const { account, btcId } = await seed();
    const first = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, {
          quantity: "0.001",
          idempotencyKey: "reuse",
        }),
      ),
    );
    expect(first.kind).toBe("created_filled");

    const reused = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, {
          quantity: "0.002",
          idempotencyKey: "reuse",
        }),
      ),
    );

    expect(reused.kind).toBe("key_reused");
  });

  it("rejects filling a FILLED order that has no execution", async () => {
    const { account, btcId } = await seed();
    const [orphan] = await db
      .insert(tradeOrder)
      .values({
        paperAccountId: account.id,
        instrumentId: btcId,
        side: "BUY",
        orderType: "LIMIT",
        quantity: "0.001",
        limitPrice: "100",
        reduceOnly: false,
        status: "FILLED",
        idempotencyKey: "orphan-filled",
      })
      .returning();

    if (!orphan) {
      throw new Error("failed to insert orphan FILLED order");
    }

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, orphan.id, "100")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "EXECUTION_CONFLICT",
    );
  });

  it("serializes concurrent complete fills into one execution", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        db.transaction((tx) =>
          completeOpenLimitOrder(tx, account.id, created.order.id, index === 0 ? "100" : "105"),
        ),
      ),
    );

    expect(new Set(results.map((row) => row.execution.id)).size).toBe(1);
    expect(results.filter((row) => row.kind === "created_filled")).toHaveLength(1);
    expect(results.filter((row) => row.kind === "replayed_filled")).toHaveLength(7);
    expect(results.every((row) => row.execution.price === results[0]?.execution.price)).toBe(
      true,
    );
    expect(await db.select().from(execution)).toHaveLength(1);
    expect((await db.select().from(tradeOrder))[0]?.status).toBe("FILLED");
  });

  it("treats OPEN plus a pre-existing execution as EXECUTION_CONFLICT and does not heal to FILLED", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await db.execute(sql`
      INSERT INTO execution (order_id, quantity, price, executed_at)
      VALUES (
        ${created.order.id}::uuid,
        ${created.order.quantity}::numeric,
        ${"98"}::numeric,
        TIMESTAMP '2024-06-15 12:30:00'
      )
    `);

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, created.order.id, "99")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "EXECUTION_CONFLICT",
    );

    const [order] = await db.select().from(tradeOrder).where(eq(tradeOrder.id, created.order.id));
    expect(order?.status).toBe("OPEN");
    const existing = await findExecutionByOrderId(db, created.order.id);
    expect(existing?.price).toBe("98");
    expect(await db.select().from(execution)).toHaveLength(1);
  });

  it("lets fill win against a later cancel", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "100"),
    );

    await expect(
      db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, created.order.id)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "ORDER_NOT_CANCELLABLE",
    );

    expect(await db.select().from(execution)).toHaveLength(1);
  });

  it("lets cancel win against a later fill", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, created.order.id));

    await expect(
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, created.order.id, "100")),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "ORDER_ALREADY_CANCELLED",
    );

    expect(await db.select().from(execution)).toHaveLength(0);
  });

  it("serializes concurrent cancel and fill into one consistent winner", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const outcomes = await Promise.allSettled([
      db.transaction((tx) => completeOpenLimitOrder(tx, account.id, created.order.id, "100")),
      db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, created.order.id)),
    ]);

    const executions = await db.select().from(execution);
    const [order] = await db.select().from(tradeOrder);

    if (order?.status === "FILLED") {
      expect(executions).toHaveLength(1);
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    } else {
      expect(order?.status).toBe("CANCELLED");
      expect(executions).toHaveLength(0);
    }
  });

  it("rolls back an OPEN fill so the order remains OPEN with no execution", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await expect(
      db.transaction(async (tx) => {
        await completeOpenLimitOrder(tx, account.id, created.order.id, "100");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect((await db.select().from(tradeOrder))[0]?.status).toBe("OPEN");
    expect(await db.select().from(execution)).toHaveLength(0);
  });

  it("rolls back an immediate fill so neither the order nor execution remains", async () => {
    const { account, btcId } = await seed();

    await expect(
      db.transaction(async (tx) => {
        await insertFilledOrderWithExecution(tx, filledMarketInput(account.id, btcId));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.select().from(tradeOrder)).toHaveLength(0);
    expect(await db.select().from(execution)).toHaveLength(0);
  });

  it("samples one PostgreSQL UTC wall-clock instant for execution and filled updated_at", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, openLimitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const before = await readWallClock();
    const filled = await db.transaction((tx) =>
      completeOpenLimitOrder(tx, account.id, created.order.id, "100"),
    );
    const after = await readWallClock();
    const stamps = await readFillStamps(filled.execution.id);

    expect(stamps.executedAt).toBe(stamps.updatedAt);
    expect(stamps.executedAt >= before).toBe(true);
    expect(stamps.executedAt <= after).toBe(true);
  });

  it("reads a UTC-naive executed_at as an unshifted ISO UTC instant", async () => {
    const { account, btcId } = await seed();
    const result = await db.transaction((tx) =>
      insertFilledOrderWithExecution(tx, filledMarketInput(account.id, btcId)),
    );
    expect(result.kind).toBe("created_filled");
    if (result.kind !== "created_filled") {
      return;
    }

    await db.execute(sql`
      UPDATE execution
      SET executed_at = TIMESTAMP '2024-06-15 12:30:00'
      WHERE id = ${result.execution.id}::uuid
    `);

    const loaded = await findAccountExecutionById(db, account.id, result.execution.id);
    expect(loaded?.executedAt.toISOString()).toBe("2024-06-15T12:30:00.000Z");

    const listed = await listExecutionsByPaperAccountId(db, account.id, {
      limit: 50,
      offset: 0,
    });
    expect(listed[0]?.executedAt.toISOString()).toBe("2024-06-15T12:30:00.000Z");
  });

  it("lists newest first and scopes reads to the paper account", async () => {
    const { account, other, btcId } = await seed();
    const older = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, { idempotencyKey: "older" }),
      ),
    );
    const newer = await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(account.id, btcId, { idempotencyKey: "newer" }),
      ),
    );
    await db.transaction((tx) =>
      insertFilledOrderWithExecution(
        tx,
        filledMarketInput(other.id, btcId, { idempotencyKey: "foreign" }),
      ),
    );

    expect(older.kind).toBe("created_filled");
    expect(newer.kind).toBe("created_filled");
    if (older.kind !== "created_filled" || newer.kind !== "created_filled") {
      return;
    }

    const listed = await listExecutionsByPaperAccountId(db, account.id, {
      limit: 50,
      offset: 0,
    });
    expect(listed.map((row) => row.id)).toEqual([newer.execution.id, older.execution.id]);
    expect(listed[0]?.symbol).toBe("BTCUSDT");
    expect(listed[0]?.orderId).toBe(newer.order.id);

    expect(await findAccountExecutionById(db, other.id, older.execution.id)).toBeNull();
  });

  it("does not export production update or delete helpers", async () => {
    const executionApi = await import("./execution.js");
    expect("updateExecution" in executionApi).toBe(false);
    expect("deleteExecution" in executionApi).toBe(false);
    expect("changeExecutionPrice" in executionApi).toBe(false);
  });
});

async function seed() {
  const ada = await insertUser("ada@example.com");
  const bob = await insertUser("bob@example.com");
  const account = await ensurePaperAccount(db, ada.id);
  const other = await ensurePaperAccount(db, bob.id);
  const btcRow = await upsertInstrumentBySymbol(db, btc());
  return { account, other, btcId: btcRow.id };
}

function openLimitInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: Partial<{
    side: "BUY" | "SELL";
    quantity: string;
    limitPrice: string;
    idempotencyKey: string;
  }> = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: overrides.side ?? "BUY",
    orderType: "LIMIT" as const,
    quantity: overrides.quantity ?? "0.001",
    limitPrice: overrides.limitPrice ?? "100",
    reservedMargin: "1",
    idempotencyKey: overrides.idempotencyKey ?? "open-limit",
  };
}

function filledMarketInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: Partial<{
    quantity: string;
    executionPrice: string;
    idempotencyKey: string;
  }> = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: "BUY" as const,
    orderType: "MARKET" as const,
    quantity: overrides.quantity ?? "0.001",
    executionPrice: overrides.executionPrice ?? "65000",
    idempotencyKey: overrides.idempotencyKey ?? "filled-market",
  };
}

function filledLimitInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: Partial<{
    quantity: string;
    limitPrice: string;
    executionPrice: string;
    side: "BUY" | "SELL";
    idempotencyKey: string;
  }> = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: overrides.side ?? "BUY",
    orderType: "LIMIT" as const,
    quantity: overrides.quantity ?? "0.001",
    limitPrice: overrides.limitPrice ?? "100",
    executionPrice: overrides.executionPrice ?? "100",
    idempotencyKey: overrides.idempotencyKey ?? "filled-limit",
  };
}

function btc() {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
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

async function readWallClock(): Promise<string> {
  const result = await db.execute(sql`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS wall_clock
  `);
  const [row] = result.rows as { wall_clock: string }[];

  if (!row?.wall_clock) {
    throw new Error("failed to read wall clock");
  }

  return row.wall_clock;
}

async function readFillStamps(executionId: string): Promise<{
  executedAt: string;
  updatedAt: string;
}> {
  const result = await db.execute(sql`
    SELECT
      to_char(execution.executed_at, 'YYYY-MM-DD HH24:MI:SS.US') AS executed_at,
      to_char(trade_order.updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at
    FROM execution
    INNER JOIN trade_order ON trade_order.id = execution.order_id
    WHERE execution.id = ${executionId}::uuid
  `);
  const [row] = result.rows as { executed_at: string; updated_at: string }[];

  if (!row) {
    throw new Error("missing fill stamps");
  }

  return { executedAt: row.executed_at, updatedAt: row.updated_at };
}

async function expectRejectedConstraint(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(operation).rejects.toSatisfy((error: unknown) => {
    return postgresConstraint(error) === constraint;
  });
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
