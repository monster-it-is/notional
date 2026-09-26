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
  type PositionWithSymbol,
} from "@notional/db";
import { calculateUnrealizedPnl, toCanonicalDecimalString } from "@notional/trading";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { MarketDataAccess } from "./market-data/coordinator.js";

const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export async function getPositions(
  request: FastifyRequest,
  reply: FastifyReply,
  marketData: MarketDataAccess,
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
    positions: rows.map((row) => toPositionResponse(row, marketData)),
  };
}

export async function getPositionBySymbol(
  request: FastifyRequest,
  reply: FastifyReply,
  marketData: MarketDataAccess,
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

  return toPositionResponse(row, marketData);
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

function toPositionResponse(row: PositionWithSymbol, marketData: MarketDataAccess): PositionResponse {
  if (row.entryPrice === null) {
    throw new Error("open position requires entryPrice");
  }

  const quantity = toCanonicalDecimalString(row.quantity);
  const entryPrice = toCanonicalDecimalString(row.entryPrice);
  const freshMark = marketData.getFreshMark(row.symbol);
  const markPrice = freshMark ? toCanonicalDecimalString(freshMark.markPrice) : null;

  return {
    symbol: row.symbol,
    quantity,
    entryPrice,
    markPrice,
    unrealizedPnl:
      markPrice === null
        ? null
        : calculateUnrealizedPnl({
            positionQty: quantity,
            entryPrice,
            markPrice,
          }),
    cumulativeRealizedPnl: toCanonicalDecimalString(row.realizedPnl),
    marginMode: row.marginMode,
    leverage: row.leverage,
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
