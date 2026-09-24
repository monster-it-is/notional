import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isDecimalGte } from "@notional/trading";

import { useMarketSocket } from "../../hooks/use-market-socket.ts";
import { getMarketSocket } from "../../realtime/runtime.ts";
import { useMarketStore } from "../../stores/market-store.ts";
import { useRealtimeStatusStore } from "../../stores/realtime-status-store.ts";
import {
  isLandingFeedLive,
  resolveLandingFeedState,
} from "./landing-feed-state.ts";
import {
  LandingMarketContext,
  type LandingMarketValue,
  type LandingSymbol,
  type MarkMove,
} from "./use-landing-market.ts";

export function LandingMarketProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState<LandingSymbol>("BTCUSDT");
  const [history, setHistory] = useState<{ symbol: LandingSymbol; prints: string[] }>({
    symbol: "BTCUSDT",
    prints: [],
  });
  const [now, setNow] = useState(() => Date.now());
  useMarketSocket(true);

  useEffect(() => {
    const socket = getMarketSocket();
    socket.setDesiredSymbol(symbol);
    return () => {
      socket.setDesiredSymbol(null);
    };
  }, [symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const markPrice = useMarketStore((state) => state.quotes[symbol]?.mark?.markPrice);
  const markEventTime = useMarketStore((state) => state.quotes[symbol]?.mark?.markEventTime);
  const indexPrice = useMarketStore((state) => state.quotes[symbol]?.mark?.indexPrice);
  const fundingRate = useMarketStore((state) => state.quotes[symbol]?.mark?.fundingRate);
  const bestBid = useMarketStore((state) => state.quotes[symbol]?.bbo?.bestBidPrice);
  const bestAsk = useMarketStore((state) => state.quotes[symbol]?.bbo?.bestAskPrice);
  const marketStatus = useRealtimeStatusStore((state) => state.market);
  const feedState = resolveLandingFeedState({
    status: marketStatus,
    markEventTime,
    now,
  });

  const prints = printsForSymbol(history, symbol, markPrice, setHistory);
  const live = isLandingFeedLive(feedState);
  const markMove = live ? markMoveFromPrints(prints) : "waiting";
  const value = useMemo<LandingMarketValue>(
    () => ({
      symbol,
      setSymbol,
      markPrice,
      indexPrice,
      fundingRate,
      bestBid,
      bestAsk,
      prints,
      markMove,
      feedState,
    }),
    [symbol, markPrice, indexPrice, fundingRate, bestBid, bestAsk, prints, markMove, feedState],
  );

  return <LandingMarketContext.Provider value={value}>{children}</LandingMarketContext.Provider>;
}

function printsForSymbol(
  history: { symbol: LandingSymbol; prints: string[] },
  symbol: LandingSymbol,
  markPrice: string | undefined,
  setHistory: (next: { symbol: LandingSymbol; prints: string[] }) => void,
): string[] {
  if (history.symbol !== symbol) {
    const prints = markPrice ? [markPrice] : [];
    setHistory({ symbol, prints });
    return prints;
  }

  if (markPrice && history.prints[history.prints.length - 1] !== markPrice) {
    const prints = history.prints.concat(markPrice).slice(-40);
    setHistory({ symbol, prints });
    return prints;
  }

  return history.prints;
}

function markMoveFromPrints(prints: string[]): MarkMove {
  const latest = prints[prints.length - 1];
  const previous = prints[prints.length - 2];

  if (!latest) {
    return "waiting";
  }

  if (!previous || previous === latest) {
    return "live";
  }

  return isDecimalGte(latest, previous) ? "up" : "down";
}
