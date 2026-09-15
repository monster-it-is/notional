import {
  db,
  advanceLastRealizedFundingTime,
  deletePredictedScheduledCycle,
  ensurePerpFundingSourceState,
  findSourceStateByInstrumentId,
  insertReadyFundingCycle,
  insertScheduledFundingCycle,
  listAllInstruments,
  listScheduledFundingCyclesBefore,
  minOpenFundingCursorAt,
  persistNextFundingTimeObservation,
  sampleFinancialTransactionTime,
  type Instrument,
} from "@notional/db";
import {
  expectedMarkCandleCloseTimeMs,
  type LiveScheduleProof,
} from "@notional/trading";

import {
  expectedMarkCandleOpenTimeMs,
  FundingSourceError,
  parseMarkPriceKlines,
  parseRealizedFundingRates,
  selectExactSettlementMark,
  type RealizedFundingRate,
} from "../market-data/funding-source.js";

export type FundingRestClient = {
  getFundingRate(query: {
    symbol: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown>;
  getMarkPriceKlines(query: {
    symbol: string;
    interval: "1m";
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<unknown>;
};

const HISTORY_LIMIT = 1000;
const liveProofs = new Map<string, LiveScheduleProof>();
const processContinuity = new Map<string, string>();
const activatedThisProcess = new Set<string>();

export function getLiveScheduleProof(instrumentId: string): LiveScheduleProof | null {
  return liveProofs.get(instrumentId) ?? null;
}

export function setLiveScheduleProof(
  instrumentId: string,
  proof: LiveScheduleProof | null,
): void {
  if (proof === null) {
    liveProofs.delete(instrumentId);
    return;
  }

  liveProofs.set(instrumentId, proof);
}

export function clearLiveScheduleProofs(): void {
  liveProofs.clear();
  processContinuity.clear();
  activatedThisProcess.clear();
}

export type FundingSync = {
  reconcileAll(): Promise<void>;
  reconcileInstrument(row: Instrument, nextFundingTimeMs?: number | null): Promise<void>;
  getLiveScheduleProof(instrumentId: string): LiveScheduleProof | null;
};

export function createFundingSync(options: { rest: FundingRestClient }): FundingSync {
  async function reconcileAll(): Promise<void> {
    const instruments = await listAllInstruments(db);
    for (const row of instruments) {
      await reconcileInstrument(row);
    }
  }

  async function reconcileInstrument(
    row: Instrument,
    nextFundingTimeMs?: number | null,
  ): Promise<void> {
    const initialized = await db.transaction(async (tx) => {
      const existing = await findSourceStateByInstrumentId(tx, row.id);
      if (existing) {
        return { state: existing, createdNow: false };
      }

      const minCursor = await minOpenFundingCursorAt(tx, row.id);
      if (minCursor) {
        return {
          state: await ensurePerpFundingSourceState(tx, {
            instrumentId: row.id,
            activationFloorAt: minCursor,
          }),
          createdNow: true,
        };
      }

      const activationFloorAt = await sampleFinancialTransactionTime(tx);
      return {
        state: await ensurePerpFundingSourceState(tx, {
          instrumentId: row.id,
          activationFloorAt,
        }),
        createdNow: true,
      };
    });

    if (initialized.createdNow) {
      activatedThisProcess.add(row.id);
    }

    const source = initialized.state;
    const proofBaseMs = (
      source.lastRealizedFundingTime ?? source.activationFloorAt
    ).getTime();
    const history = await fetchRealizedHistory(options.rest, row.symbol, proofBaseMs);
    let latestRealized: RealizedFundingRate | null = null;
    let historyGap = false;

    for (const event of history) {
      const prepared = await persistRealizedCycle(row, event, options.rest);
      if (!prepared) {
        historyGap = true;
        break;
      }

      latestRealized = event;
      processContinuity.set(row.id, new Date(event.fundingTimeMs).toISOString());
      await db.transaction((tx) =>
        advanceLastRealizedFundingTime(tx, row.id, new Date(event.fundingTimeMs)),
      );
    }

    if (nextFundingTimeMs === undefined || nextFundingTimeMs === null) {
      liveProofs.delete(row.id);
      activatedThisProcess.delete(row.id);
      if (latestRealized === null) {
        processContinuity.delete(row.id);
      }
    } else {
      const nextTime = new Date(nextFundingTimeMs);
      const current = await db.transaction((tx) => findSourceStateByInstrumentId(tx, row.id));
      let observed = current;
      if (
        current &&
        (current.nextFundingTime === null || current.nextFundingTime.getTime() !== nextFundingTimeMs)
      ) {
        observed = await db.transaction((tx) =>
          persistNextFundingTimeObservation(tx, row.id, nextTime),
        );
      }

      await db.transaction((tx) =>
        insertScheduledFundingCycle(tx, { instrumentId: row.id, fundingTime: nextTime }),
      );

      if (!historyGap) {
        if (
          !processContinuity.has(row.id) &&
          activatedThisProcess.has(row.id) &&
          latestRealized === null
        ) {
          processContinuity.set(row.id, source.activationFloorAt.toISOString());
        }

        const validFrom = processContinuity.get(row.id);
        const observedAt = observed?.nextFundingTimeObservedAt?.toISOString();
        if (validFrom && observedAt) {
          liveProofs.set(row.id, {
            validFrom,
            nextFundingTime: nextTime.toISOString(),
            observedAt,
          });
        }
      }
    }

    if (latestRealized && !historyGap) {
      await deleteObsoletePredicted({
        instrumentId: row.id,
        history,
        latestRealized,
        proofBaseMs,
        currentNextFundingTimeMs: nextFundingTimeMs ?? null,
      });
    }
  }

  return {
    reconcileAll,
    reconcileInstrument,
    getLiveScheduleProof,
  };
}

export function nextHistoryStartTime(proofBaseMs: number): number {
  if (!Number.isSafeInteger(proofBaseMs) || proofBaseMs < 0) {
    throw new FundingSourceError("funding proof base must be a safe non-negative integer");
  }

  const startTime = proofBaseMs + 1;
  if (!Number.isSafeInteger(startTime)) {
    throw new FundingSourceError("funding history startTime overflows a safe integer");
  }

  return startTime;
}

async function fetchRealizedHistory(
  rest: FundingRestClient,
  symbol: string,
  proofBaseMs: number,
): Promise<RealizedFundingRate[]> {
  const collected: RealizedFundingRate[] = [];
  let startTime = nextHistoryStartTime(proofBaseMs);
  let previousLast: number | null = null;

  while (true) {
    const payload = await rest.getFundingRate({
      symbol,
      startTime,
      limit: HISTORY_LIMIT,
    });
    const page = parseRealizedFundingRates(payload, symbol);
    assertPageProgress(page, startTime, previousLast);
    collected.push(...page);

    if (page.length < HISTORY_LIMIT) {
      break;
    }

    const last = page[page.length - 1];
    if (!last) {
      throw new FundingSourceError("fundingRate full page is empty");
    }

    previousLast = last.fundingTimeMs;
    startTime = nextHistoryStartTime(last.fundingTimeMs);
  }

  return collected;
}

function assertPageProgress(
  page: RealizedFundingRate[],
  startTime: number,
  previousLast: number | null,
): void {
  for (let index = 0; index < page.length; index += 1) {
    const row = page[index];
    if (!row) {
      throw new FundingSourceError("fundingRate page is missing a row");
    }

    const previous =
      index === 0 ? (previousLast === null ? startTime - 1 : previousLast) : page[index - 1]?.fundingTimeMs;

    if (previous === undefined || row.fundingTimeMs <= previous) {
      throw new FundingSourceError("fundingRate page is unordered or non-progressing");
    }
  }
}

async function persistRealizedCycle(
  row: Instrument,
  event: RealizedFundingRate,
  rest: FundingRestClient,
): Promise<boolean> {
  const fundingTime = new Date(event.fundingTimeMs);
  const mark = await fetchExactSettlementMark(rest, row.symbol, event.fundingTimeMs);

  if (mark === null) {
    await db.transaction((tx) =>
      insertScheduledFundingCycle(tx, { instrumentId: row.id, fundingTime }),
    );
    return false;
  }

  await db.transaction((tx) =>
    insertReadyFundingCycle(tx, {
      instrumentId: row.id,
      fundingTime,
      fundingRate: event.fundingRate,
      markPrice: mark,
    }),
  );
  return true;
}

async function fetchExactSettlementMark(
  rest: FundingRestClient,
  symbol: string,
  fundingTimeMs: number,
): Promise<string | null> {
  const closeTime = expectedMarkCandleCloseTimeMs(fundingTimeMs);
  const openTime = expectedMarkCandleOpenTimeMs(fundingTimeMs);
  const payload = await rest.getMarkPriceKlines({
    symbol,
    interval: "1m",
    startTime: openTime,
    endTime: closeTime,
    limit: 5,
  });
  return selectExactSettlementMark(parseMarkPriceKlines(payload), fundingTimeMs);
}

async function deleteObsoletePredicted(params: {
  instrumentId: string;
  history: RealizedFundingRate[];
  latestRealized: RealizedFundingRate;
  proofBaseMs: number;
  currentNextFundingTimeMs: number | null;
}): Promise<void> {
  const historyTimes = new Set(params.history.map((row) => row.fundingTimeMs));
  const scheduled = await db.transaction((tx) =>
    listScheduledFundingCyclesBefore(
      tx,
      params.instrumentId,
      new Date(params.latestRealized.fundingTimeMs),
    ),
  );

  for (const candidate of scheduled) {
    const predictedAt = candidate.fundingTime.getTime();
    if (predictedAt <= params.proofBaseMs) {
      continue;
    }
    if (historyTimes.has(predictedAt)) {
      continue;
    }
    if (params.currentNextFundingTimeMs === predictedAt) {
      continue;
    }
    if (candidate.status !== "SCHEDULED") {
      continue;
    }

    await db.transaction((tx) => deletePredictedScheduledCycle(tx, candidate.id));
  }
}
