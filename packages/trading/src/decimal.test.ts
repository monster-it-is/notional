import { describe, expect, it } from "vitest";

import {
  assertFitsNumeric3818,
  parseDecimalString,
  parseNonNegativeDecimalString,
  parsePositiveDecimalString,
  quantizeToNumeric3818,
  toCanonicalDecimalString,
} from "./decimal.js";
import { expectTradingCode, fractionalDigitCount } from "./test-helpers.js";

describe("decimal syntax", () => {
  it("accepts canonical integers and fractions", () => {
    expect(parseDecimalString("0")).toBe("0");
    expect(parseDecimalString("1")).toBe("1");
    expect(parseDecimalString("0.001")).toBe("0.001");
    expect(parseDecimalString("65000.25")).toBe("65000.25");
    expect(parseDecimalString("-0.0001")).toBe("-0.0001");
  });

  it("strips unnecessary trailing zeros", () => {
    expect(parseDecimalString("100.00")).toBe("100");
    expect(parseDecimalString("0.100000000000000000")).toBe("0.1");
    expect(toCanonicalDecimalString("120.000")).toBe("120");
  });

  it("canonicalizes mathematical zero including negative zero", () => {
    expect(parseDecimalString("0")).toBe("0");
    expect(parseDecimalString("-0")).toBe("0");
    expect(parseDecimalString("0.0")).toBe("0");
    expect(parseDecimalString("-0.000")).toBe("0");
    expect(parseDecimalString("-0.000000000000000000")).toBe("0");
  });

  it("rejects scientific notation, plus signs, whitespace, and malformed strings", () => {
    for (const value of [
      "1e-8",
      "1E-8",
      "+1",
      " 1",
      "1 ",
      " 1 ",
      "NaN",
      "Infinity",
      "-Infinity",
      "",
      ".",
      "1.",
      ".1",
      "01",
      "00.1",
      "-01",
      "--1",
    ]) {
      expectTradingCode(() => parseDecimalString(value), "INVALID_DECIMAL");
    }
  });

  it("rejects non-strings", () => {
    expectTradingCode(() => parseDecimalString(1 as unknown as string), "INVALID_DECIMAL");
  });

  it("allows negatives only on the signed parser", () => {
    expect(parseDecimalString("-1")).toBe("-1");
    expectTradingCode(() => parseNonNegativeDecimalString("-1"), "INVALID_ARGUMENT");
    expectTradingCode(() => parsePositiveDecimalString("-1"), "INVALID_ARGUMENT");
    expectTradingCode(() => parsePositiveDecimalString("0"), "INVALID_ARGUMENT");
    expect(parseNonNegativeDecimalString("0")).toBe("0");
    expect(parsePositiveDecimalString("0.1")).toBe("0.1");
  });

  it("accepts high precision strings without scientific notation", () => {
    const value = `0.${"1".repeat(40)}`;
    expect(parseDecimalString(value)).toBe(value);
  });
});

describe("NUMERIC(38,18) bounds", () => {
  it("accepts values that fit the domain", () => {
    expect(() => assertFitsNumeric3818("0")).not.toThrow();
    expect(() => assertFitsNumeric3818("-1.5")).not.toThrow();
    expect(() => assertFitsNumeric3818(`0.${"1".repeat(18)}`)).not.toThrow();
    expect(() => assertFitsNumeric3818(`${"9".repeat(20)}`)).not.toThrow();
  });

  it("rejects extra fractional scale rather than rounding", () => {
    expectTradingCode(
      () => assertFitsNumeric3818("1.1234567890123456789"),
      "OVERFLOW",
    );
  });

  it("rejects too many integer digits", () => {
    expectTradingCode(() => assertFitsNumeric3818(`1${"0".repeat(20)}`), "OVERFLOW");
  });
});

describe("quantizeToNumeric3818", () => {
  it("uses ROUND_HALF_EVEN and returns a canonical string", () => {
    expect(quantizeToNumeric3818("1.0000000000000000005")).toBe("1");
    expect(quantizeToNumeric3818("0.0000000000000000015")).toBe("0.000000000000000002");
    expect(quantizeToNumeric3818("0.0000000000000000025")).toBe("0.000000000000000002");
    expect(quantizeToNumeric3818("120.000000000000000000")).toBe("120");
  });

  it("checks overflow after rounding because rounding can carry", () => {
    const almostOverflow = `${"9".repeat(20)}.${"9".repeat(18)}5`;
    expectTradingCode(() => quantizeToNumeric3818(almostOverflow), "OVERFLOW");
  });

  it("does not pad trailing zeros", () => {
    expect(quantizeToNumeric3818("0.1")).toBe("0.1");
    expect(fractionalDigitCount(quantizeToNumeric3818("0.1"))).toBe(1);
  });
});
