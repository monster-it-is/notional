import { classifyPositionTransition } from "@notional/trading";
import { describe, expect, it } from "vitest";

import { createMarketDataStore } from "../market-data/market-data-store.js";
import {
  OrderValidationError,
  reduceOnlyAllows,
  validateLimitOrderFilters,
  validateMarketOrderFilters,
  validateOrderPlacement,
  type OrderFilterInstrument,
} from "./validate-order.js";

const instrument: OrderFilterInstrument = {
  status: "ACTIVE",
  tickSize: "0.1",
  minPrice: "0.1",
  maxPrice: "1000000",
  stepSize: "0.001",
  minQty: "0.001",
  maxQty: "1000",
  marketStepSize: "0.01",
  marketMinQty: "0.01",
  marketMaxQty: "120",
  minNotional: "100",
};

const book = {
  bestBidPrice: "99.9",
  bestAskPrice: "100.1",
};

describe("LIMIT order validation", () => {
  it("accepts LOT_SIZE, PRICE_FILTER, and MIN_NOTIONAL using the limit price", () => {
    const result = validateLimitOrderFilters({
      quantity: "1.000",
      limitPrice: "100.10",
      instrument,
    });

    expect(result).toEqual({ quantity: "1", limitPrice: "100.1" });
  });

  it("does not require market data", () => {
    expect(() =>
      validateOrderPlacement({
        request: {
          type: "LIMIT",
          side: "BUY",
          quantity: "1",
          limitPrice: "100.1",
        },
        account: { status: "ACTIVE" },
        initialized: true,
        instrument,
        markPrice: null,
        book: null,
      }),
    ).not.toThrow();
  });

  it("rejects quantity outside LOT_SIZE even when MARKET_LOT_SIZE would accept it", () => {
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "0.01",
          limitPrice: "100.1",
          instrument: { ...instrument, maxQty: "0.005" },
        }),
      "INVALID_QUANTITY",
    );
  });

  it("rejects quantity below min, above max, and off step", () => {
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "0.0001",
          limitPrice: "100.1",
          instrument,
        }),
      "INVALID_QUANTITY",
    );
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "1001",
          limitPrice: "100.1",
          instrument,
        }),
      "INVALID_QUANTITY",
    );
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "0.0015",
          limitPrice: "100.1",
          instrument,
        }),
      "INVALID_QUANTITY",
    );
  });

  it("rejects an off-tick limit price and prices outside min/max", () => {
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "1",
          limitPrice: "100.15",
          instrument,
        }),
      "INVALID_PRICE",
    );
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "1",
          limitPrice: "0.05",
          instrument,
        }),
      "INVALID_PRICE",
    );
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "1",
          limitPrice: "1000000.1",
          instrument,
        }),
      "INVALID_PRICE",
    );
  });

  it("disables PRICE_FILTER sub-rules when zeros are persisted", () => {
    const result = validateLimitOrderFilters({
      quantity: "1",
      limitPrice: "123.456",
      instrument: {
        ...instrument,
        tickSize: "0",
        minPrice: "0",
        maxPrice: "0",
        minNotional: "1",
      },
    });

    expect(result.limitPrice).toBe("123.456");
  });

  it("rejects MIN_NOTIONAL using the limit price, not a mark", () => {
    expectInvalidOrder(
      () =>
        validateLimitOrderFilters({
          quantity: "0.001",
          limitPrice: "100.1",
          instrument,
        }),
      "MIN_NOTIONAL",
    );

    expect(() =>
      validateLimitOrderFilters({
        quantity: "1",
        limitPrice: "100.1",
        instrument,
      }),
    ).not.toThrow();
  });
});

describe("MARKET order validation", () => {
  it("uses MARKET_LOT_SIZE rather than LOT_SIZE", () => {
    expectInvalidOrder(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "0.001",
          instrument,
          markPrice: "100",
          book,
        }),
      "INVALID_QUANTITY",
    );

    const result = validateMarketOrderFilters({
      side: "BUY",
      quantity: "0.01",
      instrument: { ...instrument, minNotional: "1" },
      markPrice: "100",
      book,
    });
    expect(result.quantity).toBe("0.01");
  });

  it("requires a fresh mark and uses it for MIN_NOTIONAL", () => {
    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "0.01",
          instrument,
          markPrice: null,
          book,
        }),
      "MARKET_DATA_UNAVAILABLE",
    );

    expectInvalidOrder(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "1",
          instrument,
          markPrice: "50",
          book: { bestBidPrice: "49.9", bestAskPrice: "1000" },
        }),
      "MIN_NOTIONAL",
    );

    expect(() =>
      validateMarketOrderFilters({
        side: "BUY",
        quantity: "1.00",
        instrument,
        markPrice: "100",
        book,
      }),
    ).not.toThrow();
  });

  it("requires a fresh BBO and observes ask for BUY and bid for SELL", () => {
    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "1",
          instrument,
          markPrice: "100",
          book: null,
        }),
      "MARKET_DATA_UNAVAILABLE",
    );

    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "1",
          instrument,
          markPrice: "100",
          book: { bestBidPrice: "99.9", bestAskPrice: "0" },
        }),
      "MARKET_DATA_UNAVAILABLE",
    );

    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "SELL",
          quantity: "1",
          instrument,
          markPrice: "100",
          book: { bestBidPrice: "0", bestAskPrice: "100.1" },
        }),
      "MARKET_DATA_UNAVAILABLE",
    );

    expect(() =>
      validateMarketOrderFilters({
        side: "BUY",
        quantity: "1",
        instrument,
        markPrice: "100",
        book: { bestBidPrice: "0", bestAskPrice: "100.1" },
      }),
    ).not.toThrow();

    expect(() =>
      validateMarketOrderFilters({
        side: "SELL",
        quantity: "1",
        instrument,
        markPrice: "100",
        book: { bestBidPrice: "99.9", bestAskPrice: "0" },
      }),
    ).not.toThrow();
  });

  it("rejects stale mark and stale book from the market-data store", () => {
    const store = createMarketDataStore({ now: () => 100 });
    store.applyMark(
      {
        symbol: "BTCUSDT",
        markPrice: "100",
        indexPrice: "100",
        fundingRate: "0",
        nextFundingTime: 1,
        markEventTime: 1,
      },
      0,
    );
    store.applyBook(
      {
        symbol: "BTCUSDT",
        bestBidPrice: "99.9",
        bestAskPrice: "100.1",
        bestBidQty: "1",
        bestAskQty: "1",
        bookUpdateId: 1,
        bookEventTime: 1,
      },
      0,
    );

    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "1",
          instrument,
          markPrice: store.getFreshMark("BTCUSDT", 10, 100)?.markPrice ?? null,
          book: store.getFreshBook("BTCUSDT", 10, 5),
        }),
      "MARKET_DATA_UNAVAILABLE",
    );

    expectCode(
      () =>
        validateMarketOrderFilters({
          side: "BUY",
          quantity: "1",
          instrument,
          markPrice: store.getFreshMark("BTCUSDT", 10, 5)?.markPrice ?? null,
          book: store.getFreshBook("BTCUSDT", 10, 100),
        }),
      "MARKET_DATA_UNAVAILABLE",
    );
  });

  it("does not execute or invent a fill price", () => {
    const result = validateOrderPlacement({
      request: { type: "MARKET", side: "BUY", quantity: "1" },
      account: { status: "ACTIVE" },
      initialized: true,
      instrument,
      markPrice: "100",
      book,
    });

    expect(result.limitPrice).toBeNull();
    expect(result.quantity).toBe("1");
  });
});

describe("order placement eligibility", () => {
  it("rejects uninitialized, suspended, missing, and inactive instruments", () => {
    expectCode(
      () =>
        validateOrderPlacement({
          request: { type: "LIMIT", side: "BUY", quantity: "1", limitPrice: "100.1" },
          account: null,
          initialized: false,
          instrument,
          markPrice: null,
          book: null,
        }),
      "ACCOUNT_NOT_INITIALIZED",
    );

    expectCode(
      () =>
        validateOrderPlacement({
          request: { type: "LIMIT", side: "BUY", quantity: "1", limitPrice: "100.1" },
          account: { status: "SUSPENDED" },
          initialized: true,
          instrument,
          markPrice: null,
          book: null,
        }),
      "ACCOUNT_SUSPENDED",
    );

    expectCode(
      () =>
        validateOrderPlacement({
          request: { type: "LIMIT", side: "BUY", quantity: "1", limitPrice: "100.1" },
          account: { status: "ACTIVE" },
          initialized: true,
          instrument: null,
          markPrice: null,
          book: null,
        }),
      "INSTRUMENT_NOT_FOUND",
    );

    expectCode(
      () =>
        validateOrderPlacement({
          request: { type: "LIMIT", side: "BUY", quantity: "1", limitPrice: "100.1" },
          account: { status: "ACTIVE" },
          initialized: true,
          instrument: { ...instrument, status: "INACTIVE" },
          markPrice: null,
          book: null,
        }),
      "INSTRUMENT_INACTIVE",
    );
  });

  it("does not authoritatively validate reduce-only without a position", () => {
    const result = validateOrderPlacement({
      request: {
        type: "LIMIT",
        side: "SELL",
        quantity: "1",
        limitPrice: "100.1",
        reduceOnly: true,
      },
      account: { status: "ACTIVE" },
      initialized: true,
      instrument,
      markPrice: null,
      book: null,
    });

    expect(result.reduceOnly).toBe(true);
    expect(reduceOnlyAllows(classifyPositionTransition({
      currentQty: "0",
      fillSide: "BUY",
      fillQty: "1",
    }))).toBe(false);
    expect(reduceOnlyAllows(classifyPositionTransition({
      currentQty: "2",
      fillSide: "SELL",
      fillQty: "1",
    }))).toBe(true);
    expect(reduceOnlyAllows(classifyPositionTransition({
      currentQty: "1",
      fillSide: "SELL",
      fillQty: "1",
    }))).toBe(true);
    expect(reduceOnlyAllows(classifyPositionTransition({
      currentQty: "1",
      fillSide: "BUY",
      fillQty: "1",
    }))).toBe(false);
    expect(reduceOnlyAllows(classifyPositionTransition({
      currentQty: "1",
      fillSide: "SELL",
      fillQty: "2",
    }))).toBe(false);
  });
});

function expectInvalidOrder(fn: () => unknown, reason: "INVALID_QUANTITY" | "INVALID_PRICE" | "MIN_NOTIONAL") {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrderValidationError);
    expect((error as OrderValidationError).code).toBe("INVALID_ORDER");
    expect((error as OrderValidationError).reason).toBe(reason);
    return;
  }

  throw new Error(`expected INVALID_ORDER ${reason}`);
}

function expectCode(fn: () => unknown, code: OrderValidationError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrderValidationError);
    expect((error as OrderValidationError).code).toBe(code);
    return;
  }

  throw new Error(`expected ${code}`);
}
