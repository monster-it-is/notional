import {
  db,
  ensurePerpFundingSourceState,
  sampleFinancialTransactionTime,
  upsertInstrumentBySymbol,
  type Instrument,
} from "@notional/db";
import type { LiveScheduleProof } from "@notional/trading";

import { setLiveScheduleProof } from "./funding-sync.js";

const TEST_FLOOR = "1970-01-01T00:00:00.000Z";
const LIVE_SCHEDULE_HORIZON_MS = 8 * 60 * 60 * 1000;

export async function getDatabaseNow(): Promise<Date> {
  return db.transaction((tx) => sampleFinancialTransactionTime(tx));
}

export function futureFundingTimeFrom(databaseNow: Date): Date {
  return new Date(databaseNow.getTime() + LIVE_SCHEDULE_HORIZON_MS);
}

export function liveScheduleProofFrom(params: {
  validFrom: Date | string;
  observedAt: Date | string;
  nextFundingTime: Date;
}): LiveScheduleProof {
  return {
    validFrom: toIso(params.validFrom),
    nextFundingTime: params.nextFundingTime.toISOString(),
    observedAt: toIso(params.observedAt),
  };
}

export async function openEndedTestProof(): Promise<LiveScheduleProof> {
  return liveScheduleProofFrom({
    validFrom: TEST_FLOOR,
    observedAt: TEST_FLOOR,
    nextFundingTime: futureFundingTimeFrom(await getDatabaseNow()),
  });
}

export async function seedExplicitFundingEvidence(
  instrumentId: string,
  proof?: LiveScheduleProof,
): Promise<void> {
  const resolved = proof ?? (await openEndedTestProof());
  await db.transaction((tx) =>
    ensurePerpFundingSourceState(tx, {
      instrumentId,
      activationFloorAt: new Date(resolved.validFrom),
    }),
  );
  setLiveScheduleProof(instrumentId, resolved);
}

export async function upsertInstrumentWithFundingEvidence(
  ...args: Parameters<typeof upsertInstrumentBySymbol>
): Promise<Instrument> {
  const row = await upsertInstrumentBySymbol(...args);
  await seedExplicitFundingEvidence(row.id);
  return row;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
