import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { type MoneyDecimal, toDbDecimal } from "./money.js";
import { paperAccount } from "./schema/paper-account.js";

export type PaperAccount = typeof paperAccount.$inferSelect;

export type PaperAccountExecutor = Pick<NodePgDatabase, "insert" | "select">;

export async function ensurePaperAccount(
  executor: PaperAccountExecutor,
  userId: string,
): Promise<PaperAccount> {
  const [inserted] = await executor
    .insert(paperAccount)
    .values({
      userId,
      currency: "USDT",
      balance: "0",
      status: "ACTIVE",
    })
    .onConflictDoNothing({ target: paperAccount.userId })
    .returning();

  if (inserted) {
    return inserted;
  }

  const existing = await findPaperAccountByUserId(executor, userId);

  if (!existing) {
    throw new Error("paper_account missing after ensure");
  }

  return existing;
}

export async function findPaperAccountByUserId(
  executor: Pick<NodePgDatabase, "select">,
  userId: string,
): Promise<PaperAccount | null> {
  const [existing] = await executor
    .select()
    .from(paperAccount)
    .where(eq(paperAccount.userId, userId));

  return existing ?? null;
}

export async function lockPaperAccountByUserId(
  executor: Pick<NodePgDatabase, "select">,
  userId: string,
): Promise<PaperAccount> {
  const [account] = await executor
    .select()
    .from(paperAccount)
    .where(eq(paperAccount.userId, userId))
    .for("update");

  if (!account) {
    throw new Error("paper_account missing after lock");
  }

  return account;
}

export async function lockPaperAccountById(
  executor: FinancialTransaction,
  paperAccountId: string,
): Promise<PaperAccount> {
  const [account] = await executor
    .select()
    .from(paperAccount)
    .where(eq(paperAccount.id, paperAccountId))
    .for("update");

  if (!account) {
    throw new Error("paper_account missing after lock");
  }

  return account;
}

export async function updatePaperAccountBalance(
  executor: FinancialTransaction,
  paperAccountId: string,
  balance: MoneyDecimal,
): Promise<PaperAccount> {
  const [updated] = await executor
    .update(paperAccount)
    .set({
      balance: toDbDecimal(balance),
    })
    .where(eq(paperAccount.id, paperAccountId))
    .returning();

  if (!updated) {
    throw new Error("paper_account missing after balance update");
  }

  return updated;
}

export async function applyFaucetClaim(
  executor: FinancialTransaction,
  input: {
    paperAccountId: string;
    balance: MoneyDecimal;
    claimedAtUtc: string;
  },
): Promise<PaperAccount> {
  const [updated] = await executor
    .update(paperAccount)
    .set({
      balance: toDbDecimal(input.balance),
      lastFaucetClaimAt: sql`${input.claimedAtUtc}::timestamp`,
    })
    .where(eq(paperAccount.id, input.paperAccountId))
    .returning();

  if (!updated) {
    throw new Error("paper_account missing after faucet claim");
  }

  return updated;
}
