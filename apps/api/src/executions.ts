import type {
  AccountNotInitializedError,
  ExecutionListResponse,
  ExecutionNotFoundError,
  ExecutionResponse,
  InvalidQueryError,
  OrderSide,
  OrderType,
} from "@notional/contracts";
import {
  db,
  findAccountExecutionById,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listExecutionsByPaperAccountId,
} from "@notional/db";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_EXECUTION_LIMIT = 50;
const MAX_EXECUTION_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export async function getExecutions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  ExecutionListResponse | AccountNotInitializedError | InvalidQueryError | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const parsed = parseExecutionListQuery(request.query);

  if (parsed === "invalid_pagination") {
    return reply.status(400).send({ error: "INVALID_PAGINATION" });
  }

  if (parsed === "invalid_query") {
    return reply.status(400).send({ error: "INVALID_QUERY" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const rows = await listExecutionsByPaperAccountId(
    db,
    initialized.account.id,
    { limit: parsed.limit, offset: parsed.offset },
    { symbol: parsed.symbol, orderId: parsed.orderId },
  );

  return {
    executions: rows.map(toExecutionResponse),
  };
}

export async function getExecutionById(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<
  ExecutionResponse | AccountNotInitializedError | ExecutionNotFoundError | { error: string }
> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const executionId = requestExecutionId(request);

  if (!executionId) {
    return reply.status(404).send({ error: "EXECUTION_NOT_FOUND" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const row = await findAccountExecutionById(db, initialized.account.id, executionId);

  if (!row) {
    return reply.status(404).send({ error: "EXECUTION_NOT_FOUND" });
  }

  return toExecutionResponse(row);
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

function toExecutionResponse(row: {
  id: string;
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: string;
  price: string;
  executedAt: Date;
}): ExecutionResponse {
  return {
    id: row.id,
    orderId: row.orderId,
    symbol: row.symbol,
    side: asOrderSide(row.side),
    orderType: asOrderType(row.orderType),
    quantity: toCanonicalDecimalString(row.quantity),
    price: toCanonicalDecimalString(row.price),
    executedAt: toIsoString(row.executedAt),
  };
}

function asOrderSide(value: string): OrderSide {
  if (value === "BUY" || value === "SELL") {
    return value;
  }

  throw new Error(`invalid trade_order.side: ${value}`);
}

function asOrderType(value: string): OrderType {
  if (value === "MARKET" || value === "LIMIT") {
    return value;
  }

  throw new Error(`invalid trade_order.order_type: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requestExecutionId(request: FastifyRequest): string | null {
  const params = request.params;

  if (params === undefined || params === null || typeof params !== "object") {
    return null;
  }

  if (!("id" in params) || typeof params.id !== "string" || !UUID_PATTERN.test(params.id)) {
    return null;
  }

  return params.id;
}

function parseExecutionListQuery(query: unknown):
  | { limit: number; offset: number; symbol?: string; orderId?: string }
  | "invalid_pagination"
  | "invalid_query" {
  if (query === undefined || query === null || typeof query !== "object") {
    return { limit: DEFAULT_EXECUTION_LIMIT, offset: 0 };
  }

  const record = query as Record<string, unknown>;
  const limit = parseOptionalInt(record.limit, DEFAULT_EXECUTION_LIMIT);
  const offset = parseOptionalInt(record.offset, 0);

  if (limit === null || offset === null) {
    return "invalid_pagination";
  }

  if (limit < 1 || limit > MAX_EXECUTION_LIMIT || offset < 0) {
    return "invalid_pagination";
  }

  const symbol = parseOptionalSymbol(record.symbol);

  if (symbol === "invalid") {
    return "invalid_query";
  }

  const orderId = parseOptionalOrderId(record.orderId);

  if (orderId === "invalid") {
    return "invalid_query";
  }

  return {
    limit,
    offset,
    symbol,
    orderId,
  };
}

function parseOptionalSymbol(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !CANONICAL_SYMBOL.test(raw)) {
    return "invalid";
  }

  return raw;
}

function parseOptionalOrderId(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
    return "invalid";
  }

  return raw;
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
