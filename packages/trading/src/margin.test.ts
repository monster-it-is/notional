import { describe, expect, it } from "vitest";

import { calculateInitialMargin } from "./margin.js";
import { expectTradingCode } from "./test-helpers.js";

describe("calculateInitialMargin", () => {
  it("divides notional by positive integer leverage", () => {
    expect(calculateInitialMargin({ notional: "1000", leverage: "10" })).toBe("100");
    expect(calculateInitialMargin({ notional: "0", leverage: "20" })).toBe("0");
    const repeating = calculateInitialMargin({ notional: "100", leverage: "3" });
    expect(repeating.startsWith("33.3")).toBe(true);
    expect(repeating.includes("e")).toBe(false);
    expect(repeating.split(".")[1]!.length).toBeGreaterThan(18);
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
