import { and, desc, eq } from "drizzle-orm";

import type { FinancialExecutor, FinancialTransaction } from "./executor.js";
import { type MoneyDecimal, toDbDecimal } from "./money.js";
import { fundingEvent } from "./schema/funding.js";

export type FundingEvent = typeof fundingEvent.$inferSelect;

export type PaperWalletFundingEventType = "SIGNUP_ALLOCATION" | "FAUCET_CLAIM";

export type InsertFundingEventInput = {
  paperAccountId: string;
  eventType: PaperWalletFundingEventType;
  amount: MoneyDecimal;
  idempotencyKey: string;
  ledgerTransactionId: string;
};

export async function findSignupAllocationFundingEvent(
  executor: Pick<FinancialExecutor, "select">,
  paperAccountId: string,
): Promise<FundingEvent | null> {
  const [existing] = await executor
    .select()
    .from(fundingEvent)
    .where(
      and(
        eq(fundingEvent.paperAccountId, paperAccountId),
        eq(fundingEvent.eventType, "SIGNUP_ALLOCATION"),
      ),
    );

  return existing ?? null;
}

export async function insertFundingEvent(
  executor: FinancialTransaction,
  input: InsertFundingEventInput,
): Promise<FundingEvent> {
  if (!input.amount.isPositive()) {
    throw new Error("funding event amount must be positive");
  }

  const [created] = await executor
    .insert(fundingEvent)
    .values({
      paperAccountId: input.paperAccountId,
      eventType: input.eventType,
      amount: toDbDecimal(input.amount),
      currency: "USDT",
      idempotencyKey: input.idempotencyKey,
      ledgerTransactionId: input.ledgerTransactionId,
    })
    .returning();

  if (!created) {
    throw new Error("funding_event insert failed");
  }

  return created;
}

export async function listFundingEventsByPaperAccountId(
  executor: Pick<FinancialExecutor, "select">,
  paperAccountId: string,
  pagination: { limit: number; offset: number },
): Promise<FundingEvent[]> {
  return executor
    .select()
    .from(fundingEvent)
    .where(eq(fundingEvent.paperAccountId, paperAccountId))
    .orderBy(desc(fundingEvent.createdAt), desc(fundingEvent.id))
    .limit(pagination.limit)
    .offset(pagination.offset);
}
