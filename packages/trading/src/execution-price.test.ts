import { describe, expect, it } from "vitest";

import {
  getLimitExecutionPrice,
  getMarketExecutionPrice,
  isLimitMarketable,
} from "./execution-price.js";
import { expectTradingCode } from "./test-helpers.js";

describe("getMarketExecutionPrice", () => {
  it("fills BUY at the best ask", () => {
    expect(
      getMarketExecutionPrice({
        side: "BUY",
        bestBidPrice: "99.5",
        bestAskPrice: "100.10",
      }),
    ).toBe("100.1");
  });

  it("fills SELL at the best bid", () => {
    expect(
      getMarketExecutionPrice({
        side: "SELL",
        bestBidPrice: "99.50",
        bestAskPrice: "100.1",
      }),
    ).toBe("99.5");
  });

  it("requires positive exact bid and ask even when only one side is used", () => {
    expectTradingCode(
      () =>
        getMarketExecutionPrice({
          side: "BUY",
          bestBidPrice: "0",
          bestAskPrice: "100",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        getMarketExecutionPrice({
          side: "SELL",
          bestBidPrice: "100",
          bestAskPrice: "-1",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        getMarketExecutionPrice({
          side: "BUY",
          bestBidPrice: "1e2",
          bestAskPrice: "100",
        }),
      "INVALID_DECIMAL",
    );
  });

  it("rejects an invalid side", () => {
    expectTradingCode(
      () =>
        getMarketExecutionPrice({
          side: "LONG" as "BUY",
          bestBidPrice: "1",
          bestAskPrice: "2",
        }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("LIMIT marketability and execution price", () => {
  it("fills a BUY LIMIT at the ask when ask is below the limit", () => {
    expect(
      isLimitMarketable({
        side: "BUY",
        limitPrice: "100",
        bestBidPrice: "97",
        bestAskPrice: "98",
      }),
    ).toBe(true);
    expect(
      getLimitExecutionPrice({
        side: "BUY",
        limitPrice: "100",
        bestBidPrice: "97",
        bestAskPrice: "98",
      }),
    ).toBe("98");
  });

  it("fills a BUY LIMIT at the ask when ask equals the limit", () => {
    expect(
      getLimitExecutionPrice({
        side: "BUY",
        limitPrice: "100.10",
        bestBidPrice: "99",
        bestAskPrice: "100.1",
      }),
    ).toBe("100.1");
  });

  it("does not fill a BUY LIMIT when ask is above the limit", () => {
    expect(
      isLimitMarketable({
        side: "BUY",
        limitPrice: "100",
        bestBidPrice: "99",
        bestAskPrice: "100.01",
      }),
    ).toBe(false);
    expect(
      getLimitExecutionPrice({
        side: "BUY",
        limitPrice: "100",
        bestBidPrice: "99",
        bestAskPrice: "100.01",
      }),
    ).toBeNull();
  });

  it("fills a SELL LIMIT at the bid when bid is above the limit", () => {
    expect(
      getLimitExecutionPrice({
        side: "SELL",
        limitPrice: "100",
        bestBidPrice: "102",
        bestAskPrice: "103",
      }),
    ).toBe("102");
  });

  it("fills a SELL LIMIT at the bid when bid equals the limit", () => {
    expect(
      getLimitExecutionPrice({
        side: "SELL",
        limitPrice: "100.00",
        bestBidPrice: "100",
        bestAskPrice: "101",
      }),
    ).toBe("100");
  });

  it("does not fill a SELL LIMIT when bid is below the limit", () => {
    expect(
      getLimitExecutionPrice({
        side: "SELL",
        limitPrice: "100",
        bestBidPrice: "99.99",
        bestAskPrice: "101",
      }),
    ).toBeNull();
  });

  it("compares exact decimals rather than JS numbers", () => {
    expect(
      isLimitMarketable({
        side: "BUY",
        limitPrice: "0.3",
        bestBidPrice: "0.2",
        bestAskPrice: "0.30",
      }),
    ).toBe(true);
    expect(
      isLimitMarketable({
        side: "BUY",
        limitPrice: "0.3",
        bestBidPrice: "0.2",
        bestAskPrice: "0.30000000000000004",
      }),
    ).toBe(false);
  });

  it("requires positive exact prices", () => {
    expectTradingCode(
      () =>
        getLimitExecutionPrice({
          side: "BUY",
          limitPrice: "0",
          bestBidPrice: "1",
          bestAskPrice: "1",
        }),
      "INVALID_ARGUMENT",
    );
    expectTradingCode(
      () =>
        isLimitMarketable({
          side: "SELL",
          limitPrice: "100",
          bestBidPrice: "1e2",
          bestAskPrice: "101",
        }),
      "INVALID_DECIMAL",
    );
  });
});
