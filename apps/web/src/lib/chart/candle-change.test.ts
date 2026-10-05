import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { calculateCandleChange } from "./candle-change.ts";

describe("calculateCandleChange", () => {
  it("computes a positive change and signed 2dp percent", () => {
    expect(calculateCandleChange("100.00", "105.00")).toEqual({
      change: "5",
      changePercent: "5.00",
    });
  });

  it("computes a negative change and signed 2dp percent", () => {
    expect(calculateCandleChange("100.00", "95.00")).toEqual({
      change: "-5",
      changePercent: "-5.00",
    });
  });

  it("computes an unchanged candle as zero", () => {
    expect(calculateCandleChange("100.00", "100.00")).toEqual({
      change: "0",
      changePercent: "0.00",
    });
  });

  it("returns unavailable percent when open is zero", () => {
    expect(calculateCandleChange("0", "5.00")).toEqual({
      change: "5",
      changePercent: null,
    });
    expect(calculateCandleChange("0.00", "0.00")).toEqual({
      change: "0",
      changePercent: null,
    });
  });

  it("returns null for malformed open or close without throwing", () => {
    expect(calculateCandleChange("1e2", "105.00")).toBeNull();
    expect(calculateCandleChange("100.00", "1e2")).toBeNull();
    expect(calculateCandleChange("abc", "105.00")).toBeNull();
    expect(calculateCandleChange("100.00", "")).toBeNull();
    expect(calculateCandleChange("01", "2")).toBeNull();
  });

  it("keeps high-precision decimal strings exact", () => {
    expect(calculateCandleChange("1.00000001", "1.00000002")).toEqual({
      change: "0.00000001",
      changePercent: "0.00",
    });
  });

  it("does not exhibit floating-point artifacts", () => {
    expect(calculateCandleChange("0.1", "0.3")).toEqual({
      change: "0.2",
      changePercent: "200.00",
    });
    expect(calculateCandleChange("0.3", "0.1")).toEqual({
      change: "-0.2",
      changePercent: "-66.67",
    });
  });

  it("keeps a very tiny non-zero change exact while rounding percent to 2dp", () => {
    const result = calculateCandleChange("1", "1.00000001");
    expect(result?.change).toBe("0.00000001");
    expect(result?.changePercent).toBe("0.00");
  });

  it("handles large decimal values", () => {
    expect(calculateCandleChange("1000000000000.25", "1000000000005.75")).toEqual({
      change: "5.5",
      changePercent: "0.00",
    });
  });

  it("does not use Number, parseFloat, or parseInt", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/chart/candle-change.ts"), "utf8");

    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/\bparseFloat\s*\(/);
    expect(source).not.toMatch(/\bparseInt\s*\(/);
    expect(source).toMatch(/\.toFixed\s*\(/);
  });
});
