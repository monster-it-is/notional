import type { MarketBboMessage, MarketMarkMessage } from "@notional/contracts";
import { create } from "zustand";

export type SymbolMarketState = {
  bbo?: Pick<
    MarketBboMessage,
    "bestBidPrice" | "bestBidQty" | "bestAskPrice" | "bestAskQty" | "bookEventTime"
  >;
  mark?: Pick<
    MarketMarkMessage,
    "markPrice" | "indexPrice" | "fundingRate" | "nextFundingTime" | "markEventTime"
  >;
};

type MarketStore = {
  quotes: Record<string, SymbolMarketState>;
  applyBbo: (message: MarketBboMessage) => void;
  applyMark: (message: MarketMarkMessage) => void;
  clear: () => void;
};

export const useMarketStore = create<MarketStore>((set) => ({
  quotes: {},
  applyBbo: (message) =>
    set((state) => ({
      quotes: {
        ...state.quotes,
        [message.symbol]: {
          ...state.quotes[message.symbol],
          bbo: {
            bestBidPrice: message.bestBidPrice,
            bestBidQty: message.bestBidQty,
            bestAskPrice: message.bestAskPrice,
            bestAskQty: message.bestAskQty,
            bookEventTime: message.bookEventTime,
          },
        },
      },
    })),
  applyMark: (message) =>
    set((state) => ({
      quotes: {
        ...state.quotes,
        [message.symbol]: {
          ...state.quotes[message.symbol],
          mark: {
            markPrice: message.markPrice,
            indexPrice: message.indexPrice,
            fundingRate: message.fundingRate,
            nextFundingTime: message.nextFundingTime,
            markEventTime: message.markEventTime,
          },
        },
      },
    })),
  clear: () => set({ quotes: {} }),
}));
