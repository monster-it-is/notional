import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  db,
  ensurePaperAccount,
  ensureSystemFundingLedgerAccount,
  ensureSystemInsuranceAccount,
  ensureSystemTradingPnlAccount,
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
  fromDbDecimal,
  ledgerAccount,
  ledgerEntry,
  MoneyDecimal,
  postLedgerTransaction,
  SIGNUP_ALLOCATION_AMOUNT,
  sumRealizedTradingPnlSince,
  toDbDecimal,
  user,
  utcTimestampFromDate,
} from "./index.js";
import { postgresConstraint } from "./postgres-constraint.js";
import { endTestPool, resetTestTables } from "./test.js";

describe("sumRealizedTradingPnlSince", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("returns 0 when the account has no REALIZED_PNL events", async () => {
    const account = await seedAccount("empty-pnl@example.com");
    await postSignup(account.id);
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("0");
  });

  it("returns a profitable realized event as a positive canonical string", async () => {
    const account = await seedAccount("profit-pnl@example.com");
    await postRealized(account.id, "20");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("20");
  });

  it("returns a losing realized event as a negative canonical string", async () => {
    const account = await seedAccount("loss-pnl@example.com");
    await postRealized(account.id, "-7.5");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("-7.5");
  });

  it("sums mixed profit and loss exactly", async () => {
    const account = await seedAccount("mixed-pnl@example.com");
    await postRealized(account.id, "20", "realized-pnl:mixed-profit");
    await postRealized(account.id, "-5", "realized-pnl:mixed-loss");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("15");
  });

  it("includes an event exactly at the supplied cutoff", async () => {
    const account = await seedAccount("cutoff-in@example.com");
    const posted = await postRealized(account.id, "4");
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    await setLedgerCreatedAt(posted.id, cutoff);
    expect(await sumRealizedTradingPnlSince(db, account.id, cutoff)).toBe("4");
  });

  it("excludes an event before the supplied cutoff", async () => {
    const account = await seedAccount("cutoff-out@example.com");
    const posted = await postRealized(account.id, "4");
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    await setLedgerCreatedAt(posted.id, new Date(cutoff.getTime() - 1));
    expect(await sumRealizedTradingPnlSince(db, account.id, cutoff)).toBe("0");
  });

  it("excludes FUNDING_PAYMENT, FAUCET_CLAIM, and SIGNUP_ALLOCATION", async () => {
    const account = await seedAccount("excluded-events@example.com");
    await postSignup(account.id);
    await postFaucet(account.id);
    await postFunding(account.id);
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("0");
  });

  it("includes a reversal-sized realized component", async () => {
    const account = await seedAccount("reversal-pnl@example.com");
    await postRealized(account.id, "40");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("40");
  });

  it("includes liquidation realized PnL", async () => {
    const account = await seedAccount("liquidation-pnl@example.com");
    await postRealized(account.id, "-50", "liquidation-realized:event-1");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("-50");
  });

  it("uses full trading PnL for a partially insurance-covered loss", async () => {
    const account = await seedAccount("partial-insurance@example.com");
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const tradingPnl = await ensureSystemTradingPnlAccount(db);
    const insurance = await ensureSystemInsuranceAccount(db);

    await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "REALIZED_PNL",
        paperAccountId: account.id,
        idempotencyKey: "realized-pnl:partial-insurance",
        entries: [
          { ledgerAccountId: userCash.id, amount: new MoneyDecimal("-1000") },
          { ledgerAccountId: insurance.id, amount: new MoneyDecimal("-500") },
          { ledgerAccountId: tradingPnl.id, amount: new MoneyDecimal("1500") },
        ],
      }),
    );

    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("-1500");
  });

  it("includes a fully insurance-covered loss with no USER_CASH entry", async () => {
    const account = await seedAccount("full-insurance@example.com");
    const tradingPnl = await ensureSystemTradingPnlAccount(db);
    const insurance = await ensureSystemInsuranceAccount(db);

    const posted = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "REALIZED_PNL",
        paperAccountId: account.id,
        idempotencyKey: "realized-pnl:full-insurance",
        entries: [
          { ledgerAccountId: tradingPnl.id, amount: new MoneyDecimal("1500") },
          { ledgerAccountId: insurance.id, amount: new MoneyDecimal("-1500") },
        ],
      }),
    );

    const cashEntries = await db
      .select()
      .from(ledgerEntry)
      .innerJoin(ledgerAccount, eq(ledgerEntry.ledgerAccountId, ledgerAccount.id))
      .where(eq(ledgerEntry.ledgerTransactionId, posted.id));
    expect(cashEntries.some((row) => row.ledger_account.kind === "USER_CASH")).toBe(
      false,
    );
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("-1500");
  });

  it("does not double-count an idempotent replay of the same realized key", async () => {
    const account = await seedAccount("replay-pnl@example.com");
    await postRealized(account.id, "12", "realized-pnl:same-execution");
    await expect(
      db.transaction((tx) =>
        postRealizedInTx(tx, account.id, "12", "realized-pnl:same-execution"),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return postgresConstraint(error) === "ledger_transaction_idempotency_key_unique";
    });
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("12");
  });

  it("excludes another paper account's realized PnL", async () => {
    const first = await seedAccount("owner-pnl@example.com");
    const other = await seedAccount("other-pnl@example.com");
    await postRealized(first.id, "9", "realized-pnl:owner");
    await postRealized(other.id, "40", "realized-pnl:other");
    expect(await sumRealizedTradingPnlSince(db, first.id)).toBe("9");
    expect(await sumRealizedTradingPnlSince(db, other.id)).toBe("40");
  });

  it("aggregates high-precision NUMERIC amounts exactly", async () => {
    const account = await seedAccount("precision-pnl@example.com");
    const delta = "1.123456789012345678";
    await postRealized(account.id, delta, "realized-pnl:precision-a");
    await postRealized(account.id, delta, "realized-pnl:precision-b");
    const expected = toDbDecimal(fromDbDecimal(delta).plus(fromDbDecimal(delta)));
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe(expected);
  });

  it("includes a just-posted event when using the production rolling-24h cutoff", async () => {
    const account = await seedAccount("live-cutoff@example.com");
    await postRealized(account.id, "3");
    expect(await sumRealizedTradingPnlSince(db, account.id)).toBe("3");
  });
});

async function seedAccount(email: string) {
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

  return ensurePaperAccount(db, created.id);
}

async function postSignup(paperAccountId: string): Promise<void> {
  const userCash = await ensureUserCashLedgerAccount(db, paperAccountId);
  const systemFunding = await ensureSystemVirtualFundingAccount(db);
  await db.transaction((tx) =>
    postLedgerTransaction(tx, {
      eventType: "SIGNUP_ALLOCATION",
      paperAccountId,
      idempotencyKey: `signup-allocation:${paperAccountId}`,
      entries: [
        { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
        {
          ledgerAccountId: systemFunding.id,
          amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
        },
      ],
    }),
  );
}

async function postFaucet(paperAccountId: string): Promise<void> {
  const userCash = await ensureUserCashLedgerAccount(db, paperAccountId);
  const systemFunding = await ensureSystemVirtualFundingAccount(db);
  const amount = new MoneyDecimal("100");
  await db.transaction((tx) =>
    postLedgerTransaction(tx, {
      eventType: "FAUCET_CLAIM",
      paperAccountId,
      idempotencyKey: `faucet:${paperAccountId}:1`,
      entries: [
        { ledgerAccountId: userCash.id, amount },
        { ledgerAccountId: systemFunding.id, amount: amount.negated() },
      ],
    }),
  );
}

async function postFunding(paperAccountId: string): Promise<void> {
  const userCash = await ensureUserCashLedgerAccount(db, paperAccountId);
  const funding = await ensureSystemFundingLedgerAccount(db);
  await db.transaction((tx) =>
    postLedgerTransaction(tx, {
      eventType: "FUNDING_PAYMENT",
      paperAccountId,
      idempotencyKey: `funding-payment:${paperAccountId}`,
      entries: [
        { ledgerAccountId: userCash.id, amount: new MoneyDecimal("-8") },
        { ledgerAccountId: funding.id, amount: new MoneyDecimal("8") },
      ],
    }),
  );
}

async function postRealized(
  paperAccountId: string,
  realizedPnlDelta: string,
  idempotencyKey = `realized-pnl:${paperAccountId}:${realizedPnlDelta}`,
) {
  return db.transaction((tx) =>
    postRealizedInTx(tx, paperAccountId, realizedPnlDelta, idempotencyKey),
  );
}

async function postRealizedInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paperAccountId: string,
  realizedPnlDelta: string,
  idempotencyKey: string,
) {
  const userCash = await ensureUserCashLedgerAccount(tx, paperAccountId);
  const tradingPnl = await ensureSystemTradingPnlAccount(tx);
  const delta = fromDbDecimal(realizedPnlDelta);
  return postLedgerTransaction(tx, {
    eventType: "REALIZED_PNL",
    paperAccountId,
    idempotencyKey,
    entries: [
      { ledgerAccountId: tradingPnl.id, amount: delta.negated() },
      { ledgerAccountId: userCash.id, amount: delta },
    ],
  });
}

async function setLedgerCreatedAt(transactionId: string, createdAt: Date): Promise<void> {
  await db.execute(sql`
    UPDATE ledger_transaction
    SET created_at = ${utcTimestampFromDate(createdAt)}
    WHERE id = ${transactionId}::uuid
  `);
}
