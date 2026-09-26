import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, MoneyDecimal, toDbDecimal } from "./money.js";
import { ledgerEntry, ledgerTransaction } from "./schema/ledger.js";
import { utcTimestampFromDate } from "./time.js";

export type LedgerTransaction = typeof ledgerTransaction.$inferSelect;
export type LedgerEntry = typeof ledgerEntry.$inferSelect;

export type LedgerPostingEntry = {
  ledgerAccountId: string;
  amount: MoneyDecimal;
};

export type FinancialEventType =
  | "SIGNUP_ALLOCATION"
  | "FAUCET_CLAIM"
  | "REALIZED_PNL"
  | "FUNDING_PAYMENT";

export type PostLedgerTransactionInput = {
  eventType: FinancialEventType;
  paperAccountId: string;
  idempotencyKey: string;
  entries: LedgerPostingEntry[];
};

export async function postLedgerTransaction(
  executor: FinancialTransaction,
  input: PostLedgerTransactionInput,
): Promise<LedgerTransaction> {
  if (!input.paperAccountId) {
    throw new Error("ledger transaction requires paperAccountId");
  }

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
      paperAccountId: input.paperAccountId,
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

export async function sumRealizedTradingPnlSince(
  executor: Pick<NodePgDatabase, "execute">,
  paperAccountId: string,
  since?: Date,
): Promise<string> {
  const cutoff =
    since === undefined
      ? sql`clock_timestamp() - interval '24 hours'`
      : utcTimestampFromDate(since);

  const result = await executor.execute(sql`
    SELECT coalesce(sum(e.amount), 0)::text AS total
    FROM ledger_transaction t
    INNER JOIN ledger_entry e ON e.ledger_transaction_id = t.id
    INNER JOIN ledger_account a ON a.id = e.ledger_account_id
    WHERE t.paper_account_id = ${paperAccountId}::uuid
      AND t.event_type = 'REALIZED_PNL'
      AND t.created_at >= ${cutoff}
      AND a.kind = 'SYSTEM_TRADING_PNL'
  `);
  const [row] = result.rows as { total: string }[];

  if (!row) {
    return "0";
  }

  const systemTradingPnlSum = fromDbDecimal(row.total);
  if (systemTradingPnlSum.isZero()) {
    return "0";
  }

  const realized = systemTradingPnlSum.negated();
  if (realized.isZero()) {
    return "0";
  }

  return toDbDecimal(realized);
}
