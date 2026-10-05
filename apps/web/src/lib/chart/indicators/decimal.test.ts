import { describe, expect, it } from "vitest";

import {
  INDICATOR_OUTPUT_SCALE,
  INDICATOR_ZERO,
  IndicatorDecimal,
  parseIndicatorDecimal,
  serializeIndicatorValue,
} from "./decimal.ts";

describe("indicator decimal serialization", () => {
  it("trims trailing zeros and rejects scientific notation", () => {
    expect(serializeIndicatorValue(new IndicatorDecimal("2.5000"))).toBe("2.5");
    expect(serializeIndicatorValue(new IndicatorDecimal("2"))).toBe("2");
    expect(serializeIndicatorValue(INDICATOR_ZERO)).toBe("0");
    expect(serializeIndicatorValue(new IndicatorDecimal("-0"))).toBe("0");
    expect(serializeIndicatorValue(new IndicatorDecimal("0.0000000000000000004"))).toBe("0");
  });

  it("rounds half up to 18 decimal places", () => {
    const value = new IndicatorDecimal("1.1234567890123456785");
    const serialized = serializeIndicatorValue(value);
    expect(serialized).toBe("1.123456789012345679");
    expect(serialized?.split(".")[1]?.length).toBeLessThanOrEqual(INDICATOR_OUTPUT_SCALE);
    expect(serialized).not.toMatch(/e/i);
  });

  it("parses only plain canonical decimals", () => {
    expect(parseIndicatorDecimal("1.50")?.toFixed()).toBe("1.5");
    expect(parseIndicatorDecimal("1e2")).toBeNull();
    expect(parseIndicatorDecimal("not-a-price")).toBeNull();
    expect(parseIndicatorDecimal("")).toBeNull();
  });
});
