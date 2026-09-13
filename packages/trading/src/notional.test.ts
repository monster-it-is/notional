import { describe, expect, it } from "vitest";

import { calculateNotional } from "./notional.js";
import { expectTradingCode, fractionalDigitCount } from "./test-helpers.js";

describe("calculateNotional", () => {
  it("uses abs(quantity) * price and is never negative", () => {
    expect(calculateNotional({ quantity: "2", price: "100" })).toBe("200");
    expect(calculateNotional({ quantity: "-2", price: "100" })).toBe("200");
    expect(calculateNotional({ quantity: "0", price: "65000" })).toBe("0");
    expect(calculateNotional({ quantity: "0.5", price: "65000" })).toBe("32500");
  });

  it("does not round products that exceed 18 fractional digits", () => {
    const notional = calculateNotional({
      quantity: "0.000000000000000003",
      price: "0.000000000000000003",
    });
    expect(fractionalDigitCount(notional)).toBeGreaterThan(18);
    expect(notional).toBe("0.000000000000000000000000000000000009");
  });

  it("rejects non-positive prices and invalid decimals", () => {
    expectTradingCode(
      () => calculateNotional({ quantity: "1", price: "0" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateNotional({ quantity: "1", price: "-1" }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () => calculateNotional({ quantity: "1e2", price: "1" }),
      "INVALID_DECIMAL",
    );
  });
});
