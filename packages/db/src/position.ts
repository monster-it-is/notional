import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";
import { tradingPosition } from "./schema/position.js";

export type Position = {
  id: string;
  paperAccountId: string;
  instrumentId: string;
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PositionWithSymbol = Position & { symbol: string };

export type UpdatePositionStateInput = {
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
};

const createdAtUtc = sql<Date>`${tradingPosition.createdAt} AT TIME ZONE 'UTC'`.as(
  "created_at_utc",
);
const updatedAtUtc = sql<Date>`${tradingPosition.updatedAt} AT TIME ZONE 'UTC'`.as(
  "updated_at_utc",
);

const positionColumns = {
  id: tradingPosition.id,
  paperAccountId: tradingPosition.paperAccountId,
  instrumentId: tradingPosition.instrumentId,
  quantity: tradingPosition.quantity,
  entryPrice: tradingPosition.entryPrice,
  realizedPnl: tradingPosition.realizedPnl,
  createdAt: createdAtUtc,
  updatedAt: updatedAtUtc,
};

const positionWithSymbolColumns = {
  ...positionColumns,
  symbol: instrument.symbol,
};

export async function ensurePosition(
  executor: FinancialTransaction,
  paperAccountId: string,
  instrumentId: string,
): Promise<Position> {
  await executor
    .insert(tradingPosition)
    .values({
      paperAccountId,
      instrumentId,
      quantity: "0",
      entryPrice: null,
      realizedPnl: "0",
    })
    .onConflictDoNothing({
      target: [tradingPosition.paperAccountId, tradingPosition.instrumentId],
    });

  const existing = await findPositionByAccountAndInstrument(
    executor,
    paperAccountId,
    instrumentId,
  );

  if (!existing) {
    throw new Error("trading_position missing after ensure");
  }

  return existing;
}

export async function lockPositionByAccountAndInstrument(
  executor: FinancialTransaction,
  paperAccountId: string,
  instrumentId: string,
): Promise<Position> {
  const [row] = await executor
    .select(positionColumns)
    .from(tradingPosition)
    .where(
      and(
        eq(tradingPosition.paperAccountId, paperAccountId),
        eq(tradingPosition.instrumentId, instrumentId),
      ),
    )
    .for("update");

  if (!row) {
    throw new Error("trading_position missing after lock");
  }

  return fromPersistedPosition(row);
}

export async function findPositionByAccountAndInstrument(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  instrumentId: string,
): Promise<Position | null> {
  const [row] = await executor
    .select(positionColumns)
    .from(tradingPosition)
    .where(
      and(
        eq(tradingPosition.paperAccountId, paperAccountId),
        eq(tradingPosition.instrumentId, instrumentId),
      ),
    );

  return row ? fromPersistedPosition(row) : null;
}

export async function listOpenPositionsByPaperAccountId(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
): Promise<PositionWithSymbol[]> {
  const rows = await executor
    .select(positionWithSymbolColumns)
    .from(tradingPosition)
    .innerJoin(instrument, eq(tradingPosition.instrumentId, instrument.id))
    .where(
      and(eq(tradingPosition.paperAccountId, paperAccountId), sql`${tradingPosition.quantity} <> 0`),
    )
    .orderBy(asc(instrument.symbol));

  return rows.map(fromPersistedPositionWithSymbol);
}

export async function findOpenPositionByAccountAndSymbol(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  symbol: string,
): Promise<PositionWithSymbol | null> {
  const [row] = await executor
    .select(positionWithSymbolColumns)
    .from(tradingPosition)
    .innerJoin(instrument, eq(tradingPosition.instrumentId, instrument.id))
    .where(
      and(
        eq(tradingPosition.paperAccountId, paperAccountId),
        eq(instrument.symbol, symbol),
        sql`${tradingPosition.quantity} <> 0`,
      ),
    );

  return row ? fromPersistedPositionWithSymbol(row) : null;
}

export async function updatePositionState(
  executor: FinancialTransaction,
  positionId: string,
  input: UpdatePositionStateInput,
): Promise<Position> {
  const quantity = toPersistedDecimal(input.quantity);
  const entryPrice =
    input.entryPrice === null ? null : toPersistedDecimal(input.entryPrice);
  const realizedPnl = toPersistedDecimal(input.realizedPnl);

  const [updated] = await executor
    .update(tradingPosition)
    .set({
      quantity,
      entryPrice,
      realizedPnl,
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(eq(tradingPosition.id, positionId))
    .returning({ id: tradingPosition.id });

  if (!updated) {
    throw new Error("trading_position missing after update");
  }

  const [row] = await executor
    .select(positionColumns)
    .from(tradingPosition)
    .where(eq(tradingPosition.id, positionId));

  if (!row) {
    throw new Error("trading_position missing after update");
  }

  return fromPersistedPosition(row);
}

function fromPersistedPosition(row: {
  id: string;
  paperAccountId: string;
  instrumentId: string;
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Position {
  return {
    id: row.id,
    paperAccountId: row.paperAccountId,
    instrumentId: row.instrumentId,
    quantity: toPersistedDecimal(row.quantity),
    entryPrice: row.entryPrice === null ? null : toPersistedDecimal(row.entryPrice),
    realizedPnl: toPersistedDecimal(row.realizedPnl),
    createdAt: fromUtcTimestamptz(row.createdAt),
    updatedAt: fromUtcTimestamptz(row.updatedAt),
  };
}

function fromPersistedPositionWithSymbol(
  row: {
    id: string;
    paperAccountId: string;
    instrumentId: string;
    quantity: string;
    entryPrice: string | null;
    realizedPnl: string;
    createdAt: Date | string;
    updatedAt: Date | string;
    symbol: string;
  },
): PositionWithSymbol {
  return {
    ...fromPersistedPosition(row),
    symbol: row.symbol,
  };
}

function toPersistedDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}

function fromUtcTimestamptz(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || !/[zZ]|[+-]\d{2}/.test(value)) {
    throw new Error("trading_position timestamp must be timezone-aware");
  }

  return parsed;
}
