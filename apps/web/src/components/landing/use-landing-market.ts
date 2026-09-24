import { createContext, useContext } from "react";

import type { LandingFeedState } from "./landing-feed-state.ts";

export const LANDING_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

export type LandingSymbol = (typeof LANDING_SYMBOLS)[number];

export type MarkMove = "waiting" | "live" | "up" | "down";

export type LandingMarketValue = {
  symbol: LandingSymbol;
  setSymbol: (symbol: LandingSymbol) => void;
  markPrice?: string;
  indexPrice?: string;
  fundingRate?: string;
  bestBid?: string;
  bestAsk?: string;
  prints: string[];
  markMove: MarkMove;
  feedState: LandingFeedState;
};

export const LandingMarketContext = createContext<LandingMarketValue | null>(null);

export function useLandingMarket(): LandingMarketValue {
  const value = useContext(LandingMarketContext);

  if (!value) {
    throw new Error("useLandingMarket must be used within LandingMarketProvider");
  }

  return value;
}
