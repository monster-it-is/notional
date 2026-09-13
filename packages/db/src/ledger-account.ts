import { and, eq, isNull } from "drizzle-orm";

import type { FinancialExecutor } from "./executor.js";
import { ledgerAccount } from "./schema/ledger.js";

export type LedgerAccount = typeof ledgerAccount.$inferSelect;

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
  const [inserted] = await executor
    .insert(ledgerAccount)
    .values({
      kind: "SYSTEM_VIRTUAL_FUNDING",
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
    .where(
      and(
        eq(ledgerAccount.kind, "SYSTEM_VIRTUAL_FUNDING"),
        isNull(ledgerAccount.paperAccountId),
      ),
    );

  if (!existing) {
    throw new Error("SYSTEM_VIRTUAL_FUNDING ledger_account missing after ensure");
  }

  return existing;
}
