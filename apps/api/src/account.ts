import type { AccountResponse, AccountStatus } from "@notional/contracts";
import { db, ensurePaperAccount } from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

export async function getAccount(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AccountResponse | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const account = await ensurePaperAccount(db, session.user.id);

  return toAccountResponse(account);
}

function toAccountResponse(account: {
  id: string;
  userId: string;
  currency: string;
  balance: string;
  status: string;
  lastFaucetClaimAt: Date | null;
  createdAt: Date;
}): AccountResponse {
  if (account.currency !== "USDT") {
    throw new Error("paper_account.currency must be USDT");
  }

  if (typeof account.balance !== "string") {
    throw new Error("paper_account.balance must be a string");
  }

  return {
    id: account.id,
    userId: account.userId,
    currency: "USDT",
    balance: account.balance,
    status: asAccountStatus(account.status),
    lastFaucetClaimAt: account.lastFaucetClaimAt
      ? toIsoString(account.lastFaucetClaimAt)
      : null,
    createdAt: toIsoString(account.createdAt),
  };
}

function asAccountStatus(value: string): AccountStatus {
  if (value === "ACTIVE" || value === "SUSPENDED") {
    return value;
  }

  throw new Error(`invalid paper_account.status: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
