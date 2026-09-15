import {
  db,
  findPaperAccountById,
  listOpenPositionsForLiquidation,
  sumIsolatedMarginByPaperAccountId,
  type PositionWithSymbol,
} from "@notional/db";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import { silentLogger, type Logger, type Scheduler, systemScheduler } from "../market-data/types.js";
import { liquidateCrossAccount, liquidateIsolatedPosition } from "./liquidation.js";
import {
  calculateCrossLiquidationRisk,
  calculateIsolatedLiquidationRisk,
} from "./liquidation-risk.js";

export type LiquidationScanner = {
  requestScan(): void;
  start(): void;
  stop(): void;
  scanOnce(): Promise<void>;
};

export function createLiquidationScanner(options: {
  marketData: MarketDataAccess;
  intervalMs: number;
  logger?: Logger;
  scheduler?: Scheduler;
}): LiquidationScanner {
  const logger = options.logger ?? silentLogger;
  const scheduler = options.scheduler ?? systemScheduler;
  let inFlight = false;
  let dirty = false;
  let timer: ReturnType<Scheduler["setTimeout"]> | undefined;
  let stopped = true;

  async function runScan(): Promise<void> {
    const positions = await listOpenPositionsForLiquidation(db);
    const byAccount = new Map<string, PositionWithSymbol[]>();

    for (const position of positions) {
      const rows = byAccount.get(position.paperAccountId) ?? [];
      rows.push(position);
      byAccount.set(position.paperAccountId, rows);
    }

    for (const paperAccountId of [...byAccount.keys()].sort()) {
      try {
        await processAccount(paperAccountId, byAccount.get(paperAccountId) ?? [], options.marketData, logger);
      } catch (error) {
        logger.error("liquidation scanner account failed", {
          paperAccountId,
          detail: error instanceof Error ? error.message : "liquidation scanner account failed",
        });
      }
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
          logger.error("liquidation scanner cycle failed", {
            detail: error instanceof Error ? error.message : "liquidation scanner cycle failed",
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
    requestScan() {
      void scanOnce().catch((error: unknown) => {
        logger.error("liquidation scanner request failed", {
          detail: error instanceof Error ? error.message : "liquidation scanner request failed",
        });
      });
    },
  };
}

async function processAccount(
  paperAccountId: string,
  positions: PositionWithSymbol[],
  marketData: MarketDataAccess,
  logger: Logger,
): Promise<void> {
  const isolated = positions
    .filter((row) => row.marginMode === "ISOLATED")
    .sort((left, right) =>
      left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0,
    );

  for (const position of isolated) {
    const mark = marketData.getFreshMark(position.symbol);
    if (mark === null) {
      logger.warn("isolated liquidation precheck skipped: stale mark", {
        symbol: position.symbol,
      });
      continue;
    }

    const risk = calculateIsolatedLiquidationRisk({
      isolatedMargin: position.isolatedMargin,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: mark.markPrice,
    });

    if (!risk.breached) {
      continue;
    }

    await liquidateIsolatedPosition({
      paperAccountId,
      instrumentId: position.instrumentId,
      marketData,
      logger,
    });
  }

  const remaining = (await listOpenPositionsForLiquidation(db)).filter(
    (row) => row.paperAccountId === paperAccountId && row.marginMode === "CROSS",
  );

  if (remaining.length === 0) {
    return;
  }

  const marks = [];
  for (const position of remaining) {
    const mark = marketData.getFreshMark(position.symbol);
    if (mark === null) {
      logger.warn("cross liquidation precheck skipped: stale mark", { symbol: position.symbol });
      return;
    }

    marks.push({
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: mark.markPrice,
    });
  }

  const account = await findPaperAccountById(db, paperAccountId);

  if (!account) {
    return;
  }

  const isolatedReservedMargin = await sumIsolatedMarginByPaperAccountId(db, paperAccountId);
  const risk = calculateCrossLiquidationRisk({
    walletBalance: account.balance,
    isolatedReservedMargin,
    positions: marks,
  });

  if (!risk.breached) {
    return;
  }

  await liquidateCrossAccount({ paperAccountId, marketData, logger });
}
