import { describe, expect, it } from "vitest";

import {
  isPriceInRange,
  isQuantityInRange,
  isQuantityOnStep,
  isTickAligned,
  satisfiesMinNotional,
  validateMinNotional,
  validatePriceFilter,
  validateQuantityFilter,
} from "./filters.js";
import { expectTradingCode } from "./test-helpers.js";

describe("PRICE_FILTER", () => {
  it("accepts an exact tick match and rejects off-tick prices", () => {
    expect(
      isTickAligned({ price: "100.1", tickSize: "0.1", minPrice: "0.1" }),
    ).toBe(true);
    expect(
      isTickAligned({ price: "100.15", tickSize: "0.1", minPrice: "0.1" }),
    ).toBe(false);
    expect(() =>
      validatePriceFilter({
        price: "100.1",
        tickSize: "0.1",
        minPrice: "0.1",
        maxPrice: "1000",
      }),
    ).not.toThrow();
    expectTradingCode(
      () =>
        validatePriceFilter({
          price: "100.15",
          tickSize: "0.1",
          minPrice: "0.1",
          maxPrice: "1000",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("uses exact decimal modulo rather than JS floating remainder", () => {
    expect(isTickAligned({ price: "0.3", tickSize: "0.1", minPrice: "0" })).toBe(
      true,
    );
    expect(isTickAligned({ price: "0.15", tickSize: "0.1", minPrice: "0" })).toBe(
      false,
    );
  });

  it("disables tick alignment when tickSize is 0", () => {
    expect(isTickAligned({ price: "123.456", tickSize: "0", minPrice: "0" })).toBe(
      true,
    );
    expect(() =>
      validatePriceFilter({
        price: "123.456",
        tickSize: "0",
        minPrice: "0",
        maxPrice: "0",
      }),
    ).not.toThrow();
  });

  it("disables min/max bounds when those fields are 0", () => {
    expect(isPriceInRange({ price: "0.01", minPrice: "0", maxPrice: "0" })).toBe(
      true,
    );
    expect(
      isPriceInRange({ price: "5", minPrice: "10", maxPrice: "0" }),
    ).toBe(false);
    expect(
      isPriceInRange({ price: "50", minPrice: "0", maxPrice: "10" }),
    ).toBe(false);
    expect(() =>
      validatePriceFilter({
        price: "0.01",
        tickSize: "0",
        minPrice: "0",
        maxPrice: "0",
      }),
    ).not.toThrow();
  });

  it("uses minPrice as the tick origin even when it is not a multiple of tickSize", () => {
    expect(
      isTickAligned({ price: "11.1", tickSize: "1", minPrice: "10.1" }),
    ).toBe(true);
    expect(
      isTickAligned({ price: "11", tickSize: "1", minPrice: "10.1" }),
    ).toBe(false);
  });

  it("still requires a positive price", () => {
    expectTradingCode(
      () =>
        validatePriceFilter({
          price: "0",
          tickSize: "0",
          minPrice: "0",
          maxPrice: "0",
        }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("quantity filters", () => {
  it("accepts an exact step match and rejects off-step quantities", () => {
    expect(
      isQuantityOnStep({ quantity: "0.002", minQty: "0.001", stepSize: "0.001" }),
    ).toBe(true);
    expect(
      isQuantityOnStep({ quantity: "0.0015", minQty: "0.001", stepSize: "0.001" }),
    ).toBe(false);
    expect(() =>
      validateQuantityFilter({
        quantity: "0.002",
        minQty: "0.001",
        maxQty: "1000",
        stepSize: "0.001",
      }),
    ).not.toThrow();
    expectTradingCode(
      () =>
        validateQuantityFilter({
          quantity: "0.0015",
          minQty: "0.001",
          maxQty: "1000",
          stepSize: "0.001",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("uses minQty as the step origin when it is not a multiple of stepSize", () => {
    expect(
      isQuantityOnStep({
        quantity: "0.0025",
        minQty: "0.0015",
        stepSize: "0.001",
      }),
    ).toBe(true);
    expect(
      isQuantityOnStep({
        quantity: "0.002",
        minQty: "0.0015",
        stepSize: "0.001",
      }),
    ).toBe(false);
  });

  it("enforces min/max bounds", () => {
    expect(
      isQuantityInRange({ quantity: "1", minQty: "0.001", maxQty: "10" }),
    ).toBe(true);
    expect(
      isQuantityInRange({ quantity: "0.0001", minQty: "0.001", maxQty: "10" }),
    ).toBe(false);
    expect(
      isQuantityInRange({ quantity: "11", minQty: "0.001", maxQty: "10" }),
    ).toBe(false);
    expectTradingCode(
      () =>
        validateQuantityFilter({
          quantity: "11",
          minQty: "0.001",
          maxQty: "10",
          stepSize: "0.001",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("keeps LOT_SIZE and MARKET_LOT_SIZE as caller-selected field sets", () => {
    const lot = {
      minQty: "0.001",
      maxQty: "1000",
      stepSize: "0.001",
    };
    const marketLot = {
      minQty: "0.01",
      maxQty: "120",
      stepSize: "0.01",
    };

    expect(() =>
      validateQuantityFilter({ quantity: "0.001", ...lot }),
    ).not.toThrow();
    expectTradingCode(
      () => validateQuantityFilter({ quantity: "0.001", ...marketLot }),
      "INVALID_ARGUMENT",
    );
    expect(() =>
      validateQuantityFilter({ quantity: "0.01", ...marketLot }),
    ).not.toThrow();
  });
});

describe("MIN_NOTIONAL", () => {
  it("compares unrounded qty * price against minNotional", () => {
    expect(
      satisfiesMinNotional({
        quantity: "0.001",
        price: "100",
        minNotional: "0.1",
      }),
    ).toBe(true);
    expect(
      satisfiesMinNotional({
        quantity: "0.001",
        price: "100",
        minNotional: "0.11",
      }),
    ).toBe(false);
    expect(() =>
      validateMinNotional({
        quantity: "0.001",
        price: "100",
        minNotional: "0.1",
      }),
    ).not.toThrow();
    expectTradingCode(
      () =>
        validateMinNotional({
          quantity: "0.001",
          price: "100",
          minNotional: "0.11",
        }),
      "INVALID_ARGUMENT",
    );
  });

  it("does not round notional up before comparison", () => {
    expect(
      satisfiesMinNotional({
        quantity: "0.000000000000000001",
        price: "0.6",
        minNotional: "0.000000000000000001",
      }),
    ).toBe(false);
  });
});
