import type {
  AccountNotInitializedError,
  InvalidQueryError,
  LiquidationListResponse,
  LiquidationResponse,
} from "@notional/contracts";
import {
  db,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listLiquidationEventsByPaperAccountId,
} from "@notional/db";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_LIQUIDATION_LIMIT = 50;
const MAX_LIQUIDATION_LIMIT = 100;

export async function getLiquidations(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  LiquidationListResponse | AccountNotInitializedError | InvalidQueryError | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const parsed = parseLiquidationListQuery(request.query);

  if (parsed === "invalid_pagination") {
    return reply.status(400).send({ error: "INVALID_PAGINATION" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const rows = await listLiquidationEventsByPaperAccountId(db, initialized.account.id, parsed);

  return {
    liquidations: rows.map(toLiquidationResponse),
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

function toLiquidationResponse(row: {
  id: string;
  marginMode: "CROSS" | "ISOLATED";
  symbol: string | null;
  equity: string;
  maintenanceMargin: string;
  createdAt: Date;
}): LiquidationResponse {
  return {
    id: row.id,
    marginMode: row.marginMode,
    symbol: row.symbol,
    equity: toCanonicalDecimalString(row.equity),
    maintenanceMargin: toCanonicalDecimalString(row.maintenanceMargin),
    createdAt: toIsoString(row.createdAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseLiquidationListQuery(
  query: unknown,
): { limit: number; offset: number } | "invalid_pagination" {
  if (query === undefined || query === null || typeof query !== "object") {
    return { limit: DEFAULT_LIQUIDATION_LIMIT, offset: 0 };
  }

  const record = query as Record<string, unknown>;
  const limit = parseOptionalInt(record.limit, DEFAULT_LIQUIDATION_LIMIT);
  const offset = parseOptionalInt(record.offset, 0);

  if (limit === null || offset === null) {
    return "invalid_pagination";
  }

  if (limit < 1 || limit > MAX_LIQUIDATION_LIMIT || offset < 0) {
    return "invalid_pagination";
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
