import { describe, expect, it } from "vitest";

import { calculateInitialMargin } from "./margin.js";
import { fractionalDigitCount, expectTradingCode } from "./test-helpers.js";
import {
  isDecimalGte,
  isDecimalLte,
  quantizeCollateralRequirementToNumeric3818,
  sumDecimalValues,
} from "./decimal.js";
import {
  calculateIsolatedReduceProtectedBalance,
  calculateWalletRealizedSettlement,
} from "./wallet-settlement.js";

describe("quantizeCollateralRequirementToNumeric3818", () => {
  it("rounds a repeating initial margin UP and never below the exact requirement", () => {
    const exact = calculateInitialMargin({ notional: "1", leverage: "3" });
    const stored = quantizeCollateralRequirementToNumeric3818(exact);

    expect(stored).toBe("0.333333333333333334");
    expect(fractionalDigitCount(stored)).toBe(18);
    expect(isDecimalGte(stored, exact)).toBe(true);
    expect(isDecimalGte(exact, stored)).toBe(false);
  });

  it("does not inflate an already exact storage-scale requirement", () => {
    expect(quantizeCollateralRequirementToNumeric3818("0.5")).toBe("0.5");
    expect(quantizeCollateralRequirementToNumeric3818("0")).toBe("0");
    expect(quantizeCollateralRequirementToNumeric3818("10.000")).toBe("10");
  });

  it("rejects negatives", () => {
    expectTradingCode(() => quantizeCollateralRequirementToNumeric3818("-0.1"), "INVALID_ARGUMENT");
  });
});

describe("sumDecimalValues", () => {
  it("returns 0 for an empty list and adds signed strings without Number", () => {
    expect(sumDecimalValues([])).toBe("0");
    expect(sumDecimalValues(["1.5", "-0.25", "0.25"])).toBe("1.5");
  });
});

describe("isDecimalGte", () => {
  it("compares canonical decimal strings", () => {
    expect(isDecimalGte("1", "1")).toBe(true);
    expect(isDecimalGte("1.0", "1")).toBe(true);
    expect(isDecimalGte("0.9", "1")).toBe(false);
    expect(isDecimalGte("-1", "-2")).toBe(true);
  });
});

describe("isDecimalLte", () => {
  it("compares canonical decimal strings", () => {
    expect(isDecimalLte("1", "1")).toBe(true);
    expect(isDecimalLte("1.0", "1")).toBe(true);
    expect(isDecimalLte("1.1", "1")).toBe(false);
    expect(isDecimalLte("-2", "-1")).toBe(true);
  });
});

describe("calculateWalletRealizedSettlement", () => {
  it("credits profit in full with no insurance", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "200",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "1200",
      userWalletDelta: "200",
      insuranceAbsorption: "0",
    });
  });

  it("debits a loss within wallet", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-300",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "700",
      userWalletDelta: "-300",
      insuranceAbsorption: "0",
    });
  });

  it("wipes the wallet exactly", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-1000",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-1000",
      insuranceAbsorption: "0",
    });
  });

  it("routes residual loss beyond wallet to insurance", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-1500",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-1000",
      insuranceAbsorption: "500",
    });
  });

  it("does not mutate a zero-delta wallet", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "0",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "1000",
      userWalletDelta: "0",
      insuranceAbsorption: "0",
    });
  });

  it("does not post a user cash line when the wallet is already at the floor", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "0",
        realizedPnlDelta: "-1500",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "0",
      insuranceAbsorption: "1500",
    });
  });

  it("honors a positive protectedBalance without clamping realizedPnlDelta", () => {
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-800",
        protectedBalance: "400",
      }),
    ).toEqual({
      nextWalletBalance: "400",
      userWalletDelta: "-600",
      insuranceAbsorption: "200",
    });
  });

  it("rejects protectedBalance above wallet without rewriting it", () => {
    expectTradingCode(
      () =>
        calculateWalletRealizedSettlement({
          walletBalance: "100",
          realizedPnlDelta: "-10",
          protectedBalance: "150",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("rejects negative wallet or protected balance", () => {
    expectTradingCode(
      () =>
        calculateWalletRealizedSettlement({
          walletBalance: "-1",
          realizedPnlDelta: "0",
          protectedBalance: "0",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        calculateWalletRealizedSettlement({
          walletBalance: "10",
          realizedPnlDelta: "0",
          protectedBalance: "-1",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("computes isolated reduce loss capacity without leaking free wallet", () => {
    expect(
      calculateIsolatedReduceProtectedBalance({
        walletBalance: "1000",
        currentIsolatedMargin: "100",
        nextIsolatedMargin: "80",
      }),
    ).toEqual({
      lossCapacity: "20",
      protectedBalance: "980",
    });
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-50",
        protectedBalance: "980",
      }),
    ).toEqual({
      nextWalletBalance: "980",
      userWalletDelta: "-20",
      insuranceAbsorption: "30",
    });
  });

  it("caps isolated close loss to the full former allocation", () => {
    expect(
      calculateIsolatedReduceProtectedBalance({
        walletBalance: "1000",
        currentIsolatedMargin: "100",
        nextIsolatedMargin: "0",
      }),
    ).toEqual({
      lossCapacity: "100",
      protectedBalance: "900",
    });
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "1000",
        realizedPnlDelta: "-150",
        protectedBalance: "900",
      }),
    ).toEqual({
      nextWalletBalance: "900",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });
  });

  it("sums CROSS liquidation deltas independently of order", () => {
    expect(sumDecimalValues(["-150", "100"])).toBe("-50");
    expect(sumDecimalValues(["100", "-150"])).toBe("-50");
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "100",
        realizedPnlDelta: "-50",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "50",
      userWalletDelta: "-50",
      insuranceAbsorption: "0",
    });
    expect(
      calculateWalletRealizedSettlement({
        walletBalance: "100",
        realizedPnlDelta: sumDecimalValues(["-250", "100"]),
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });
  });

  it("does not use Number for settlement math", () => {
    const source = calculateWalletRealizedSettlement.toString();
    expect(source.includes("Number(")).toBe(false);
    expect(source.includes("parseFloat")).toBe(false);
    expect(source.includes("parseInt")).toBe(false);
  });
});
