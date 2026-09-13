import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelOpenLimitOrder,
  db,
  ensurePaperAccount,
  findAccountOrderById,
  findOrderById,
  findOrderByIdempotencyKey,
  insertOrder,
  instrument,
  listOrdersByPaperAccountId,
  lockOrderById,
  OrderMutationError,
  paperAccount,
  tradeOrder,
  user,
  upsertInstrumentBySymbol,
  type CreateOrderInput,
} from "./index.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("trade_order", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("inserts a valid FILLED MARKET order with a null limit price", async () => {
    const { account, btcId } = await seed();

    const result = await insertOrder(
      db,
      marketInput(account.id, btcId, { quantity: "0.001" }),
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") {
      return;
    }

    expect(result.order.id).toMatch(UUID_PATTERN);
    expect(result.order.paperAccountId).toBe(account.id);
    expect(result.order.instrumentId).toBe(btcId);
    expect(result.order.side).toBe("BUY");
    expect(result.order.orderType).toBe("MARKET");
    expect(result.order.status).toBe("FILLED");
    expect(result.order.limitPrice).toBeNull();
    expect(typeof result.order.quantity).toBe("string");
    expect(result.order.quantity).toBe("0.001");
    expect(result.order.reduceOnly).toBe(false);
  });

  it("inserts a valid OPEN LIMIT order with a positive limit price", async () => {
    const { account, btcId } = await seed();

    const result = await insertOrder(
      db,
      limitInput(account.id, btcId, { quantity: "0.002", limitPrice: "65000.1" }),
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") {
      return;
    }

    expect(result.order.orderType).toBe("LIMIT");
    expect(result.order.status).toBe("OPEN");
    expect(result.order.limitPrice).toBe("65000.1");
    expect(result.order.quantity).toBe("0.002");
  });

  it("inserts a valid FILLED LIMIT order", async () => {
    const { account, btcId } = await seed();

    const result = await insertOrder(
      db,
      limitInput(account.id, btcId, { status: "FILLED" }),
    );

    expect(result.kind).toBe("created");
    if (result.kind !== "created") {
      return;
    }

    expect(result.order.status).toBe("FILLED");
    expect(result.order.limitPrice).toBe("65000");
  });

  it("rejects MARKET OPEN, MARKET CANCELLED, and MARKET limit prices at the database", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "MARKET",
          status: "OPEN",
          limitPrice: null,
        }),
      ),
      "trade_order_status_by_type",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "MARKET",
          status: "CANCELLED",
          limitPrice: null,
        }),
      ),
      "trade_order_status_by_type",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "MARKET",
          status: "FILLED",
          limitPrice: "100",
        }),
      ),
      "trade_order_limit_price_by_type",
    );
  });

  it("rejects LIMIT without a positive limit price", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "LIMIT",
          status: "OPEN",
          limitPrice: null,
        }),
      ),
      "trade_order_limit_price_by_type",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "LIMIT",
          status: "OPEN",
          limitPrice: "0",
        }),
      ),
      "trade_order_limit_price_by_type",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "LIMIT",
          status: "OPEN",
          limitPrice: "-1",
        }),
      ),
      "trade_order_limit_price_by_type",
    );
  });

  it("rejects non-positive quantity and invalid enums at the database", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          quantity: "0",
        }),
      ),
      "trade_order_quantity_positive",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          side: "LONG",
        }),
      ),
      "trade_order_side_valid",
    );

    await expect(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          orderType: "STOP",
          status: "OPEN",
          limitPrice: "100",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      const constraint = postgresConstraint(error);
      return (
        constraint === "trade_order_type_valid" ||
        constraint === "trade_order_status_by_type" ||
        constraint === "trade_order_limit_price_by_type"
      );
    });

    await expect(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          status: "REJECTED",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      const constraint = postgresConstraint(error);
      return (
        constraint === "trade_order_status_valid" ||
        constraint === "trade_order_status_by_type"
      );
    });
  });

  it("rejects an empty, oversized, or padded idempotency key", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          idempotencyKey: "",
        }),
      ),
      "trade_order_idempotency_key_shape",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          idempotencyKey: `${"a".repeat(129)}`,
        }),
      ),
      "trade_order_idempotency_key_shape",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          idempotencyKey: " padded ",
        }),
      ),
      "trade_order_idempotency_key_shape",
    );
  });

  it("accepts printable non-whitespace ASCII idempotency keys on insertOrder", async () => {
    const { account, btcId } = await seed();

    for (const idempotencyKey of [
      "abc",
      "order-123",
      "retry_ABC:123",
      "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    ]) {
      const result = await insertOrder(
        db,
        limitInput(account.id, btcId, { idempotencyKey }),
      );
      expect(result.kind).toBe("created");
      if (result.kind === "created") {
        expect(result.order.idempotencyKey).toBe(idempotencyKey);
      }
    }
  });

  it("rejects non-printable or whitespace idempotency keys before insertOrder writes a row", async () => {
    const { account, btcId } = await seed();
    const invalidKeys = [
      "",
      "a".repeat(129),
      " padded ",
      "has space",
      "tab\tkey",
      "new\nline",
      "return\rkey",
      "café",
      "   ",
      "\t",
      "\n",
    ];

    for (const idempotencyKey of invalidKeys) {
      await expect(
        insertOrder(db, limitInput(account.id, btcId, { idempotencyKey })),
      ).rejects.toThrow(
        "idempotency key must be 1..128 printable non-whitespace ASCII characters",
      );
    }

    expect(await db.select().from(tradeOrder)).toHaveLength(0);
  });

  it("rejects missing paper_account and instrument foreign keys", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: "00000000-0000-4000-8000-000000000001",
          instrumentId: btcId,
        }),
      ),
      "trade_order_paper_account_id_paper_account_id_fk",
    );

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: "00000000-0000-4000-8000-000000000001",
        }),
      ),
      "trade_order_instrument_id_instrument_id_fk",
    );
  });

  it("restricts deleting an account or instrument that still has orders", async () => {
    const { account, btcId } = await seed();
    await insertOrder(db, limitInput(account.id, btcId));

    await expectRejectedConstraint(
      db.delete(paperAccount).where(eq(paperAccount.id, account.id)),
      "trade_order_paper_account_id_paper_account_id_fk",
    );

    await expectRejectedConstraint(
      db.delete(instrument).where(eq(instrument.id, btcId)),
      "trade_order_instrument_id_instrument_id_fk",
    );
  });

  it("rejects creating a LIMIT order directly in CANCELLED status", async () => {
    const { account, btcId } = await seed();

    await expect(
      insertOrder(
        db,
        limitInput(account.id, btcId, {
          status: "CANCELLED",
        }) as unknown as CreateOrderInput,
      ),
    ).rejects.toThrow("LIMIT orders cannot be created CANCELLED");
  });

  it("cancels an OPEN LIMIT order and treats a second cancel as success", async () => {
    const { account, btcId } = await seed();
    const created = await insertOrder(db, limitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const cancelled = await db.transaction((tx) =>
      cancelOpenLimitOrder(tx, account.id, created.order.id),
    );

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.id).toBe(created.order.id);

    const again = await db.transaction((tx) =>
      cancelOpenLimitOrder(tx, account.id, created.order.id),
    );

    expect(again.status).toBe("CANCELLED");
    expect(again.id).toBe(created.order.id);
  });

  it("does not cancel FILLED LIMIT or MARKET orders", async () => {
    const { account, btcId } = await seed();
    const filledLimit = await insertOrder(
      db,
      limitInput(account.id, btcId, { status: "FILLED", idempotencyKey: "filled-limit" }),
    );
    const filledMarket = await insertOrder(
      db,
      marketInput(account.id, btcId, { idempotencyKey: "filled-market" }),
    );

    expect(filledLimit.kind).toBe("created");
    expect(filledMarket.kind).toBe("created");
    if (filledLimit.kind !== "created" || filledMarket.kind !== "created") {
      return;
    }

    await expect(
      db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, filledLimit.order.id)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OrderMutationError && error.code === "ORDER_NOT_CANCELLABLE",
    );

    await expect(
      db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, filledMarket.order.id)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OrderMutationError && error.code === "ORDER_NOT_CANCELLABLE",
    );
  });

  it("does not cancel another account's order", async () => {
    const { account, other, btcId } = await seed();
    const created = await insertOrder(db, limitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await expect(
      db.transaction((tx) => cancelOpenLimitOrder(tx, other.id, created.order.id)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof OrderMutationError && error.code === "ORDER_NOT_FOUND",
    );

    const stillOpen = await findOrderById(db, account.id, created.order.id);
    expect(stillOpen?.status).toBe("OPEN");
  });

  it("serializes concurrent cancels into one CANCELLED row", async () => {
    const { account, btcId } = await seed();
    const created = await insertOrder(db, limitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, created.order.id)),
      ),
    );

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(results.every((row) => row.status === "CANCELLED")).toBe(true);

    const rows = await db.select().from(tradeOrder);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("CANCELLED");
  });

  it("locks an order row for update without locking the paper account", async () => {
    const { account, btcId } = await seed();
    const created = await insertOrder(db, limitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    const locked = await db.transaction((tx) =>
      lockOrderById(tx, account.id, created.order.id),
    );

    expect(locked?.id).toBe(created.order.id);
    expect(locked?.status).toBe("OPEN");
  });

  it("enforces per-account idempotency uniqueness and allows the same key on another account", async () => {
    const { account, other, btcId } = await seed();

    const first = await insertOrder(
      db,
      limitInput(account.id, btcId, { idempotencyKey: "shared-key" }),
    );
    const secondAccount = await insertOrder(
      db,
      limitInput(other.id, btcId, { idempotencyKey: "shared-key" }),
    );

    expect(first.kind).toBe("created");
    expect(secondAccount.kind).toBe("created");
    if (first.kind !== "created" || secondAccount.kind !== "created") {
      return;
    }

    expect(first.order.id).not.toBe(secondAccount.order.id);

    await expectRejectedConstraint(
      db.insert(tradeOrder).values(
        rawOrder({
          paperAccountId: account.id,
          instrumentId: btcId,
          idempotencyKey: "shared-key",
        }),
      ),
      "trade_order_paper_account_idempotency_key_unique",
    );
  });

  it("replays an identical concurrent create as one row", async () => {
    const { account, btcId } = await seed();
    const input = limitInput(account.id, btcId, { idempotencyKey: "same-create" });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => insertOrder(db, input)),
    );

    const created = results.filter((result) => result.kind === "created");
    const replayed = results.filter((result) => result.kind === "replayed");

    expect(created.length + replayed.length).toBe(8);
    expect(created.length).toBe(1);

    const ids = new Set(
      results.map((result) =>
        result.kind === "key_reused" ? result.existing.id : result.order.id,
      ),
    );
    expect(ids.size).toBe(1);

    const rows = await db.select().from(tradeOrder);
    expect(rows).toHaveLength(1);
  });

  it("replays canonical quantity 1 and 1.0 as the same request", async () => {
    const { account, btcId } = await seed();

    const first = await insertOrder(
      db,
      limitInput(account.id, btcId, {
        quantity: "1",
        idempotencyKey: "canonical-qty",
      }),
    );
    const second = await insertOrder(
      db,
      limitInput(account.id, btcId, {
        quantity: "1.0",
        idempotencyKey: "canonical-qty",
      }),
    );

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("replayed");
    if (first.kind !== "created" || second.kind !== "replayed") {
      return;
    }

    expect(second.order.id).toBe(first.order.id);
  });

  it("replays after the original OPEN order is cancelled without comparing status", async () => {
    const { account, btcId } = await seed();
    const input = limitInput(account.id, btcId, { idempotencyKey: "after-cancel" });
    const first = await insertOrder(db, input);
    expect(first.kind).toBe("created");
    if (first.kind !== "created") {
      return;
    }

    await db.transaction((tx) => cancelOpenLimitOrder(tx, account.id, first.order.id));

    const replay = await insertOrder(db, input);
    expect(replay.kind).toBe("replayed");
    if (replay.kind !== "replayed") {
      return;
    }

    expect(replay.order.id).toBe(first.order.id);
    expect(replay.order.status).toBe("CANCELLED");
  });

  it("conflicts when the same key is reused with a different fingerprint", async () => {
    const { account, btcId, ethId } = await seed();
    const first = await insertOrder(
      db,
      limitInput(account.id, btcId, { idempotencyKey: "reuse", quantity: "0.001" }),
    );
    expect(first.kind).toBe("created");

    const differentQty = await insertOrder(
      db,
      limitInput(account.id, btcId, { idempotencyKey: "reuse", quantity: "0.002" }),
    );
    expect(differentQty.kind).toBe("key_reused");

    const differentSide = await insertOrder(
      db,
      limitInput(account.id, btcId, {
        idempotencyKey: "reuse",
        quantity: "0.001",
        side: "SELL",
      }),
    );
    expect(differentSide.kind).toBe("key_reused");

    const differentInstrument = await insertOrder(
      db,
      limitInput(account.id, ethId, { idempotencyKey: "reuse", quantity: "0.001" }),
    );
    expect(differentInstrument.kind).toBe("key_reused");
  });

  it("keeps order rows when the instrument becomes INACTIVE", async () => {
    const { account, btcId } = await seed();
    const created = await insertOrder(db, limitInput(account.id, btcId));
    expect(created.kind).toBe("created");
    if (created.kind !== "created") {
      return;
    }

    await upsertInstrumentBySymbol(db, btc({ status: "INACTIVE" }));

    const loaded = await findAccountOrderById(db, account.id, created.order.id);
    expect(loaded?.id).toBe(created.order.id);
    expect(loaded?.symbol).toBe("BTCUSDT");
    expect((await findOrderByIdempotencyKey(db, account.id, "limit-1"))?.id).toBe(
      created.order.id,
    );
  });

  it("lists newest first and scopes finds to the paper account", async () => {
    const { account, other, btcId } = await seed();
    const older = await insertOrder(
      db,
      limitInput(account.id, btcId, { idempotencyKey: "older" }),
    );
    const newer = await insertOrder(
      db,
      marketInput(account.id, btcId, { idempotencyKey: "newer" }),
    );
    const foreign = await insertOrder(
      db,
      limitInput(other.id, btcId, { idempotencyKey: "foreign" }),
    );

    expect(older.kind).toBe("created");
    expect(newer.kind).toBe("created");
    expect(foreign.kind).toBe("created");
    if (older.kind !== "created" || newer.kind !== "created" || foreign.kind !== "created") {
      return;
    }

    const listed = await listOrdersByPaperAccountId(db, account.id, {
      limit: 50,
      offset: 0,
    });
    expect(listed.map((row) => row.id)).toEqual([newer.order.id, older.order.id]);
    expect(listed[0]?.symbol).toBe("BTCUSDT");

    expect(await findOrderById(db, other.id, older.order.id)).toBeNull();
    expect(await findAccountOrderById(db, other.id, older.order.id)).toBeNull();
  });

  it("does not export a production delete helper", async () => {
    const orderApi = await import("./order.js");
    expect("deleteOrder" in orderApi).toBe(false);
  });
});

async function seed() {
  const ada = await insertUser("ada@example.com");
  const bob = await insertUser("bob@example.com");
  const account = await ensurePaperAccount(db, ada.id);
  const other = await ensurePaperAccount(db, bob.id);
  const btcRow = await upsertInstrumentBySymbol(db, btc());
  const ethRow = await upsertInstrumentBySymbol(db, eth());
  return { account, other, btcId: btcRow.id, ethId: ethRow.id };
}

function marketInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: Partial<{
    side: "BUY" | "SELL";
    quantity: string;
    reduceOnly: boolean;
    idempotencyKey: string;
  }> = {},
): CreateOrderInput {
  return {
    paperAccountId,
    instrumentId,
    side: overrides.side ?? "BUY",
    orderType: "MARKET",
    quantity: overrides.quantity ?? "0.001",
    status: "FILLED",
    reduceOnly: overrides.reduceOnly,
    idempotencyKey: overrides.idempotencyKey ?? "market-1",
  };
}

function limitInput(
  paperAccountId: string,
  instrumentId: string,
  overrides: Partial<{
    side: "BUY" | "SELL";
    quantity: string;
    limitPrice: string;
    reduceOnly: boolean;
    status: "OPEN" | "FILLED" | "CANCELLED";
    idempotencyKey: string;
  }> = {},
): CreateOrderInput {
  return {
    paperAccountId,
    instrumentId,
    side: overrides.side ?? "BUY",
    orderType: "LIMIT",
    quantity: overrides.quantity ?? "0.001",
    limitPrice: overrides.limitPrice ?? "65000",
    status: (overrides.status ?? "OPEN") as "OPEN" | "FILLED",
    reduceOnly: overrides.reduceOnly,
    idempotencyKey: overrides.idempotencyKey ?? "limit-1",
  };
}

function rawOrder(
  overrides: Partial<typeof tradeOrder.$inferInsert> = {},
): typeof tradeOrder.$inferInsert {
  return {
    paperAccountId: overrides.paperAccountId ?? "00000000-0000-4000-8000-000000000001",
    instrumentId: overrides.instrumentId ?? "00000000-0000-4000-8000-000000000002",
    side: "BUY",
    orderType: "LIMIT",
    quantity: "0.001",
    limitPrice: "65000",
    reduceOnly: false,
    status: "OPEN",
    idempotencyKey: "raw-1",
    ...overrides,
  };
}

function btc(overrides: { status?: "ACTIVE" | "INACTIVE" } = {}) {
  return {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    status: overrides.status ?? "ACTIVE",
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
  } as const;
}

function eth() {
  return {
    ...btc(),
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    tickSize: "0.01",
    minPrice: "0.01",
  } as const;
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
