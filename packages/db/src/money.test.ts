import { describe, expect, it } from "vitest";

import {
  fromDbDecimal,
  MoneyDecimal,
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
});
