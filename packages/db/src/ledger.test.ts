import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { postgresConstraint } from "./postgres-constraint.js";
import {
  db,
  ensurePaperAccount,
  ensureSystemInsuranceAccount,
  ensureSystemTradingPnlAccount,
  ensureSystemVirtualFundingAccount,
  ensureUserCashLedgerAccount,
  fundingEvent,
  ledgerAccount,
  ledgerEntry,
  ledgerTransaction,
  MoneyDecimal,
  paperAccount,
  postLedgerTransaction,
  SIGNUP_ALLOCATION_AMOUNT,
  user,
} from "./index.js";
import { endTestPool, resetTestTables } from "./test.js";

describe("ledger and funding primitives", () => {
  afterAll(async () => {
    await endTestPool();
  });

  beforeEach(async () => {
    await resetTestTables();
  });

  it("creates one USER_CASH account per paper account under concurrency", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureUserCashLedgerAccount(db, account.id),
      ),
    );

    const ids = new Set(results.map((row) => row.id));
    expect(ids.size).toBe(1);

    const rows = await db
      .select()
      .from(ledgerAccount)
      .where(
        and(
          eq(ledgerAccount.kind, "USER_CASH"),
          eq(ledgerAccount.paperAccountId, account.id),
        ),
      );

    expect(rows).toHaveLength(1);
  });

  it("creates one global SYSTEM_VIRTUAL_FUNDING account under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureSystemVirtualFundingAccount(db)),
    );

    const ids = new Set(results.map((row) => row.id));
    expect(ids.size).toBe(1);

    const rows = await db
      .select()
      .from(ledgerAccount)
      .where(eq(ledgerAccount.kind, "SYSTEM_VIRTUAL_FUNDING"));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.paperAccountId).toBeNull();
  });

  it("posts a balanced signup allocation and rejects an unbalanced one", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);

    await expect(
      db.transaction((tx) =>
        postLedgerTransaction(tx, {
          eventType: "SIGNUP_ALLOCATION",
          idempotencyKey: "unbalanced",
          entries: [
            {
              ledgerAccountId: userCash.id,
              amount: SIGNUP_ALLOCATION_AMOUNT,
            },
            {
              ledgerAccountId: systemFunding.id,
              amount: new MoneyDecimal("-999"),
            },
          ],
        }),
      ),
    ).rejects.toThrow("ledger transaction is unbalanced");

    const leftover = await db.select().from(ledgerTransaction);
    expect(leftover).toHaveLength(0);

    const posted = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:balanced",
        entries: [
          {
            ledgerAccountId: userCash.id,
            amount: SIGNUP_ALLOCATION_AMOUNT,
          },
          {
            ledgerAccountId: systemFunding.id,
            amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
          },
        ],
      }),
    );

    const entries = await db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.ledgerTransactionId, posted.id));

    expect(entries).toHaveLength(2);
    expect(typeof entries[0]?.amount).toBe("string");

    const sum = entries.reduce(
      (total, entry) => total.plus(new MoneyDecimal(entry.amount)),
      new MoneyDecimal("0"),
    );
    expect(sum.isZero()).toBe(true);
  });

  it("posts a balanced FAUCET_CLAIM transaction", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);
    const faucetAmount = new MoneyDecimal("100");

    const posted = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "FAUCET_CLAIM",
        idempotencyKey: "faucet:balanced",
        entries: [
          {
            ledgerAccountId: userCash.id,
            amount: faucetAmount,
          },
          {
            ledgerAccountId: systemFunding.id,
            amount: faucetAmount.negated(),
          },
        ],
      }),
    );

    expect(posted.eventType).toBe("FAUCET_CLAIM");

    const entries = await db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.ledgerTransactionId, posted.id));

    expect(entries).toHaveLength(2);

    const sum = entries.reduce(
      (total, entry) => total.plus(new MoneyDecimal(entry.amount)),
      new MoneyDecimal("0"),
    );
    expect(sum.isZero()).toBe(true);
  });

  it("rejects a zero-amount ledger entry at the database", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);

    const [transaction] = await db
      .insert(ledgerTransaction)
      .values({
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "zero-entry",
      })
      .returning();

    await expectRejectedConstraint(
      db.insert(ledgerEntry).values({
        ledgerTransactionId: transaction!.id,
        ledgerAccountId: userCash.id,
        amount: "0",
      }),
      "ledger_entry_amount_nonzero",
    );
  });

  it("rejects a duplicate ledger idempotency key", async () => {
    await db.insert(ledgerTransaction).values({
      eventType: "SIGNUP_ALLOCATION",
      idempotencyKey: "signup-allocation:dup",
    });

    await expectRejectedConstraint(
      db.insert(ledgerTransaction).values({
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:dup",
      }),
      "ledger_transaction_idempotency_key_unique",
    );
  });

  it("rejects a second USER_CASH account for the same paper account", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    await ensureUserCashLedgerAccount(db, account.id);

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "USER_CASH",
        paperAccountId: account.id,
        currency: "USDT",
      }),
      "ledger_account_user_cash_unique",
    );
  });

  it("rejects a second SYSTEM_VIRTUAL_FUNDING account", async () => {
    await ensureSystemVirtualFundingAccount(db);

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "SYSTEM_VIRTUAL_FUNDING",
        paperAccountId: null,
        currency: "USDT",
      }),
      "ledger_account_system_kind_unique",
    );
  });

  it("rejects invalid ledger-account ownership and non-USDT currency", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "USER_CASH",
        paperAccountId: null,
        currency: "USDT",
      }),
      "ledger_account_ownership",
    );

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "SYSTEM_VIRTUAL_FUNDING",
        paperAccountId: account.id,
        currency: "USDT",
      }),
      "ledger_account_ownership",
    );

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "USER_CASH",
        paperAccountId: account.id,
        currency: "USD",
      }),
      "ledger_account_currency_usdt",
    );
  });

  it("rejects a non-positive funding amount and duplicate signup allocation", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);

    const first = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:funding-1",
        entries: [
          { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
          {
            ledgerAccountId: systemFunding.id,
            amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
          },
        ],
      }),
    );

    await expectRejectedConstraint(
      db.insert(fundingEvent).values({
        paperAccountId: account.id,
        eventType: "SIGNUP_ALLOCATION",
        amount: "0",
        currency: "USDT",
        idempotencyKey: "signup-allocation:funding-zero",
        ledgerTransactionId: first.id,
      }),
      "funding_event_amount_positive",
    );

    await db.insert(fundingEvent).values({
      paperAccountId: account.id,
      eventType: "SIGNUP_ALLOCATION",
      amount: "1000",
      currency: "USDT",
      idempotencyKey: "signup-allocation:funding-1",
      ledgerTransactionId: first.id,
    });

    const second = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:funding-2",
        entries: [
          { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
          {
            ledgerAccountId: systemFunding.id,
            amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
          },
        ],
      }),
    );

    await expectRejectedConstraint(
      db.insert(fundingEvent).values({
        paperAccountId: account.id,
        eventType: "SIGNUP_ALLOCATION",
        amount: "1000",
        currency: "USDT",
        idempotencyKey: "signup-allocation:funding-2",
        ledgerTransactionId: second.id,
      }),
      "funding_event_signup_allocation_unique",
    );
  });

  it("allows multiple FAUCET_CLAIM funding events for one account", async () => {
    const createdUser = await insertUser("faucet-history@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);
    const faucetAmount = new MoneyDecimal("100");

    const first = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "FAUCET_CLAIM",
        idempotencyKey: "faucet:history-1",
        entries: [
          { ledgerAccountId: userCash.id, amount: faucetAmount },
          { ledgerAccountId: systemFunding.id, amount: faucetAmount.negated() },
        ],
      }),
    );
    const second = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "FAUCET_CLAIM",
        idempotencyKey: "faucet:history-2",
        entries: [
          { ledgerAccountId: userCash.id, amount: faucetAmount },
          { ledgerAccountId: systemFunding.id, amount: faucetAmount.negated() },
        ],
      }),
    );

    await db.insert(fundingEvent).values({
      paperAccountId: account.id,
      eventType: "FAUCET_CLAIM",
      amount: "100",
      currency: "USDT",
      idempotencyKey: "faucet:history-1",
      ledgerTransactionId: first.id,
    });
    await db.insert(fundingEvent).values({
      paperAccountId: account.id,
      eventType: "FAUCET_CLAIM",
      amount: "100",
      currency: "USDT",
      idempotencyKey: "faucet:history-2",
      ledgerTransactionId: second.id,
    });

    const events = await db
      .select()
      .from(fundingEvent)
      .where(eq(fundingEvent.paperAccountId, account.id));

    expect(events).toHaveLength(2);
  });

  it("rejects a non-USDT funding currency", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);

    const transaction = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "SIGNUP_ALLOCATION",
        idempotencyKey: "signup-allocation:currency",
        entries: [
          { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
          {
            ledgerAccountId: systemFunding.id,
            amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
          },
        ],
      }),
    );

    await expectRejectedConstraint(
      db.insert(fundingEvent).values({
        paperAccountId: account.id,
        eventType: "SIGNUP_ALLOCATION",
        amount: "1000",
        currency: "USD",
        idempotencyKey: "signup-allocation:currency",
        ledgerTransactionId: transaction.id,
      }),
      "funding_event_currency_usdt",
    );
  });

  it("rolls back ledger writes when the surrounding transaction throws", async () => {
    const createdUser = await insertUser("ada@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const systemFunding = await ensureSystemVirtualFundingAccount(db);

    await expect(
      db.transaction(async (tx) => {
        await postLedgerTransaction(tx, {
          eventType: "SIGNUP_ALLOCATION",
          idempotencyKey: "signup-allocation:rollback",
          entries: [
            { ledgerAccountId: userCash.id, amount: SIGNUP_ALLOCATION_AMOUNT },
            {
              ledgerAccountId: systemFunding.id,
              amount: SIGNUP_ALLOCATION_AMOUNT.negated(),
            },
          ],
        });
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    const transactions = await db.select().from(ledgerTransaction);
    const entries = await db.select().from(ledgerEntry);
    expect(transactions).toHaveLength(0);
    expect(entries).toHaveLength(0);

    const accounts = await db
      .select()
      .from(paperAccount)
      .where(eq(paperAccount.id, account.id));
    expect(accounts).toHaveLength(1);
  });

  it("accepts SYSTEM_TRADING_PNL and SYSTEM_INSURANCE global accounts and REALIZED_PNL events", async () => {
    const createdUser = await insertUser("pnl@example.com");
    const account = await ensurePaperAccount(db, createdUser.id);
    const userCash = await ensureUserCashLedgerAccount(db, account.id);
    const pnl = await ensureSystemTradingPnlAccount(db);
    const insurance = await ensureSystemInsuranceAccount(db);

    expect(pnl.paperAccountId).toBeNull();
    expect(insurance.paperAccountId).toBeNull();

    const duplicated = await Promise.all([
      ensureSystemTradingPnlAccount(db),
      ensureSystemInsuranceAccount(db),
    ]);
    expect(duplicated[0]?.id).toBe(pnl.id);
    expect(duplicated[1]?.id).toBe(insurance.id);

    const posted = await db.transaction((tx) =>
      postLedgerTransaction(tx, {
        eventType: "REALIZED_PNL",
        idempotencyKey: "realized-pnl:test",
        entries: [
          { ledgerAccountId: userCash.id, amount: new MoneyDecimal("-1000") },
          { ledgerAccountId: insurance.id, amount: new MoneyDecimal("-500") },
          { ledgerAccountId: pnl.id, amount: new MoneyDecimal("1500") },
        ],
      }),
    );

    expect(posted.eventType).toBe("REALIZED_PNL");
    const entries = await db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.ledgerTransactionId, posted.id));
    const sum = entries.reduce(
      (total, entry) => total.plus(new MoneyDecimal(entry.amount)),
      new MoneyDecimal("0"),
    );
    expect(sum.isZero()).toBe(true);

    await expectRejectedConstraint(
      db.insert(ledgerAccount).values({
        kind: "SYSTEM_TRADING_PNL",
        paperAccountId: account.id,
        currency: "USDT",
      }),
      "ledger_account_ownership",
    );
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
