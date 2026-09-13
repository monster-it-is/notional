import { and, asc, eq, ne, notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";

export type Instrument = typeof instrument.$inferSelect;

export type InstrumentStatus = "ACTIVE" | "INACTIVE";

export type UpsertInstrumentInput = {
  symbol: string;
  baseAsset: string;
  status: InstrumentStatus;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  minNotional: string;
};

export type InstrumentExecutor = Pick<NodePgDatabase, "insert" | "select" | "update">;

export async function findInstrumentById(
  executor: Pick<NodePgDatabase, "select">,
  id: string,
): Promise<Instrument | null> {
  const [existing] = await executor
    .select()
    .from(instrument)
    .where(eq(instrument.id, id));

  return existing ? fromPersistedInstrument(existing) : null;
}

export async function findInstrumentBySymbol(
  executor: Pick<NodePgDatabase, "select">,
  symbol: string,
): Promise<Instrument | null> {
  const [existing] = await executor
    .select()
    .from(instrument)
    .where(eq(instrument.symbol, symbol));

  return existing ? fromPersistedInstrument(existing) : null;
}

export async function listActiveInstruments(
  executor: Pick<NodePgDatabase, "select">,
): Promise<Instrument[]> {
  const rows = await executor
    .select()
    .from(instrument)
    .where(eq(instrument.status, "ACTIVE"))
    .orderBy(asc(instrument.symbol));

  return rows.map(fromPersistedInstrument);
}

export async function listInstrumentSymbols(
  executor: Pick<NodePgDatabase, "select">,
): Promise<string[]> {
  const rows = await executor.select({ symbol: instrument.symbol }).from(instrument);
  return rows.map((row) => row.symbol);
}

export async function markInstrumentsInactiveExcept(
  executor: Pick<NodePgDatabase, "update">,
  symbols: string[],
): Promise<number> {
  if (symbols.length === 0) {
    throw new Error("refusing to inactivate entire catalog: empty keep-set");
  }

  const rows = await executor
    .update(instrument)
    .set({
      status: "INACTIVE",
      updatedAt: new Date(),
    })
    .where(
      and(ne(instrument.status, "INACTIVE"), notInArray(instrument.symbol, symbols)),
    )
    .returning({ id: instrument.id });

  return rows.length;
}

export async function upsertInstrumentBySymbol(
  executor: InstrumentExecutor,
  input: UpsertInstrumentInput,
): Promise<Instrument> {
  const values = {
    symbol: input.symbol,
    baseAsset: input.baseAsset,
    quoteAsset: "USDT" as const,
    contractType: "PERPETUAL" as const,
    status: input.status,
    tickSize: toPersistedDecimal(input.tickSize),
    minPrice: toPersistedDecimal(input.minPrice),
    maxPrice: toPersistedDecimal(input.maxPrice),
    stepSize: toPersistedDecimal(input.stepSize),
    minQty: toPersistedDecimal(input.minQty),
    maxQty: toPersistedDecimal(input.maxQty),
    marketStepSize: toPersistedDecimal(input.marketStepSize),
    marketMinQty: toPersistedDecimal(input.marketMinQty),
    marketMaxQty: toPersistedDecimal(input.marketMaxQty),
    minNotional: toPersistedDecimal(input.minNotional),
  };

  const [row] = await executor
    .insert(instrument)
    .values(values)
    .onConflictDoUpdate({
      target: instrument.symbol,
      set: {
        baseAsset: values.baseAsset,
        quoteAsset: values.quoteAsset,
        contractType: values.contractType,
        status: values.status,
        tickSize: values.tickSize,
        minPrice: values.minPrice,
        maxPrice: values.maxPrice,
        stepSize: values.stepSize,
        minQty: values.minQty,
        maxQty: values.maxQty,
        marketStepSize: values.marketStepSize,
        marketMinQty: values.marketMinQty,
        marketMaxQty: values.marketMaxQty,
        minNotional: values.minNotional,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error("instrument missing after upsert");
  }

  return fromPersistedInstrument(row);
}

function toPersistedDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}

function fromPersistedInstrument(row: Instrument): Instrument {
  return {
    ...row,
    tickSize: toPersistedDecimal(row.tickSize),
    minPrice: toPersistedDecimal(row.minPrice),
    maxPrice: toPersistedDecimal(row.maxPrice),
    stepSize: toPersistedDecimal(row.stepSize),
    minQty: toPersistedDecimal(row.minQty),
    maxQty: toPersistedDecimal(row.maxQty),
    marketStepSize: toPersistedDecimal(row.marketStepSize),
    marketMinQty: toPersistedDecimal(row.marketMinQty),
    marketMaxQty: toPersistedDecimal(row.marketMaxQty),
    minNotional: toPersistedDecimal(row.minNotional),
  };
}
