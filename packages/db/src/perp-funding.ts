import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { FinancialTransaction } from "./executor.js";
import { fromDbDecimal, toDbDecimal } from "./money.js";
import { instrument } from "./schema/instrument.js";
import {
  perpFundingAccountSettlement,
  perpFundingCycle,
  perpFundingSettlement,
  perpFundingSourceState,
} from "./schema/perp-funding.js";
import { tradingPosition } from "./schema/position.js";
import { fromUtcTimestamp, toIsoUtc, utcTimestampFromDate } from "./time.js";

export type PerpFundingCycleStatus = "SCHEDULED" | "READY";

export type PerpFundingCycle = {
  id: string;
  instrumentId: string;
  fundingTime: Date;
  status: PerpFundingCycleStatus;
  fundingRate: string | null;
  markPrice: string | null;
  createdAt: Date;
  readyAt: Date | null;
};

export type PerpFundingSourceState = {
  instrumentId: string;
  activationFloorAt: Date;
  lastRealizedFundingTime: Date | null;
  nextFundingTime: Date | null;
  nextFundingTimeObservedAt: Date | null;
  updatedAt: Date;
};

export type PerpFundingAccountSettlement = {
  id: string;
  paperAccountId: string;
  fundingTime: Date;
  totalFundingPayment: string;
  userWalletDelta: string;
  insuranceAbsorption: string;
  createdAt: Date;
};

export type PerpFundingSettlement = {
  id: string;
  fundingCycleId: string;
  paperAccountId: string;
  positionId: string;
  fundingAccountSettlementId: string;
  marginMode: "CROSS" | "ISOLATED";
  quantity: string;
  fundingPayment: string;
  isolatedMarginBefore: string | null;
  isolatedMarginAfter: string | null;
  createdAt: Date;
};

export type PerpFundingHistoryRow = PerpFundingSettlement & {
  symbol: string;
  fundingTime: Date;
  fundingRate: string;
  markPrice: string;
};

export type UnpaidFundingBatch = {
  paperAccountId: string;
  fundingTime: Date;
};

export type MarkFundingCycleReadyResult =
  | { kind: "transitioned"; cycle: PerpFundingCycle }
  | { kind: "already_ready_same"; cycle: PerpFundingCycle };

export class FundingCycleIntegrityError extends Error {
  readonly code = "FUNDING_CYCLE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "FundingCycleIntegrityError";
  }
}

const cycleCreatedAtUtc = sql<Date>`${perpFundingCycle.createdAt} AT TIME ZONE 'UTC'`.as(
  "created_at_utc",
);
const cycleReadyAtUtc = sql<Date>`${perpFundingCycle.readyAt} AT TIME ZONE 'UTC'`.as(
  "ready_at_utc",
);
const cycleFundingTimeUtc = sql<Date>`${perpFundingCycle.fundingTime} AT TIME ZONE 'UTC'`.as(
  "funding_time_utc",
);

const cycleColumns = {
  id: perpFundingCycle.id,
  instrumentId: perpFundingCycle.instrumentId,
  fundingTime: cycleFundingTimeUtc,
  status: perpFundingCycle.status,
  fundingRate: perpFundingCycle.fundingRate,
  markPrice: perpFundingCycle.markPrice,
  createdAt: cycleCreatedAtUtc,
  readyAt: cycleReadyAtUtc,
};

export async function insertScheduledFundingCycle(
  executor: FinancialTransaction,
  input: { instrumentId: string; fundingTime: Date },
): Promise<PerpFundingCycle> {
  await executor
    .insert(perpFundingCycle)
    .values({
      instrumentId: input.instrumentId,
      fundingTime: utcTimestampFromDate(input.fundingTime),
      status: "SCHEDULED",
      createdAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .onConflictDoNothing({
      target: [perpFundingCycle.instrumentId, perpFundingCycle.fundingTime],
    });

  const existing = await findFundingCycleByInstrumentAndTime(
    executor,
    input.instrumentId,
    input.fundingTime,
  );

  if (!existing) {
    throw new Error("perp_funding_cycle missing after scheduled insert");
  }

  return existing;
}

export async function insertReadyFundingCycle(
  executor: FinancialTransaction,
  input: {
    instrumentId: string;
    fundingTime: Date;
    fundingRate: string;
    markPrice: string;
  },
): Promise<MarkFundingCycleReadyResult> {
  const existing = await findFundingCycleByInstrumentAndTime(
    executor,
    input.instrumentId,
    input.fundingTime,
  );

  if (existing) {
    return markFundingCycleReady(executor, existing.id, {
      fundingRate: input.fundingRate,
      markPrice: input.markPrice,
    });
  }

  const [created] = await executor
    .insert(perpFundingCycle)
    .values({
      instrumentId: input.instrumentId,
      fundingTime: utcTimestampFromDate(input.fundingTime),
      status: "READY",
      fundingRate: persistDecimal(input.fundingRate),
      markPrice: persistDecimal(input.markPrice),
      createdAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      readyAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .returning({ id: perpFundingCycle.id });

  if (!created) {
    throw new Error("perp_funding_cycle READY insert failed");
  }

  const cycle = await findFundingCycleById(executor, created.id);

  if (!cycle) {
    throw new Error("perp_funding_cycle missing after READY insert");
  }

  return { kind: "transitioned", cycle };
}

export async function markFundingCycleReady(
  executor: FinancialTransaction,
  cycleId: string,
  payload: { fundingRate: string; markPrice: string },
): Promise<MarkFundingCycleReadyResult> {
  const cycle = await findFundingCycleById(executor, cycleId);

  if (!cycle) {
    throw new Error("perp_funding_cycle missing during READY mark");
  }

  const fundingRate = persistDecimal(payload.fundingRate);
  const markPrice = persistDecimal(payload.markPrice);

  if (cycle.status === "READY") {
    if (cycle.fundingRate === fundingRate && cycle.markPrice === markPrice) {
      return { kind: "already_ready_same", cycle };
    }

    throw new FundingCycleIntegrityError("READY funding cycle payload conflict");
  }

  const [updated] = await executor
    .update(perpFundingCycle)
    .set({
      status: "READY",
      fundingRate,
      markPrice,
      readyAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(and(eq(perpFundingCycle.id, cycleId), eq(perpFundingCycle.status, "SCHEDULED")))
    .returning({ id: perpFundingCycle.id });

  if (!updated) {
    throw new Error("perp_funding_cycle READY transition failed");
  }

  const next = await findFundingCycleById(executor, cycleId);

  if (!next) {
    throw new Error("perp_funding_cycle missing after READY transition");
  }

  return { kind: "transitioned", cycle: next };
}

export async function deletePredictedScheduledCycle(
  executor: FinancialTransaction,
  cycleId: string,
): Promise<void> {
  await executor
    .delete(perpFundingCycle)
    .where(and(eq(perpFundingCycle.id, cycleId), eq(perpFundingCycle.status, "SCHEDULED")));
}

export async function listScheduledFundingCyclesBefore(
  executor: Pick<NodePgDatabase, "select">,
  instrumentId: string,
  before: Date,
): Promise<PerpFundingCycle[]> {
  const rows = await executor
    .select(cycleColumns)
    .from(perpFundingCycle)
    .where(
      and(
        eq(perpFundingCycle.instrumentId, instrumentId),
        eq(perpFundingCycle.status, "SCHEDULED"),
        sql`${perpFundingCycle.fundingTime} < ${utcTimestampFromDate(before)}`,
      ),
    )
    .orderBy(asc(perpFundingCycle.fundingTime));

  return rows.map(fromPersistedCycle);
}

export async function findFundingCycleById(
  executor: Pick<NodePgDatabase, "select">,
  cycleId: string,
): Promise<PerpFundingCycle | null> {
  const [row] = await executor
    .select(cycleColumns)
    .from(perpFundingCycle)
    .where(eq(perpFundingCycle.id, cycleId));

  return row ? fromPersistedCycle(row) : null;
}

export async function findFundingCycleByInstrumentAndTime(
  executor: Pick<NodePgDatabase, "select">,
  instrumentId: string,
  fundingTime: Date,
): Promise<PerpFundingCycle | null> {
  const [row] = await executor
    .select(cycleColumns)
    .from(perpFundingCycle)
    .where(
      and(
        eq(perpFundingCycle.instrumentId, instrumentId),
        sql`${perpFundingCycle.fundingTime} = ${utcTimestampFromDate(fundingTime)}`,
      ),
    );

  return row ? fromPersistedCycle(row) : null;
}

export async function listUnresolvedScheduledTimesInWindow(
  executor: Pick<NodePgDatabase, "select">,
  instrumentId: string,
  cursorAt: Date,
  financialNow: Date,
): Promise<string[]> {
  const rows = await executor
    .select({ fundingTime: cycleFundingTimeUtc })
    .from(perpFundingCycle)
    .where(
      and(
        eq(perpFundingCycle.instrumentId, instrumentId),
        eq(perpFundingCycle.status, "SCHEDULED"),
        sql`${perpFundingCycle.fundingTime} > ${utcTimestampFromDate(cursorAt)}`,
        sql`${perpFundingCycle.fundingTime} <= ${utcTimestampFromDate(financialNow)}`,
      ),
    );

  return rows.map((row) => toIsoUtc(fromUtcTimestamp(row.fundingTime)));
}

export async function findSourceStateByInstrumentId(
  executor: Pick<NodePgDatabase, "select">,
  instrumentId: string,
): Promise<PerpFundingSourceState | null> {
  const [row] = await executor
    .select({
      instrumentId: perpFundingSourceState.instrumentId,
      activationFloorAt: sql<Date>`${perpFundingSourceState.activationFloorAt} AT TIME ZONE 'UTC'`,
      lastRealizedFundingTime: sql<
        Date | null
      >`${perpFundingSourceState.lastRealizedFundingTime} AT TIME ZONE 'UTC'`,
      nextFundingTime: sql<
        Date | null
      >`${perpFundingSourceState.nextFundingTime} AT TIME ZONE 'UTC'`,
      nextFundingTimeObservedAt: sql<
        Date | null
      >`${perpFundingSourceState.nextFundingTimeObservedAt} AT TIME ZONE 'UTC'`,
      updatedAt: sql<Date>`${perpFundingSourceState.updatedAt} AT TIME ZONE 'UTC'`,
    })
    .from(perpFundingSourceState)
    .where(eq(perpFundingSourceState.instrumentId, instrumentId));

  return row ? fromPersistedSourceState(row) : null;
}

export async function ensurePerpFundingSourceState(
  executor: FinancialTransaction,
  input: { instrumentId: string; activationFloorAt: Date },
): Promise<PerpFundingSourceState> {
  await executor
    .insert(perpFundingSourceState)
    .values({
      instrumentId: input.instrumentId,
      activationFloorAt: utcTimestampFromDate(input.activationFloorAt),
      lastRealizedFundingTime: null,
      nextFundingTime: null,
      nextFundingTimeObservedAt: null,
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .onConflictDoNothing({
      target: [perpFundingSourceState.instrumentId],
    });

  const existing = await findSourceStateByInstrumentId(executor, input.instrumentId);

  if (!existing) {
    throw new Error("perp_funding_source_state missing after ensure");
  }

  return existing;
}

export async function minOpenFundingCursorAt(
  executor: Pick<NodePgDatabase, "execute">,
  instrumentId: string,
): Promise<Date | null> {
  const result = await executor.execute(sql`
    SELECT min(funding_cursor_at) AT TIME ZONE 'UTC' AS min_cursor
    FROM trading_position
    WHERE instrument_id = ${instrumentId}::uuid
      AND quantity <> 0
  `);
  const [row] = result.rows as { min_cursor: Date | string | null }[];

  if (!row || row.min_cursor === null) {
    return null;
  }

  return fromUtcTimestamp(row.min_cursor);
}

export async function persistNextFundingTimeObservation(
  executor: FinancialTransaction,
  instrumentId: string,
  nextFundingTime: Date,
): Promise<PerpFundingSourceState> {
  const [updated] = await executor
    .update(perpFundingSourceState)
    .set({
      nextFundingTime: utcTimestampFromDate(nextFundingTime),
      nextFundingTimeObservedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(eq(perpFundingSourceState.instrumentId, instrumentId))
    .returning({ instrumentId: perpFundingSourceState.instrumentId });

  if (!updated) {
    throw new Error("perp_funding_source_state missing during schedule persist");
  }

  const next = await findSourceStateByInstrumentId(executor, instrumentId);

  if (!next) {
    throw new Error("perp_funding_source_state missing after schedule persist");
  }

  return next;
}

export async function advanceLastRealizedFundingTime(
  executor: FinancialTransaction,
  instrumentId: string,
  lastRealizedFundingTime: Date,
): Promise<PerpFundingSourceState> {
  await executor
    .update(perpFundingSourceState)
    .set({
      lastRealizedFundingTime: utcTimestampFromDate(lastRealizedFundingTime),
      updatedAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .where(
      and(
        eq(perpFundingSourceState.instrumentId, instrumentId),
        sql`(
          ${perpFundingSourceState.lastRealizedFundingTime} IS NULL
          OR ${perpFundingSourceState.lastRealizedFundingTime} < ${utcTimestampFromDate(lastRealizedFundingTime)}
        )`,
      ),
    );

  const next = await findSourceStateByInstrumentId(executor, instrumentId);

  if (!next) {
    throw new Error("perp_funding_source_state missing after watermark advance");
  }

  return next;
}

export async function insertPerpFundingAccountSettlement(
  executor: FinancialTransaction,
  input: {
    paperAccountId: string;
    fundingTime: Date;
    totalFundingPayment: string;
    userWalletDelta: string;
    insuranceAbsorption: string;
  },
): Promise<PerpFundingAccountSettlement> {
  const [created] = await executor
    .insert(perpFundingAccountSettlement)
    .values({
      paperAccountId: input.paperAccountId,
      fundingTime: utcTimestampFromDate(input.fundingTime),
      totalFundingPayment: persistDecimal(input.totalFundingPayment),
      userWalletDelta: persistDecimal(input.userWalletDelta),
      insuranceAbsorption: persistDecimal(input.insuranceAbsorption),
      createdAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .returning({ id: perpFundingAccountSettlement.id });

  if (!created) {
    throw new Error("perp_funding_account_settlement insert failed");
  }

  const loaded = await findAccountSettlementById(executor, created.id);

  if (!loaded) {
    throw new Error("perp_funding_account_settlement missing after insert");
  }

  return loaded;
}

export async function findAccountSettlementById(
  executor: Pick<NodePgDatabase, "select">,
  id: string,
): Promise<PerpFundingAccountSettlement | null> {
  const [row] = await executor
    .select({
      id: perpFundingAccountSettlement.id,
      paperAccountId: perpFundingAccountSettlement.paperAccountId,
      fundingTime: sql<Date>`${perpFundingAccountSettlement.fundingTime} AT TIME ZONE 'UTC'`,
      totalFundingPayment: perpFundingAccountSettlement.totalFundingPayment,
      userWalletDelta: perpFundingAccountSettlement.userWalletDelta,
      insuranceAbsorption: perpFundingAccountSettlement.insuranceAbsorption,
      createdAt: sql<Date>`${perpFundingAccountSettlement.createdAt} AT TIME ZONE 'UTC'`,
    })
    .from(perpFundingAccountSettlement)
    .where(eq(perpFundingAccountSettlement.id, id));

  return row ? fromPersistedAccountSettlement(row) : null;
}

export async function findAccountSettlementByAccountAndTime(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  fundingTime: Date,
): Promise<PerpFundingAccountSettlement | null> {
  const [row] = await executor
    .select({
      id: perpFundingAccountSettlement.id,
      paperAccountId: perpFundingAccountSettlement.paperAccountId,
      fundingTime: sql<Date>`${perpFundingAccountSettlement.fundingTime} AT TIME ZONE 'UTC'`,
      totalFundingPayment: perpFundingAccountSettlement.totalFundingPayment,
      userWalletDelta: perpFundingAccountSettlement.userWalletDelta,
      insuranceAbsorption: perpFundingAccountSettlement.insuranceAbsorption,
      createdAt: sql<Date>`${perpFundingAccountSettlement.createdAt} AT TIME ZONE 'UTC'`,
    })
    .from(perpFundingAccountSettlement)
    .where(
      and(
        eq(perpFundingAccountSettlement.paperAccountId, paperAccountId),
        sql`${perpFundingAccountSettlement.fundingTime} = ${utcTimestampFromDate(fundingTime)}`,
      ),
    );

  return row ? fromPersistedAccountSettlement(row) : null;
}

export async function insertPerpFundingSettlement(
  executor: FinancialTransaction,
  input: {
    fundingCycleId: string;
    paperAccountId: string;
    positionId: string;
    fundingAccountSettlementId: string;
    marginMode: "CROSS" | "ISOLATED";
    quantity: string;
    fundingPayment: string;
    isolatedMarginBefore: string | null;
    isolatedMarginAfter: string | null;
  },
): Promise<PerpFundingSettlement> {
  const [created] = await executor
    .insert(perpFundingSettlement)
    .values({
      fundingCycleId: input.fundingCycleId,
      paperAccountId: input.paperAccountId,
      positionId: input.positionId,
      fundingAccountSettlementId: input.fundingAccountSettlementId,
      marginMode: input.marginMode,
      quantity: persistDecimal(input.quantity),
      fundingPayment: persistDecimal(input.fundingPayment),
      isolatedMarginBefore:
        input.isolatedMarginBefore === null ? null : persistDecimal(input.isolatedMarginBefore),
      isolatedMarginAfter:
        input.isolatedMarginAfter === null ? null : persistDecimal(input.isolatedMarginAfter),
      createdAt: sql`clock_timestamp() AT TIME ZONE 'UTC'`,
    })
    .returning({ id: perpFundingSettlement.id });

  if (!created) {
    throw new Error("perp_funding_settlement insert failed");
  }

  const loaded = await findPositionSettlementById(executor, created.id);

  if (!loaded) {
    throw new Error("perp_funding_settlement missing after insert");
  }

  return loaded;
}

export async function listPerpFundingHistoryByPaperAccountId(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  pagination: { limit: number; offset: number },
): Promise<PerpFundingHistoryRow[]> {
  const rows = await executor
    .select({
      id: perpFundingSettlement.id,
      fundingCycleId: perpFundingSettlement.fundingCycleId,
      paperAccountId: perpFundingSettlement.paperAccountId,
      positionId: perpFundingSettlement.positionId,
      fundingAccountSettlementId: perpFundingSettlement.fundingAccountSettlementId,
      marginMode: perpFundingSettlement.marginMode,
      quantity: perpFundingSettlement.quantity,
      fundingPayment: perpFundingSettlement.fundingPayment,
      isolatedMarginBefore: perpFundingSettlement.isolatedMarginBefore,
      isolatedMarginAfter: perpFundingSettlement.isolatedMarginAfter,
      createdAt: sql<Date>`${perpFundingSettlement.createdAt} AT TIME ZONE 'UTC'`,
      symbol: instrument.symbol,
      fundingTime: cycleFundingTimeUtc,
      fundingRate: perpFundingCycle.fundingRate,
      markPrice: perpFundingCycle.markPrice,
    })
    .from(perpFundingSettlement)
    .innerJoin(perpFundingCycle, eq(perpFundingSettlement.fundingCycleId, perpFundingCycle.id))
    .innerJoin(instrument, eq(perpFundingCycle.instrumentId, instrument.id))
    .where(eq(perpFundingSettlement.paperAccountId, paperAccountId))
    .orderBy(desc(perpFundingCycle.fundingTime), desc(perpFundingSettlement.id))
    .limit(pagination.limit)
    .offset(pagination.offset);

  return rows.map((row) => {
    if (row.fundingRate === null || row.markPrice === null) {
      throw new Error("READY funding cycle missing rate or mark in history");
    }

    return {
      ...fromPersistedPositionSettlement(row),
      symbol: row.symbol,
      fundingTime: fromUtcTimestamp(row.fundingTime),
      fundingRate: persistDecimal(row.fundingRate),
      markPrice: persistDecimal(row.markPrice),
    };
  });
}

export async function listUnpaidReadyFundingBatches(
  executor: Pick<NodePgDatabase, "execute">,
): Promise<UnpaidFundingBatch[]> {
  const result = await executor.execute(sql`
    SELECT DISTINCT p.paper_account_id, c.funding_time AT TIME ZONE 'UTC' AS funding_time
    FROM perp_funding_cycle c
    JOIN trading_position p
      ON p.instrument_id = c.instrument_id
     AND p.quantity <> 0
     AND p.funding_cursor_at < c.funding_time
    WHERE c.status = 'READY'
      AND NOT EXISTS (
        SELECT 1
        FROM perp_funding_account_settlement s
        WHERE s.paper_account_id = p.paper_account_id
          AND s.funding_time = c.funding_time
      )
    ORDER BY funding_time ASC, p.paper_account_id ASC
  `);

  return (result.rows as { paper_account_id: string; funding_time: Date | string }[]).map(
    (row) => ({
      paperAccountId: row.paper_account_id,
      fundingTime: fromUtcTimestamp(row.funding_time),
    }),
  );
}

export async function listDueReadyCyclesForAccount(
  executor: Pick<NodePgDatabase, "select">,
  paperAccountId: string,
  financialNow: Date,
): Promise<PerpFundingCycle[]> {
  const rows = await executor
    .select(cycleColumns)
    .from(perpFundingCycle)
    .innerJoin(
      tradingPosition,
      and(
        eq(tradingPosition.instrumentId, perpFundingCycle.instrumentId),
        eq(tradingPosition.paperAccountId, paperAccountId),
        sql`${tradingPosition.quantity} <> 0`,
        sql`${tradingPosition.fundingCursorAt} < ${perpFundingCycle.fundingTime}`,
      ),
    )
    .where(
      and(
        eq(perpFundingCycle.status, "READY"),
        sql`${perpFundingCycle.fundingTime} <= ${utcTimestampFromDate(financialNow)}`,
      ),
    )
    .orderBy(asc(perpFundingCycle.fundingTime), asc(perpFundingCycle.instrumentId));

  return rows.map(fromPersistedCycle);
}

async function findPositionSettlementById(
  executor: Pick<NodePgDatabase, "select">,
  id: string,
): Promise<PerpFundingSettlement | null> {
  const [row] = await executor
    .select({
      id: perpFundingSettlement.id,
      fundingCycleId: perpFundingSettlement.fundingCycleId,
      paperAccountId: perpFundingSettlement.paperAccountId,
      positionId: perpFundingSettlement.positionId,
      fundingAccountSettlementId: perpFundingSettlement.fundingAccountSettlementId,
      marginMode: perpFundingSettlement.marginMode,
      quantity: perpFundingSettlement.quantity,
      fundingPayment: perpFundingSettlement.fundingPayment,
      isolatedMarginBefore: perpFundingSettlement.isolatedMarginBefore,
      isolatedMarginAfter: perpFundingSettlement.isolatedMarginAfter,
      createdAt: sql<Date>`${perpFundingSettlement.createdAt} AT TIME ZONE 'UTC'`,
    })
    .from(perpFundingSettlement)
    .where(eq(perpFundingSettlement.id, id));

  return row ? fromPersistedPositionSettlement(row) : null;
}

function fromPersistedCycle(row: {
  id: string;
  instrumentId: string;
  fundingTime: Date | string;
  status: string;
  fundingRate: string | null;
  markPrice: string | null;
  createdAt: Date | string;
  readyAt: Date | string | null;
}): PerpFundingCycle {
  if (row.status !== "SCHEDULED" && row.status !== "READY") {
    throw new Error(`invalid perp_funding_cycle.status: ${row.status}`);
  }

  return {
    id: row.id,
    instrumentId: row.instrumentId,
    fundingTime: fromUtcTimestamp(row.fundingTime),
    status: row.status,
    fundingRate: row.fundingRate === null ? null : persistDecimal(row.fundingRate),
    markPrice: row.markPrice === null ? null : persistDecimal(row.markPrice),
    createdAt: fromUtcTimestamp(row.createdAt),
    readyAt: row.readyAt === null ? null : fromUtcTimestamp(row.readyAt),
  };
}

function fromPersistedSourceState(row: {
  instrumentId: string;
  activationFloorAt: Date | string;
  lastRealizedFundingTime: Date | string | null;
  nextFundingTime: Date | string | null;
  nextFundingTimeObservedAt: Date | string | null;
  updatedAt: Date | string;
}): PerpFundingSourceState {
  return {
    instrumentId: row.instrumentId,
    activationFloorAt: fromUtcTimestamp(row.activationFloorAt),
    lastRealizedFundingTime:
      row.lastRealizedFundingTime === null ? null : fromUtcTimestamp(row.lastRealizedFundingTime),
    nextFundingTime: row.nextFundingTime === null ? null : fromUtcTimestamp(row.nextFundingTime),
    nextFundingTimeObservedAt:
      row.nextFundingTimeObservedAt === null
        ? null
        : fromUtcTimestamp(row.nextFundingTimeObservedAt),
    updatedAt: fromUtcTimestamp(row.updatedAt),
  };
}

function fromPersistedAccountSettlement(row: {
  id: string;
  paperAccountId: string;
  fundingTime: Date | string;
  totalFundingPayment: string;
  userWalletDelta: string;
  insuranceAbsorption: string;
  createdAt: Date | string;
}): PerpFundingAccountSettlement {
  return {
    id: row.id,
    paperAccountId: row.paperAccountId,
    fundingTime: fromUtcTimestamp(row.fundingTime),
    totalFundingPayment: persistDecimal(row.totalFundingPayment),
    userWalletDelta: persistDecimal(row.userWalletDelta),
    insuranceAbsorption: persistDecimal(row.insuranceAbsorption),
    createdAt: fromUtcTimestamp(row.createdAt),
  };
}

function fromPersistedPositionSettlement(row: {
  id: string;
  fundingCycleId: string;
  paperAccountId: string;
  positionId: string;
  fundingAccountSettlementId: string;
  marginMode: string;
  quantity: string;
  fundingPayment: string;
  isolatedMarginBefore: string | null;
  isolatedMarginAfter: string | null;
  createdAt: Date | string;
}): PerpFundingSettlement {
  if (row.marginMode !== "CROSS" && row.marginMode !== "ISOLATED") {
    throw new Error(`invalid perp_funding_settlement.margin_mode: ${row.marginMode}`);
  }

  return {
    id: row.id,
    fundingCycleId: row.fundingCycleId,
    paperAccountId: row.paperAccountId,
    positionId: row.positionId,
    fundingAccountSettlementId: row.fundingAccountSettlementId,
    marginMode: row.marginMode,
    quantity: persistDecimal(row.quantity),
    fundingPayment: persistDecimal(row.fundingPayment),
    isolatedMarginBefore:
      row.isolatedMarginBefore === null ? null : persistDecimal(row.isolatedMarginBefore),
    isolatedMarginAfter:
      row.isolatedMarginAfter === null ? null : persistDecimal(row.isolatedMarginAfter),
    createdAt: fromUtcTimestamp(row.createdAt),
  };
}

function persistDecimal(value: string): string {
  return toDbDecimal(fromDbDecimal(value));
}
