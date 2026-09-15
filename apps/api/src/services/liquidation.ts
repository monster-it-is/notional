import type { FinancialTransaction, PositionWithSymbol } from "@notional/db";
import {
  cancelOpenLimitOrder,
  createLiquidationEvent,
  db,
  findInstrumentById,
  fromDbDecimal,
  insertLiquidationFilledOrderWithExecution,
  listOpenCrossModeLimitOrdersByPaperAccountId,
  listOpenLimitOrdersByAccountAndInstrument,
  listOpenPositionsByPaperAccountId,
  lockPaperAccountById,
  sumIsolatedMarginByPaperAccountId,
  toDbDecimal,
} from "@notional/db";
import {
  getMarketExecutionPrice,
  isDecimalGte,
  sumDecimalValues,
} from "@notional/trading";

import type { MarketDataAccess } from "../market-data/coordinator.js";
import { silentLogger, type Logger } from "../market-data/types.js";
import { isolatedReduceSettlementProtection } from "./isolated-fill.js";
import {
  FundingDataUnavailableError,
  settleDueFundingForAccountInTx,
} from "./funding-settlement.js";
import {
  calculateCrossLiquidationRisk,
  calculateIsolatedLiquidationRisk,
  snapshotLiquidationRisk,
} from "./liquidation-risk.js";
import { applyCreatedExecutionToPosition } from "./position-application.js";
import {
  liquidationRealizedLedgerIdempotencyKey,
  settleCreatedFillRealizedPnlInTx,
  settleRealizedPnlInTx,
} from "./realized-settlement.js";

export type LiquidationResult =
  | {
      kind: "noop";
      reason: "safe" | "stale_mark" | "stale_bbo" | "flat" | "funding_data_unavailable";
    }
  | { kind: "liquidated"; eventId: string };

export async function liquidateIsolatedPosition(params: {
  paperAccountId: string;
  instrumentId: string;
  marketData: MarketDataAccess;
  logger?: Logger;
}): Promise<LiquidationResult> {
  return db.transaction((tx) => liquidateIsolatedPositionInTx(tx, params));
}

export async function liquidateCrossAccount(params: {
  paperAccountId: string;
  marketData: MarketDataAccess;
  logger?: Logger;
}): Promise<LiquidationResult> {
  return db.transaction((tx) => liquidateCrossAccountInTx(tx, params));
}

async function liquidateIsolatedPositionInTx(
  tx: FinancialTransaction,
  params: {
    paperAccountId: string;
    instrumentId: string;
    marketData: MarketDataAccess;
    logger?: Logger;
  },
): Promise<LiquidationResult> {
  const logger = params.logger ?? silentLogger;
  const lockedAccount = await lockPaperAccountById(tx, params.paperAccountId);
  let barrier;
  try {
    barrier = await settleDueFundingForAccountInTx(tx, {
      accountId: lockedAccount.id,
      extraInstrumentIds: [params.instrumentId],
    });
  } catch (error) {
    if (error instanceof FundingDataUnavailableError) {
      return { kind: "noop", reason: "funding_data_unavailable" };
    }
    throw error;
  }

  const position = barrier.positions.find((row) => row.instrumentId === params.instrumentId);
  const instrument = await findInstrumentById(tx, params.instrumentId);

  if (!instrument || !position) {
    return { kind: "noop", reason: "flat" };
  }

  const account = barrier.account;

  if (position.marginMode !== "ISOLATED" || fromDbDecimal(position.quantity).isZero()) {
    return { kind: "noop", reason: "flat" };
  }

  const mark = params.marketData.getFreshMark(instrument.symbol);
  if (mark === null) {
    logger.warn("isolated liquidation skipped: stale mark", { symbol: instrument.symbol });
    return { kind: "noop", reason: "stale_mark" };
  }

  const risk = calculateIsolatedLiquidationRisk({
    isolatedMargin: position.isolatedMargin,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    markPrice: mark.markPrice,
  });

  if (!risk.breached) {
    return { kind: "noop", reason: "safe" };
  }

  const book = params.marketData.getFreshBook(instrument.symbol);
  if (book === null) {
    logger.warn("isolated liquidation skipped: stale BBO", { symbol: instrument.symbol });
    return { kind: "noop", reason: "stale_bbo" };
  }

  const event = await createLiquidationEvent(tx, {
    paperAccountId: account.id,
    marginMode: "ISOLATED",
    instrumentId: instrument.id,
    equity: snapshotLiquidationRisk(risk.equity),
    maintenanceMargin: snapshotLiquidationRisk(risk.maintenanceMargin),
  });

  await cancelOpenOrders(tx, account.id, await listOpenLimitOrdersByAccountAndInstrument(
    tx,
    account.id,
    instrument.id,
  ));

  const fill = await insertLiquidationFilledOrderWithExecution(tx, {
    paperAccountId: account.id,
    instrumentId: instrument.id,
    positionId: position.id,
    liquidationEventId: event.id,
    side: liquidationSide(position.quantity),
    quantity: absQuantity(position.quantity),
    executionPrice: getMarketExecutionPrice({
      side: liquidationSide(position.quantity),
      bestBidPrice: book.bestBidPrice,
      bestAskPrice: book.bestAskPrice,
    }),
  });

  const applied = await applyCreatedExecutionToPosition(tx, {
    position,
    fill,
    financialNow: barrier.financialNow,
  });
  await settleCreatedFillRealizedPnlInTx(tx, {
    paperAccountId: account.id,
    walletBalance: account.balance,
    executionId: fill.execution.id,
    realizedPnlDelta: applied.realizedPnlDelta,
    protectedBalance: isolatedReduceSettlementProtection({
      walletBalance: account.balance,
      currentIsolatedMargin: applied.previousIsolatedMargin,
      nextIsolatedMargin: applied.nextIsolatedMargin,
    }).protectedBalance,
  });

  return { kind: "liquidated", eventId: event.id };
}

async function liquidateCrossAccountInTx(
  tx: FinancialTransaction,
  params: {
    paperAccountId: string;
    marketData: MarketDataAccess;
    logger?: Logger;
  },
): Promise<LiquidationResult> {
  const logger = params.logger ?? silentLogger;
  const lockedAccount = await lockPaperAccountById(tx, params.paperAccountId);
  const openPositions = await listOpenPositionsByPaperAccountId(tx, lockedAccount.id);
  const crossOpenOrders = await listOpenCrossModeLimitOrdersByPaperAccountId(tx, lockedAccount.id);
  const instrumentIds = [
    ...new Set([
      ...openPositions.filter((row) => row.marginMode === "CROSS").map((row) => row.instrumentId),
      ...crossOpenOrders.map((row) => row.instrumentId),
    ]),
  ];

  let barrier;
  try {
    barrier = await settleDueFundingForAccountInTx(tx, {
      accountId: lockedAccount.id,
      extraInstrumentIds: instrumentIds,
    });
  } catch (error) {
    if (error instanceof FundingDataUnavailableError) {
      return { kind: "noop", reason: "funding_data_unavailable" };
    }
    throw error;
  }

  const account = barrier.account;
  const lockedPositions = await listOpenPositionsByPaperAccountId(tx, account.id);
  const crossPositions = lockedPositions.filter((row) => row.marginMode === "CROSS");

  if (crossPositions.length === 0) {
    return { kind: "noop", reason: "flat" };
  }

  const marks: Array<PositionWithSymbol & { markPrice: string }> = [];
  for (const position of crossPositions) {
    const mark = params.marketData.getFreshMark(position.symbol);
    if (mark === null) {
      logger.warn("cross liquidation skipped: stale mark", { symbol: position.symbol });
      return { kind: "noop", reason: "stale_mark" };
    }

    marks.push({ ...position, markPrice: mark.markPrice });
  }

  const isolatedReservedMargin = await sumIsolatedMarginByPaperAccountId(tx, account.id);
  if (!isDecimalGte(account.balance, isolatedReservedMargin)) {
    throw new Error("isolated reserved margin exceeds walletBalance");
  }

  const risk = calculateCrossLiquidationRisk({
    walletBalance: account.balance,
    isolatedReservedMargin,
    positions: marks,
  });

  if (!risk.breached) {
    return { kind: "noop", reason: "safe" };
  }

  const books = new Map<string, { bestBidPrice: string; bestAskPrice: string }>();
  for (const position of crossPositions) {
    const book = params.marketData.getFreshBook(position.symbol);
    if (book === null) {
      logger.warn("cross liquidation skipped: stale BBO", { symbol: position.symbol });
      return { kind: "noop", reason: "stale_bbo" };
    }

    books.set(position.instrumentId, {
      bestBidPrice: book.bestBidPrice,
      bestAskPrice: book.bestAskPrice,
    });
  }

  const event = await createLiquidationEvent(tx, {
    paperAccountId: account.id,
    marginMode: "CROSS",
    instrumentId: null,
    equity: snapshotLiquidationRisk(risk.equity),
    maintenanceMargin: snapshotLiquidationRisk(risk.maintenanceMargin),
  });

  const lockedCrossOrders = await listOpenCrossModeLimitOrdersByPaperAccountId(tx, account.id);
  await cancelOpenOrders(tx, account.id, lockedCrossOrders);

  const deltas: string[] = [];
  const ordered = [...crossPositions].sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0,
  );

  for (const position of ordered) {
    const book = books.get(position.instrumentId);
    if (!book) {
      throw new Error("missing locked BBO during CROSS liquidation");
    }

    const side = liquidationSide(position.quantity);
    const fill = await insertLiquidationFilledOrderWithExecution(tx, {
      paperAccountId: account.id,
      instrumentId: position.instrumentId,
      positionId: position.id,
      liquidationEventId: event.id,
      side,
      quantity: absQuantity(position.quantity),
      executionPrice: getMarketExecutionPrice({
        side,
        bestBidPrice: book.bestBidPrice,
        bestAskPrice: book.bestAskPrice,
      }),
    });
    const applied = await applyCreatedExecutionToPosition(tx, {
      position,
      fill,
      financialNow: barrier.financialNow,
    });
    deltas.push(applied.realizedPnlDelta);
  }

  const aggregateRealizedPnlDelta = sumDecimalValues(deltas);
  await settleRealizedPnlInTx(tx, {
    paperAccountId: account.id,
    walletBalance: account.balance,
    realizedPnlDelta: aggregateRealizedPnlDelta,
    protectedBalance: isolatedReservedMargin,
    idempotencyKey: liquidationRealizedLedgerIdempotencyKey(event.id),
  });

  return { kind: "liquidated", eventId: event.id };
}

async function cancelOpenOrders(
  tx: FinancialTransaction,
  paperAccountId: string,
  orders: Array<{ id: string }>,
): Promise<void> {
  const ordered = [...orders].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (const order of ordered) {
    await cancelOpenLimitOrder(tx, paperAccountId, order.id);
  }
}

function liquidationSide(quantity: string): "BUY" | "SELL" {
  return fromDbDecimal(quantity).isPositive() ? "SELL" : "BUY";
}

function absQuantity(quantity: string): string {
  return toDbDecimal(fromDbDecimal(quantity).abs());
}
