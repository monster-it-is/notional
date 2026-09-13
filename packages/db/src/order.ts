import { and, desc, eq, getTableColumns } from "drizzle-orm";
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

export type CreateOrderInput =
  | {
      paperAccountId: string;
      instrumentId: string;
      side: OrderSide;
      orderType: "MARKET";
      quantity: string;
      limitPrice?: null;
      reduceOnly?: boolean;
      status: "FILLED";
      idempotencyKey: string;
    }
  | {
      paperAccountId: string;
      instrumentId: string;
      side: OrderSide;
      orderType: "LIMIT";
      quantity: string;
      limitPrice: string;
      reduceOnly?: boolean;
      status: "OPEN" | "FILLED";
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

export async function insertOrder(
  executor: OrderExecutor,
  input: CreateOrderInput,
): Promise<InsertOrderResult> {
  assertIdempotencyKey(input.idempotencyKey);
  assertCreateInput(input);

  const quantity = toPersistedDecimal(input.quantity);
  const limitPrice =
    input.orderType === "LIMIT" ? toPersistedDecimal(input.limitPrice) : null;
  const reduceOnly = input.reduceOnly ?? false;

  if (input.orderType === "LIMIT" && !fromDbDecimal(limitPrice!).isPositive()) {
    throw new Error("LIMIT orders require a positive limit price");
  }

  const values = {
    paperAccountId: input.paperAccountId,
    instrumentId: input.instrumentId,
    side: input.side,
    orderType: input.orderType,
    quantity,
    limitPrice,
    reduceOnly,
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

  const [updated] = await executor
    .update(tradeOrder)
    .set({
      status: "CANCELLED",
      updatedAt: new Date(),
    })
    .where(eq(tradeOrder.id, orderId))
    .returning();

  if (!updated) {
    throw new Error("trade_order missing after cancel");
  }

  return fromPersistedOrder(updated);
}

function assertCreateInput(input: CreateOrderInput): void {
  if (input.side !== "BUY" && input.side !== "SELL") {
    throw new Error("order side must be BUY or SELL");
  }

  if (input.orderType === "MARKET") {
    if (input.status !== "FILLED") {
      throw new Error("MARKET orders must be created FILLED");
    }

    if (input.limitPrice != null) {
      throw new Error("MARKET orders must not have a limit price");
    }

    return;
  }

  if (input.orderType === "LIMIT") {
    const status = input.status as string;

    if (status === "CANCELLED") {
      throw new Error("LIMIT orders cannot be created CANCELLED");
    }

    if (status !== "OPEN" && status !== "FILLED") {
      throw new Error("LIMIT orders must be created OPEN or FILLED");
    }
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

function sameRequestFingerprint(
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

function toPersistedDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}

function fromPersistedOrder(row: Order): Order {
  return {
    ...row,
    quantity: toPersistedDecimal(row.quantity),
    limitPrice: row.limitPrice === null ? null : toPersistedDecimal(row.limitPrice),
  };
}

function fromPersistedOrderWithSymbol(row: OrderWithSymbol): OrderWithSymbol {
  return {
    ...fromPersistedOrder(row),
    symbol: row.symbol,
  };
}
