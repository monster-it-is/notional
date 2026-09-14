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
  tradingPosition,
  updatePositionState,
  user,
  upsertInstrumentBySymbol,
} from "./index.js";
import { instrument } from "./schema/instrument.js";
import { endTestPool, postgresConstraint, resetTestTables } from "./test.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("trading_position", () => {
  afterAll(async () => {
    await endTestPool();
  });

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
    expect(typeof position.quantity).toBe("string");
    expect(typeof position.realizedPnl).toBe("string");
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
