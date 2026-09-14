import type { Execution, FinancialTransaction, Order, Position } from "@notional/db";
import { fromDbDecimal, updatePositionState } from "@notional/db";
import { applyFillToPosition, toPersistedFillState, type PositionTransition } from "@notional/trading";

import { nextIsolatedMarginForFill } from "./isolated-fill.js";

export type CreatedFilledResult = {
  kind: "created_filled";
  order: Order;
  execution: Execution;
};

export type ReplayedFilledResult = {
  kind: "replayed_filled";
  order: Order;
  execution: Execution;
};

export type FillResultWithExecution = CreatedFilledResult | ReplayedFilledResult;

export type AppliedPositionTransition = {
  kind: "applied";
  position: Position;
  transition: PositionTransition;
  realizedPnlDelta: string;
  previousQty: string;
  previousEntryPrice: string | null;
  previousIsolatedMargin: string;
  nextIsolatedMargin: string;
};

export type ReplayedPositionTransition = {
  kind: "replayed";
  position: Position;
};

export type PositionApplicationResult = AppliedPositionTransition | ReplayedPositionTransition;

export type PositionApplicationCode = "MISMATCHED_FILL" | "ORDER_NOT_FILLED";

export class PositionApplicationError extends Error {
  readonly code: PositionApplicationCode;

  constructor(code: PositionApplicationCode) {
    super(code);
    this.name = "PositionApplicationError";
    this.code = code;
  }
}

export async function applyPositionForFillResult(
  tx: FinancialTransaction,
  lockedPosition: Position,
  result: FillResultWithExecution,
): Promise<PositionApplicationResult> {
  if (result.kind === "replayed_filled") {
    return { kind: "replayed", position: lockedPosition };
  }

  return applyCreatedExecutionToPosition(tx, {
    position: lockedPosition,
    fill: result,
  });
}

export async function applyCreatedExecutionToPosition(
  tx: FinancialTransaction,
  input: {
    position: Position;
    fill: CreatedFilledResult;
  },
): Promise<AppliedPositionTransition> {
  const { position, fill } = input;
  const { order, execution } = fill;

  if (execution.orderId !== order.id) {
    throw new PositionApplicationError("MISMATCHED_FILL");
  }

  if (!fromDbDecimal(execution.quantity).eq(fromDbDecimal(order.quantity))) {
    throw new PositionApplicationError("MISMATCHED_FILL");
  }

  if (order.status !== "FILLED") {
    throw new PositionApplicationError("ORDER_NOT_FILLED");
  }

  if (position.paperAccountId !== order.paperAccountId) {
    throw new PositionApplicationError("MISMATCHED_FILL");
  }

  if (position.instrumentId !== order.instrumentId) {
    throw new PositionApplicationError("MISMATCHED_FILL");
  }

  if (order.side !== "BUY" && order.side !== "SELL") {
    throw new PositionApplicationError("MISMATCHED_FILL");
  }

  const fillState = toPersistedFillState(
    applyFillToPosition({
      currentQty: position.quantity,
      currentEntryPrice: position.entryPrice,
      fillSide: order.side,
      fillQty: execution.quantity,
      fillPrice: execution.price,
    }),
    position.realizedPnl,
  );

  const nextIsolatedMargin = nextIsolatedMarginForFill({
    marginMode: position.marginMode,
    quantity: fillState.quantity,
    entryPrice: fillState.entryPrice,
    leverage: position.leverage,
  });

  const next = await updatePositionState(tx, position.id, {
    quantity: fillState.quantity,
    entryPrice: fillState.entryPrice,
    realizedPnl: fillState.realizedPnl,
    isolatedMargin: nextIsolatedMargin,
  });

  return {
    kind: "applied",
    position: next,
    transition: fillState.transition,
    realizedPnlDelta: fillState.realizedPnlDelta,
    previousQty: fillState.previousQty,
    previousEntryPrice: fillState.previousEntryPrice,
    previousIsolatedMargin: position.isolatedMargin,
    nextIsolatedMargin,
  };
}
