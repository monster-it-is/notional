import type { MarketDataResponse } from "@notional/contracts";

import type { BookTick, Clock, MarkTick, SymbolMarketState } from "./types.js";
import { systemClock } from "./types.js";

export type MarketDataStore = {
  applyMark(tick: MarkTick, receivedAt?: number): boolean;
  applyBook(tick: BookTick, receivedAt?: number): boolean;
  getState(symbol: string): SymbolMarketState | undefined;
  isMarkFresh(symbol: string, staleMs: number, now?: number): boolean;
  isBookFresh(symbol: string, staleMs: number, now?: number): boolean;
  getReadySnapshot(
    symbol: string,
    markStaleMs: number,
    bookStaleMs: number,
    now?: number,
  ): MarketDataResponse | null;
  countReady(markStaleMs: number, bookStaleMs: number, now?: number): number;
};

export function createMarketDataStore(clock: Clock = systemClock): MarketDataStore {
  const states = new Map<string, SymbolMarketState>();

  function current(symbol: string): SymbolMarketState {
    const existing = states.get(symbol);

    if (existing) {
      return existing;
    }

    const created = { symbol };
    states.set(symbol, created);
    return created;
  }

  return {
    applyMark(tick, receivedAt = clock.now()) {
      const state = current(tick.symbol);

      if (state.mark && tick.markEventTime <= state.mark.markEventTime) {
        return false;
      }

      state.mark = {
        ...tick,
        markReceivedAt: receivedAt,
      };
      return true;
    },

    applyBook(tick, receivedAt = clock.now()) {
      const state = current(tick.symbol);

      if (state.book && tick.bookUpdateId <= state.book.bookUpdateId) {
        return false;
      }

      state.book = {
        ...tick,
        bookReceivedAt: receivedAt,
      };
      return true;
    },

    getState(symbol) {
      return states.get(symbol);
    },

    isMarkFresh(symbol, staleMs, now = clock.now()) {
      const mark = states.get(symbol)?.mark;
      return mark !== undefined && now - mark.markReceivedAt <= staleMs;
    },

    isBookFresh(symbol, staleMs, now = clock.now()) {
      const book = states.get(symbol)?.book;
      return book !== undefined && now - book.bookReceivedAt <= staleMs;
    },

    getReadySnapshot(symbol, markStaleMs, bookStaleMs, now = clock.now()) {
      const state = states.get(symbol);
      const mark = state?.mark;
      const book = state?.book;

      if (!mark || !book) {
        return null;
      }

      if (now - mark.markReceivedAt > markStaleMs || now - book.bookReceivedAt > bookStaleMs) {
        return null;
      }

      return {
        symbol,
        markPrice: mark.markPrice,
        indexPrice: mark.indexPrice,
        bestBidPrice: book.bestBidPrice,
        bestBidQty: book.bestBidQty,
        bestAskPrice: book.bestAskPrice,
        bestAskQty: book.bestAskQty,
        fundingRate: mark.fundingRate,
        nextFundingTime: mark.nextFundingTime,
        markEventTime: mark.markEventTime,
        bookEventTime: book.bookEventTime,
      };
    },

    countReady(markStaleMs, bookStaleMs, now = clock.now()) {
      let count = 0;

      for (const symbol of states.keys()) {
        if (this.getReadySnapshot(symbol, markStaleMs, bookStaleMs, now)) {
          count += 1;
        }
      }

      return count;
    },
  };
}
