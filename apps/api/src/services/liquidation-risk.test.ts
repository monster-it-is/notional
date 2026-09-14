import { describe, expect, it } from "vitest";

import {
  calculateCrossLiquidationRisk,
  calculateIsolatedLiquidationRisk,
  snapshotLiquidationRisk,
} from "./liquidation-risk.js";

describe("liquidation risk", () => {
  it("treats equity greater than maintenance as safe and equality as a breach", () => {
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "10",
        quantity: "1",
        entryPrice: "100",
        markPrice: "99",
      }).breached,
    ).toBe(false);
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "0.5",
        quantity: "1",
        entryPrice: "100",
        markPrice: "100",
      }),
    ).toEqual({
      equity: "0.5",
      maintenanceMargin: "0.5",
      breached: true,
    });
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "10",
        quantity: "1",
        entryPrice: "100",
        markPrice: "90",
      }).breached,
    ).toBe(true);
  });

  it("computes CROSS equity from wallet minus isolated reserve plus CROSS UPNL", () => {
    const profitable = calculateCrossLiquidationRisk({
      walletBalance: "1000",
      isolatedReservedMargin: "400",
      positions: [{ quantity: "1", entryPrice: "100", markPrice: "110" }],
    });
    expect(profitable.equity).toBe("610");
    expect(profitable.maintenanceMargin).toBe("0.55");
    expect(profitable.breached).toBe(false);

    const losing = calculateCrossLiquidationRisk({
      walletBalance: "1000",
      isolatedReservedMargin: "400",
      positions: [{ quantity: "1", entryPrice: "100", markPrice: "50" }],
    });
    expect(losing.equity).toBe("550");
    expect(losing.maintenanceMargin).toBe("0.25");
    expect(losing.breached).toBe(false);
  });

  it("aggregates CROSS maintenance across positions and ignores isolated UPNL", () => {
    const risk = calculateCrossLiquidationRisk({
      walletBalance: "1000",
      isolatedReservedMargin: "100",
      positions: [
        { quantity: "2", entryPrice: "100", markPrice: "100" },
        { quantity: "-1", entryPrice: "50", markPrice: "40" },
      ],
    });
    expect(risk.equity).toBe("910");
    expect(risk.maintenanceMargin).toBe("1.2");
    expect(risk.breached).toBe(false);
  });

  it("computes isolated long and short equity from isolated margin plus mark UPNL", () => {
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "10",
        quantity: "1",
        entryPrice: "100",
        markPrice: "110",
      }).equity,
    ).toBe("20");
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "10",
        quantity: "-1",
        entryPrice: "100",
        markPrice: "90",
      }).equity,
    ).toBe("20");
    expect(
      calculateIsolatedLiquidationRisk({
        isolatedMargin: "10",
        quantity: "-1",
        entryPrice: "100",
        markPrice: "110",
      }).equity,
    ).toBe("0");
  });

  it("quantizes liquidation snapshots HALF_EVEN to NUMERIC(38,18)", () => {
    expect(snapshotLiquidationRisk("1.2345678901234567894")).toBe("1.234567890123456789");
    expect(snapshotLiquidationRisk("1.2345678901234567895")).toBe("1.23456789012345679");
  });
});
