import { describe, expect, it } from "vitest";

import { isPlainPositiveDecimal, positionSideFromQuantity } from "./decimal-string.ts";

describe("decimal strings", () => {
  it("accepts plain positive decimals without Number conversion", () => {
    expect(isPlainPositiveDecimal("0.001")).toBe(true);
    expect(isPlainPositiveDecimal("1")).toBe(true);
    expect(isPlainPositiveDecimal("01")).toBe(false);
    expect(isPlainPositiveDecimal("1e-3")).toBe(false);
    expect(isPlainPositiveDecimal("-1")).toBe(false);
  });

  it("classifies position side from string sign", () => {
    expect(positionSideFromQuantity("1.5")).toBe("LONG");
    expect(positionSideFromQuantity("-0.2")).toBe("SHORT");
    expect(positionSideFromQuantity("0")).toBe("FLAT");
  });
});
