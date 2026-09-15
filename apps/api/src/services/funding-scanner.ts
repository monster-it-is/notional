import {
  db,
  listAllInstruments,
  listUnpaidReadyFundingBatches,
  lockPaperAccountById,
} from "@notional/db";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import { silentLogger, type Logger, type Scheduler, systemScheduler } from "../market-data/types.js";
import { createFundingSync, type FundingRestClient } from "./funding-sync.js";
import { FundingDataUnavailableError, settleDueFundingForAccountInTx } from "./funding-settlement.js";
import { fundingSettledEffect, safeOnPrivateCommitted, type CommittedPrivateEffect } from "../realtime/effects.js";

export type FundingScanner = {
  start(): void;
  stop(): void;
  scanOnce(): Promise<void>;
};

export function createFundingScanner(options: {
  rest: FundingRestClient;
  marketData: MarketDataAccess;
  intervalMs: number;
  logger?: Logger;
  scheduler?: Scheduler;
  onSettled?: () => void;
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void;
}): FundingScanner {
  const logger = options.logger ?? silentLogger;
  const scheduler = options.scheduler ?? systemScheduler;
  const sync = createFundingSync({ rest: options.rest });
  let inFlight = false;
  let dirty = false;
  let timer: ReturnType<Scheduler["setTimeout"]> | undefined;
  let stopped = true;

  async function runScan(): Promise<void> {
    const instruments = await listAllInstruments(db);
    for (const row of instruments) {
      try {
        const nextFundingTime = options.marketData.getFreshMark(row.symbol)?.nextFundingTime ?? null;
        await sync.reconcileInstrument(row, nextFundingTime);
      } catch (error) {
        logger.error("funding scanner source failed", {
          symbol: row.symbol,
          detail: error instanceof Error ? error.message : "funding scanner source failed",
        });
      }
    }

    const batches = await listUnpaidReadyFundingBatches(db);
    let moved = false;

    for (const batch of batches) {
      try {
        const result = await db.transaction(async (tx) => {
          await lockPaperAccountById(tx, batch.paperAccountId);
          return settleDueFundingForAccountInTx(tx, {
            accountId: batch.paperAccountId,
            extraInstrumentIds: [],
            sampleNow: async () => batch.fundingTime,
          });
        });
        if (result.settledBatches.length > 0) {
          safeOnPrivateCommitted(
            options.onPrivateCommitted,
            fundingSettledEffect(batch.paperAccountId),
            logger,
          );
        }
        if (result.needsLiquidationRecheck || result.settledBatches.length > 0) {
          moved = moved || result.needsLiquidationRecheck;
        }
      } catch (error) {
        if (error instanceof FundingDataUnavailableError) {
          logger.warn("funding scanner account skipped: data unavailable", {
            paperAccountId: batch.paperAccountId,
          });
          continue;
        }

        logger.error("funding scanner account failed", {
          paperAccountId: batch.paperAccountId,
          detail: error instanceof Error ? error.message : "funding scanner account failed",
        });
      }
    }

    if (moved) {
      options.onSettled?.();
    }
  }

  async function scanOnce(): Promise<void> {
    if (inFlight) {
      dirty = true;
      return;
    }

    inFlight = true;
    try {
      do {
        dirty = false;
        await runScan();
      } while (dirty);
    } finally {
      inFlight = false;
    }
  }

  function schedule(): void {
    if (stopped) {
      return;
    }

    timer = scheduler.setTimeout(() => {
      void scanOnce()
        .catch((error: unknown) => {
          logger.error("funding scanner cycle failed", {
            detail: error instanceof Error ? error.message : "funding scanner cycle failed",
          });
        })
        .finally(() => {
          schedule();
        });
    }, options.intervalMs);
  }

  return {
    start() {
      if (!stopped) {
        return;
      }

      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) {
        scheduler.clearTimeout(timer);
        timer = undefined;
      }
    },
    scanOnce,
  };
}
