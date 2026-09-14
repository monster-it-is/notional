import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";
import { tradingPosition } from "./schema/position.js";

export type MarginMode = "CROSS" | "ISOLATED";

export type Position = {
  id: string;
  paperAccountId: string;
  instrumentId: string;
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
  marginMode: MarginMode;
  leverage: number;
  isolatedMargin: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PositionWithSymbol = Position & { symbol: string };

export type UpdatePositionStateInput = {
  quantity: string;
  entryPrice: string | null;
  realizedPnl: string;
  isolatedMargin?: string;
};

export type UpdateMarginSettingsInput = {
  marginMode: MarginMode;
  leverage: number;
};

export class PositionMutationError extends Error {
  readonly code: "POSITION_NOT_FLAT";

  constructor(code: "POSITION_NOT_FLAT") {
    super(code);
    this.name = "PositionMutationError";
    this.code = code;
  }
}

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
  marginMode: tradingPosition.marginMode,
  leverage: tradingPosition.leverage,
  isolatedMargin: tradingPosition.isolatedMargin,
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

export async function listOpenPositionsForLiquidation(
  executor: Pick<NodePgDatabase, "select">,
): Promise<PositionWithSymbol[]> {
  const rows = await executor
    .select(positionWithSymbolColumns)
    .from(tradingPosition)
    .innerJoin(instrument, eq(tradingPosition.instrumentId, instrument.id))
    .where(sql`${tradingPosition.quantity} <> 0`)
    .orderBy(asc(tradingPosition.paperAccountId), asc(tradingPosition.instrumentId));

  return rows.map(fromPersistedPositionWithSymbol);
}

export async function lockPositionsByAccountAndInstrumentIds(
  executor: FinancialTransaction,
  paperAccountId: string,
  instrumentIds: string[],
): Promise<Position[]> {
  if (instrumentIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(instrumentIds)];
  const rows = await executor
    .select(positionColumns)
    .from(tradingPosition)
    .where(
      and(
        eq(tradingPosition.paperAccountId, paperAccountId),
        inArray(tradingPosition.instrumentId, uniqueIds),
      ),
    )
    .orderBy(asc(tradingPosition.instrumentId))
    .for("update");

  if (rows.length !== uniqueIds.length) {
    throw new Error("trading_position missing during multi-position lock");
  }

  return rows.map(fromPersistedPosition);
}

export async function sumIsolatedMarginByPaperAccountId(
  executor: Pick<NodePgDatabase, "execute">,
  paperAccountId: string,
): Promise<string> {
  const result = await executor.execute(sql`
    SELECT coalesce(sum(isolated_margin), 0)::text AS total
    FROM trading_position
    WHERE paper_account_id = ${paperAccountId}::uuid
  `);
  const [row] = result.rows as { total: string }[];

  if (!row) {
    return "0";
  }

  return toDbDecimal(fromDbDecimal(row.total));
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
  const isolatedMargin = toPersistedDecimal(input.isolatedMargin ?? "0");

  const [updated] = await executor
    .update(tradingPosition)
    .set({
      quantity,
      entryPrice,
      realizedPnl,
      isolatedMargin,
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(eq(tradingPosition.id, positionId))
    .returning({ id: tradingPosition.id });

  if (!updated) {
    throw new Error("trading_position missing after update");
  }

  return loadPositionById(executor, positionId);
}

export async function updateMarginSettingsForFlatPosition(
  executor: FinancialTransaction,
  positionId: string,
  input: UpdateMarginSettingsInput,
): Promise<Position> {
  const [updated] = await executor
    .update(tradingPosition)
    .set({
      marginMode: input.marginMode,
      leverage: input.leverage,
      isolatedMargin: "0",
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(
      and(
        eq(tradingPosition.id, positionId),
        sql`${tradingPosition.quantity} = 0`,
        sql`${tradingPosition.entryPrice} IS NULL`,
      ),
    )
    .returning({ id: tradingPosition.id });

  if (!updated) {
    throw new PositionMutationError("POSITION_NOT_FLAT");
  }

  return loadPositionById(executor, positionId);
}

async function loadPositionById(
  executor: FinancialTransaction,
  positionId: string,
): Promise<Position> {
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
  marginMode: string;
  leverage: number;
  isolatedMargin: string;
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
    marginMode: asMarginMode(row.marginMode),
    leverage: asLeverage(row.leverage),
    isolatedMargin: toPersistedDecimal(row.isolatedMargin),
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
    marginMode: string;
    leverage: number;
    isolatedMargin: string;
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

function asMarginMode(value: string): MarginMode {
  if (value === "CROSS" || value === "ISOLATED") {
    return value;
  }

  throw new Error(`invalid trading_position.margin_mode: ${value}`);
}

function asLeverage(value: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("trading_position.leverage must be an integer");
  }

  return value;
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
