import { describe, expect, it } from "vitest";

import { createMarketDataStore } from "./market-data-store.js";
import { parseBookTick, parseBookTickerTicks, parseMarkTicks, parsePremiumIndexTicks } from "./parse-events.js";

describe("parseMarkTicks", () => {
  it("parses a mark-price event and keeps decimal strings", () => {
    const ticks = parseMarkTicks({
      e: "markPriceUpdate",
      E: 1000,
      s: "BTCUSDT",
      p: "77241.80000000",
      i: "77268.98456522",
      r: "0.00007415",
      T: 2000,
    });

    expect(ticks).toEqual([
      {
        symbol: "BTCUSDT",
        markPrice: "77241.80000000",
        indexPrice: "77268.98456522",
        fundingRate: "0.00007415",
        nextFundingTime: 2000,
        markEventTime: 1000,
      },
    ]);
    expect(typeof ticks[0]?.markPrice).toBe("string");
  });

  it("parses an all-market array and combined stream envelope", () => {
    const ticks = parseMarkTicks({
      stream: "!markPrice@arr@1s",
      data: [
        markEvent("BTCUSDT", 1),
        markEvent("ETHUSDT", 2),
      ],
    });

    expect(ticks.map((tick) => tick.symbol)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("rejects malformed decimals and unsafe timestamps", () => {
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), p: "not-a-number" })).toEqual([]);
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), E: 1.5 })).toEqual([]);
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), E: Number.MAX_SAFE_INTEGER + 1 })).toEqual(
      [],
    );
  });

  it("ignores coin-margined symbols", () => {
    expect(parseMarkTicks({ ...markEvent("BTCUSD_PERP", 1), st: 2 })).toEqual([]);
  });

  it("rejects zero and negative mark and index prices", () => {
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), p: "0" })).toEqual([]);
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), i: "0" })).toEqual([]);
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), p: "-1" })).toEqual([]);
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), i: "-0.1" })).toEqual([]);
  });

  it("accepts zero and negative funding rates", () => {
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), r: "0" })[0]?.fundingRate).toBe("0");
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), r: "0.0" })[0]?.fundingRate).toBe("0.0");
    expect(parseMarkTicks({ ...markEvent("BTCUSDT", 1), r: "-0.0001" })[0]?.fundingRate).toBe(
      "-0.0001",
    );
  });
});

describe("parseBookTick", () => {
  it("parses a book-ticker event using update id u", () => {
    const tick = parseBookTick({
      e: "bookTicker",
      u: 99,
      E: 50,
      T: 49,
      s: "BTCUSDT",
      b: "77241.70",
      B: "21.549",
      a: "77241.80",
      A: "0.703",
    });

    expect(tick).toEqual({
      symbol: "BTCUSDT",
      bestBidPrice: "77241.70",
      bestBidQty: "21.549",
      bestAskPrice: "77241.80",
      bestAskQty: "0.703",
      bookUpdateId: 99,
      bookEventTime: 50,
    });
    expect(typeof tick?.bestBidPrice).toBe("string");
  });

  it("rejects malformed decimals and unsafe update ids", () => {
    expect(parseBookTick({ ...bookEvent(1), b: "1e" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), u: -1 })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), u: 1.2 })).toBeNull();
  });

  it("rejects zero and negative BBO prices and quantities", () => {
    expect(parseBookTick({ ...bookEvent(1), b: "0" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), a: "0" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), B: "0" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), A: "0" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), b: "-1" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), a: "-0.01" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), B: "-1" })).toBeNull();
    expect(parseBookTick({ ...bookEvent(1), A: "-1" })).toBeNull();
  });
});

describe("REST bootstrap parsers", () => {
  it("maps premiumIndex lastFundingRate and time", () => {
    const ticks = parsePremiumIndexTicks({
      symbol: "BTCUSDT",
      markPrice: "1.0",
      indexPrice: "1.1",
      lastFundingRate: "-0.0001",
      nextFundingTime: 9,
      time: 8,
    });

    expect(ticks[0]).toEqual({
      symbol: "BTCUSDT",
      markPrice: "1.0",
      indexPrice: "1.1",
      fundingRate: "-0.0001",
      nextFundingTime: 9,
      markEventTime: 8,
    });
  });

  it("maps bookTicker lastUpdateId", () => {
    const ticks = parseBookTickerTicks({
      symbol: "BTCUSDT",
      bidPrice: "1",
      bidQty: "2",
      askPrice: "3",
      askQty: "4",
      lastUpdateId: 15,
      time: 20,
    });

    expect(ticks[0]?.bookUpdateId).toBe(15);
    expect(ticks[0]?.bookEventTime).toBe(20);
  });

  it("rejects zero and negative REST mark and BBO fields while allowing zero funding", () => {
    expect(
      parsePremiumIndexTicks({
        symbol: "BTCUSDT",
        markPrice: "0",
        indexPrice: "1.1",
        lastFundingRate: "0",
        nextFundingTime: 9,
        time: 8,
      }),
    ).toEqual([]);
    expect(
      parsePremiumIndexTicks({
        symbol: "BTCUSDT",
        markPrice: "1.0",
        indexPrice: "0",
        lastFundingRate: "0",
        nextFundingTime: 9,
        time: 8,
      }),
    ).toEqual([]);
    expect(
      parsePremiumIndexTicks({
        symbol: "BTCUSDT",
        markPrice: "-1",
        indexPrice: "1.1",
        lastFundingRate: "0",
        nextFundingTime: 9,
        time: 8,
      }),
    ).toEqual([]);
    expect(
      parsePremiumIndexTicks({
        symbol: "BTCUSDT",
        markPrice: "1.0",
        indexPrice: "1.1",
        lastFundingRate: "0",
        nextFundingTime: 9,
        time: 8,
      })[0]?.fundingRate,
    ).toBe("0");

    expect(
      parseBookTickerTicks({
        symbol: "BTCUSDT",
        bidPrice: "0",
        bidQty: "2",
        askPrice: "3",
        askQty: "4",
        lastUpdateId: 15,
        time: 20,
      }),
    ).toEqual([]);
    expect(
      parseBookTickerTicks({
        symbol: "BTCUSDT",
        bidPrice: "1",
        bidQty: "0",
        askPrice: "3",
        askQty: "4",
        lastUpdateId: 15,
        time: 20,
      }),
    ).toEqual([]);
    expect(
      parseBookTickerTicks({
        symbol: "BTCUSDT",
        bidPrice: "1",
        bidQty: "2",
        askPrice: "0",
        askQty: "4",
        lastUpdateId: 15,
        time: 20,
      }),
    ).toEqual([]);
    expect(
      parseBookTickerTicks({
        symbol: "BTCUSDT",
        bidPrice: "1",
        bidQty: "2",
        askPrice: "3",
        askQty: "0",
        lastUpdateId: 15,
        time: 20,
      }),
    ).toEqual([]);
    expect(
      parseBookTickerTicks({
        symbol: "BTCUSDT",
        bidPrice: "-1",
        bidQty: "2",
        askPrice: "3",
        askQty: "4",
        lastUpdateId: 15,
        time: 20,
      }),
    ).toEqual([]);
  });
});

describe("rejected live ticks never enter MarketDataStore", () => {
  it("leaves the store empty when mark or BBO prices are zero", () => {
    const store = createMarketDataStore({ now: () => 0 });

    for (const tick of parseMarkTicks({ ...markEvent("BTCUSDT", 1), p: "0" })) {
      store.applyMark(tick);
    }

    for (const tick of parseBookTickerTicks({
      symbol: "BTCUSDT",
      bidPrice: "0",
      bidQty: "2",
      askPrice: "3",
      askQty: "4",
      lastUpdateId: 15,
      time: 20,
    })) {
      store.applyBook(tick);
    }

    expect(store.getState("BTCUSDT")).toBeUndefined();
    expect(store.getReadySnapshot("BTCUSDT", 10_000, 10_000, 0)).toBeNull();
  });
});

function markEvent(symbol: string, eventTime: number) {
  return {
    e: "markPriceUpdate",
    E: eventTime,
    s: symbol,
    p: "1.0",
    i: "1.1",
    r: "0.0",
    T: eventTime + 8,
  };
}

function bookEvent(updateId: number) {
  return {
    e: "bookTicker",
    u: updateId,
    E: 10,
    s: "BTCUSDT",
    b: "1",
    B: "2",
    a: "3",
    A: "4",
  };
}
