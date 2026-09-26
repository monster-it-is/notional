import { describe, expect, it } from "vitest";

import { formatExactMoneyDisplay } from "./format-exact-money.ts";

describe("formatExactMoneyDisplay", () => {
  it("pads whole amounts to two fraction digits and groups thousands", () => {
    expect(formatExactMoneyDisplay("1000")).toBe("1,000.00");
    expect(formatExactMoneyDisplay("0")).toBe("0.00");
    expect(formatExactMoneyDisplay("50")).toBe("50.00");
    expect(formatExactMoneyDisplay("1234567")).toBe("1,234,567.00");
  });

  it("trims redundant trailing zeros without dropping a non-zero tail", () => {
    expect(formatExactMoneyDisplay("1000.000000000000000000")).toBe("1,000.00");
    expect(formatExactMoneyDisplay("999.999856000")).toBe("999.999856");
    expect(formatExactMoneyDisplay("0.1")).toBe("0.10");
    expect(formatExactMoneyDisplay("1.10")).toBe("1.10");
    expect(formatExactMoneyDisplay("1.100")).toBe("1.10");
    expect(formatExactMoneyDisplay("0.000000000000000001")).toBe("0.000000000000000001");
  });

  it("never rounds", () => {
    expect(formatExactMoneyDisplay("1.999999999")).toBe("1.999999999");
    expect(formatExactMoneyDisplay("999.999856")).toBe("999.999856");
    expect(formatExactMoneyDisplay("1.005")).toBe("1.005");
  });

  it("returns malformed strings unchanged", () => {
    expect(formatExactMoneyDisplay("")).toBe("");
    expect(formatExactMoneyDisplay("abc")).toBe("abc");
    expect(formatExactMoneyDisplay("1e2")).toBe("1e2");
    expect(formatExactMoneyDisplay("01")).toBe("01");
    expect(formatExactMoneyDisplay("1.")).toBe("1.");
    expect(formatExactMoneyDisplay("1.2.3")).toBe("1.2.3");
  });

  it("keeps a signed non-zero amount and treats equivalent zero as 0.00", () => {
    expect(formatExactMoneyDisplay("-1000.10")).toBe("-1,000.10");
    expect(formatExactMoneyDisplay("-0.00")).toBe("0.00");
  });
});
