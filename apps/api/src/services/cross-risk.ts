import type { FinancialTransaction, PaperAccount } from "@notional/db";
import {
  listOpenPositionsByPaperAccountId,
  sumIsolatedMarginByPaperAccountId,
  sumOpenOrderReservedMarginByPaperAccountId,
} from "@notional/db";
import {
  calculateAvailableBalance,
  calculateCrossCollateral,
  calculateInitialMargin,
  calculateNotional,
  calculateUnrealizedPnl,
  sumDecimalValues,
} from "@notional/trading";

import type { MarketDataAccess } from "../market-data/coordinator.js";

export class CrossRiskError extends Error {
  readonly code: "MARKET_DATA_UNAVAILABLE";

  constructor() {
    super("MARKET_DATA_UNAVAILABLE");
    this.name = "CrossRiskError";
    this.code = "MARKET_DATA_UNAVAILABLE";
  }
}

export type CrossPortfolioRisk = {
  walletBalance: string;
  isolatedReservedMargin: string;
  crossUnrealizedPnl: string;
  crossInitialMargin: string;
  openOrderReservedMargin: string;
  crossCollateral: string;
  crossAvailableBalance: string;
};

export async function calculateCrossPortfolioRisk(
  tx: FinancialTransaction,
  params: {
    paperAccount: Pick<PaperAccount, "id" | "balance">;
    marketData: MarketDataAccess;
  },
): Promise<CrossPortfolioRisk> {
  const walletBalance = params.paperAccount.balance;
  const isolatedReservedMargin = await sumIsolatedMarginByPaperAccountId(
    tx,
    params.paperAccount.id,
  );
  const openOrderReservedMargin = await sumOpenOrderReservedMarginByPaperAccountId(
    tx,
    params.paperAccount.id,
  );
  const openPositions = await listOpenPositionsByPaperAccountId(tx, params.paperAccount.id);
  const crossPositions = openPositions.filter((position) => position.marginMode === "CROSS");

  const unrealized: string[] = [];
  const initialMargins: string[] = [];

  for (const position of crossPositions) {
    const mark = params.marketData.getFreshMark(position.symbol);

    if (mark === null) {
      throw new CrossRiskError();
    }

    unrealized.push(
      calculateUnrealizedPnl({
        positionQty: position.quantity,
        entryPrice: position.entryPrice,
        markPrice: mark.markPrice,
      }),
    );
    initialMargins.push(
      calculateInitialMargin({
        notional: calculateNotional({
          quantity: position.quantity,
          price: mark.markPrice,
        }),
        leverage: String(position.leverage),
      }),
    );
  }

  const crossUnrealizedPnl = sumDecimalValues(unrealized);
  const crossInitialMargin = sumDecimalValues(initialMargins);
  const crossCollateral = calculateCrossCollateral({
    walletBalance,
    isolatedReservedMargin,
    crossUnrealizedPnl,
  });
  const crossAvailableBalance = calculateAvailableBalance({
    crossCollateral,
    crossInitialMargin,
    openOrderReservedMargin,
  });

  return {
    walletBalance,
    isolatedReservedMargin,
    crossUnrealizedPnl,
    crossInitialMargin,
    openOrderReservedMargin,
    crossCollateral,
    crossAvailableBalance,
  };
}
