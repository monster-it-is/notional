import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import {
  findOrderById,
  insertTradeOrderRow,
  lockOrderById,
  lockOrderByIdempotencyKey,
  sameRequestFingerprint,
  type Order,
  type OrderSide,
  type OrderType,
} from "./order.js";
import { execution } from "./schema/execution.js";
import { instrument } from "./schema/instrument.js";
import { tradeOrder } from "./schema/order.js";

export type Execution = {
  id: string;
  orderId: string;
  quantity: string;
  price: string;
  executedAt: Date;
};

export type ExecutionWithOrder = Execution & {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
};

export type CreateFilledOrderInput =
  | {
      paperAccountId: string;
      instrumentId: string;
      side: OrderSide;
      orderType: "MARKET";
      quantity: string;
      limitPrice?: null;
      reduceOnly?: boolean;
      idempotencyKey: string;
      executionPrice: string;
    }
  | {
      paperAccountId: string;
      instrumentId: string;
      side: OrderSide;
      orderType: "LIMIT";
      quantity: string;
      limitPrice: string;
      reduceOnly?: boolean;
      idempotencyKey: string;
      executionPrice: string;
    };

export type InsertFilledOrderResult =
  | { kind: "created_filled"; order: Order; execution: Execution }
  | { kind: "replayed_filled"; order: Order; execution: Execution }
  | { kind: "replayed_order"; order: Order }
  | { kind: "key_reused"; existing: Order };

export type CompleteOrderFillResult =
  | { kind: "created_filled"; order: Order; execution: Execution }
  | { kind: "replayed_filled"; order: Order; execution: Execution };

export type ListExecutionsPagination = {
  limit: number;
  offset: number;
};

export type ListExecutionsFilters = {
  symbol?: string;
  orderId?: string;
};

export type ExecutionMutationCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_EXECUTABLE"
  | "ORDER_ALREADY_CANCELLED"
  | "EXECUTION_CONFLICT";

export class ExecutionMutationError extends Error {
  readonly code: ExecutionMutationCode;

  constructor(code: ExecutionMutationCode) {
    super(code);
    this.name = "ExecutionMutationError";
    this.code = code;
  }
}

const PLAIN_POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const executedAtUtc = sql<Date>`${execution.executedAt} AT TIME ZONE 'UTC'`.as(
  "executed_at_utc",
);

export async function insertFilledOrderWithExecution(
  executor: FinancialTransaction,
  input: CreateFilledOrderInput,
): Promise<InsertFilledOrderResult> {
  const limitPrice = input.orderType === "LIMIT" ? input.limitPrice : null;

  const inserted = await insertTradeOrderRow(executor, {
    paperAccountId: input.paperAccountId,
    instrumentId: input.instrumentId,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    limitPrice,
    reduceOnly: input.reduceOnly ?? false,
    reservedMargin: "0",
    status: "FILLED",
    idempotencyKey: input.idempotencyKey,
  });

  if (inserted.kind !== "created") {
    const locked = await lockOrderByIdempotencyKey(
      executor,
      input.paperAccountId,
      input.idempotencyKey,
    );

    if (!locked) {
      throw new Error("trade_order missing after idempotency conflict");
    }

    const attempted = {
      instrumentId: input.instrumentId,
      side: input.side,
      orderType: input.orderType,
      quantity: persistPlainDecimal(input.quantity),
      limitPrice: limitPrice === null ? null : persistPlainDecimal(limitPrice),
      reduceOnly: input.reduceOnly ?? false,
    };

    if (!sameRequestFingerprint(locked, attempted)) {
      return { kind: "key_reused", existing: locked };
    }

    return replayExistingFilledOrder(executor, locked);
  }

  const executionPrice = persistExecutionPrice(input.executionPrice);

  if (input.orderType === "LIMIT") {
    assertLimitPriceProtection(input.side, input.limitPrice, executionPrice);
  }

  const fill = await insertExecutionForOrder(executor, inserted.order, executionPrice);

  if (fill.kind !== "created_filled") {
    throw new ExecutionMutationError("EXECUTION_CONFLICT");
  }

  return fill;
}

export async function completeOpenLimitOrder(
  executor: FinancialTransaction,
  paperAccountId: string,
  orderId: string,
  executionPrice: string,
): Promise<CompleteOrderFillResult> {
  const locked = await lockOrderById(executor, paperAccountId, orderId);

  if (!locked) {
    throw new ExecutionMutationError("ORDER_NOT_FOUND");
  }

  if (locked.status === "CANCELLED") {
    throw new ExecutionMutationError("ORDER_ALREADY_CANCELLED");
  }

  if (locked.status === "FILLED") {
    return replayFilledLockedOrder(executor, locked);
  }


  if (locked.orderType !== "LIMIT" || locked.status !== "OPEN") {
    throw new ExecutionMutationError("ORDER_NOT_EXECUTABLE");
  }

  const price = persistExecutionPrice(executionPrice);
  assertLimitPriceProtection(locked.side as OrderSide, locked.limitPrice, price);

  return insertExecutionForOrder(executor, locked, price);
}

export async function findExecutionByOrderId(
  executor: Pick<NodePgDatabase, "select">,
  orderId: string,
): Promise<Execution | null> {
  const [row] = await executor
    .select({
      id: execution.id,
      orderId: execution.orderId,
      quantity: execution.quantity,
      price: execution.price,
      executedAt: executedAtUtc,
    })
    .from(execution)
    .where(eq(execution.orderId, orderId));

  return row ? fromPersistedExecution(row) : null;
}

export async function findAccountExecutionById(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  executionId: string,
): Promise<ExecutionWithOrder | null> {
  const [row] = await executor
    .select({
      id: execution.id,
      orderId: execution.orderId,
      quantity: execution.quantity,
      price: execution.price,
      executedAt: executedAtUtc,
      symbol: instrument.symbol,
      side: tradeOrder.side,
      orderType: tradeOrder.orderType,
    })
    .from(execution)
    .innerJoin(tradeOrder, eq(execution.orderId, tradeOrder.id))
    .innerJoin(instrument, eq(tradeOrder.instrumentId, instrument.id))
    .where(and(eq(execution.id, executionId), eq(tradeOrder.paperAccountId, paperAccountId)));

  return row ? fromPersistedExecutionWithOrder(row) : null;
}

export async function listExecutionsByPaperAccountId(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  pagination: ListExecutionsPagination,
  filters: ListExecutionsFilters = {},
): Promise<ExecutionWithOrder[]> {
  const conditions = [eq(tradeOrder.paperAccountId, paperAccountId)];

  if (filters.symbol !== undefined) {
    conditions.push(eq(instrument.symbol, filters.symbol));
  }

  if (filters.orderId !== undefined) {
    conditions.push(eq(execution.orderId, filters.orderId));
  }

  const rows = await executor
    .select({
      id: execution.id,
      orderId: execution.orderId,
      quantity: execution.quantity,
      price: execution.price,
      executedAt: executedAtUtc,
      symbol: instrument.symbol,
      side: tradeOrder.side,
      orderType: tradeOrder.orderType,
    })
    .from(execution)
    .innerJoin(tradeOrder, eq(execution.orderId, tradeOrder.id))
    .innerJoin(instrument, eq(tradeOrder.instrumentId, instrument.id))
    .where(and(...conditions))
    .orderBy(desc(execution.executedAt), desc(execution.id))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return rows.map(fromPersistedExecutionWithOrder);
}

async function replayExistingFilledOrder(
  executor: FinancialTransaction,
  order: Order,
): Promise<InsertFilledOrderResult> {
  if (order.status === "OPEN" || order.status === "CANCELLED") {
    return { kind: "replayed_order", order };
  }

  if (order.status !== "FILLED") {
    throw new ExecutionMutationError("ORDER_NOT_EXECUTABLE");
  }

  const existing = await findExecutionByOrderId(executor, order.id);

  if (!existing) {
    throw new ExecutionMutationError("EXECUTION_CONFLICT");
  }

  return { kind: "replayed_filled", order, execution: existing };
}

async function replayFilledLockedOrder(
  executor: FinancialTransaction,
  order: Order,
): Promise<CompleteOrderFillResult> {
  const existing = await findExecutionByOrderId(executor, order.id);

  if (!existing) {
    throw new ExecutionMutationError("EXECUTION_CONFLICT");
  }

  return { kind: "replayed_filled", order, execution: existing };
}

async function insertExecutionForOrder(
  executor: FinancialTransaction,
  order: Order,
  executionPrice: string,
): Promise<CompleteOrderFillResult> {
  const wallClock = await sampleUtcWallClock(executor);
  const inserted = await insertExecutionRow(
    executor,
    order.id,
    order.quantity,
    executionPrice,
    wallClock,
  );

  if (!inserted) {
    throw new ExecutionMutationError("EXECUTION_CONFLICT");
  }

  const filled = await markOrderFilled(executor, order, wallClock);
  return { kind: "created_filled", order: filled, execution: inserted };
}

async function insertExecutionRow(
  executor: FinancialTransaction,
  orderId: string,
  quantity: string,
  price: string,
  wallClock: string,
): Promise<Execution | null> {
  const result = await executor.execute(sql`
    INSERT INTO execution (order_id, quantity, price, executed_at)
    VALUES (
      ${orderId}::uuid,
      ${quantity}::numeric,
      ${price}::numeric,
      ${wallClock}::timestamp
    )
    ON CONFLICT (order_id) DO NOTHING
    RETURNING
      id,
      order_id,
      quantity,
      price,
      executed_at AT TIME ZONE 'UTC' AS executed_at_utc
  `);

  const [row] = result.rows as ExecutionInsertRow[];

  if (!row) {
    return null;
  }

  return fromPersistedExecution({
    id: row.id,
    orderId: row.order_id,
    quantity: row.quantity,
    price: row.price,
    executedAt: row.executed_at_utc,
  });
}

async function markOrderFilled(
  executor: FinancialTransaction,
  order: Order,
  wallClock: string,
): Promise<Order> {
  await executor.execute(sql`
    UPDATE trade_order
    SET status = 'FILLED',
        reserved_margin = 0,
        updated_at = ${wallClock}::timestamp
    WHERE id = ${order.id}::uuid
  `);

  const filled = await findOrderById(executor, order.paperAccountId, order.id);

  if (!filled) {
    throw new Error("trade_order missing after fill");
  }

  return filled;
}

async function sampleUtcWallClock(executor: FinancialTransaction): Promise<string> {
  const result = await executor.execute(sql`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS wall_clock
  `);
  const [row] = result.rows as { wall_clock: string }[];

  if (!row?.wall_clock) {
    throw new Error("failed to sample PostgreSQL UTC wall clock");
  }

  return row.wall_clock;
}

function persistExecutionPrice(value: string): string {
  if (typeof value !== "string" || !PLAIN_POSITIVE_DECIMAL.test(value)) {
    throw new Error("execution price must be a positive plain decimal string");
  }

  const parsed = fromDbDecimal(value);

  if (!parsed.isPositive()) {
    throw new Error("execution price must be positive");
  }

  return toDbDecimal(parsed);
}

function persistPlainDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}

function assertLimitPriceProtection(
  side: string,
  limitPrice: string | null,
  executionPrice: string,
): void {
  if (limitPrice === null) {
    throw new ExecutionMutationError("ORDER_NOT_EXECUTABLE");
  }

  const limit = fromDbDecimal(limitPrice);
  const price = fromDbDecimal(executionPrice);

  if (side === "BUY" && price.gt(limit)) {
    throw new ExecutionMutationError("ORDER_NOT_EXECUTABLE");
  }

  if (side === "SELL" && price.lt(limit)) {
    throw new ExecutionMutationError("ORDER_NOT_EXECUTABLE");
  }
}

function fromPersistedExecution(row: {
  id: string;
  orderId: string;
  quantity: string;
  price: string;
  executedAt: Date | string;
}): Execution {
  return {
    id: row.id,
    orderId: row.orderId,
    quantity: persistPlainDecimal(row.quantity),
    price: persistPlainDecimal(row.price),
    executedAt: fromUtcTimestamptz(row.executedAt),
  };
}

function fromPersistedExecutionWithOrder(row: {
  id: string;
  orderId: string;
  quantity: string;
  price: string;
  executedAt: Date | string;
  symbol: string;
  side: string;
  orderType: string;
}): ExecutionWithOrder {
  return {
    ...fromPersistedExecution(row),
    symbol: row.symbol,
    side: asOrderSide(row.side),
    orderType: asOrderType(row.orderType),
  };
}

function fromUtcTimestamptz(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}/.test(value)) {
    throw new Error("execution executedAt must be a timezone-aware timestamp");
  }

  return parsed;
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

type ExecutionInsertRow = {
  id: string;
  order_id: string;
  quantity: string;
  price: string;
  executed_at_utc: Date | string;
};
