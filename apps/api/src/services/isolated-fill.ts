import type { Position } from "@notional/db";
import {
  calculateIsolatedReduceProtectedBalance,
  calculateNextIsolatedCollateralAfterFill,
  isolatedIncreaseRequiresHealthyCollateral,
  type PositionTransition,
} from "@notional/trading";

export class IsolatedIncreaseBlockedError extends Error {
  readonly code = "INSUFFICIENT_MARGIN" as const;

  constructor() {
    super("INSUFFICIENT_MARGIN");
    this.name = "IsolatedIncreaseBlockedError";
  }
}

export function nextIsolatedMarginForFill(params: {
  marginMode: Position["marginMode"];
  currentQty: string;
  currentEntryPrice: string | null;
  currentIsolatedMargin: string;
  nextQty: string;
  nextEntryPrice: string | null;
  leverage: number;
  fillSide: "BUY" | "SELL";
  fillQty: string;
}): string {
  if (params.marginMode === "CROSS") {
    return "0";
  }

  return calculateNextIsolatedCollateralAfterFill({
    currentQty: params.currentQty,
    currentEntryPrice: params.currentEntryPrice,
    currentIsolatedMargin: params.currentIsolatedMargin,
    nextQty: params.nextQty,
    nextEntryPrice: params.nextEntryPrice,
    leverage: String(params.leverage),
    fillSide: params.fillSide,
    fillQty: params.fillQty,
  });
}

export function assertIsolatedIncreaseHealthy(params: {
  marginMode: Position["marginMode"];
  currentIsolatedMargin: string;
  currentQty: string;
  currentEntryPrice: string | null;
  leverage: number;
  transition: PositionTransition;
}): void {
  if (params.marginMode !== "ISOLATED") {
    return;
  }

  if (
    !isolatedIncreaseRequiresHealthyCollateral({
      currentIsolatedMargin: params.currentIsolatedMargin,
      currentQty: params.currentQty,
      currentEntryPrice: params.currentEntryPrice,
      leverage: String(params.leverage),
      transition: params.transition,
    })
  ) {
    throw new IsolatedIncreaseBlockedError();
  }
}

export function isolatedReduceSettlementProtection(params: {
  walletBalance: string;
  currentIsolatedMargin: string;
  nextIsolatedMargin: string;
}): { lossCapacity: string; protectedBalance: string } {
  return calculateIsolatedReduceProtectedBalance(params);
}
