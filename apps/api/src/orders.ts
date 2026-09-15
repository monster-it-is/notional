import type {
  AccountNotInitializedError,
  InvalidQueryError,
  OrderListResponse,
  OrderNotFoundError,
  OrderOrigin,
  OrderResponse,
  OrderStatus,
} from "@notional/contracts";
import {
  db,
  findAccountOrderById,
  findPaperAccountByUserId,
  findSignupAllocationFundingEvent,
  listOrdersByPaperAccountId,
} from "@notional/db";
import { toCanonicalDecimalString } from "@notional/trading";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { MarketDataAccess } from "./market-data/coordinator.js";
import { cancelUserOrder, OrderPlacementError, placeOrder } from "./services/order-placement.js";
import type { CommittedPrivateEffect } from "./realtime/effects.js";

const DEFAULT_ORDER_LIMIT = 50;
const MAX_ORDER_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_SYMBOL = /^[A-Z0-9]+$/;

export async function getOrders(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<OrderListResponse | AccountNotInitializedError | InvalidQueryError | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const parsed = parseOrderListQuery(request.query);

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

  const rows = await listOrdersByPaperAccountId(
    db,
    initialized.account.id,
    { limit: parsed.limit, offset: parsed.offset },
    { status: parsed.status, symbol: parsed.symbol },
  );

  return {
    orders: rows.map(toOrderResponse),
  };
}

export async function getOrderById(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<OrderResponse | AccountNotInitializedError | OrderNotFoundError | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const orderId = requestOrderId(request);

  if (!orderId) {
    return reply.status(404).send({ error: "ORDER_NOT_FOUND" });
  }

  const initialized = await loadInitializedAccount(session.user.id);

  if (!initialized) {
    return reply.status(409).send({ error: "ACCOUNT_NOT_INITIALIZED" });
  }

  const row = await findAccountOrderById(db, initialized.account.id, orderId);

  if (!row) {
    return reply.status(404).send({ error: "ORDER_NOT_FOUND" });
  }

  return toOrderResponse(row);
}

export async function postOrder(
  request: FastifyRequest,
  reply: FastifyReply,
  marketData: MarketDataAccess,
  onOpenOrderCommitted?: (symbol: string) => void,
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void,
): Promise<OrderResponse | { error: string; reason?: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  try {
    const result = await placeOrder({
      userId: session.user.id,
      idempotencyKey: headerValue(request.headers["idempotency-key"]),
      body: request.body,
      marketData,
      onOpenOrderCommitted,
      onPrivateCommitted,
    });

    return reply.status(result.created ? 201 : 200).send(toOrderResponse(result.order));
  } catch (error) {
    return sendOrderMutationError(reply, error);
  }
}

export async function cancelOrder(
  request: FastifyRequest,
  reply: FastifyReply,
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void,
): Promise<OrderResponse | OrderNotFoundError | { error: string }> {
  const session = request.auth;

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const orderId = requestOrderId(request);

  if (!orderId) {
    return reply.status(404).send({ error: "ORDER_NOT_FOUND" });
  }

  try {
    const order = await cancelUserOrder({
      userId: session.user.id,
      orderId,
      onPrivateCommitted,
    });
    return toOrderResponse(order);
  } catch (error) {
    return sendOrderMutationError(reply, error);
  }
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

function toOrderResponse(row: {
  id: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: string;
  limitPrice: string | null;
  reduceOnly: boolean;
  status: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
}): OrderResponse {
  return {
    id: row.id,
    symbol: row.symbol,
    side: asOrderSide(row.side),
    type: asOrderType(row.orderType),
    quantity: toCanonicalDecimalString(row.quantity),
    limitPrice: row.limitPrice === null ? null : toCanonicalDecimalString(row.limitPrice),
    reduceOnly: row.reduceOnly,
    status: asOrderStatus(row.status),
    origin: asOrderOrigin(row.origin),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function asOrderSide(value: string): "BUY" | "SELL" {
  if (value === "BUY" || value === "SELL") {
    return value;
  }

  throw new Error(`invalid trade_order.side: ${value}`);
}

function asOrderType(value: string): "MARKET" | "LIMIT" {
  if (value === "MARKET" || value === "LIMIT") {
    return value;
  }

  throw new Error(`invalid trade_order.order_type: ${value}`);
}

function asOrderStatus(value: string): OrderStatus {
  if (value === "OPEN" || value === "FILLED" || value === "CANCELLED") {
    return value;
  }

  throw new Error(`invalid trade_order.status: ${value}`);
}

function asOrderOrigin(value: string): OrderOrigin {
  if (value === "USER" || value === "LIQUIDATION") {
    return value;
  }

  throw new Error(`invalid trade_order.origin: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function sendOrderMutationError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof OrderPlacementError)) {
    throw error;
  }

  if (error.code === "INVALID_ORDER") {
    return reply.status(400).send({
      error: "INVALID_ORDER",
      reason: error.reason,
    });
  }

  if (
    error.code === "IDEMPOTENCY_KEY_REQUIRED" ||
    error.code === "IDEMPOTENCY_KEY_INVALID"
  ) {
    return reply.status(400).send({ error: error.code });
  }

  if (error.code === "INSTRUMENT_NOT_FOUND" || error.code === "ORDER_NOT_FOUND") {
    return reply.status(404).send({ error: error.code });
  }

  if (error.code === "MARKET_DATA_UNAVAILABLE" || error.code === "FUNDING_DATA_UNAVAILABLE") {
    return reply.status(503).send({ error: error.code });
  }

  return reply.status(409).send({ error: error.code });
}

function requestOrderId(request: FastifyRequest): string | null {
  const params = request.params;

  if (params === undefined || params === null || typeof params !== "object") {
    return null;
  }

  if (!("id" in params) || typeof params.id !== "string" || !UUID_PATTERN.test(params.id)) {
    return null;
  }

  return params.id;
}

function parseOrderListQuery(query: unknown):
  | { limit: number; offset: number; status?: OrderStatus; symbol?: string }
  | "invalid_pagination"
  | "invalid_query" {
  if (query === undefined || query === null || typeof query !== "object") {
    return { limit: DEFAULT_ORDER_LIMIT, offset: 0 };
  }

  const record = query as Record<string, unknown>;
  const limit = parseOptionalInt(record.limit, DEFAULT_ORDER_LIMIT);
  const offset = parseOptionalInt(record.offset, 0);

  if (limit === null || offset === null) {
    return "invalid_pagination";
  }

  if (limit < 1 || limit > MAX_ORDER_LIMIT || offset < 0) {
    return "invalid_pagination";
  }

  const status = parseOptionalStatus(record.status);

  if (status === "invalid") {
    return "invalid_query";
  }

  const symbol = parseOptionalSymbol(record.symbol);

  if (symbol === "invalid") {
    return "invalid_query";
  }

  return {
    limit,
    offset,
    status,
    symbol,
  };
}

function parseOptionalStatus(value: unknown): OrderStatus | undefined | "invalid" {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === "OPEN" || raw === "FILLED" || raw === "CANCELLED") {
    return raw;
  }

  return "invalid";
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
