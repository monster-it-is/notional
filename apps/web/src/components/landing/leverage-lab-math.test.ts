import { describe, expect, it } from "vitest";

import { estimateLeverageScenario } from "./leverage-lab-math.ts";

const base = {
  direction: "LONG" as const,
  margin: "1000",
  leverage: "10",
  movePercent: "1",
  entryPrice: "100000",
};

describe("estimateLeverageScenario", () => {
  it("scales a long 10x position by the market move", () => {
    const result = estimateLeverageScenario(base);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures).toMatchObject({
      notional: "10000",
      initialMargin: "1000",
      estimatedPnl: "100",
      roePercent: "10",
      equity: "1100",
      markPrice: "101000",
      maintenanceMargin: "50.5",
      maintenanceBreached: false,
    });
  });

  it("inverts PnL and ROE for a short", () => {
    const result = estimateLeverageScenario({ ...base, direction: "SHORT" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures.estimatedPnl).toBe("-100");
    expect(result.figures.roePercent).toBe("-10");
    expect(result.figures.equity).toBe("900");
    expect(result.figures.maintenanceBreached).toBe(false);
  });

  it("marks a large adverse move as a maintenance breach", () => {
    const result = estimateLeverageScenario({ ...base, movePercent: "-10" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures.estimatedPnl).toBe("-1000");
    expect(result.figures.roePercent).toBe("-100");
    expect(result.figures.equity).toBe("0");
    expect(result.figures.markPrice).toBe("90000");
    expect(result.figures.maintenanceMargin).toBe("45");
    expect(result.figures.maintenanceBreached).toBe(true);
  });

  it("gives a short the gain when the market falls", () => {
    const result = estimateLeverageScenario({
      ...base,
      direction: "SHORT",
      movePercent: "-10",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures.estimatedPnl).toBe("1000");
    expect(result.figures.roePercent).toBe("100");
    expect(result.figures.equity).toBe("2000");
  });

  it("stays flat when the market does not move", () => {
    const result = estimateLeverageScenario({ ...base, movePercent: "0" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures.estimatedPnl).toBe("0");
    expect(result.figures.roePercent).toBe("0");
    expect(result.figures.markPrice).toBe("100000");
    expect(result.figures.equity).toBe("1000");
  });

  it("keeps decimal margin exact and uses entry only for the illustrative mark", () => {
    const result = estimateLeverageScenario({
      direction: "LONG",
      margin: "250.5",
      leverage: "4",
      movePercent: "2",
      entryPrice: "100000.5",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.figures.notional).toBe("1002");
    expect(result.figures.initialMargin).toBe("250.5");
    expect(result.figures.estimatedPnl).toBe("20.04");
    expect(result.figures.roePercent).toBe("8");
    expect(result.figures.equity).toBe("270.54");
    expect(result.figures.markPrice).toBe("102000.51");
  });

  it("uses mark-adjusted notional for maintenance, not entry notional", () => {
    const result = estimateLeverageScenario({
      ...base,
      direction: "SHORT",
      movePercent: "9",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Isolated risk uses |qty| × mark. Entry notional MM would be 50;
    // mark notional is 10000 × 1.09 = 10900, so MM is 54.5.
    expect(result.figures.estimatedPnl).toBe("-900");
    expect(result.figures.equity).toBe("100");
    expect(result.figures.maintenanceMargin).toBe("54.5");
    expect(result.figures.maintenanceBreached).toBe(false);
  });

  it("rejects a non-positive margin", () => {
    expect(estimateLeverageScenario({ ...base, margin: "0" }).ok).toBe(false);
    expect(estimateLeverageScenario({ ...base, margin: "abc" }).ok).toBe(false);
  });
});
