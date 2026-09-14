import type { Position } from "@notional/db";
import {
  calculateIsolatedReduceProtectedBalance,
  calculatePersistedIsolatedMargin,
} from "@notional/trading";

export function nextIsolatedMarginForFill(params: {
  marginMode: Position["marginMode"];
  quantity: string;
  entryPrice: string | null;
  leverage: number;
}): string {
  if (params.marginMode === "CROSS") {
    return "0";
  }

  return calculatePersistedIsolatedMargin({
    positionQty: params.quantity,
    entryPrice: params.entryPrice,
    leverage: String(params.leverage),
  });
}

export function isolatedReduceSettlementProtection(params: {
  walletBalance: string;
  currentIsolatedMargin: string;
  nextIsolatedMargin: string;
}): { lossCapacity: string; protectedBalance: string } {
  return calculateIsolatedReduceProtectedBalance(params);
}
