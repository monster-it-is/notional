import { describe, expect, it } from "vitest";

import {
  decimalVisualSign,
  isPlainPositiveDecimal,
  positionSideFromQuantity,
} from "./decimal-string.ts";

describe("decimal strings", () => {
  it("accepts plain positive decimals without Number conversion", () => {
    expect(isPlainPositiveDecimal("0.001")).toBe(true);
    expect(isPlainPositiveDecimal("1")).toBe(true);
    expect(isPlainPositiveDecimal("01")).toBe(false);
    expect(isPlainPositiveDecimal("1e-3")).toBe(false);
    expect(isPlainPositiveDecimal("-1")).toBe(false);
  });

  it("classifies position side from decimal-safe sign comparison", () => {
    expect(positionSideFromQuantity("1")).toBe("LONG");
    expect(positionSideFromQuantity("0.2")).toBe("LONG");
    expect(positionSideFromQuantity("-0.2")).toBe("SHORT");
    expect(positionSideFromQuantity("0")).toBe("FLAT");
    expect(positionSideFromQuantity("0.0")).toBe("FLAT");
    expect(positionSideFromQuantity("-0")).toBe("FLAT");
    expect(positionSideFromQuantity("-0.000")).toBe("FLAT");
    expect(positionSideFromQuantity("")).toBe("FLAT");
    expect(positionSideFromQuantity("not-a-decimal")).toBe("FLAT");
  });

  it("classifies realized PnL sign without float conversion", () => {
    expect(decimalVisualSign("-1.25")).toBe("negative");
    expect(decimalVisualSign("1.25")).toBe("positive");
    expect(decimalVisualSign("0")).toBe("zero");
    expect(decimalVisualSign("0.0")).toBe("zero");
    expect(decimalVisualSign("-0")).toBe("zero");
    expect(decimalVisualSign("not-a-decimal")).toBe("zero");
  });
});
