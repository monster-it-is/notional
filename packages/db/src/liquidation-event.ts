import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";
import { liquidationEvent } from "./schema/liquidation.js";

export type LiquidationMarginMode = "CROSS" | "ISOLATED";

export type LiquidationEvent = {
  id: string;
  paperAccountId: string;
  marginMode: LiquidationMarginMode;
  instrumentId: string | null;
  equity: string;
  maintenanceMargin: string;
  createdAt: Date;
};

export type LiquidationEventWithSymbol = LiquidationEvent & {
  symbol: string | null;
};

export type CreateLiquidationEventInput = {
  paperAccountId: string;
  marginMode: LiquidationMarginMode;
  instrumentId: string | null;
  equity: string;
  maintenanceMargin: string;
};

const createdAtUtc = sql<Date>`${liquidationEvent.createdAt} AT TIME ZONE 'UTC'`.as(
  "created_at_utc",
);

export async function createLiquidationEvent(
  executor: FinancialTransaction,
  input: CreateLiquidationEventInput,
): Promise<LiquidationEvent> {
  const [created] = await executor
    .insert(liquidationEvent)
    .values({
      paperAccountId: input.paperAccountId,
      marginMode: input.marginMode,
      instrumentId: input.instrumentId,
      equity: toPersistedDecimal(input.equity),
      maintenanceMargin: toPersistedDecimal(input.maintenanceMargin),
      createdAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .returning({ id: liquidationEvent.id });

  if (!created) {
    throw new Error("liquidation_event insert failed");
  }

  const loaded = await findLiquidationEventById(executor, created.id);

  if (!loaded) {
    throw new Error("liquidation_event missing after insert");
  }

  return loaded;
}

export async function findLiquidationEventById(
  executor: Pick<NodePgDatabase, "select">,
  id: string,
): Promise<LiquidationEvent | null> {
  const [row] = await executor
    .select({
      id: liquidationEvent.id,
      paperAccountId: liquidationEvent.paperAccountId,
      marginMode: liquidationEvent.marginMode,
      instrumentId: liquidationEvent.instrumentId,
      equity: liquidationEvent.equity,
      maintenanceMargin: liquidationEvent.maintenanceMargin,
      createdAt: createdAtUtc,
    })
    .from(liquidationEvent)
    .where(eq(liquidationEvent.id, id));

  return row ? fromPersistedEvent(row) : null;
}

export async function listLiquidationEventsByPaperAccountId(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  pagination: { limit: number; offset: number },
): Promise<LiquidationEventWithSymbol[]> {
  const rows = await executor
    .select({
      id: liquidationEvent.id,
      paperAccountId: liquidationEvent.paperAccountId,
      marginMode: liquidationEvent.marginMode,
      instrumentId: liquidationEvent.instrumentId,
      equity: liquidationEvent.equity,
      maintenanceMargin: liquidationEvent.maintenanceMargin,
      createdAt: createdAtUtc,
      symbol: instrument.symbol,
    })
    .from(liquidationEvent)
    .leftJoin(instrument, eq(liquidationEvent.instrumentId, instrument.id))
    .where(eq(liquidationEvent.paperAccountId, paperAccountId))
    .orderBy(desc(liquidationEvent.createdAt), desc(liquidationEvent.id))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return rows.map((row) => ({
    ...fromPersistedEvent(row),
    symbol: row.symbol,
  }));
}

function fromPersistedEvent(row: {
  id: string;
  paperAccountId: string;
  marginMode: string;
  instrumentId: string | null;
  equity: string;
  maintenanceMargin: string;
  createdAt: Date | string;
}): LiquidationEvent {
  return {
    id: row.id,
    paperAccountId: row.paperAccountId,
    marginMode: asMarginMode(row.marginMode),
    instrumentId: row.instrumentId,
    equity: toPersistedDecimal(row.equity),
    maintenanceMargin: toPersistedDecimal(row.maintenanceMargin),
    createdAt: fromUtcTimestamptz(row.createdAt),
  };
}

function asMarginMode(value: string): LiquidationMarginMode {
  if (value === "CROSS" || value === "ISOLATED") {
    return value;
  }

  throw new Error(`invalid liquidation_event.margin_mode: ${value}`);
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
    throw new Error("liquidation_event timestamp must be timezone-aware");
  }

  return parsed;
}
