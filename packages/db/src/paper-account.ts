import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

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

  const [existing] = await executor
    .select()
    .from(paperAccount)
    .where(eq(paperAccount.userId, userId));

  if (!existing) {
    throw new Error("paper_account missing after ensure");
  }

  return existing;
}
