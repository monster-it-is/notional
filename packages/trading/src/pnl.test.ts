import { describe, expect, it } from "vitest";

import { calculateRealizedPnl, calculateUnrealizedPnl } from "./pnl.js";
import { expectTradingCode } from "./test-helpers.js";

describe("unrealized PnL", () => {
  it("is zero for a flat position", () => {
    expect(
      calculateUnrealizedPnl({
        positionQty: "0",
        entryPrice: null,
        markPrice: "110",
      }),
    ).toBe("0");
  });

  it("matches signed-quantity examples", () => {
    expect(
      calculateUnrealizedPnl({
        positionQty: "2",
        entryPrice: "100",
        markPrice: "110",
      }),
    ).toBe("20");
    expect(
      calculateUnrealizedPnl({
        positionQty: "2",
        entryPrice: "100",
        markPrice: "90",
      }),
    ).toBe("-20");
    expect(
      calculateUnrealizedPnl({
        positionQty: "-2",
        entryPrice: "100",
        markPrice: "90",
      }),
    ).toBe("20");
    expect(
      calculateUnrealizedPnl({
        positionQty: "-2",
        entryPrice: "100",
        markPrice: "110",
      }),
    ).toBe("-20");
  });

  it("requires a positive mark and a consistent position", () => {
    expectTradingCode(
      () =>
        calculateUnrealizedPnl({
          positionQty: "1",
          entryPrice: "100",
          markPrice: "0",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        calculateUnrealizedPnl({
          positionQty: "1",
          entryPrice: null,
          markPrice: "100",
        }),
      "INVARIANT_VIOLATION",
    );
    expectTradingCode(
      () =>
        calculateUnrealizedPnl({
          positionQty: "0",
          entryPrice: "100",
          markPrice: "100",
        }),
      "INVARIANT_VIOLATION",
    );
  });
});

describe("realized PnL", () => {
  it("is positive for user profit on both long and short closes", () => {
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "120",
        currentQty: "2",
      }),
    ).toBe("40");
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "80",
        currentQty: "-2",
      }),
    ).toBe("40");
  });

  it("is negative for user loss and zero when entry equals exit", () => {
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "120",
        exitPrice: "110",
        currentQty: "2",
      }),
    ).toBe("-20");
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "120",
        currentQty: "-2",
      }),
    ).toBe("-40");
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "100",
        currentQty: "2",
      }),
    ).toBe("0");
  });

  it("rejects realizing against a flat position", () => {
    expectTradingCode(
      () =>
        calculateRealizedPnl({
          closedQty: "1",
          entryPrice: "100",
          exitPrice: "110",
          currentQty: "0",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("allows closing the full current quantity and rejects over-close", () => {
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "110",
        currentQty: "2",
      }),
    ).toBe("20");
    expectTradingCode(
      () =>
        calculateRealizedPnl({
          closedQty: "3",
          entryPrice: "100",
          exitPrice: "110",
          currentQty: "2",
        }),
      "INVALID_ARGUMENT",
    );
    expect(
      calculateRealizedPnl({
        closedQty: "2",
        entryPrice: "100",
        exitPrice: "90",
        currentQty: "-2",
      }),
    ).toBe("20");
    expectTradingCode(
      () =>
        calculateRealizedPnl({
          closedQty: "3",
          entryPrice: "100",
          exitPrice: "90",
          currentQty: "-2",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("accepts fractional equality and rejects fractional over-close", () => {
    expect(
      calculateRealizedPnl({
        closedQty: "0.25",
        entryPrice: "100",
        exitPrice: "110",
        currentQty: "0.25",
      }),
    ).toBe("2.5");
    expectTradingCode(
      () =>
        calculateRealizedPnl({
          closedQty: "0.250000000000000001",
          entryPrice: "100",
          exitPrice: "110",
          currentQty: "0.25",
        }),
      "INVALID_ARGUMENT",
    );
    expect(
      calculateRealizedPnl({
        closedQty: "0.25",
        entryPrice: "100",
        exitPrice: "90",
        currentQty: "-0.25",
      }),
    ).toBe("2.5");
    expectTradingCode(
      () =>
        calculateRealizedPnl({
          closedQty: "0.26",
          entryPrice: "100",
          exitPrice: "90",
          currentQty: "-0.25",
        }),
      "INVALID_ARGUMENT",
    );
  });
});
