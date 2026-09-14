import type { FinancialTransaction, Order } from "@notional/db";
import {
  db,
  ensurePosition,
  findInstrumentBySymbol,
  listOpenLimitOrdersByInstrumentId,
  lockInstrumentByIdForTrading,
  lockOrderById,
  lockPaperAccountById,
  lockPositionByAccountAndInstrument,
} from "@notional/db";
import {
  classifyPositionTransition,
  getLimitExecutionPrice,
  isLimitMarketable,
} from "@notional/trading";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import { silentLogger, type Logger } from "../market-data/types.js";
import { reduceOnlyAllows } from "../orders/validate-order.js";
import { completeMatcherFillInTx, OrderPlacementError } from "./order-placement.js";

const MATCHER_RETRY_CODES = new Set(["INSUFFICIENT_MARGIN", "MARKET_DATA_UNAVAILABLE"]);

export type LimitOrderMatcher = {
  schedule(symbol: string): void;
  waitForIdle(): Promise<void>;
  processSymbol(symbol: string): Promise<void>;
};

export function createLimitOrderMatcher(options: {
  marketData: MarketDataAccess;
  logger?: Logger;
}): LimitOrderMatcher {
  const logger = options.logger ?? silentLogger;
  const inFlight = new Set<string>();
  const dirty = new Set<string>();
  const running = new Map<string, Promise<void>>();

  async function runCycle(symbol: string): Promise<void> {
    const candidates = await loadCandidates(symbol);

    for (const candidate of candidates) {
      try {
        await db.transaction((tx) => matchCandidateInTx(tx, candidate, options.marketData));
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

    if (dirty.delete(symbol)) {
      await runCycle(symbol);
    }
  }

  function schedule(symbol: string): void {
    if (inFlight.has(symbol)) {
      dirty.add(symbol);
      return;
    }

    inFlight.add(symbol);
    const done = processSymbol(symbol)
      .catch((error: unknown) => {
        logger.error("limit matcher cycle failed", {
          symbol,
          detail: error instanceof Error ? error.message : "limit matcher cycle failed",
        });
      })
      .finally(() => {
        inFlight.delete(symbol);
        running.delete(symbol);

        if (dirty.delete(symbol)) {
          schedule(symbol);
        }
      });
    running.set(symbol, done);
  }

  async function waitForIdle(): Promise<void> {
    while (inFlight.size > 0 || dirty.size > 0 || running.size > 0) {
      await Promise.all([...running.values()]);
    }
  }

  return { schedule, waitForIdle, processSymbol };
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
): Promise<void> {
  const account = await lockPaperAccountById(tx, candidate.order.paperAccountId);
  const instrument = await lockInstrumentByIdForTrading(tx, candidate.order.instrumentId);

  if (!instrument || instrument.status !== "ACTIVE") {
    return;
  }

  await ensurePosition(tx, account.id, instrument.id);
  const position = await lockPositionByAccountAndInstrument(tx, account.id, instrument.id);
  const locked = await lockOrderById(tx, account.id, candidate.order.id);

  if (!locked || locked.status !== "OPEN" || locked.orderType !== "LIMIT") {
    return;
  }

  if (position.marginMode !== "CROSS") {
    return;
  }

  const book = marketData.getFreshBook(instrument.symbol);

  if (book === null) {
    return;
  }

  if (locked.limitPrice === null) {
    return;
  }

  if (
    !isLimitMarketable({
      side: locked.side as "BUY" | "SELL",
      limitPrice: locked.limitPrice,
      bestBidPrice: book.bestBidPrice,
      bestAskPrice: book.bestAskPrice,
    })
  ) {
    return;
  }

  const executionPrice = getLimitExecutionPrice({
    side: locked.side as "BUY" | "SELL",
    limitPrice: locked.limitPrice,
    bestBidPrice: book.bestBidPrice,
    bestAskPrice: book.bestAskPrice,
  });

  if (executionPrice === null) {
    return;
  }

  if (locked.reduceOnly) {
    const transition = classifyPositionTransition({
      currentQty: position.quantity,
      fillSide: locked.side as "BUY" | "SELL",
      fillQty: locked.quantity,
    });

    if (!reduceOnlyAllows(transition)) {
      return;
    }
  }

  await completeMatcherFillInTx(tx, {
    account,
    position,
    order: locked,
    executionPrice,
    marketData,
  });
}
