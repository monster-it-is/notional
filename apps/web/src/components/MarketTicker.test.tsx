import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketTicker } from "./MarketTicker.tsx";
import { TRADE_MARK_STALE_MS } from "../lib/trade-feed-state.ts";
import { useMarketStore } from "../stores/market-store.ts";
import { useRealtimeStatusStore } from "../stores/realtime-status-store.ts";

const instrument = {
  id: "1",
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT" as const,
  contractType: "PERPETUAL" as const,
  status: "ACTIVE" as const,
  tickSize: "0.1",
  minPrice: "0.1",
  maxPrice: "1000000",
  stepSize: "0.001",
  minQty: "0.001",
  maxQty: "1000",
  marketStepSize: "0.001",
  marketMinQty: "0.001",
  marketMaxQty: "120",
  minNotional: "5",
};

function seedQuote(markEventTime: number): void {
  useMarketStore.getState().applyMark({
    type: "market.mark",
    symbol: "BTCUSDT",
    markPrice: "100000.1",
    indexPrice: "99999.9",
    fundingRate: "0.0001",
    nextFundingTime: markEventTime + 28_800_000,
    markEventTime,
  });
  useMarketStore.getState().applyBbo({
    type: "market.bbo",
    symbol: "BTCUSDT",
    bestBidPrice: "99990",
    bestBidQty: "1.2",
    bestAskPrice: "100010",
    bestAskQty: "0.8",
    bookEventTime: markEventTime,
  });
}

describe("MarketTicker", () => {
  beforeEach(() => {
    useMarketStore.getState().clear();
    useRealtimeStatusStore.setState({ market: "idle", account: "idle" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the trader to select an instrument when none is chosen", () => {
    render(<MarketTicker symbol={null} />);
    expect(screen.getByText(/Select an instrument/)).toBeInTheDocument();
  });

  it("renders em dashes when quote fields are missing", () => {
    useRealtimeStatusStore.setState({ market: "ready" });
    render(<MarketTicker symbol="BTCUSDT" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("renders websocket decimal strings and Bid/Ask labels", () => {
    const now = Date.now();
    useRealtimeStatusStore.setState({ market: "ready" });
    seedQuote(now);
    render(<MarketTicker symbol="BTCUSDT" instrument={instrument} />);
    expect(screen.getByText("100000.1")).toBeInTheDocument();
    expect(screen.getByText("99999.9")).toBeInTheDocument();
    expect(screen.getByText("99990")).toBeInTheDocument();
    expect(screen.getByText("1.2")).toBeInTheDocument();
    expect(screen.getByText("100010")).toBeInTheDocument();
    expect(screen.getByText("0.8")).toBeInTheDocument();
    expect(screen.getByText("0.0001")).toBeInTheDocument();
    expect(screen.getByText("Bid")).toBeInTheDocument();
    expect(screen.getByText("Ask")).toBeInTheDocument();
    expect(screen.getByText(/BTC\/USDT/)).toBeInTheDocument();
    expect(screen.getByText(/PERPETUAL/)).toBeInTheDocument();
    expect(screen.queryByText(/order book/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/24h/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open interest/i)).not.toBeInTheDocument();
  });

  it("shows Live only when the market socket is ready and the mark is fresh", () => {
    const now = Date.now();
    useRealtimeStatusStore.setState({ market: "ready" });
    seedQuote(now);
    render(<MarketTicker symbol="BTCUSDT" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows Stale on mount when the cached mark is already past the deadline", () => {
    vi.useFakeTimers();
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    useRealtimeStatusStore.setState({ market: "ready" });
    seedQuote(start - TRADE_MARK_STALE_MS);
    render(<MarketTicker symbol="BTCUSDT" />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("ages Live into Stale when the freshness deadline elapses without a new mark", () => {
    vi.useFakeTimers();
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    useRealtimeStatusStore.setState({ market: "ready" });
    seedQuote(start);
    render(<MarketTicker symbol="BTCUSDT" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("100000.1")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRADE_MARK_STALE_MS);
    });

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("100000.1")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("labels connecting, disconnected, and waiting from socket state", () => {
    render(<MarketTicker symbol="BTCUSDT" />);
    expect(screen.getByText("Waiting")).toBeInTheDocument();

    act(() => {
      useRealtimeStatusStore.setState({ market: "connecting" });
    });
    expect(screen.getByText("Connecting")).toBeInTheDocument();

    act(() => {
      useRealtimeStatusStore.setState({ market: "closed" });
    });
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});
