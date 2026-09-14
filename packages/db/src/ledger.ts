import type { FinancialTransaction } from "./executor.js";
import { MoneyDecimal, toDbDecimal } from "./money.js";
import { ledgerEntry, ledgerTransaction } from "./schema/ledger.js";

export type LedgerTransaction = typeof ledgerTransaction.$inferSelect;
export type LedgerEntry = typeof ledgerEntry.$inferSelect;

export type LedgerPostingEntry = {
  ledgerAccountId: string;
  amount: MoneyDecimal;
};

export type FinancialEventType = "SIGNUP_ALLOCATION" | "FAUCET_CLAIM" | "REALIZED_PNL";

export type PostLedgerTransactionInput = {
  eventType: FinancialEventType;
  idempotencyKey: string;
  entries: LedgerPostingEntry[];
};

export async function postLedgerTransaction(
  executor: FinancialTransaction,
  input: PostLedgerTransactionInput,
): Promise<LedgerTransaction> {
  if (input.entries.length < 2) {
    throw new Error("ledger transaction requires at least two entries");
  }

  let sum = new MoneyDecimal("0");

  for (const entry of input.entries) {
    if (entry.amount.isZero()) {
      throw new Error("ledger entry amount must be non-zero");
    }

    sum = sum.plus(entry.amount);
  }

  if (!sum.isZero()) {
    throw new Error("ledger transaction is unbalanced");
  }

  const [transaction] = await executor
    .insert(ledgerTransaction)
    .values({
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();

  if (!transaction) {
    throw new Error("ledger_transaction insert failed");
  }

  await executor.insert(ledgerEntry).values(
    input.entries.map((entry) => ({
      ledgerTransactionId: transaction.id,
      ledgerAccountId: entry.ledgerAccountId,
      amount: toDbDecimal(entry.amount),
    })),
  );

  return transaction;
}
