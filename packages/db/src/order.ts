import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";
import { tradeOrder } from "./schema/order.js";

export type Order = typeof tradeOrder.$inferSelect;

export type OrderWithSymbol = Order & { symbol: string };

export type OrderSide = "BUY" | "SELL";

export type OrderType = "MARKET" | "LIMIT";

export type OrderStatus = "OPEN" | "FILLED" | "CANCELLED";

export type CreateOpenLimitOrderInput = {
  paperAccountId: string;
  instrumentId: string;
  side: OrderSide;
  orderType: "LIMIT";
  quantity: string;
  limitPrice: string;
  reservedMargin: string;
  reduceOnly?: boolean;
  idempotencyKey: string;
};

export type InsertOrderValues = {
  paperAccountId: string;
  instrumentId: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: string;
  limitPrice: string | null;
  reduceOnly: boolean;
  reservedMargin: string;
  status: OrderStatus;
  idempotencyKey: string;
};

export type InsertOrderResult =
  | { kind: "created"; order: Order }
  | { kind: "replayed"; order: Order }
  | { kind: "key_reused"; existing: Order };

export type ListOrdersPagination = {
  limit: number;
  offset: number;
};

export type ListOrdersFilters = {
  status?: OrderStatus;
  symbol?: string;
};

export class OrderMutationError extends Error {
  readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_CANCELLABLE";

  constructor(code: "ORDER_NOT_FOUND" | "ORDER_NOT_CANCELLABLE") {
    super(code);
    this.name = "OrderMutationError";
    this.code = code;
  }
}

export type OrderExecutor = Pick<NodePgDatabase, "insert" | "select">;

const orderWithSymbol = {
  ...getTableColumns(tradeOrder),
  symbol: instrument.symbol,
};

export async function insertOpenLimitOrder(
  executor: OrderExecutor,
  input: CreateOpenLimitOrderInput,
): Promise<InsertOrderResult> {
  assertOpenLimitInput(input);

  const reduceOnly = input.reduceOnly ?? false;
  const reservedMargin = persistReservedMargin(input.reservedMargin, {
    orderType: "LIMIT",
    status: "OPEN",
    reduceOnly,
  });

  return insertTradeOrderRow(executor, {
    paperAccountId: input.paperAccountId,
    instrumentId: input.instrumentId,
    side: input.side,
    orderType: "LIMIT",
    quantity: input.quantity,
    limitPrice: input.limitPrice,
    reduceOnly,
    reservedMargin,
    status: "OPEN",
    idempotencyKey: input.idempotencyKey,
  });
}

export async function insertTradeOrderRow(
  executor: OrderExecutor,
  input: {
    paperAccountId: string;
    instrumentId: string;
    side: OrderSide;
    orderType: OrderType;
    quantity: string;
    limitPrice: string | null;
    reduceOnly?: boolean;
    reservedMargin?: string;
    status: OrderStatus;
    idempotencyKey: string;
  },
): Promise<InsertOrderResult> {
  assertIdempotencyKey(input.idempotencyKey);
  assertOrderSide(input.side);

  const quantity = toPersistedDecimal(input.quantity);
  const limitPrice =
    input.limitPrice === null ? null : toPersistedDecimal(input.limitPrice);
  const reduceOnly = input.reduceOnly ?? false;
  const reservedMargin = persistReservedMargin(input.reservedMargin ?? "0", {
    orderType: input.orderType,
    status: input.status,
    reduceOnly,
  });

  if (input.orderType === "LIMIT") {
    if (limitPrice === null || !fromDbDecimal(limitPrice).isPositive()) {
      throw new Error("LIMIT orders require a positive limit price");
    }
  } else if (limitPrice !== null) {
    throw new Error("MARKET orders must not have a limit price");
  }

  const values: InsertOrderValues = {
    paperAccountId: input.paperAccountId,
    instrumentId: input.instrumentId,
    side: input.side,
    orderType: input.orderType,
    quantity,
    limitPrice,
    reduceOnly,
    reservedMargin,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
  };

  const [inserted] = await executor
    .insert(tradeOrder)
    .values(values)
    .onConflictDoNothing({
      target: [tradeOrder.paperAccountId, tradeOrder.idempotencyKey],
    })
    .returning();

  if (inserted) {
    return { kind: "created", order: fromPersistedOrder(inserted) };
  }

  const existing = await findOrderByIdempotencyKey(
    executor,
    input.paperAccountId,
    input.idempotencyKey,
  );

  if (!existing) {
    throw new Error("trade_order missing after idempotency conflict");
  }

  if (sameRequestFingerprint(existing, values)) {
    return { kind: "replayed", order: existing };
  }

  return { kind: "key_reused", existing };
}

export async function findOrderById(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  orderId: string,
): Promise<Order | null> {
  const [row] = await executor
    .select()
    .from(tradeOrder)
    .where(and(eq(tradeOrder.id, orderId), eq(tradeOrder.paperAccountId, paperAccountId)));

  return row ? fromPersistedOrder(row) : null;
}

export async function findAccountOrderById(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  orderId: string,
): Promise<OrderWithSymbol | null> {
  const [row] = await executor
    .select(orderWithSymbol)
    .from(tradeOrder)
    .innerJoin(instrument, eq(tradeOrder.instrumentId, instrument.id))
    .where(and(eq(tradeOrder.id, orderId), eq(tradeOrder.paperAccountId, paperAccountId)));

  return row ? fromPersistedOrderWithSymbol(row) : null;
}

export async function findOrderByIdempotencyKey(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  idempotencyKey: string,
): Promise<Order | null> {
  const [row] = await executor
    .select()
    .from(tradeOrder)
    .where(
      and(
        eq(tradeOrder.paperAccountId, paperAccountId),
        eq(tradeOrder.idempotencyKey, idempotencyKey),
      ),
    );

  return row ? fromPersistedOrder(row) : null;
}

export async function listOrdersByPaperAccountId(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  pagination: ListOrdersPagination,
  filters: ListOrdersFilters = {},
): Promise<OrderWithSymbol[]> {
  const conditions = [eq(tradeOrder.paperAccountId, paperAccountId)];

  if (filters.status !== undefined) {
    conditions.push(eq(tradeOrder.status, filters.status));
  }

  if (filters.symbol !== undefined) {
    conditions.push(eq(instrument.symbol, filters.symbol));
  }

  const rows = await executor
    .select(orderWithSymbol)
    .from(tradeOrder)
    .innerJoin(instrument, eq(tradeOrder.instrumentId, instrument.id))
    .where(and(...conditions))
    .orderBy(desc(tradeOrder.createdAt), desc(tradeOrder.id))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return rows.map(fromPersistedOrderWithSymbol);
}

export async function sumOpenOrderReservedMarginByPaperAccountId(
  executor: Pick<NodePgDatabase, "select" | "execute">,
  paperAccountId: string,
): Promise<string> {
  const result = await executor.execute(sql`
    SELECT coalesce(sum(reserved_margin), 0)::text AS total
    FROM trade_order
    WHERE paper_account_id = ${paperAccountId}::uuid
      AND status = 'OPEN'
  `);
  const [row] = result.rows as { total: string }[];

  if (!row) {
    return "0";
  }

  return toPersistedDecimal(row.total);
}

export async function hasOpenOrdersForAccountInstrument(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  instrumentId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: tradeOrder.id })
    .from(tradeOrder)
    .where(
      and(
        eq(tradeOrder.paperAccountId, paperAccountId),
        eq(tradeOrder.instrumentId, instrumentId),
        eq(tradeOrder.status, "OPEN"),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export async function listOpenLimitOrdersByInstrumentId(
  executor: Pick<NodePgDatabase, "select">,
  instrumentId: string,
): Promise<Order[]> {
  const rows = await executor
    .select()
    .from(tradeOrder)
    .where(
      and(
        eq(tradeOrder.instrumentId, instrumentId),
        eq(tradeOrder.status, "OPEN"),
        eq(tradeOrder.orderType, "LIMIT"),
      ),
    )
    .orderBy(asc(tradeOrder.createdAt), asc(tradeOrder.id));

  return rows.map(fromPersistedOrder);
}

export async function lockOrderById(
  executor: FinancialTransaction,
  paperAccountId: string,
  orderId: string,
): Promise<Order | null> {
  const [row] = await executor
    .select()
    .from(tradeOrder)
    .where(and(eq(tradeOrder.id, orderId), eq(tradeOrder.paperAccountId, paperAccountId)))
    .for("update");

  return row ? fromPersistedOrder(row) : null;
}

export async function lockOrderByIdempotencyKey(
  executor: FinancialTransaction,
  paperAccountId: string,
  idempotencyKey: string,
): Promise<Order | null> {
  const [row] = await executor
    .select()
    .from(tradeOrder)
    .where(
      and(
        eq(tradeOrder.paperAccountId, paperAccountId),
        eq(tradeOrder.idempotencyKey, idempotencyKey),
      ),
    )
    .for("update");

  return row ? fromPersistedOrder(row) : null;
}

export async function cancelOpenLimitOrder(
  executor: FinancialTransaction,
  paperAccountId: string,
  orderId: string,
): Promise<Order> {
  const [locked] = await executor
    .select()
    .from(tradeOrder)
    .where(and(eq(tradeOrder.id, orderId), eq(tradeOrder.paperAccountId, paperAccountId)))
    .for("update");

  if (!locked) {
    throw new OrderMutationError("ORDER_NOT_FOUND");
  }

  if (locked.status === "CANCELLED") {
    return fromPersistedOrder(locked);
  }

  if (locked.orderType !== "LIMIT" || locked.status !== "OPEN") {
    throw new OrderMutationError("ORDER_NOT_CANCELLABLE");
  }

  const wallClock = await sampleUtcWallClock(executor);

  await executor.execute(sql`
    UPDATE trade_order
    SET status = 'CANCELLED',
        reserved_margin = 0,
        updated_at = ${wallClock}::timestamp
    WHERE id = ${orderId}::uuid
  `);

  const updated = await findOrderById(executor, paperAccountId, orderId);

  if (!updated) {
    throw new Error("trade_order missing after cancel");
  }

  return updated;
}

export function sameRequestFingerprint(
  existing: Order,
  attempted: {
    instrumentId: string;
    side: string;
    orderType: string;
    quantity: string;
    limitPrice: string | null;
    reduceOnly: boolean;
  },
): boolean {
  if (
    existing.instrumentId !== attempted.instrumentId ||
    existing.side !== attempted.side ||
    existing.orderType !== attempted.orderType ||
    existing.reduceOnly !== attempted.reduceOnly
  ) {
    return false;
  }

  if (!fromDbDecimal(existing.quantity).eq(fromDbDecimal(attempted.quantity))) {
    return false;
  }

  if (existing.limitPrice === null && attempted.limitPrice === null) {
    return true;
  }

  if (existing.limitPrice === null || attempted.limitPrice === null) {
    return false;
  }

  return fromDbDecimal(existing.limitPrice).eq(fromDbDecimal(attempted.limitPrice));
}

export function fromPersistedOrder(row: Order): Order {
  return {
    ...row,
    quantity: toPersistedDecimal(row.quantity),
    limitPrice: row.limitPrice === null ? null : toPersistedDecimal(row.limitPrice),
    reservedMargin: toPersistedDecimal(row.reservedMargin),
  };
}

function assertOpenLimitInput(input: CreateOpenLimitOrderInput): void {
  assertOrderSide(input.side);

  if (input.orderType !== "LIMIT") {
    throw new Error("insertOpenLimitOrder only creates LIMIT orders");
  }
}

function assertOrderSide(side: string): void {
  if (side !== "BUY" && side !== "SELL") {
    throw new Error("order side must be BUY or SELL");
  }
}

const IDEMPOTENCY_KEY = /^[!-~]{1,128}$/;

function assertIdempotencyKey(key: string): void {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
    throw new Error(
      "idempotency key must be 1..128 printable non-whitespace ASCII characters",
    );
  }
}

function persistReservedMargin(
  value: string,
  params: { orderType: OrderType; status: OrderStatus; reduceOnly: boolean },
): string {
  const reservedMargin = toPersistedDecimal(value);
  const amount = fromDbDecimal(reservedMargin);

  if (amount.isNegative()) {
    throw new Error("reserved_margin must be non-negative");
  }

  if (params.orderType === "MARKET") {
    if (!amount.isZero()) {
      throw new Error("MARKET orders require reserved_margin 0");
    }

    return reservedMargin;
  }

  if (params.status === "FILLED" || params.status === "CANCELLED") {
    if (!amount.isZero()) {
      throw new Error("terminal orders require reserved_margin 0");
    }

    return reservedMargin;
  }

  if (params.orderType !== "LIMIT" || params.status !== "OPEN") {
    throw new Error("reserved_margin is only held by OPEN LIMIT orders");
  }

  if (params.reduceOnly) {
    if (!amount.isZero()) {
      throw new Error("reduce-only OPEN LIMIT reserved_margin must be 0");
    }

    return reservedMargin;
  }

  if (amount.lte(0)) {
    throw new Error("non-reduce OPEN LIMIT reserved_margin must be positive");
  }

  return reservedMargin;
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

function toPersistedDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}

function fromPersistedOrderWithSymbol(row: OrderWithSymbol): OrderWithSymbol {
  return {
    ...fromPersistedOrder(row),
    symbol: row.symbol,
  };
}
