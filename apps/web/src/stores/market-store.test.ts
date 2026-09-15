import { beforeEach, describe, expect, it } from "vitest";

import { useMarketStore } from "./market-store.ts";

describe("market store", () => {
  beforeEach(() => {
    useMarketStore.getState().clear();
  });

  it("stores bbo and mark strings in memory without numeric conversion", () => {
    useMarketStore.getState().applyBbo({
      type: "market.bbo",
      symbol: "BTCUSDT",
      bestBidPrice: "1",
      bestBidQty: "2",
      bestAskPrice: "3",
      bestAskQty: "4",
      bookEventTime: 1,
    });
    useMarketStore.getState().applyMark({
      type: "market.mark",
      symbol: "BTCUSDT",
      markPrice: "1.5",
      indexPrice: "1.4",
      fundingRate: "0.0001",
      nextFundingTime: 1,
      markEventTime: 1,
    });

    const quote = useMarketStore.getState().quotes.BTCUSDT;
    expect(quote?.bbo?.bestBidPrice).toBe("1");
    expect(quote?.mark?.fundingRate).toBe("0.0001");
    expect(typeof quote?.bbo?.bestBidPrice).toBe("string");
    expect(typeof quote?.mark?.markPrice).toBe("string");
  });
});
