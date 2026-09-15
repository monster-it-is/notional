import type { PerpFundingHistoryResponse } from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listPerpFundingHistoryByPaperAccountId,
} from "@notional/db";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function getPerpFundingHistory(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PerpFundingHistoryResponse | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const pagination = parsePagination(request.query);

  if (!pagination) {
    return reply.status(400).send({ error: "INVALID_PAGINATION" });
  }

  const account = await findPaperAccountByUserId(db, session.user.id);
  if (!account) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const allocation = await findSignupAllocationFundingEvent(db, account.id);
  if (!allocation) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const rows = await listPerpFundingHistoryByPaperAccountId(db, account.id, pagination);

  return {
    funding: rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      fundingTime: row.fundingTime.toISOString(),
      marginMode: row.marginMode,
      quantity: row.quantity,
      fundingRate: row.fundingRate,
      markPrice: row.markPrice,
      fundingPayment: row.fundingPayment,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function parsePagination(query: unknown): { limit: number; offset: number } | null {
  if (query === undefined || query === null || typeof query !== "object") {
    return { limit: DEFAULT_LIMIT, offset: 0 };
  }

  const record = query as Record<string, unknown>;
  const limit = parseOptionalInt(record.limit, DEFAULT_LIMIT);
  const offset = parseOptionalInt(record.offset, 0);

  if (limit === null || offset === null) {
    return null;
  }

  if (limit < 1 || limit > MAX_LIMIT || offset < 0) {
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
  return Number.isSafeInteger(parsed) ? parsed : null;
}
