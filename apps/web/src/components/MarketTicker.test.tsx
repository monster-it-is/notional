import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketTicker } from "./MarketTicker.tsx";
import { formatAdaptiveMarketPriceDisplay } from "../lib/format-adaptive-market-price.ts";
import { formatCompactEpochMsUtc } from "../lib/format-timestamp.ts";
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
    expect(screen.getByText("100000.10")).toBeInTheDocument();
    expect(screen.getAllByText("99999.90")).toHaveLength(1);
    expect(screen.getByText("99990.00")).toBeInTheDocument();
    expect(screen.getByText("1.2")).toBeInTheDocument();
    expect(screen.getByText("100010.00")).toBeInTheDocument();
    expect(screen.getByText("0.8")).toBeInTheDocument();
    expect(screen.getByText("0.0001")).toBeInTheDocument();
    expect(screen.getByText("BTC/USDT")).toBeInTheDocument();
    expect(screen.getByText("PERPETUAL")).toBeInTheDocument();
    expect(screen.getByText("Mark Price")).toBeInTheDocument();
    expect(screen.getAllByText("Index")).toHaveLength(1);
    expect(screen.getByText("Bid")).toBeInTheDocument();
    expect(screen.getByText("Ask")).toBeInTheDocument();
    expect(screen.getByText("Funding")).toBeInTheDocument();
    expect(screen.getByText("Next Funding")).toBeInTheDocument();
    expect(screen.getByText(/Tick/)).toBeInTheDocument();
    expect(screen.getByText(/Step/)).toBeInTheDocument();
    expect(screen.getByText(/Min Qty/)).toBeInTheDocument();
    expect(screen.getByText(/Min Notional/)).toBeInTheDocument();
    expect(screen.getAllByText("qty").length).toBe(2);
    const metricGrid = screen.getByText("Bid").parentElement?.parentElement;
    expect(metricGrid?.className).toContain("min-w-0");
    expect(metricGrid?.className).toContain("max-w-full");
    expect(metricGrid?.className).toContain("grid");
    expect(metricGrid?.className).toContain("grid-cols-2");
    expect(metricGrid?.className).toContain("sm:grid-cols-3");
    expect(metricGrid?.className).toContain(
      "lg:grid-cols-[minmax(190px,240px)_repeat(5,minmax(90px,1fr))]",
    );
    const contractRow = screen.getByText(/Tick/).closest("div");
    expect(contractRow?.className).toContain("border-t");
    expect(contractRow?.className).toContain("min-w-0");
    expect(contractRow?.className).toContain("lg:justify-between");
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
    expect(screen.getByText("100000.10")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRADE_MARK_STALE_MS);
    });

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("100000.10")).toBeInTheDocument();
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

  it("formats market prices adaptively and keeps quantities, funding, and specs exact", () => {
    const now = Date.now();
    const markPrice = "123456789.123456789012345678";
    const indexPrice = "123456788.123456789012345678";
    const fundingRate = "0.000123456789012345678";
    const bestBidPrice = "123456787.123456789012345678";
    const bestBidQty = "123456.123456789012345678";
    const bestAskPrice = "123456790.123456789012345678";
    const bestAskQty = "654321.123456789012345678";

    useRealtimeStatusStore.setState({ market: "ready" });
    useMarketStore.getState().applyMark({
      type: "market.mark",
      symbol: "BTCUSDT",
      markPrice,
      indexPrice,
      fundingRate,
      nextFundingTime: now + 28_800_000,
      markEventTime: now,
    });
    useMarketStore.getState().applyBbo({
      type: "market.bbo",
      symbol: "BTCUSDT",
      bestBidPrice,
      bestBidQty,
      bestAskPrice,
      bestAskQty,
      bookEventTime: now,
    });

    const { container } = render(<MarketTicker symbol="BTCUSDT" instrument={instrument} />);

    const formattedMark = formatAdaptiveMarketPriceDisplay(markPrice);
    const formattedIndex = formatAdaptiveMarketPriceDisplay(indexPrice);
    const formattedBid = formatAdaptiveMarketPriceDisplay(bestBidPrice);
    const formattedAsk = formatAdaptiveMarketPriceDisplay(bestAskPrice);

    const mark = screen.getByText(formattedMark);
    expect(mark.textContent).toBe(formattedMark);
    expect(mark.className).toContain("text-2xl");
    expect(mark.className).toContain("min-w-0");
    expect(mark.className).toContain("max-w-full");

    expect(screen.getAllByText(formattedIndex)).toHaveLength(1);
    expect(screen.getByText(formattedBid).textContent).toBe(formattedBid);
    expect(screen.getByText(formattedAsk).textContent).toBe(formattedAsk);
    expect(screen.getByText(formattedBid).className).toContain("text-positive");
    expect(screen.getByText(formattedAsk).className).toContain("text-negative");
    expect(screen.getByText(fundingRate).textContent).toBe(fundingRate);

    const bidQty = screen.getByText(bestBidQty);
    expect(bidQty.textContent).toBe(bestBidQty);
    expect(screen.getByText(bestAskQty).textContent).toBe(bestAskQty);
    expect(screen.queryByText(markPrice)).not.toBeInTheDocument();
    expect(screen.getByText("0.1")).toBeInTheDocument();
    expect(screen.getAllByText("0.001").length).toBe(2);
    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(container.firstElementChild?.className).toContain("max-w-full");
    expect(container.firstElementChild?.className).toContain("flex-col");
  });

  it("renders compact UTC next funding without local-time conversion", () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 9, 5, 12, 0, 0);
    vi.setSystemTime(now);
    useRealtimeStatusStore.setState({ market: "ready" });
    useMarketStore.getState().applyMark({
      type: "market.mark",
      symbol: "BTCUSDT",
      markPrice: "2.17821529",
      indexPrice: "2.17875000",
      fundingRate: "0.00005000",
      nextFundingTime: Date.UTC(2026, 9, 5, 20, 0, 0),
      markEventTime: now,
    });
    render(<MarketTicker symbol="BTCUSDT" instrument={instrument} />);
    expect(screen.getByText("2.17822")).toBeInTheDocument();
    expect(screen.getAllByText("2.17875")).toHaveLength(1);
    expect(screen.getByText("0.00005000")).toBeInTheDocument();
    expect(screen.getByText("20:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("2026-10-05 20:00:00 UTC")).not.toBeInTheDocument();
    expect(formatCompactEpochMsUtc(Date.UTC(2026, 9, 6, 20, 0, 0), now)).toBe("06 Oct · 20:00 UTC");
  });
});
