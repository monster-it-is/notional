import { and, eq, isNull } from "drizzle-orm";

import type { FinancialExecutor } from "./executor.js";
import { ledgerAccount } from "./schema/ledger.js";

export type LedgerAccount = typeof ledgerAccount.$inferSelect;

export type SystemLedgerKind =
  | "SYSTEM_VIRTUAL_FUNDING"
  | "SYSTEM_TRADING_PNL"
  | "SYSTEM_INSURANCE"
  | "SYSTEM_FUNDING";

export async function ensureUserCashLedgerAccount(
  executor: FinancialExecutor,
  paperAccountId: string,
): Promise<LedgerAccount> {
  const [inserted] = await executor
    .insert(ledgerAccount)
    .values({
      kind: "USER_CASH",
      paperAccountId,
      currency: "USDT",
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return inserted;
  }

  const [existing] = await executor
    .select()
    .from(ledgerAccount)
    .where(
      and(
        eq(ledgerAccount.kind, "USER_CASH"),
        eq(ledgerAccount.paperAccountId, paperAccountId),
      ),
    );

  if (!existing) {
    throw new Error("USER_CASH ledger_account missing after ensure");
  }

  return existing;
}

export async function ensureSystemVirtualFundingAccount(
  executor: FinancialExecutor,
): Promise<LedgerAccount> {
  return ensureSystemLedgerAccount(executor, "SYSTEM_VIRTUAL_FUNDING");
}

export async function ensureSystemTradingPnlAccount(
  executor: FinancialExecutor,
): Promise<LedgerAccount> {
  return ensureSystemLedgerAccount(executor, "SYSTEM_TRADING_PNL");
}

export async function ensureSystemInsuranceAccount(
  executor: FinancialExecutor,
): Promise<LedgerAccount> {
  return ensureSystemLedgerAccount(executor, "SYSTEM_INSURANCE");
}

export async function ensureSystemFundingLedgerAccount(
  executor: FinancialExecutor,
): Promise<LedgerAccount> {
  return ensureSystemLedgerAccount(executor, "SYSTEM_FUNDING");
}

async function ensureSystemLedgerAccount(
  executor: FinancialExecutor,
  kind: SystemLedgerKind,
): Promise<LedgerAccount> {
  const [inserted] = await executor
    .insert(ledgerAccount)
    .values({
      kind,
      paperAccountId: null,
      currency: "USDT",
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return inserted;
  }

  const [existing] = await executor
    .select()
    .from(ledgerAccount)
    .where(and(eq(ledgerAccount.kind, kind), isNull(ledgerAccount.paperAccountId)));

  if (!existing) {
    throw new Error(`${kind} ledger_account missing after ensure`);
  }

  return existing;
}
