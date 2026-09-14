import { describe, expect, it } from "vitest";

import * as trading from "./index.js";

describe("public package boundary", () => {
  it("exposes string-based domain functions and does not re-export Decimal internals", () => {
    expect(Object.hasOwn(trading, "TradingDecimal")).toBe(false);
    expect(Object.hasOwn(trading, "realizedPnlValue")).toBe(false);
    expect(typeof trading.calculateRealizedPnl).toBe("function");
    expect(typeof trading.calculateUnrealizedPnl).toBe("function");
    expect(typeof trading.applyFillToPosition).toBe("function");
    expect(typeof trading.toPersistedFillState).toBe("function");
    expect(typeof trading.addNumeric3818Exact).toBe("function");
    expect(typeof trading.classifyPositionTransition).toBe("function");
    expect(typeof trading.satisfiesMinNotional).toBe("function");
    expect(typeof trading.calculateInitialMargin).toBe("function");
    expect(typeof trading.calculateMaintenanceMargin).toBe("function");
    expect(typeof trading.calculateCrossCollateral).toBe("function");
    expect(typeof trading.calculateAvailableBalance).toBe("function");
    expect(typeof trading.calculateIsolatedEquity).toBe("function");
    expect(typeof trading.calculateRequiredIsolatedMargin).toBe("function");
    expect(typeof trading.calculatePersistedIsolatedMargin).toBe("function");
    expect(typeof trading.isMaintenanceBreached).toBe("function");
    expect(typeof trading.isDecimalLte).toBe("function");
    expect(typeof trading.calculateIsolatedReduceProtectedBalance).toBe("function");
    expect(trading.MIN_LEVERAGE).toBe(1);
    expect(trading.MAX_LEVERAGE).toBe(100);
    expect(trading.DEFAULT_LEVERAGE).toBe(1);
    expect(trading.DEFAULT_MARGIN_MODE).toBe("CROSS");
    expect(trading.MAINTENANCE_MARGIN_RATE).toBe("0.005");
    expect(typeof trading.assertFitsNumeric3818).toBe("function");
    expect(typeof trading.quantizeToNumeric3818).toBe("function");
    expect(typeof trading.quantizeCollateralRequirementToNumeric3818).toBe("function");
    expect(typeof trading.sumDecimalValues).toBe("function");
    expect(typeof trading.isDecimalGte).toBe("function");
    expect(typeof trading.calculateWalletRealizedSettlement).toBe("function");
    expect(typeof trading.TradingMathError).toBe("function");
    expect(typeof trading.getMarketExecutionPrice).toBe("function");
    expect(typeof trading.getLimitExecutionPrice).toBe("function");
    expect(typeof trading.isLimitMarketable).toBe("function");
  });
});
