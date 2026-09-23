import type { FinancialTransaction, Order } from "@notional/db";
import {
  db,
  findInstrumentBySymbol,
  listOpenLimitOrdersByInstrumentId,
  lockOrderById,
  lockPaperAccountById,
} from "@notional/db";
import {
  classifyPositionTransition,
  getLimitExecutionPrice,
  isLimitMarketable,
} from "@notional/trading";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import { silentLogger, type Logger } from "../market-data/types.js";
import { unknownErrorDiagnostic } from "../logging.js";
import { reduceOnlyAllows } from "../orders/validate-order.js";
import { ISOLATED_TRADING_ENABLED } from "./isolated-trading.js";
import { completeMatcherFillInTx, OrderPlacementError } from "./order-placement.js";
import { FundingDataUnavailableError, settleDueFundingForAccountInTx } from "./funding-settlement.js";
import { matcherEffect, safeOnPrivateCommitted, type CommittedPrivateEffect } from "../realtime/effects.js";
import {
  createSymbolCycleScheduler,
  resolvePositiveInteger,
} from "./symbol-cycle-scheduler.js";

const MATCHER_RETRY_CODES = new Set([
  "INSUFFICIENT_MARGIN",
  "MARKET_DATA_UNAVAILABLE",
  "FUNDING_DATA_UNAVAILABLE",
]);

export const DEFAULT_MAX_CONCURRENT_SYMBOL_CYCLES = 4;

export type LimitOrderMatcher = {
  schedule(symbol: string): void;
  stop(): void;
  waitForIdle(): Promise<void>;
  processSymbol(symbol: string): Promise<void>;
};

export type MatchCandidateResult = {
  paperAccountId: string;
  filled: boolean;
  settledFunding: boolean;
};

export function createLimitOrderMatcher(options: {
  marketData: MarketDataAccess;
  logger?: Logger;
  onPrivateCommitted?: (effect: CommittedPrivateEffect) => void;
  maxConcurrentSymbols?: number;
}): LimitOrderMatcher {
  const logger = options.logger ?? silentLogger;
  const maxConcurrentSymbols = resolvePositiveInteger(
    options.maxConcurrentSymbols ?? DEFAULT_MAX_CONCURRENT_SYMBOL_CYCLES,
    "maxConcurrentSymbols",
  );

  async function runCycle(symbol: string): Promise<void> {
    const candidates = await loadCandidates(symbol);

    for (const candidate of candidates) {
      try {
        const result = await db.transaction((tx) =>
          matchCandidateInTx(tx, candidate, options.marketData),
        );
        safeOnPrivateCommitted(
          options.onPrivateCommitted,
          matcherEffect(result),
          logger,
        );
      } catch (error) {
        if (
          error instanceof OrderPlacementError &&
          MATCHER_RETRY_CODES.has(error.code)
        ) {
          continue;
        }

        throw error;
      }
    }
  }

  async function processSymbol(symbol: string): Promise<void> {
    await runCycle(symbol);
  }

  const scheduler = createSymbolCycleScheduler({
    maxConcurrent: maxConcurrentSymbols,
    run: processSymbol,
    onError(symbol, error) {
      logger.error("limit matcher cycle failed", {
        symbol,
        ...unknownErrorDiagnostic(error),
      });
    },
  });

  return {
    schedule: scheduler.schedule,
    stop: scheduler.stop,
    waitForIdle: scheduler.waitForIdle,
    processSymbol,
  };
}

async function loadCandidates(symbol: string): Promise<{ order: Order; symbol: string }[]> {
  const instrument = await findInstrumentBySymbol(db, symbol);

  if (!instrument) {
    return [];
  }

  const orders = await listOpenLimitOrdersByInstrumentId(db, instrument.id);
  return orders.map((order) => ({ order, symbol }));
}

async function matchCandidateInTx(
  tx: FinancialTransaction,
  candidate: { order: Order; symbol: string },
  marketData: MarketDataAccess,
): Promise<MatchCandidateResult> {
  const lockedAccount = await lockPaperAccountById(tx, candidate.order.paperAccountId);
  let barrier;
  try {
    barrier = await settleDueFundingForAccountInTx(tx, {
      accountId: lockedAccount.id,
      extraInstrumentIds: [candidate.order.instrumentId],
    });
  } catch (error) {
    if (error instanceof FundingDataUnavailableError) {
      throw new OrderPlacementError("FUNDING_DATA_UNAVAILABLE");
    }
    throw error;
  }

  const settledFunding = barrier.settledBatches.length > 0;
  const none: MatchCandidateResult = {
    paperAccountId: lockedAccount.id,
    filled: false,
    settledFunding,
  };

  const position = barrier.positions.find((row) => row.instrumentId === candidate.order.instrumentId);

  if (!position) {
    return none;
  }

  const locked = await lockOrderById(tx, barrier.account.id, candidate.order.id);

  if (!locked || locked.status !== "OPEN" || locked.orderType !== "LIMIT") {
    return none;
  }

  const instrument = await findInstrumentBySymbol(tx, candidate.symbol);

  if (!instrument) {
    return none;
  }

  if (!ISOLATED_TRADING_ENABLED && position.marginMode !== "CROSS") {
    return none;
  }

  if (instrument.status !== "ACTIVE" && !locked.reduceOnly) {
    return none;
  }

  const transition = classifyPositionTransition({
    currentQty: position.quantity,
    fillSide: locked.side as "BUY" | "SELL",
    fillQty: locked.quantity,
  });

  if (position.marginMode === "ISOLATED" && transition === "REVERSE") {
    return none;
  }

  if (instrument.status !== "ACTIVE" && !reduceOnlyAllows(transition)) {
    return none;
  }

  const book = marketData.getFreshBook(instrument.symbol);

  if (book === null) {
    return none;
  }

  if (locked.limitPrice === null) {
    return none;
  }

  if (
    !isLimitMarketable({
      side: locked.side as "BUY" | "SELL",
      limitPrice: locked.limitPrice,
      bestBidPrice: book.bestBidPrice,
      bestAskPrice: book.bestAskPrice,
    })
  ) {
    return none;
  }

  const executionPrice = getLimitExecutionPrice({
    side: locked.side as "BUY" | "SELL",
    limitPrice: locked.limitPrice,
    bestBidPrice: book.bestBidPrice,
    bestAskPrice: book.bestAskPrice,
  });

  if (executionPrice === null) {
    return none;
  }

  if (locked.reduceOnly && !reduceOnlyAllows(transition)) {
    return none;
  }

  await completeMatcherFillInTx(tx, {
    account: barrier.account,
    position,
    order: locked,
    executionPrice,
    marketData,
    financialNow: barrier.financialNow,
  });

  return {
    paperAccountId: lockedAccount.id,
    filled: true,
    settledFunding,
  };
}
