import { describe, expect, it } from "vitest";

import { expectTradingCode, fractionalDigitCount } from "./test-helpers.js";
import { sumDecimalValues } from "./decimal.js";
import {
  calculateFundingPayment,
  calculateIsolatedFundingSettlement,
  calculateNextIsolatedCollateralAfterFill,
  effectiveProofBase,
  expectedMarkCandleCloseTimeMs,
  isolatedIncreaseRequiresHealthyCollateral,
  persistFundingMarkToNumeric3818,
  persistFundingRateToNumeric3818,
  windowProven,
} from "./funding.js";
import { calculateProtectedWalletSettlement } from "./wallet-settlement.js";

describe("persistFundingRateToNumeric3818", () => {
  it("keeps signed zero and values already at scale 18", () => {
    expect(persistFundingRateToNumeric3818("0")).toBe("0");
    expect(persistFundingRateToNumeric3818("-0.0001")).toBe("-0.0001");
    expect(persistFundingRateToNumeric3818("0.0001")).toBe("0.0001");
  });

  it("quantizes >18-scale rates with HALF_EVEN", () => {
    expect(persistFundingRateToNumeric3818("0.00012345678901234567")).toBe(
      "0.000123456789012346",
    );
    expect(fractionalDigitCount(persistFundingRateToNumeric3818("0.00012345678901234567"))).toBe(
      18,
    );
  });

  it("rejects abs(rate) >= 1 including after quantization", () => {
    expectTradingCode(() => persistFundingRateToNumeric3818("1"), "INVALID_ARGUMENT");
    expectTradingCode(() => persistFundingRateToNumeric3818("-1"), "INVALID_ARGUMENT");
    expectTradingCode(
      () => persistFundingRateToNumeric3818("0.9999999999999999995"),
      "INVALID_ARGUMENT",
    );
  });
});

describe("expectedMarkCandleCloseTimeMs", () => {
  it("selects the immediately preceding 1m close for aligned and intra-minute times", () => {
    expect(expectedMarkCandleCloseTimeMs(Date.parse("2026-09-15T10:00:00.000Z"))).toBe(
      Date.parse("2026-09-15T09:59:59.999Z"),
    );
    expect(expectedMarkCandleCloseTimeMs(Date.parse("2026-09-15T10:00:00.001Z"))).toBe(
      Date.parse("2026-09-15T09:59:59.999Z"),
    );
    expect(expectedMarkCandleCloseTimeMs(Date.parse("2026-09-15T10:00:30.000Z"))).toBe(
      Date.parse("2026-09-15T09:59:59.999Z"),
    );
    expect(expectedMarkCandleCloseTimeMs(Date.parse("2026-09-15T10:00:59.999Z"))).toBe(
      Date.parse("2026-09-15T09:59:59.999Z"),
    );
  });
});

describe("calculateFundingPayment", () => {
  it("charges longs and credits shorts on a positive rate", () => {
    expect(
      calculateFundingPayment({
        signedQuantity: "10",
        markPrice: "100",
        fundingRate: "0.01",
      }),
    ).toBe("-10");
    expect(
      calculateFundingPayment({
        signedQuantity: "-10",
        markPrice: "100",
        fundingRate: "0.01",
      }),
    ).toBe("10");
  });

  it("reverses payer/receiver on a negative rate and is zero at a zero rate", () => {
    expect(
      calculateFundingPayment({
        signedQuantity: "10",
        markPrice: "100",
        fundingRate: "-0.01",
      }),
    ).toBe("10");
    expect(
      calculateFundingPayment({
        signedQuantity: "-10",
        markPrice: "100",
        fundingRate: "-0.01",
      }),
    ).toBe("-10");
    expect(
      calculateFundingPayment({
        signedQuantity: "10",
        markPrice: "100",
        fundingRate: "0",
      }),
    ).toBe("0");
  });

  it("uses the persisted HALF_EVEN rate for payment", () => {
    const rate = persistFundingRateToNumeric3818("0.00012345678901234567");
    const mark = persistFundingMarkToNumeric3818("100");
    expect(
      calculateFundingPayment({
        signedQuantity: "1",
        markPrice: mark,
        fundingRate: rate,
      }),
    ).toBe("-0.0123456789012346");
  });

  it("rejects overflow rather than clamping", () => {
    expectTradingCode(
      () =>
        calculateFundingPayment({
          signedQuantity: `1${"0".repeat(20)}`,
          markPrice: `1${"0".repeat(20)}`,
          fundingRate: "0.5",
        }),
      "OVERFLOW",
    );
  });
});

describe("calculateIsolatedFundingSettlement", () => {
  it("credits isolated margin and wallet together so free cash is unchanged", () => {
    expect(
      calculateIsolatedFundingSettlement({
        isolatedMargin: "100",
        fundingPayment: "100",
      }),
    ).toEqual({
      nextIsolatedMargin: "200",
      userWalletDelta: "100",
      insuranceAbsorption: "0",
    });
  });

  it("debits isolated margin and wallet together", () => {
    expect(
      calculateIsolatedFundingSettlement({
        isolatedMargin: "100",
        fundingPayment: "-20",
      }),
    ).toEqual({
      nextIsolatedMargin: "80",
      userWalletDelta: "-20",
      insuranceAbsorption: "0",
    });
  });

  it("contains isolated bankruptcy to allocated collateral", () => {
    expect(
      calculateIsolatedFundingSettlement({
        isolatedMargin: "100",
        fundingPayment: "-150",
      }),
    ).toEqual({
      nextIsolatedMargin: "0",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });
  });

  it("is a no-op at a zero payment", () => {
    expect(
      calculateIsolatedFundingSettlement({
        isolatedMargin: "100",
        fundingPayment: "0",
      }),
    ).toEqual({
      nextIsolatedMargin: "100",
      userWalletDelta: "0",
      insuranceAbsorption: "0",
    });
  });
});

describe("CROSS protected funding settlement", () => {
  it("protects isolated reserves on a CROSS funding debit", () => {
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: "1000",
        cashDelta: "-800",
        protectedBalance: "400",
      }),
    ).toEqual({
      nextWalletBalance: "400",
      userWalletDelta: "-600",
      insuranceAbsorption: "200",
    });
  });

  it("nets same-timestamp CROSS payments independently of order", () => {
    const first = calculateProtectedWalletSettlement({
      walletBalance: "100",
      cashDelta: "-50",
      protectedBalance: "0",
    });
    const reversed = calculateProtectedWalletSettlement({
      walletBalance: "100",
      cashDelta: "-50",
      protectedBalance: "0",
    });
    expect(first).toEqual(reversed);
    expect(first).toEqual({
      nextWalletBalance: "50",
      userWalletDelta: "-50",
      insuranceAbsorption: "0",
    });
  });

  it("uses insurance when net CROSS debit exceeds spendable cash", () => {
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: "100",
        cashDelta: "-150",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });
  });
});

describe("calculateNextIsolatedCollateralAfterFill", () => {
  const reduce = {
    fillSide: "SELL" as const,
    fillQty: "0.5",
    leverage: "1",
    currentQty: "1",
    currentEntryPrice: "100",
    nextQty: "0.5",
    nextEntryPrice: "100",
  };

  it("reduces from required 100 to 50 with no past funding", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        ...reduce,
        currentIsolatedMargin: "100",
      }),
    ).toBe("50");
  });

  it("keeps a funding deficit attached on reduce", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        ...reduce,
        currentIsolatedMargin: "90",
      }),
    ).toBe("40");
  });

  it("keeps a funding surplus attached on reduce", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        ...reduce,
        currentIsolatedMargin: "110",
      }),
    ).toBe("60");
  });

  it("adds only the required increment on increase", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        currentQty: "1",
        currentEntryPrice: "100",
        currentIsolatedMargin: "90",
        nextQty: "1.5",
        nextEntryPrice: "100",
        leverage: "1",
        fillSide: "BUY",
        fillQty: "0.5",
      }),
    ).toBe("140");
  });

  it("releases all remaining collateral on close", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        currentQty: "1",
        currentEntryPrice: "100",
        currentIsolatedMargin: "40",
        nextQty: "0",
        nextEntryPrice: null,
        leverage: "1",
        fillSide: "SELL",
        fillQty: "1",
      }),
    ).toBe("0");
  });

  it("opens from flat at requiredAfter", () => {
    expect(
      calculateNextIsolatedCollateralAfterFill({
        currentQty: "0",
        currentEntryPrice: null,
        currentIsolatedMargin: "0",
        nextQty: "1",
        nextEntryPrice: "100",
        leverage: "1",
        fillSide: "BUY",
        fillQty: "1",
      }),
    ).toBe("100");
  });

  it("rejects isolated reverse", () => {
    expectTradingCode(
      () =>
        calculateNextIsolatedCollateralAfterFill({
          currentQty: "1",
          currentEntryPrice: "100",
          currentIsolatedMargin: "100",
          nextQty: "-1",
          nextEntryPrice: "100",
          leverage: "1",
          fillSide: "SELL",
          fillQty: "2",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("blocks isolated increase when actual collateral is below required", () => {
    expect(
      isolatedIncreaseRequiresHealthyCollateral({
        currentIsolatedMargin: "90",
        currentQty: "1",
        currentEntryPrice: "100",
        leverage: "1",
        transition: "INCREASE",
      }),
    ).toBe(false);
    expect(
      isolatedIncreaseRequiresHealthyCollateral({
        currentIsolatedMargin: "100",
        currentQty: "1",
        currentEntryPrice: "100",
        leverage: "1",
        transition: "INCREASE",
      }),
    ).toBe(true);
  });
});

describe("mixed isolated and CROSS free-cash invariant", () => {
  it("does not change free CROSS cash when isolated funding credits or debits", () => {
    const wallet = "1000";
    const isolated = "100";
    const freeBefore = sumDecimalValues([wallet, `-${isolated}`]);

    for (const payment of ["100", "-20", "-150"]) {
      const isolatedSettle = calculateIsolatedFundingSettlement({
        isolatedMargin: isolated,
        fundingPayment: payment,
      });
      const nextWallet = sumDecimalValues([wallet, isolatedSettle.userWalletDelta]);
      const freeAfter = sumDecimalValues([nextWallet, `-${isolatedSettle.nextIsolatedMargin}`]);
      expect(freeAfter).toBe(freeBefore);
    }
  });

  it("nets same-timestamp CROSS payments once and keeps later credits from rewriting earlier insurance", () => {
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: "100",
        cashDelta: sumDecimalValues(["-150", "100"]),
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "50",
      userWalletDelta: "-50",
      insuranceAbsorption: "0",
    });
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: "100",
        cashDelta: sumDecimalValues(["100", "-150"]),
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "50",
      userWalletDelta: "-50",
      insuranceAbsorption: "0",
    });
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: "100",
        cashDelta: sumDecimalValues(["-250", "100"]),
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });

    const earlierDefault = calculateProtectedWalletSettlement({
      walletBalance: "100",
      cashDelta: "-150",
      protectedBalance: "0",
    });
    expect(earlierDefault).toEqual({
      nextWalletBalance: "0",
      userWalletDelta: "-100",
      insuranceAbsorption: "50",
    });
    expect(
      calculateProtectedWalletSettlement({
        walletBalance: earlierDefault.nextWalletBalance,
        cashDelta: "100",
        protectedBalance: "0",
      }),
    ).toEqual({
      nextWalletBalance: "100",
      userWalletDelta: "100",
      insuranceAbsorption: "0",
    });
  });
});

describe("windowProven", () => {
  const floor = "2026-09-15T12:00:00.000Z";
  const cursor = "2026-09-15T08:00:00.000Z";

  it("uses activation floor as effectiveProofBase when last realized is null", () => {
    expect(
      effectiveProofBase({
        lastRealizedFundingTime: null,
        activationFloorAt: floor,
      }),
    ).toBe(floor);
  });

  it("proves the first Phase-15 interval after history reconcile then schedule observe", () => {
    expect(
      windowProven({
        cursorAt: floor,
        financialNow: "2026-09-15T14:00:00.000Z",
        activationFloorAt: floor,
        lastRealizedFundingTime: null,
        unresolvedScheduledTimes: [],
        liveScheduleProof: {
          validFrom: floor,
          nextFundingTime: "2026-09-15T16:00:00.000Z",
          observedAt: "2026-09-15T12:00:01.000Z",
        },
      }),
    ).toBe(true);
  });

  it("rejects a post-restart schedule snapshot as proof of a missed window", () => {
    expect(
      windowProven({
        cursorAt: cursor,
        financialNow: "2026-09-15T16:05:00.000Z",
        activationFloorAt: cursor,
        lastRealizedFundingTime: cursor,
        unresolvedScheduledTimes: [],
        liveScheduleProof: null,
      }),
    ).toBe(false);
  });

  it("fails closed when an unresolved scheduled time sits in the window", () => {
    expect(
      windowProven({
        cursorAt: cursor,
        financialNow: "2026-09-15T16:05:00.000Z",
        activationFloorAt: cursor,
        lastRealizedFundingTime: cursor,
        unresolvedScheduledTimes: ["2026-09-15T16:00:00.000Z"],
        liveScheduleProof: {
          validFrom: cursor,
          nextFundingTime: "2026-09-16T00:00:00.000Z",
          observedAt: "2026-09-15T16:05:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("accepts proof A when a later realized event exists", () => {
    expect(
      windowProven({
        cursorAt: cursor,
        financialNow: "2026-09-15T12:00:00.000Z",
        activationFloorAt: cursor,
        lastRealizedFundingTime: "2026-09-15T16:00:00.000Z",
        unresolvedScheduledTimes: [],
        liveScheduleProof: null,
      }),
    ).toBe(true);
  });

  it("does not let a live proof whose validFrom is after lastRealized close the pre-observation gap", () => {
    expect(
      windowProven({
        cursorAt: cursor,
        financialNow: "2026-09-15T16:05:00.000Z",
        activationFloorAt: cursor,
        lastRealizedFundingTime: cursor,
        unresolvedScheduledTimes: [],
        liveScheduleProof: {
          validFrom: "2026-09-15T16:05:00.000Z",
          nextFundingTime: "2026-09-16T00:00:00.000Z",
          observedAt: "2026-09-15T16:05:00.000Z",
        },
      }),
    ).toBe(false);
  });
});
