import type {
  AccountNotInitializedError,
  PositionListResponse,
  PositionNotFoundError,
  PositionResponse,
} from "@notional/contracts";
import {
  db,
  findOpenPositionByAccountAndSymbol,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listOpenPositionsByPaperAccountId,
} from "@notional/db";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyReply, FastifyRequest } from "fastify";

const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export async function getPositions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<PositionListResponse | AccountNotInitializedError | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const rows = await listOpenPositionsByPaperAccountId(db, initialized.account.id);

  return {
    positions: rows.map(toPositionResponse),
  };
}

export async function getPositionBySymbol(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  PositionResponse | AccountNotInitializedError | PositionNotFoundError | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const symbol = requestSymbol(request);

  if (!symbol) {
    return reply.status(404).send({ error: "POSITION_NOT_FOUND" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const row = await findOpenPositionByAccountAndSymbol(db, initialized.account.id, symbol);

  if (!row) {
    return reply.status(404).send({ error: "POSITION_NOT_FOUND" });
  }

  return toPositionResponse(row);
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

function toPositionResponse(row: {
  symbol: string;
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
  updatedAt: Date;
}): PositionResponse {
  if (row.entryPrice === null) {
    throw new Error("open position requires entryPrice");
  }

  return {
    symbol: row.symbol,
    quantity: toCanonicalDecimalString(row.quantity),
    entryPrice: toCanonicalDecimalString(row.entryPrice),
    cumulativeRealizedPnl: toCanonicalDecimalString(row.realizedPnl),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requestSymbol(request: FastifyRequest): string | null {
  const params = request.params;

  if (params === undefined || params === null || typeof params !== "object") {
    return null;
  }

  if (!("symbol" in params) || typeof params.symbol !== "string" || params.symbol === "") {
    return null;
  }

  if (!CANONICAL_SYMBOL.test(params.symbol)) {
    return null;
  }

  return params.symbol;
}
