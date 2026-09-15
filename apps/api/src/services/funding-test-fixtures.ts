import {
  db,
  ensurePerpFundingSourceState,
  upsertInstrumentBySymbol,
  type Instrument,
} from "@notional/db";
import type { LiveScheduleProof } from "@notional/trading";

import { setLiveScheduleProof } from "./funding-sync.js";

const TEST_FLOOR = "1970-01-01T00:00:00.000Z";
const TEST_NEXT = "2099-01-01T00:00:00.000Z";

export const OPEN_ENDED_TEST_PROOF: LiveScheduleProof = {
  validFrom: TEST_FLOOR,
  nextFundingTime: TEST_NEXT,
  observedAt: TEST_FLOOR,
};

export async function seedExplicitFundingEvidence(
  instrumentId: string,
  proof: LiveScheduleProof = OPEN_ENDED_TEST_PROOF,
): Promise<void> {
  await db.transaction((tx) =>
    ensurePerpFundingSourceState(tx, {
      instrumentId,
      activationFloorAt: new Date(proof.validFrom),
    }),
  );
  setLiveScheduleProof(instrumentId, proof);
}

export async function upsertInstrumentWithFundingEvidence(
  ...args: Parameters<typeof upsertInstrumentBySymbol>
): Promise<Instrument> {
  const row = await upsertInstrumentBySymbol(...args);
  await seedExplicitFundingEvidence(row.id);
  return row;
}
