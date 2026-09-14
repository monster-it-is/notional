import { describe, expect, it } from "vitest";

import { quantizeToNumeric3818 } from "./decimal.js";
import {
  calculateAvailableBalance,
  calculateCrossCollateral,
  calculateInitialMargin,
  calculateIsolatedEquity,
  calculateMaintenanceMargin,
  calculatePersistedIsolatedMargin,
  calculateRequiredIsolatedMargin,
  DEFAULT_LEVERAGE,
  DEFAULT_MARGIN_MODE,
  isMaintenanceBreached,
  MAINTENANCE_MARGIN_RATE,
  MAX_LEVERAGE,
  MIN_LEVERAGE,
} from "./margin.js";
import { expectTradingCode, fractionalDigitCount } from "./test-helpers.js";

describe("leverage product constants", () => {
  it("locks a product-wide 1..100 range with CROSS 1x defaults", () => {
    expect(MIN_LEVERAGE).toBe(1);
    expect(MAX_LEVERAGE).toBe(100);
    expect(DEFAULT_LEVERAGE).toBe(1);
    expect(DEFAULT_MARGIN_MODE).toBe("CROSS");
    expect(MAINTENANCE_MARGIN_RATE).toBe("0.005");
  });
});

describe("calculateInitialMargin", () => {
  it("divides notional by positive integer leverage", () => {
    expect(calculateInitialMargin({ notional: "1000", leverage: "10" })).toBe("100");
    expect(calculateInitialMargin({ notional: "0", leverage: "20" })).toBe("0");
    expect(calculateInitialMargin({ notional: "1000", leverage: "1" })).toBe("1000");
    expect(calculateInitialMargin({ notional: "1000", leverage: "100" })).toBe("10");
    const repeating = calculateInitialMargin({ notional: "100", leverage: "3" });
    expect(repeating.startsWith("33.3")).toBe(true);
    expect(repeating.includes("e")).toBe(false);
    expect(repeating.split(".")[1]!.length).toBeGreaterThan(18);
  });

  it("accepts leverage above the product cap as a pure primitive", () => {
    expect(calculateInitialMargin({ notional: "1250", leverage: "125" })).toBe("10");
  });

  it("rejects non-positive, fractional, and malformed leverage", () => {
    expectTradingCode(
      () => calculateInitialMargin({ notional: "100", leverage: "0" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateInitialMargin({ notional: "100", leverage: "20.5" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateInitialMargin({ notional: "100", leverage: "20.0" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateInitialMargin({ notional: "100", leverage: "-2" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateInitialMargin({ notional: "-1", leverage: "2" }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("calculateMaintenanceMargin", () => {
  it("multiplies notional by a positive rate less than 1", () => {
    expect(
      calculateMaintenanceMargin({ notional: "1000", maintenanceMarginRate: "0.05" }),
    ).toBe("50");
    expect(
      calculateMaintenanceMargin({ notional: "0", maintenanceMarginRate: "0.5" }),
    ).toBe("0");
    expect(
      calculateMaintenanceMargin({
        notional: "1000",
        maintenanceMarginRate: MAINTENANCE_MARGIN_RATE,
      }),
    ).toBe("5");
  });

  it("rejects zero, negative, and rate >= 1", () => {
    expectTradingCode(
      () => calculateMaintenanceMargin({ notional: "100", maintenanceMarginRate: "0" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateMaintenanceMargin({ notional: "100", maintenanceMarginRate: "-0.01" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateMaintenanceMargin({ notional: "100", maintenanceMarginRate: "1" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateMaintenanceMargin({ notional: "100", maintenanceMarginRate: "1.5" }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("calculateCrossCollateral", () => {
  it("is wallet minus isolated reserve plus signed cross UPNL", () => {
    expect(
      calculateCrossCollateral({
        walletBalance: "1000",
        isolatedReservedMargin: "200",
        crossUnrealizedPnl: "50",
      }),
    ).toBe("850");
    expect(
      calculateCrossCollateral({
        walletBalance: "1000",
        isolatedReservedMargin: "200",
        crossUnrealizedPnl: "-50",
      }),
    ).toBe("750");
    expect(
      calculateCrossCollateral({
        walletBalance: "100",
        isolatedReservedMargin: "0",
        crossUnrealizedPnl: "-150",
      }),
    ).toBe("-50");
  });
});

describe("calculateAvailableBalance", () => {
  it("subtracts cross initial margin and open-order reserve without clamping", () => {
    expect(
      calculateAvailableBalance({
        crossCollateral: "850",
        crossInitialMargin: "100",
        openOrderReservedMargin: "50",
      }),
    ).toBe("700");
    expect(
      calculateAvailableBalance({
        crossCollateral: "100",
        crossInitialMargin: "100",
        openOrderReservedMargin: "0",
      }),
    ).toBe("0");
    expect(
      calculateAvailableBalance({
        crossCollateral: "100",
        crossInitialMargin: "80",
        openOrderReservedMargin: "40",
      }),
    ).toBe("-20");
  });
});

describe("calculateIsolatedEquity", () => {
  it("adds isolated margin and signed UPNL without clamping", () => {
    expect(
      calculateIsolatedEquity({ isolatedMargin: "100", unrealizedPnl: "25" }),
    ).toBe("125");
    expect(
      calculateIsolatedEquity({ isolatedMargin: "100", unrealizedPnl: "-25" }),
    ).toBe("75");
    expect(
      calculateIsolatedEquity({ isolatedMargin: "100", unrealizedPnl: "-150" }),
    ).toBe("-50");
  });
});

describe("calculateRequiredIsolatedMargin", () => {
  it("returns 0 for a canonical flat position", () => {
    expect(
      calculateRequiredIsolatedMargin({
        positionQty: "0",
        entryPrice: null,
        leverage: "10",
      }),
    ).toBe("0");
  });

  it("uses abs(qty) times entry divided by leverage", () => {
    expect(
      calculateRequiredIsolatedMargin({
        positionQty: "2",
        entryPrice: "100",
        leverage: "10",
      }),
    ).toBe("20");
    expect(
      calculateRequiredIsolatedMargin({
        positionQty: "-2",
        entryPrice: "100",
        leverage: "10",
      }),
    ).toBe("20");
  });

  it("keeps repeating division exact and persists isolated collateral ROUND_UP", () => {
    const exact = calculateRequiredIsolatedMargin({
      positionQty: "1",
      entryPrice: "100",
      leverage: "3",
    });
    expect(exact.startsWith("33.3")).toBe(true);
    expect(exact.includes("e")).toBe(false);
    expect(fractionalDigitCount(exact)).toBeGreaterThan(18);
    expect(quantizeToNumeric3818(exact)).toBe("33.333333333333333333");
    expect(calculatePersistedIsolatedMargin({
      positionQty: "1",
      entryPrice: "100",
      leverage: "3",
    })).toBe("33.333333333333333334");
    expect(
      calculatePersistedIsolatedMargin({
        positionQty: "0",
        entryPrice: null,
        leverage: "10",
      }),
    ).toBe("0");
  });

  it("isMaintenanceBreached includes equality", () => {
    expect(isMaintenanceBreached({ equity: "10", maintenanceMargin: "9" })).toBe(false);
    expect(isMaintenanceBreached({ equity: "10", maintenanceMargin: "10" })).toBe(true);
    expect(isMaintenanceBreached({ equity: "9", maintenanceMargin: "10" })).toBe(true);
    expect(isMaintenanceBreached({ equity: "-1", maintenanceMargin: "0" })).toBe(true);
  });

  it("rejects a non-flat shape without entry and invalid leverage", () => {
    expectTradingCode(
      () =>
        calculateRequiredIsolatedMargin({
          positionQty: "1",
          entryPrice: null,
          leverage: "10",
        }),
      "INVARIANT_VIOLATION",
    );
    expectTradingCode(
      () =>
        calculateRequiredIsolatedMargin({
          positionQty: "1",
          entryPrice: "100",
          leverage: "0",
        }),
      "INVALID_ARGUMENT",
    );
  });
});
