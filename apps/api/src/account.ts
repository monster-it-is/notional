import type {
  AccountNotInitializedError,
  AccountResponse,
  AccountStatus,
  AccountSuspendedError,
  FaucetCooldownError,
  FundingEventResponse,
  FundingEventType,
  FundingHistoryResponse,
} from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listFundingEventsByPaperAccountId,
  type FundingEvent,
} from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

import { claimFaucet, FaucetClaimError } from "./services/faucet.js";
import { provisionSignupAllocation } from "./services/signup-allocation.js";

const DEFAULT_FUNDING_LIMIT = 50;
const MAX_FUNDING_LIMIT = 100;

export async function getAccount(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AccountResponse | AccountNotInitializedError | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  return toAccountResponse(initialized.account);
}

export async function initializeAccount(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AccountResponse | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const account = await provisionSignupAllocation(session.user.id);

  return toAccountResponse(account);
}

export async function claimAccountFaucet(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  | AccountResponse
  | AccountNotInitializedError
  | AccountSuspendedError
  | FaucetCooldownError
  | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  try {
    const account = await claimFaucet(session.user.id);
    return toAccountResponse(account);
  } catch (error) {
    if (error instanceof FaucetClaimError) {
      if (error.code === "FAUCET_COOLDOWN") {
        if (!error.nextClaimAt) {
          throw new Error("FAUCET_COOLDOWN missing nextClaimAt", { cause: error });
        }

        return reply.status(409).send({
          error: "FAUCET_COOLDOWN",
          nextClaimAt: toIsoString(error.nextClaimAt),
        });
      }

      return reply.status(409).send({ error: error.code });
    }

    throw error;
  }
}

export async function getFundingHistory(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  | FundingHistoryResponse
  | AccountNotInitializedError
  | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const pagination = parseFundingPagination(request.query);

  if (!pagination) {
    return reply.status(400).send({ error: "INVALID_PAGINATION" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const events = await listFundingEventsByPaperAccountId(
    db,
    initialized.account.id,
    pagination,
  );

  return {
    events: events.map(toFundingEventResponse),
  };
}

async function loadInitializedAccount(userId: string) {
  const account = await findPaperAccountByUserId(db, userId);

  if (!account) {
    return null;
  }

  const allocation = await findSignupAllocationFundingEvent(db, account.id);

  if (!allocation) {
    return null;
  }

  return { account };
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

function toFundingEventResponse(event: FundingEvent): FundingEventResponse {
  if (event.currency !== "USDT") {
    throw new Error("funding_event.currency must be USDT");
  }

  if (typeof event.amount !== "string") {
    throw new Error("funding_event.amount must be a string");
  }

  return {
    id: event.id,
    type: asFundingEventType(event.eventType),
    amount: event.amount,
    currency: "USDT",
    createdAt: toIsoString(event.createdAt),
  };
}

function asAccountStatus(value: string): AccountStatus {
  if (value === "ACTIVE" || value === "SUSPENDED") {
    return value;
  }

  throw new Error(`invalid paper_account.status: ${value}`);
}

function asFundingEventType(value: string): FundingEventType {
  if (value === "SIGNUP_ALLOCATION" || value === "FAUCET_CLAIM") {
    return value;
  }

  throw new Error(`invalid funding_event.event_type: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseFundingPagination(query: unknown): { limit: number; offset: number } | null {
  if (query === undefined || query === null || typeof query !== "object") {
    return { limit: DEFAULT_FUNDING_LIMIT, offset: 0 };
  }

  const record = query as Record<string, unknown>;
  const limit = parseOptionalInt(record.limit, DEFAULT_FUNDING_LIMIT);
  const offset = parseOptionalInt(record.offset, 0);

  if (limit === null || offset === null) {
    return null;
  }

  if (limit < 1 || limit > MAX_FUNDING_LIMIT || offset < 0) {
    return null;
  }

  return { limit, offset };
}

function parseOptionalInt(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" && typeof raw !== "number") {
    return null;
  }

  const text = String(raw);

  if (!/^\d+$/.test(text)) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}
