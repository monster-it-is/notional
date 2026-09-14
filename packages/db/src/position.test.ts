import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  ensurePaperAccount,
  ensurePosition,
  findOpenPositionByAccountAndSymbol,
  findPositionByAccountAndInstrument,
  listOpenPositionsByPaperAccountId,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
  paperAccount,
  PositionMutationError,
  tradingPosition,
  updateMarginSettingsForFlatPosition,
  updatePositionState,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { instrument } from "./schema/instrument.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterAll(async () => {
  await endTestPool();
});

describe("trading_position", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("inserts a canonical flat row", async () => {
    const { account, btcId } = await seed();
    const position = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    expect(position.id).toMatch(UUID_PATTERN);
    expect(position.paperAccountId).toBe(account.id);
    expect(position.instrumentId).toBe(btcId);
    expect(position.quantity).toBe("0");
    expect(position.entryPrice).toBeNull();
    expect(position.realizedPnl).toBe("0");
    expect(position.marginMode).toBe("CROSS");
    expect(position.leverage).toBe(1);
    expect(position.isolatedMargin).toBe("0");
    expect(typeof position.quantity).toBe("string");
    expect(typeof position.realizedPnl).toBe("string");
    expect(typeof position.isolatedMargin).toBe("string");
    expect(typeof position.leverage).toBe("number");
    expect(position.createdAt).toBeInstanceOf(Date);
    expect(position.updatedAt).toBeInstanceOf(Date);
  });

  it("accepts LONG and SHORT open rows", async () => {
    const { account, btcId, ethId } = await seed();
    const longRow = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const shortRow = await db.transaction((tx) => ensurePosition(tx, account.id, ethId));

    const long = await db.transaction((tx) =>
      updatePositionState(tx, longRow.id, {
        quantity: "0.5",
        entryPrice: "65000",
        realizedPnl: "12.5",
      }),
    );
    const short = await db.transaction((tx) =>
      updatePositionState(tx, shortRow.id, {
        quantity: "-1.25",
        entryPrice: "3000.1",
        realizedPnl: "-8",
      }),
    );

    expect(long.quantity).toBe("0.5");
    expect(long.entryPrice).toBe("65000");
    expect(short.quantity).toBe("-1.25");
    expect(short.entryPrice).toBe("3000.1");
    expect(short.realizedPnl).toBe("-8");
  });

  it("rejects zero quantity with a non-null entry", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "0",
        entryPrice: "100",
        realizedPnl: "0",
      }),
      "trading_position_qty_entry_invariant",
    );
  });

  it("rejects nonzero quantity with a null entry", async () => {
    const { account, btcId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "1",
        entryPrice: null,
        realizedPnl: "0",
      }),
      "trading_position_qty_entry_invariant",
    );
  });

  it("rejects zero and negative entry prices on open rows", async () => {
    const { account, btcId, ethId } = await seed();

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "1",
        entryPrice: "0",
        realizedPnl: "0",
      }),
      "trading_position_qty_entry_invariant",
    );

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: ethId,
        quantity: "-1",
        entryPrice: "-100",
        realizedPnl: "0",
      }),
      "trading_position_qty_entry_invariant",
    );
  });

  it("accepts positive, zero, and negative realized pnl", async () => {
    const { account, btcId, ethId } = await seed();
    const btc = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const eth = await db.transaction((tx) => ensurePosition(tx, account.id, ethId));

    const positive = await db.transaction((tx) =>
      updatePositionState(tx, btc.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "30",
      }),
    );
    const negative = await db.transaction((tx) =>
      updatePositionState(tx, eth.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "-10.5",
      }),
    );

    expect(positive.realizedPnl).toBe("30");
    expect(negative.realizedPnl).toBe("-10.5");
  });

  it("enforces unique account and instrument identity", async () => {
    const { account, other, btcId } = await seed();
    await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const otherRow = await db.transaction((tx) => ensurePosition(tx, other.id, btcId));

    expect(otherRow.paperAccountId).toBe(other.id);

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
      }),
      "trading_position_paper_account_instrument_unique",
    );
  });

  it("restricts deleting an account or instrument that still has a position", async () => {
    const { account, btcId } = await seed();
    await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    await expectRejectedConstraint(
      db.delete(paperAccount).where(eq(paperAccount.id, account.id)),
      "trading_position_paper_account_id_paper_account_id_fk",
    );

    await expectRejectedConstraint(
      db.delete(instrument).where(eq(instrument.id, btcId)),
      "trading_position_instrument_id_instrument_id_fk",
    );
  });

  it("creates exactly one row under concurrent ensure calls", async () => {
    const { account, btcId } = await seed();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.transaction((tx) => ensurePosition(tx, account.id, btcId)),
      ),
    );

    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await db.select().from(tradingPosition)).toHaveLength(1);
  });

  it("reuses the persistent flat row and does not delete it", async () => {
    const { account, btcId } = await seed();
    const first = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    await db.transaction((tx) =>
      updatePositionState(tx, first.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "30",
      }),
    );
    const closed = await db.transaction((tx) =>
      updatePositionState(tx, first.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "50",
      }),
    );
    const again = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    expect(closed.quantity).toBe("0");
    expect(closed.entryPrice).toBeNull();
    expect(closed.realizedPnl).toBe("50");
    expect(again.id).toBe(first.id);
    expect(again.realizedPnl).toBe("50");
    expect(await db.select().from(tradingPosition)).toHaveLength(1);
  });

  it("distinguishes a missing row from a persistent flat row", async () => {
    const { account, btcId, ethId } = await seed();
    expect(await findPositionByAccountAndInstrument(db, account.id, btcId)).toBeNull();

    await db.transaction((tx) => ensurePosition(tx, account.id, ethId));
    const flat = await findPositionByAccountAndInstrument(db, account.id, ethId);

    expect(flat).not.toBeNull();
    expect(flat?.quantity).toBe("0");
    expect(flat?.entryPrice).toBeNull();
    expect(await findOpenPositionByAccountAndSymbol(db, account.id, "ETHUSDT")).toBeNull();
  });

  it("lists only open positions by symbol ascending and omits flat rows", async () => {
    const { account, other, btcId, ethId } = await seed();
    const btc = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const eth = await db.transaction((tx) => ensurePosition(tx, account.id, ethId));
    const otherBtc = await db.transaction((tx) => ensurePosition(tx, other.id, btcId));

    await db.transaction((tx) =>
      updatePositionState(tx, eth.id, {
        quantity: "-2",
        entryPrice: "3000",
        realizedPnl: "1",
      }),
    );
    await db.transaction((tx) =>
      updatePositionState(tx, btc.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
      }),
    );
    await db.transaction((tx) =>
      updatePositionState(tx, otherBtc.id, {
        quantity: "9",
        entryPrice: "1",
        realizedPnl: "0",
      }),
    );

    const listed = await listOpenPositionsByPaperAccountId(db, account.id);
    expect(listed.map((row) => row.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(listed[0]?.quantity).toBe("1");
    expect(listed[1]?.quantity).toBe("-2");

    const bySymbol = await findOpenPositionByAccountAndSymbol(db, account.id, "ETHUSDT");
    expect(bySymbol?.quantity).toBe("-2");
    expect(await findOpenPositionByAccountAndSymbol(db, account.id, "SOLUSDT")).toBeNull();
  });

  it("locks a position without mutating the paper account", async () => {
    const { account, btcId } = await seed();
    await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const before = await db.select().from(paperAccount).where(eq(paperAccount.id, account.id));

    const locked = await db.transaction((tx) =>
      lockPositionByAccountAndInstrument(tx, account.id, btcId),
    );

    expect(locked.paperAccountId).toBe(account.id);
    const after = await db.select().from(paperAccount).where(eq(paperAccount.id, account.id));
    expect(after[0]?.balance).toBe(before[0]?.balance);
  });

  it("throws when locking a missing position", async () => {
    const { account, btcId } = await seed();

    await expect(
      db.transaction((tx) => lockPositionByAccountAndInstrument(tx, account.id, btcId)),
    ).rejects.toThrow("trading_position missing after lock");
  });

  it("serializes two account-then-position updates", async () => {
    const { account, btcId } = await seed();
    await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    await Promise.all([
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, account.id);
        const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
        await updatePositionState(tx, position.id, {
          quantity: "1",
          entryPrice: "100",
          realizedPnl: "1",
        });
      }),
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, account.id);
        const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
        await updatePositionState(tx, position.id, {
          quantity: "2",
          entryPrice: "200",
          realizedPnl: "2",
        });
      }),
    ]);

    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row?.quantity === "1" || row?.quantity === "2").toBe(true);
    expect(await db.select().from(tradingPosition)).toHaveLength(1);
  });

  it("rolls back a position update with the surrounding transaction", async () => {
    const { account, btcId } = await seed();
    const created = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    await expect(
      db.transaction(async (tx) => {
        await updatePositionState(tx, created.id, {
          quantity: "1",
          entryPrice: "100",
          realizedPnl: "5",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const row = await findPositionByAccountAndInstrument(db, account.id, created.instrumentId);
    expect(row?.quantity).toBe("0");
    expect(row?.entryPrice).toBeNull();
    expect(row?.realizedPnl).toBe("0");
  });

  it("does not change paper_account.balance when updating position state", async () => {
    const { account, btcId } = await seed();
    const created = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    await db.transaction((tx) =>
      updatePositionState(tx, created.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "40",
      }),
    );

    const [row] = await db.select().from(paperAccount).where(eq(paperAccount.id, account.id));
    expect(row?.balance).toBe(account.balance);
  });

  it("does not export a production delete helper", async () => {
    const positionApi = await import("./position.js");
    expect("deletePosition" in positionApi).toBe(false);
  });
});

describe("trading_position margin settings", () => {
  beforeEach(async () => {
    await resetTestTables();
  });

  it("applies CROSS / 1 / 0 when new columns are omitted", async () => {
    const { account, btcId } = await seed();

    await db.insert(tradingPosition).values({
      paperAccountId: account.id,
      instrumentId: btcId,
      quantity: "0",
      entryPrice: null,
      realizedPnl: "0",
    });

    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row?.marginMode).toBe("CROSS");
    expect(row?.leverage).toBe(1);
    expect(row?.isolatedMargin).toBe("0");
  });

  it("rejects invalid margin mode and leverage bounds", async () => {
    const { account, btcId, ethId } = await seed();

    await expect(db.insert(tradingPosition).values({
      paperAccountId: account.id,
      instrumentId: btcId,
      quantity: "0",
      entryPrice: null,
      realizedPnl: "0",
      marginMode: "HEDGE",
    })).rejects.toSatisfy((error: unknown) => {
      const constraint = postgresConstraint(error);
      return (
        constraint === "trading_position_margin_mode_valid" ||
        constraint === "trading_position_isolated_margin_by_mode"
      );
    });

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        leverage: 0,
      }),
      "trading_position_leverage_bounds",
    );

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: ethId,
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        leverage: 101,
      }),
      "trading_position_leverage_bounds",
    );
  });

  it("accepts leverage 1 and 100", async () => {
    const { account, btcId, ethId } = await seed();
    const one = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    const hundred = await db.transaction((tx) => ensurePosition(tx, account.id, ethId));

    const min = await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, one.id, {
        marginMode: "CROSS",
        leverage: 1,
      }),
    );
    const max = await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, hundred.id, {
        marginMode: "ISOLATED",
        leverage: 100,
      }),
    );

    expect(min.leverage).toBe(1);
    expect(max.leverage).toBe(100);
    expect(max.marginMode).toBe("ISOLATED");
    expect(max.isolatedMargin).toBe("0");
  });

  it("enforces isolated_margin mode and qty invariants", async () => {
    const { account, btcId, ethId } = await seed();
    const other = await upsertInstrumentBySymbol(db, sample("SOLUSDT", "SOL"));

    await expect(db.insert(tradingPosition).values({
      paperAccountId: account.id,
      instrumentId: btcId,
      quantity: "0",
      entryPrice: null,
      realizedPnl: "0",
      isolatedMargin: "-1",
    })).rejects.toSatisfy((error: unknown) => {
      const constraint = postgresConstraint(error);
      return (
        constraint === "trading_position_isolated_margin_non_negative" ||
        constraint === "trading_position_isolated_margin_by_mode"
      );
    });

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        marginMode: "CROSS",
        isolatedMargin: "1",
      }),
      "trading_position_isolated_margin_by_mode",
    );

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: ethId,
        quantity: "0",
        entryPrice: null,
        realizedPnl: "0",
        marginMode: "ISOLATED",
        isolatedMargin: "10",
      }),
      "trading_position_isolated_margin_by_mode",
    );

    await expectRejectedConstraint(
      db.insert(tradingPosition).values({
        paperAccountId: account.id,
        instrumentId: other.id,
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        marginMode: "ISOLATED",
        isolatedMargin: "0",
      }),
      "trading_position_isolated_margin_by_mode",
    );

    const [isolatedOpen] = await db
      .insert(tradingPosition)
      .values({
        paperAccountId: account.id,
        instrumentId: btcId,
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
        marginMode: "ISOLATED",
        isolatedMargin: "10",
      })
      .returning({ id: tradingPosition.id });

    expect(isolatedOpen).toBeDefined();

    const isolatedFlat = await db.transaction((tx) => ensurePosition(tx, account.id, ethId));
    const updated = await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, isolatedFlat.id, {
        marginMode: "ISOLATED",
        leverage: 5,
      }),
    );
    expect(updated.quantity).toBe("0");
    expect(updated.isolatedMargin).toBe("0");
  });

  it("updates flat CROSS and ISOLATED settings without touching realized pnl", async () => {
    const { account, btcId } = await seed();
    const created = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    await db.transaction((tx) =>
      updatePositionState(tx, created.id, {
        quantity: "0",
        entryPrice: null,
        realizedPnl: "30",
      }),
    );

    const isolated = await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, created.id, {
        marginMode: "ISOLATED",
        leverage: 20,
      }),
    );
    expect(isolated.marginMode).toBe("ISOLATED");
    expect(isolated.leverage).toBe(20);
    expect(isolated.realizedPnl).toBe("30");
    expect(isolated.quantity).toBe("0");
    expect(isolated.entryPrice).toBeNull();
    expect(isolated.isolatedMargin).toBe("0");

    const cross = await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, created.id, {
        marginMode: "CROSS",
        leverage: 8,
      }),
    );
    expect(cross.marginMode).toBe("CROSS");
    expect(cross.leverage).toBe(8);
    expect(cross.realizedPnl).toBe("30");
  });

  it("rejects settings mutation on a non-flat position", async () => {
    const { account, btcId } = await seed();
    const created = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    await db.transaction((tx) =>
      updatePositionState(tx, created.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "0",
      }),
    );

    await expect(
      db.transaction((tx) =>
        updateMarginSettingsForFlatPosition(tx, created.id, {
          marginMode: "ISOLATED",
          leverage: 10,
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof PositionMutationError && error.code === "POSITION_NOT_FLAT";
    });
  });

  it("preserves margin settings when a CROSS fill updates quantity", async () => {
    const { account, btcId } = await seed();
    const created = await db.transaction((tx) => ensurePosition(tx, account.id, btcId));
    await db.transaction((tx) =>
      updateMarginSettingsForFlatPosition(tx, created.id, {
        marginMode: "CROSS",
        leverage: 25,
      }),
    );

    const opened = await db.transaction((tx) =>
      updatePositionState(tx, created.id, {
        quantity: "1",
        entryPrice: "100",
        realizedPnl: "4",
      }),
    );

    expect(opened.marginMode).toBe("CROSS");
    expect(opened.leverage).toBe(25);
    expect(opened.isolatedMargin).toBe("0");
    expect(opened.quantity).toBe("1");
    expect(opened.realizedPnl).toBe("4");
  });

  it("serializes settings updates against account then position locks", async () => {
    const { account, btcId } = await seed();
    await db.transaction((tx) => ensurePosition(tx, account.id, btcId));

    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, account.id);
        const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
        return updateMarginSettingsForFlatPosition(tx, position.id, {
          marginMode: "CROSS",
          leverage: 50,
        });
      }),
      db.transaction(async (tx) => {
        await lockPaperAccountById(tx, account.id);
        const position = await lockPositionByAccountAndInstrument(tx, account.id, btcId);
        return updatePositionState(tx, position.id, {
          quantity: "1",
          entryPrice: "100",
          realizedPnl: "0",
        });
      }),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const row = await findPositionByAccountAndInstrument(db, account.id, btcId);
    expect(row).not.toBeNull();
    expect(await db.select().from(tradingPosition)).toHaveLength(1);

    if (row?.quantity === "0") {
      expect(row.leverage === 50 || row.leverage === 1).toBe(true);
      expect(row.entryPrice).toBeNull();
    } else {
      expect(row?.quantity).toBe("1");
      expect(row?.entryPrice).toBe("100");
      expect(row?.marginMode).toBe("CROSS");
      expect(row?.leverage === 1 || row?.leverage === 50).toBe(true);
      expect(row?.isolatedMargin).toBe("0");
    }
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
  const ada = await insertUser("ada@example.com");
  const bob = await insertUser("bob@example.com");
  const account = await ensurePaperAccount(db, ada.id);
  const other = await ensurePaperAccount(db, bob.id);
  const btcRow = await upsertInstrumentBySymbol(db, sample("BTCUSDT", "BTC"));
  const ethRow = await upsertInstrumentBySymbol(db, sample("ETHUSDT", "ETH"));
  return { account, other, btcId: btcRow.id, ethId: ethRow.id };
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
