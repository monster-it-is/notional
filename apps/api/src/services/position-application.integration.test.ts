import {
  completeOpenLimitOrder,
  db,
  ensurePaperAccount,
  ensurePosition,
  ExecutionMutationError,
  findExecutionByOrderId,
  findOrderById,
  findPositionByAccountAndInstrument,
  insertFilledOrderWithExecution,
  insertOpenLimitOrder,
  listOrdersByPaperAccountId,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  pool,
  updateMarginSettingsForFlatPosition,
  user,
  upsertInstrumentBySymbol,
} from "@notional/db";
import { endTestPool, resetTestTables } from "@notional/db/test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyCreatedExecutionToPosition,
  applyPositionForFillResult,
  PositionApplicationError,
} from "./position-application.js";

describe("position application", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("opens FLAT + BUY as LONG and FLAT + SELL as SHORT", async () => {
    const { account, btcId, ethId } = await seed();

    const long = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "BUY",
        quantity: "0.5",
        executionPrice: "65000",
        idempotencyKey: "flat-buy",
      }),
    );
    const short = await applyImmediateFill(
      account.id,
      ethId,
      filledMarket(account.id, ethId, {
        side: "SELL",
        quantity: "1.25",
        executionPrice: "3000",
        idempotencyKey: "flat-sell",
      }),
    );

    expect(long.kind).toBe("applied");
    expect(short.kind).toBe("applied");
    if (long.kind !== "applied" || short.kind !== "applied") {
      return;
    }

    expect(long.transition).toBe("OPEN");
    expect(long.position.quantity).toBe("0.5");
    expect(long.position.entryPrice).toBe("65000");
    expect(long.realizedPnlDelta).toBe("0");
    expect(short.transition).toBe("OPEN");
    expect(short.position.quantity).toBe("-1.25");
    expect(short.position.entryPrice).toBe("3000");
  });

  it("applies LONG increase, reduce, close, and reverse", async () => {
    const { account, btcId } = await seed();

    const opened = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "2",
        executionPrice: "100",
        idempotencyKey: "open",
      }),
    );
    const increased = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "1",
        executionPrice: "130",
        idempotencyKey: "increase",
      }),
    );
    const reduced = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "1",
        executionPrice: "160",
        idempotencyKey: "reduce",
      }),
    );
    const closed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "2",
        executionPrice: "110",
        idempotencyKey: "close",
      }),
    );

    expect(opened.kind).toBe("applied");
    expect(increased.kind).toBe("applied");
    expect(reduced.kind).toBe("applied");
    expect(closed.kind).toBe("applied");
    if (
      opened.kind !== "applied" ||
      increased.kind !== "applied" ||
      reduced.kind !== "applied" ||
      closed.kind !== "applied"
    ) {
      return;
    }

    expect(opened.transition).toBe("OPEN");
    expect(increased.transition).toBe("INCREASE");
    expect(increased.position.quantity).toBe("3");
    expect(increased.position.entryPrice).toBe("110");
    expect(reduced.transition).toBe("REDUCE");
    expect(reduced.position.quantity).toBe("2");
    expect(reduced.position.entryPrice).toBe("110");
    expect(closed.transition).toBe("CLOSE");
    expect(closed.position.quantity).toBe("0");
    expect(closed.position.entryPrice).toBeNull();

    const reversedOpen = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "2",
        executionPrice: "100",
        idempotencyKey: "reopen",
      }),
    );
    const reversed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "3",
        executionPrice: "120",
        idempotencyKey: "reverse",
      }),
    );

    expect(reversedOpen.kind).toBe("applied");
    expect(reversed.kind).toBe("applied");
    if (reversed.kind !== "applied") {
      return;
    }

    expect(reversed.transition).toBe("REVERSE");
    expect(reversed.position.quantity).toBe("-1");
    expect(reversed.position.entryPrice).toBe("120");
    expect(reversed.realizedPnlDelta).toBe("40");
  });

  it("applies SHORT increase, reduce, close, and reverse", async () => {
    const { account, btcId } = await seed();

    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "2",
        executionPrice: "100",
        idempotencyKey: "s-open",
      }),
    );
    const increased = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "1",
        executionPrice: "90",
        idempotencyKey: "s-increase",
      }),
    );
    const reduced = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "BUY",
        quantity: "1",
        executionPrice: "80",
        idempotencyKey: "s-reduce",
      }),
    );
    const closed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "BUY",
        quantity: "2",
        executionPrice: "70",
        idempotencyKey: "s-close",
      }),
    );
    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "1",
        executionPrice: "100",
        idempotencyKey: "s-reopen",
      }),
    );
    const reversed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "BUY",
        quantity: "2",
        executionPrice: "110",
        idempotencyKey: "s-reverse",
      }),
    );

    expect(increased.kind).toBe("applied");
    expect(reduced.kind).toBe("applied");
    expect(closed.kind).toBe("applied");
    expect(reversed.kind).toBe("applied");
    if (
      increased.kind !== "applied" ||
      reduced.kind !== "applied" ||
      closed.kind !== "applied" ||
      reversed.kind !== "applied"
    ) {
      return;
    }

    expect(increased.transition).toBe("INCREASE");
    expect(increased.position.quantity).toBe("-3");
    expect(reduced.transition).toBe("REDUCE");
    expect(closed.transition).toBe("CLOSE");
    expect(closed.position.quantity).toBe("0");
    expect(closed.position.entryPrice).toBeNull();
    expect(reversed.transition).toBe("REVERSE");
    expect(reversed.position.quantity).toBe("1");
    expect(reversed.position.entryPrice).toBe("110");
  });

  it("keeps cumulative realized pnl across close and reopen", async () => {
    const { account, btcId } = await seed();

    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "1",
        executionPrice: "100",
        idempotencyKey: "c-open",
      }),
    );
    const reduced = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "0.5",
        executionPrice: "160",
        idempotencyKey: "c-reduce",
      }),
    );
    const closed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "0.5",
        executionPrice: "140",
        idempotencyKey: "c-close",
      }),
    );
    const reopened = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "1",
        executionPrice: "200",
        idempotencyKey: "c-reopen",
      }),
    );
    const later = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "1",
        executionPrice: "190",
        idempotencyKey: "c-loss",
      }),
    );

    expect(reduced.kind).toBe("applied");
    expect(closed.kind).toBe("applied");
    expect(reopened.kind).toBe("applied");
    expect(later.kind).toBe("applied");
    if (
      reduced.kind !== "applied" ||
      closed.kind !== "applied" ||
      reopened.kind !== "applied" ||
      later.kind !== "applied"
    ) {
      return;
    }

    expect(reduced.realizedPnlDelta).toBe("30");
    expect(closed.realizedPnlDelta).toBe("20");
    expect(closed.position.quantity).toBe("0");
    expect(closed.position.entryPrice).toBeNull();
    expect(closed.position.realizedPnl).toBe("50");
    expect(reopened.position.realizedPnl).toBe("50");
    expect(later.realizedPnlDelta).toBe("-10");
    expect(later.position.realizedPnl).toBe("40");
  });

  it("persists a quantized weighted-average entry as the next fill cost basis", async () => {
    const { account, btcId } = await seed();

    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "0.5",
        executionPrice: "100.5",
        idempotencyKey: "avg-open",
      }),
    );
    const increased = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "0.25",
        executionPrice: "99.5",
        idempotencyKey: "avg-increase",
      }),
    );

    expect(increased.kind).toBe("applied");
    if (increased.kind !== "applied") {
      return;
    }

    expect(increased.position.quantity).toBe("0.75");
    expect(increased.position.entryPrice).toBe("100.166666666666666667");

    const reduced = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "0.25",
        executionPrice: "110",
        idempotencyKey: "avg-reduce",
      }),
    );

    expect(reduced.kind).toBe("applied");
    if (reduced.kind !== "applied") {
      return;
    }

    expect(reduced.position.entryPrice).toBe("100.166666666666666667");
  });

  it("quantizes a >18-decimal realized delta once into the cumulative total", async () => {
    const { account, btcId } = await seed();

    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "0.000000000000000003",
        executionPrice: "1.000000000000000003",
        idempotencyKey: "tiny-open",
      }),
    );
    const closed = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "0.000000000000000003",
        executionPrice: "1.000000000000000001",
        idempotencyKey: "tiny-close",
      }),
    );

    expect(closed.kind).toBe("applied");
    if (closed.kind !== "applied") {
      return;
    }

    expect(closed.realizedPnlDelta).toBe("0");
    expect(closed.position.realizedPnl).toBe("0");
    expect(closed.position.quantity).toBe("0");
  });

  it("keeps quantity exact and never emits negative zero", async () => {
    const { account, btcId } = await seed();

    const increased = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "0.1",
        executionPrice: "100",
        idempotencyKey: "q1",
      }),
    );
    const next = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "0.2",
        executionPrice: "100",
        idempotencyKey: "q2",
      }),
    );

    expect(increased.kind).toBe("applied");
    expect(next.kind).toBe("applied");
    if (next.kind !== "applied") {
      return;
    }

    expect(next.position.quantity).toBe("0.3");

    await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "0.3",
        executionPrice: "100",
        idempotencyKey: "q-close",
      }),
    );
    const short = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "SELL",
        quantity: "1",
        executionPrice: "50",
        idempotencyKey: "q-short",
      }),
    );
    const flat = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        side: "BUY",
        quantity: "1",
        executionPrice: "50",
        idempotencyKey: "q-cover",
      }),
    );

    expect(short.kind).toBe("applied");
    expect(flat.kind).toBe("applied");
    if (flat.kind !== "applied") {
      return;
    }

    expect(flat.position.quantity).toBe("0");
    expect(flat.position.entryPrice).toBeNull();
  });

  it("applies a created fill once and ignores replayed_filled", async () => {
    const { account, btcId } = await seed();
    const input = filledMarket(account.id, btcId, {
      quantity: "1",
      executionPrice: "100",
      idempotencyKey: "once",
    });

    const first = await applyImmediateFill(account.id, btcId, input);
    const replay = await applyImmediateFill(account.id, btcId, {
      ...input,
      executionPrice: "105",
    });

    expect(first.kind).toBe("applied");
    expect(replay.kind).toBe("replayed");
    if (first.kind !== "applied" || replay.kind !== "replayed") {
      return;
    }

    expect(first.position.quantity).toBe("1");
    expect(replay.position.quantity).toBe("1");
    expect(replay.position.realizedPnl).toBe(first.position.realizedPnl);
    expect(first.position.marginMode).toBe("CROSS");
    expect(first.position.leverage).toBe(1);
    expect(first.position.isolatedMargin).toBe("0");
  });

  it("rejects a created fill against an ISOLATED position", async () => {
    const { account, btcId } = await seed();
    await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, account.id);
      await ensurePosition(tx, account.id, btcId);
      const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
      await updateMarginSettingsForFlatPosition(tx, position.id, {
        marginMode: "ISOLATED",
        leverage: 10,
      });
    });

    await expect(
      applyImmediateFill(
        account.id,
        btcId,
        filledMarket(account.id, btcId, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "isolated-fill",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof PositionApplicationError &&
        error.code === "ISOLATED_FILL_NOT_IMPLEMENTED"
      );
    });

    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row?.quantity).toBe("0");
    expect(row?.marginMode).toBe("ISOLATED");
    expect(row?.isolatedMargin).toBe("0");
  });

  it("does not reapply position on a resting LIMIT retry", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      reservedMargin: "1",
      idempotencyKey: "resting",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const first = await applyCompleteFill(account.id, btcId, created.order.id, "99");
    const retry = await applyCompleteFill(account.id, btcId, created.order.id, "90");

    expect(first.kind).toBe("applied");
    expect(retry.kind).toBe("replayed");
    if (first.kind !== "applied" || retry.kind !== "replayed") {
      return;
    }

    expect(first.position.quantity).toBe("1");
    expect(retry.position.quantity).toBe("1");
    expect(retry.position.entryPrice).toBe("99");
  });

  it("rejects OPEN plus a pre-existing execution without applying position", async () => {
    const { account, btcId } = await seed();
    const created = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      reservedMargin: "1",
      idempotencyKey: "corrupt",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, account.id);
      await ensurePosition(tx, account.id, btcId);
    });

    await pool.query(
      `INSERT INTO execution (order_id, quantity, price, executed_at)
       VALUES ($1::uuid, $2::numeric, $3::numeric, TIMESTAMP '2024-06-15 12:30:00')`,
      [created.order.id, "1", "98"],
    );

    await expect(
      applyCompleteFill(account.id, btcId, created.order.id, "99"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ExecutionMutationError && error.code === "EXECUTION_CONFLICT",
    );

    const order = await findOrderById(db, account.id, created.order.id);
    expect(order?.status).toBe("OPEN");
    expect((await findExecutionByOrderId(db, created.order.id))?.price).toBe("98");
    const position = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(position?.quantity).toBe("0");
    expect(position?.entryPrice).toBeNull();
  });

  it("rejects mismatched or non-FILLED application input", async () => {
    const { account, btcId, ethId } = await seed();
    const open = await insertOpenLimitOrder(db, {
      paperAccountId: account.id,
      instrumentId: btcId,
      side: "BUY",
      orderType: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      reservedMargin: "1",
      idempotencyKey: "open-reject",
    });
    expect(open.kind).toBe("created");
    if (open.kind !== "created") {
      return;
    }

    const filled = await applyImmediateFill(
      account.id,
      btcId,
      filledMarket(account.id, btcId, {
        quantity: "1",
        executionPrice: "100",
        idempotencyKey: "filled-reject",
      }),
    );
    expect(filled.kind).toBe("applied");
    if (filled.kind !== "applied") {
      return;
    }

    const position = filled.position;
    const created = await db.transaction(async (tx) => {
      await lockPaperAccountById(tx, account.id);
      return insertFilledOrderWithExecution(
        tx,
        filledMarket(account.id, ethId, {
          quantity: "1",
          executionPrice: "50",
          idempotencyKey: "other-instrument",
        }),
      );
    });
    expect(created.kind).toBe("created_filled");
    if (created.kind !== "created_filled") {
      return;
    }

    await expect(
      db.transaction((tx) =>
        applyCreatedExecutionToPosition(tx, {
          position,
          fill: {
            kind: "created_filled",
            order: open.order,
            execution: {
              ...created.execution,
              orderId: open.order.id,
              quantity: open.order.quantity,
            },
          },
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PositionApplicationError && error.code === "ORDER_NOT_FILLED",
    );

    await expect(
      db.transaction((tx) =>
        applyCreatedExecutionToPosition(tx, {
          position,
          fill: created,
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof PositionApplicationError && error.code === "MISMATCHED_FILL",
    );
  });

  it("rolls back fill, execution, and position together", async () => {
    const { account, btcId } = await seed();
    const existing = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    await expect(
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, account.id);
        await ensurePosition(tx, account.id, btcId);
        const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
        const fill = await insertFilledOrderWithExecution(
          tx,
          filledMarket(account.id, btcId, {
            quantity: "1",
            executionPrice: "100",
            idempotencyKey: "rollback",
          }),
        );
        if (fill.kind !== "created_filled") {
          throw new Error("expected created_filled");
        }
        await applyCreatedExecutionToPosition(tx, { position, fill });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row?.id).toBe(existing.id);
    expect(row?.quantity).toBe("0");
    expect(row?.entryPrice).toBeNull();
    expect(row?.realizedPnl).toBe("0");
    expect(await listOrdersByPaperAccountId(db, account.id, { limit: 10, offset: 0 })).toHaveLength(
      0,
    );
  });

  it("serializes two new fills on the same position through account then position locks", async () => {
    const { account, btcId } = await seed();

    await Promise.all([
      applyImmediateFill(
        account.id,
        btcId,
        filledMarket(account.id, btcId, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "conc-a",
        }),
      ),
      applyImmediateFill(
        account.id,
        btcId,
        filledMarket(account.id, btcId, {
          quantity: "1",
          executionPrice: "100",
          idempotencyKey: "conc-b",
        }),
      ),
    ]);

    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row?.quantity).toBe("2");
    expect(row?.entryPrice).toBe("100");
  });
});

async function applyImmediateFill(
  paperAccountId: string,
  instrumentId: string,
  input: Parameters<typeof insertFilledOrderWithExecution>[1],
) {
  return db.transaction(async (tx) => {
    await lockPaperAccountById(tx, paperAccountId);
    await ensurePosition(tx, paperAccountId, instrumentId);
    const position = await lockPositionByAccountAndInstrument(tx, paperAccountId, instrumentId);
    const fill = await insertFilledOrderWithExecution(tx, input);
    if (fill.kind !== "created_filled" && fill.kind !== "replayed_filled") {
      throw new Error(`unexpected fill kind ${fill.kind}`);
    }
    return applyPositionForFillResult(tx, position, fill);
  });
}

async function applyCompleteFill(
  paperAccountId: string,
  instrumentId: string,
  orderId: string,
  executionPrice: string,
) {
  return db.transaction(async (tx) => {
    await lockPaperAccountById(tx, paperAccountId);
    await ensurePosition(tx, paperAccountId, instrumentId);
    const position = await lockPositionByAccountAndInstrument(tx, paperAccountId, instrumentId);
    const fill = await completeOpenLimitOrder(tx, paperAccountId, orderId, executionPrice);
    return applyPositionForFillResult(tx, position, fill);
  });
}

function filledMarket(
  paperAccountId: string,
  instrumentId: string,
  overrides: {
    side?: "BUY" | "SELL";
    quantity?: string;
    executionPrice?: string;
    idempotencyKey?: string;
  } = {},
) {
  return {
    paperAccountId,
    instrumentId,
    side: overrides.side ?? "BUY",
    orderType: "MARKET" as const,
    quantity: overrides.quantity ?? "0.001",
    executionPrice: overrides.executionPrice ?? "65000",
    idempotencyKey: overrides.idempotencyKey ?? "filled-market",
  };
}

async function seed() {
  const ada = await insertUser("ada@example.com");
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
