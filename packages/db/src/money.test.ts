import { describe, expect, it } from "vitest";

import {
  fromDbDecimal,
  MoneyDecimal,
  parseConfiguredMoney,
  SIGNUP_ALLOCATION_AMOUNT,
  signupAllocationIdempotencyKey,
  toDbDecimal,
} from "./money.js";

describe("money", () => {
  it("creates the signup allocation from a decimal string", () => {
    expect(SIGNUP_ALLOCATION_AMOUNT.toString()).toBe("1000");
    expect(toDbDecimal(SIGNUP_ALLOCATION_AMOUNT)).toBe("1000");
    expect(fromDbDecimal("1000.000000000000000000").eq(SIGNUP_ALLOCATION_AMOUNT)).toBe(
      true,
    );
  });

  it("builds a deterministic signup-allocation identity", () => {
    expect(signupAllocationIdempotencyKey("user-1")).toBe(
      "signup-allocation:user-1",
    );
  });

  it("rejects values whose fractional scale exceeds 18", () => {
    expect(() =>
      toDbDecimal(new MoneyDecimal("1.1234567890123456789")),
    ).toThrow("financial value exceeds 18 decimal places");
  });

  it("rejects a non-string database value", () => {
    expect(() => fromDbDecimal(1000 as unknown as string)).toThrow(
      "financial value must be a string",
    );
  });

  it("parses a configured positive decimal string", () => {
    expect(parseConfiguredMoney("100").toString()).toBe("100");
    expect(parseConfiguredMoney("0.1").toString()).toBe("0.1");
  });

  it("rejects invalid configured money values", () => {
    expect(() => parseConfiguredMoney("")).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseConfiguredMoney("0")).toThrow(
      "configured money must be a positive decimal",
    );
    expect(() => parseConfiguredMoney("-1")).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseConfiguredMoney("1e2")).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseConfiguredMoney("abc")).toThrow(
      "configured money must be a plain decimal string",
    );
    expect(() => parseConfiguredMoney("1.1234567890123456789")).toThrow(
      "financial value exceeds 18 decimal places",
    );
    expect(() => parseConfiguredMoney(`1${"0".repeat(20)}`)).toThrow(
      "financial value exceeds NUMERIC(38,18) precision",
    );
  });
});
