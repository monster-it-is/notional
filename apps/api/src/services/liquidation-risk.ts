import {
  calculateCrossCollateral,
  calculateIsolatedEquity,
  calculateMaintenanceMargin,
  calculateNotional,
  calculateUnrealizedPnl,
  isMaintenanceBreached,
  MAINTENANCE_MARGIN_RATE,
  quantizeToNumeric3818,
  sumDecimalValues,
} from "@notional/trading";

export type CrossLiquidationRisk = {
  equity: string;
  maintenanceMargin: string;
  breached: boolean;
};

export type IsolatedLiquidationRisk = {
  equity: string;
  maintenanceMargin: string;
  breached: boolean;
};

export function snapshotLiquidationRisk(value: string): string {
  return quantizeToNumeric3818(value);
}

export function calculateCrossLiquidationRisk(params: {
  walletBalance: string;
  isolatedReservedMargin: string;
  positions: Array<{
    quantity: string;
    entryPrice: string | null;
    markPrice: string;
  }>;
}): CrossLiquidationRisk {
  const unrealized = params.positions.map((position) =>
    calculateUnrealizedPnl({
      positionQty: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
    }),
  );
  const maintenance = params.positions.map((position) =>
    calculateMaintenanceMargin({
      notional: calculateNotional({
        quantity: position.quantity,
        price: position.markPrice,
      }),
      maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
    }),
  );
  const equity = calculateCrossCollateral({
    walletBalance: params.walletBalance,
    isolatedReservedMargin: params.isolatedReservedMargin,
    crossUnrealizedPnl: sumDecimalValues(unrealized),
  });
  const maintenanceMargin = sumDecimalValues(maintenance);
  return {
    equity,
    maintenanceMargin,
    breached: isMaintenanceBreached({ equity, maintenanceMargin }),
  };
}

export function calculateIsolatedLiquidationRisk(params: {
  isolatedMargin: string;
  quantity: string;
  entryPrice: string | null;
  markPrice: string;
}): IsolatedLiquidationRisk {
  const equity = calculateIsolatedEquity({
    isolatedMargin: params.isolatedMargin,
    unrealizedPnl: calculateUnrealizedPnl({
      positionQty: params.quantity,
      entryPrice: params.entryPrice,
      markPrice: params.markPrice,
    }),
  });
  const maintenanceMargin = calculateMaintenanceMargin({
    notional: calculateNotional({
      quantity: params.quantity,
      price: params.markPrice,
    }),
    maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
  });
  return {
    equity,
    maintenanceMargin,
    breached: isMaintenanceBreached({ equity, maintenanceMargin }),
  };
}
