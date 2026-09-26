import { describe, expect, it } from "vitest";

import { orderSideClass } from "./order-side-class.ts";

describe("orderSideClass", () => {
  it("colors BUY and SELL with trading semantics only", () => {
    expect(orderSideClass("BUY")).toBe("text-positive");
    expect(orderSideClass("SELL")).toBe("text-negative");
  });
});
