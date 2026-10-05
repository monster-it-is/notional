import type { Candle, CandleInterval, CandleListResponse, MarketCandleMessage } from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarketChart } from "./MarketChart.tsx";
import { getCandles, TRADE_CHART_LIMIT, TRADE_CHART_MAX_CANDLES } from "../../lib/api/candles.ts";
import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  toChartLinePoints,
} from "../../lib/chart/to-chart-candles.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { ThemeProvider, useTheme } from "../../theme/ThemeProvider.tsx";
import { ApiError } from "../../lib/api/errors.ts";

const VOLUME_COLORS = { up: "#2ebd85", down: "#f0544c" };

const {
  createChart,
  remove,
  fitContent,
  addSeries,
  chartApplyOptions,
  candlestick,
  line,
  volume,
  subscribeVisibleLogicalRangeChange,
  unsubscribeVisibleLogicalRangeChange,
  getVisibleLogicalRange,
  setVisibleLogicalRange,
  rangeListeners,
} = vi.hoisted(() => {
  const rangeListeners = new Set<(range: { from: number; to: number } | null) => void>();
  const candlestick = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    barsInLogicalRange: vi.fn(() => ({ barsBefore: 0, barsAfter: 0 })),
  };
  const line = { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn() };
  const volume = { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn() };
  const fitContent = vi.fn();
  const getVisibleLogicalRange = vi.fn(() => ({ from: 2, to: 8 }));
  const setVisibleLogicalRange = vi.fn();
  const subscribeVisibleLogicalRangeChange = vi.fn(
    (handler: (range: { from: number; to: number } | null) => void) => {
      rangeListeners.add(handler);
    },
  );
  const unsubscribeVisibleLogicalRangeChange = vi.fn(
    (handler: (range: { from: number; to: number } | null) => void) => {
      rangeListeners.delete(handler);
    },
  );
  const chartApplyOptions = vi.fn();
  const addSeries = vi.fn((definition: { type: string }) => {
    if (definition.type === "Line") {
      return line;
    }

    if (definition.type === "Histogram") {
      return volume;
    }

    return candlestick;
  });
  const createChart = vi.fn(() => ({
    addSeries,
    applyOptions: chartApplyOptions,
    timeScale: () => ({
      fitContent,
      subscribeVisibleLogicalRangeChange,
      unsubscribeVisibleLogicalRangeChange,
      getVisibleLogicalRange,
      setVisibleLogicalRange,
    }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    remove,
  }));
  const remove = vi.fn();
  return {
    createChart,
    remove,
    fitContent,
    addSeries,
    chartApplyOptions,
    candlestick,
    line,
    volume,
    subscribeVisibleLogicalRangeChange,
    unsubscribeVisibleLogicalRangeChange,
    getVisibleLogicalRange,
    setVisibleLogicalRange,
    rangeListeners,
  };
});

const marketSocket = vi.hoisted(() => {
  const candleListeners = new Set<(message: MarketCandleMessage) => void>();
  const reconnectListeners = new Set<() => void>();
  return {
    candleListeners,
    reconnectListeners,
    setDesiredCandle: vi.fn(),
    subscribeMarketCandles: vi.fn((listener: (message: MarketCandleMessage) => void) => {
      candleListeners.add(listener);
      return () => {
        candleListeners.delete(listener);
      };
    }),
    subscribeReconnectReady: vi.fn((listener: () => void) => {
      reconnectListeners.add(listener);
      return () => {
        reconnectListeners.delete(listener);
      };
    }),
    emitCandle(message: MarketCandleMessage) {
      for (const listener of candleListeners) {
        listener(message);
      }
    },
    emitReconnect() {
      for (const listener of reconnectListeners) {
        listener();
      }
    },
  };
});

vi.mock("lightweight-charts", () => ({
  createChart,
  CandlestickSeries: { type: "Candlestick" },
  LineSeries: { type: "Line" },
  HistogramSeries: { type: "Histogram" },
  ColorType: { Solid: "solid" },
}));

vi.mock("../../lib/api/candles.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/candles.ts")>();
  return {
    ...actual,
    getCandles: vi.fn(),
  };
});

vi.mock("../../realtime/runtime.ts", () => ({
  getMarketSocket: () => marketSocket,
}));

const mockedGetCandles = vi.mocked(getCandles);

const btcCandle: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_040_899_999,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

const btcCandles: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [btcCandle],
};

const ethCandles: CandleListResponse = {
  symbol: "ETHUSDT",
  interval: "15m",
  candles: [
    {
      ...btcCandle,
      open: "200.00",
      high: "220.00",
      low: "180.00",
      close: "210.00",
    },
  ],
};

function liveFrame(overrides: Partial<MarketCandleMessage> = {}): MarketCandleMessage {
  return {
    type: "market.candle",
    symbol: "BTCUSDT",
    interval: "15m",
    openTime: btcCandle.openTime,
    closeTime: btcCandle.closeTime,
    open: btcCandle.open,
    high: btcCandle.high,
    low: btcCandle.low,
    close: btcCandle.close,
    volume: btcCandle.volume,
    isClosed: false,
    ...overrides,
  };
}

function aligned(candles: Candle[]) {
  return toAlignedChartPoints(candles);
}

function coloredVolume(candles: Candle[]) {
  const points = aligned(candles);
  return colorChartVolumePoints(points.volume, points.candles, VOLUME_COLORS);
}

function ThemeToggleProbe() {
  const { theme, setTheme } = useTheme();

  return (
    <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Toggle theme
    </button>
  );
}

function renderChart(
  symbol: string | null = "BTCUSDT",
  strict = false,
  {
    themeToggle = false,
    interval = "15m",
    onIntervalChange = vi.fn(),
  }: {
    themeToggle?: boolean;
    interval?: CandleInterval;
    onIntervalChange?: (interval: CandleInterval) => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {themeToggle ? <ThemeToggleProbe /> : null}
        <MarketChart symbol={symbol} interval={interval} onIntervalChange={onIntervalChange} />
      </QueryClientProvider>
    </ThemeProvider>
  );

  return { ...render(strict ? <StrictMode>{tree}</StrictMode> : tree), client };
}

function emitVisibleRange(range: { from: number; to: number } | null = { from: 0, to: 10 }) {
  for (const handler of rangeListeners) {
    handler(range);
  }
}

function olderCandle(openTime = btcCandle.openTime - 900_000): Candle {
  return {
    ...btcCandle,
    openTime,
    closeTime: openTime + 899_999,
    close: "99.00",
  };
}

describe("MarketChart", () => {
  beforeEach(() => {
    mockedGetCandles.mockReset();
    createChart.mockClear();
    candlestick.setData.mockClear();
    candlestick.setData.mockImplementation(() => undefined);
    candlestick.update.mockClear();
    candlestick.applyOptions.mockClear();
    line.setData.mockClear();
    line.update.mockClear();
    line.applyOptions.mockClear();
    volume.setData.mockClear();
    volume.update.mockClear();
    volume.applyOptions.mockClear();
    remove.mockClear();
    fitContent.mockClear();
    fitContent.mockImplementation(() => undefined);
    addSeries.mockClear();
    chartApplyOptions.mockClear();
    subscribeVisibleLogicalRangeChange.mockClear();
    unsubscribeVisibleLogicalRangeChange.mockClear();
    getVisibleLogicalRange.mockClear();
    setVisibleLogicalRange.mockClear();
    candlestick.barsInLogicalRange.mockClear();
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 0, barsAfter: 0 });
    getVisibleLogicalRange.mockReturnValue({ from: 2, to: 8 });
    rangeListeners.clear();
    marketSocket.setDesiredCandle.mockClear();
    marketSocket.subscribeMarketCandles.mockClear();
    marketSocket.subscribeReconnectReady.mockClear();
    marketSocket.candleListeners.clear();
    marketSocket.reconnectListeners.clear();
    mockedGetCandles.mockResolvedValue(btcCandles);
  });

  it("shows a loading skeleton while historical candles load", () => {
    mockedGetCandles.mockReturnValue(new Promise(() => undefined));
    renderChart();
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BTCUSDT" }).className).toContain("shrink-0");
    expect(screen.getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1h" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Line" })).toBeEnabled();
    expect(screen.getByText("Loading historical candles")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Chart interval" }).className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "1m" }).className).toContain("min-w-11");
    expect(createChart).not.toHaveBeenCalled();
  });

  it("shows an API error without crashing and keeps interval controls usable", async () => {
    const user = userEvent.setup();
    const onIntervalChange = vi.fn();
    mockedGetCandles.mockRejectedValue(
      new ApiError({ status: 503, code: "MARKET_DATA_UNAVAILABLE" }),
    );
    renderChart("BTCUSDT", false, { onIntervalChange });
    expect(await screen.findByRole("alert")).toHaveTextContent("MARKET_DATA_UNAVAILABLE");
    expect(screen.getByRole("alert").parentElement?.className).toContain("h-72");
    expect(screen.getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1h" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "1h" }));
    expect(onIntervalChange).toHaveBeenCalledWith("1h");
    expect(createChart).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no candles", async () => {
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: [] });
    renderChart();
    expect(await screen.findByText("No candle data available")).toBeInTheDocument();
    expect(screen.getByText("No candle data available").parentElement?.className).toContain("h-72");
    expect(screen.getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toBeEnabled();
    expect(createChart).not.toHaveBeenCalled();
  });

  it("passes adapted historical candles, line closes, and volume into the series with setData", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(mockedGetCandles).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 500,
    });
    expect(createChart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ autoSize: true }),
    );
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(candlestick.setData).toHaveBeenCalledTimes(1);
    expect(candlestick.setData).toHaveBeenCalledWith(aligned(btcCandles.candles).candles);
    expect(line.setData).toHaveBeenCalledTimes(1);
    expect(line.setData).toHaveBeenCalledWith(toChartLinePoints(btcCandles.candles));
    expect(volume.setData).toHaveBeenCalledTimes(1);
    expect(volume.setData).toHaveBeenCalledWith(coloredVolume(btcCandles.candles));
    expect(candlestick.update).not.toHaveBeenCalled();
    expect(line.update).not.toHaveBeenCalled();
    expect(volume.update).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(marketSocket.setDesiredCandle).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });
  });

  it("requests 1h history and subscribes to the 1h live candle pair", async () => {
    mockedGetCandles.mockResolvedValue({ ...btcCandles, interval: "1h" });
    renderChart("BTCUSDT", false, { interval: "1h" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(mockedGetCandles).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1h",
      limit: 500,
    });
    expect(marketSocket.setDesiredCandle).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "1h",
    });
  });

  it("updates the live current candle on all three series with update", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    const next = [{ ...btcCandle, close: "106.00" }];
    expect(candlestick.update).toHaveBeenCalledWith(aligned(next).candles[0]);
    expect(line.update).toHaveBeenCalledWith(toChartLinePoints(next)[0]);
    expect(volume.update).toHaveBeenCalledWith(coloredVolume(next)[0]);
    expect(candlestick.setData).toHaveBeenCalledTimes(1);
    expect(line.setData).toHaveBeenCalledTimes(1);
    expect(volume.setData).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not resubscribe the desired candle when same-symbol live data rerenders", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(marketSocket.setDesiredCandle).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });
    expect(marketSocket.setDesiredCandle).not.toHaveBeenCalledWith(null);
    const desiredCalls = marketSocket.setDesiredCandle.mock.calls.map((call) => call[0]);
    const subscribeCalls = marketSocket.subscribeMarketCandles.mock.calls.length;
    const reconnectCalls = marketSocket.subscribeReconnectReady.mock.calls.length;

    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ close: "107.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        close: "108.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(3));

    expect(marketSocket.setDesiredCandle.mock.calls.map((call) => call[0])).toEqual(desiredCalls);
    expect(marketSocket.setDesiredCandle).not.toHaveBeenCalledWith(null);
    expect(marketSocket.subscribeMarketCandles.mock.calls.length).toBe(subscribeCalls);
    expect(marketSocket.subscribeReconnectReady.mock.calls.length).toBe(reconnectCalls);
  });

  it("appends the next candle with series.update on all three series", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        close: "108.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    expect(line.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
    expect(candlestick.setData).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("uses setData on all three series when older history changes", async () => {
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const repaired: Candle[] = [
      { ...btcCandle, open: "99.00" },
      {
        ...btcCandle,
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        close: "108.00",
      },
    ];
    client.setQueryData(
      queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: "15m",
        limit: TRADE_CHART_LIMIT,
      }),
      {
        ...btcCandles,
        candles: repaired,
      },
    );
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
    expect(line.setData).toHaveBeenCalledTimes(2);
    expect(volume.setData).toHaveBeenCalledTimes(2);
    expect(volume.setData).toHaveBeenLastCalledWith(coloredVolume(repaired));
    expect(candlestick.update).not.toHaveBeenCalled();
    expect(line.update).not.toHaveBeenCalled();
    expect(volume.update).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("appends the 501st live candle with update and does not trim to 500", async () => {
    const windowed: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 500 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockResolvedValue(windowed);
    const { client } = renderChart();
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(1));
    const last = windowed.candles[windowed.candles.length - 1]!;
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "9.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    expect(candlestick.setData).toHaveBeenCalledTimes(1);
    expect(line.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(
      client.getQueryData(
        queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
      ),
    ).toEqual({
      ...windowed,
      candles: [
        ...windowed.candles,
        {
          ...btcCandle,
          openTime: last.openTime + 900_000,
          closeTime: last.closeTime + 900_000,
          close: "9.00",
        },
      ],
    });
  });

  it("loads a new query when the selected symbol changes", async () => {
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT" ? ethCandles : btcCandles,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTCUSDT" })),
    );
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(candlestick.setData).toHaveBeenCalledWith(aligned(btcCandles.candles).candles);
    expect(fitContent).toHaveBeenCalledTimes(1);

    view.rerender(tree("ETHUSDT"));
    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ETHUSDT" })),
    );
    await waitFor(() => expect(remove).toHaveBeenCalled());
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(addSeries).toHaveBeenCalledTimes(6));
    expect(candlestick.setData).toHaveBeenLastCalledWith(aligned(ethCandles.candles).candles);
    expect(line.setData).toHaveBeenLastCalledWith(toChartLinePoints(ethCandles.candles));
    expect(volume.setData).toHaveBeenLastCalledWith(coloredVolume(ethCandles.candles));
    expect(fitContent).toHaveBeenCalledTimes(2);
    expect(marketSocket.setDesiredCandle.mock.calls.map((call) => call[0])).toEqual([
      { symbol: "BTCUSDT", interval: "15m" },
      null,
      { symbol: "ETHUSDT", interval: "15m" },
    ]);
  });

  it("replaces history when the selected interval changes and does not treat it as a live update", async () => {
    const hourCandles: CandleListResponse = { ...btcCandles, interval: "1h" };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcCandles,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(marketSocket.setDesiredCandle).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });

    view.rerender(tree("1h"));
    expect(await screen.findByText("Loading historical candles")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: 500,
      }),
    );
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    expect(candlestick.setData).toHaveBeenLastCalledWith(aligned(hourCandles.candles).candles);
    expect(line.setData).toHaveBeenLastCalledWith(toChartLinePoints(hourCandles.candles));
    expect(volume.setData).toHaveBeenLastCalledWith(coloredVolume(hourCandles.candles));
    expect(candlestick.update).not.toHaveBeenCalled();
    expect(line.update).not.toHaveBeenCalled();
    expect(volume.update).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(2);
    expect(marketSocket.setDesiredCandle.mock.calls.map((call) => call[0])).toEqual([
      { symbol: "BTCUSDT", interval: "15m" },
      null,
      { symbol: "BTCUSDT", interval: "1h" },
    ]);
  });

  it("keeps the final interval identity when switches happen before REST completes", async () => {
    const resolvers = new Map<CandleInterval, (value: CandleListResponse) => void>();
    mockedGetCandles.mockImplementation(
      ({ interval }) =>
        new Promise((resolve) => {
          resolvers.set(interval, resolve);
        }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    expect(await screen.findByText("Loading historical candles")).toBeInTheDocument();

    view.rerender(tree("1h"));
    view.rerender(tree("5m"));
    view.rerender(tree("1d"));
    expect(screen.getByRole("button", { name: "1d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Loading historical candles")).toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith({
      symbol: "BTCUSDT",
      interval: "1d",
    });

    resolvers.get("15m")?.({ ...btcCandles, interval: "15m" });
    resolvers.get("1h")?.({ ...btcCandles, interval: "1h" });
    resolvers.get("5m")?.({ ...btcCandles, interval: "5m" });
    await waitFor(() =>
      expect(
        client.getQueryData(
          queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ),
      ).toEqual({ ...btcCandles, interval: "15m" }),
    );
    expect(createChart).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "1d" })).toHaveAttribute("aria-pressed", "true");

    resolvers.get("1d")?.({ ...btcCandles, interval: "1d" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(candlestick.setData).toHaveBeenCalledTimes(1);
    expect(line.setData).toHaveBeenCalledTimes(1);
    expect(volume.setData).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 1d historical candlestick chart",
    );

    marketSocket.emitCandle(liveFrame({ interval: "15m", close: "106.00" }));
    expect(candlestick.update).not.toHaveBeenCalled();
    marketSocket.emitCandle(liveFrame({ interval: "1d", close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    expect(line.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
  });

  it("keeps the final symbol and interval identity when both change before REST completes", async () => {
    const resolvers = new Map<string, (value: CandleListResponse) => void>();
    mockedGetCandles.mockImplementation(
      ({ symbol, interval }) =>
        new Promise((resolve) => {
          resolvers.set(`${symbol}:${interval}`, resolve);
        }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (symbol: string, interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT", "15m"));
    expect(await screen.findByText("Loading historical candles")).toBeInTheDocument();

    view.rerender(tree("ETHUSDT", "15m"));
    view.rerender(tree("ETHUSDT", "1h"));
    view.rerender(tree("BTCUSDT", "5m"));
    expect(screen.getByRole("heading", { name: "BTCUSDT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5m" })).toHaveAttribute("aria-pressed", "true");
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith({
      symbol: "BTCUSDT",
      interval: "5m",
    });

    resolvers.get("BTCUSDT:15m")?.({ ...btcCandles, interval: "15m" });
    resolvers.get("ETHUSDT:15m")?.({ ...ethCandles, interval: "15m" });
    resolvers.get("ETHUSDT:1h")?.({ ...ethCandles, interval: "1h" });
    await waitFor(() =>
      expect(
        client.getQueryData(
          queryKeys.candles.list({ symbol: "ETHUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
        ),
      ).toEqual({ ...ethCandles, interval: "1h" }),
    );
    expect(createChart).not.toHaveBeenCalled();

    marketSocket.emitCandle(liveFrame({ symbol: "ETHUSDT", interval: "1h", close: "211.00" }));
    expect(candlestick.update).not.toHaveBeenCalled();

    resolvers.get("BTCUSDT:5m")?.({ ...btcCandles, interval: "5m" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 5m historical candlestick chart",
    );

    marketSocket.emitCandle(liveFrame({ symbol: "ETHUSDT", interval: "15m", close: "211.00" }));
    expect(candlestick.update).not.toHaveBeenCalled();
    marketSocket.emitCandle(liveFrame({ interval: "5m", close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
  });

  it("keeps local chart mode while an uncached interval is loading", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolveHour: (value: CandleListResponse) => void = () => undefined;
    mockedGetCandles.mockImplementation(({ interval }) => {
      if (interval === "1h") {
        return new Promise((resolve) => {
          resolveHour = resolve;
        });
      }

      return Promise.resolve(btcCandles);
    });
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");

    view.rerender(tree("1h"));
    expect(await screen.findByText("Loading historical candles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    resolveHour({ ...btcCandles, interval: "1h" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "BTCUSDT 1h historical line chart");
  });

  it("ignores a live 15m frame while the active interval is 1h", async () => {
    mockedGetCandles.mockResolvedValue({ ...btcCandles, interval: "1h" });
    renderChart("BTCUSDT", false, { interval: "1h" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.setData.mockClear();
    line.setData.mockClear();
    volume.setData.mockClear();

    marketSocket.emitCandle(liveFrame({ interval: "15m", close: "106.00" }));
    await waitFor(() => expect(candlestick.update).not.toHaveBeenCalled());
    expect(line.update).not.toHaveBeenCalled();
    expect(volume.update).not.toHaveBeenCalled();
    expect(candlestick.setData).not.toHaveBeenCalled();

    marketSocket.emitCandle(liveFrame({ interval: "1h", close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    expect(line.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
  });

  it("repairs history with setData after a reconnect refetch of the current interval", async () => {
    const later: Candle = {
      ...btcCandle,
      openTime: 1_499_040_900_000,
      closeTime: 1_499_041_799_999,
      close: "108.00",
    };
    mockedGetCandles.mockResolvedValue({
      ...btcCandles,
      interval: "1h",
      candles: [btcCandle, later],
    });
    renderChart("BTCUSDT", false, { interval: "1h" });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    mockedGetCandles.mockResolvedValue({
      ...btcCandles,
      interval: "1h",
      candles: [{ ...btcCandle, open: "98.00" }, later],
    });
    marketSocket.emitReconnect();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    expect(mockedGetCandles).toHaveBeenLastCalledWith(
      {
        symbol: "BTCUSDT",
        interval: "1h",
        limit: 500,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
    expect(line.setData).toHaveBeenCalledTimes(2);
    expect(volume.setData).toHaveBeenCalledTimes(2);
    expect(candlestick.setData).toHaveBeenLastCalledWith(
      aligned([{ ...btcCandle, open: "98.00" }, later]).candles,
    );
    expect(candlestick.update).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("toggles Candles and Line without recreating, refetching, or refitting", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const subscribeCalls = marketSocket.subscribeMarketCandles.mock.calls.length;
    const reconnectCalls = marketSocket.subscribeReconnectReady.mock.calls.length;
    const desiredCalls = marketSocket.setDesiredCandle.mock.calls.length;
    candlestick.applyOptions.mockClear();
    line.applyOptions.mockClear();

    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 15m historical line chart",
    );
    expect(line.applyOptions).toHaveBeenCalledWith({ visible: true });
    expect(candlestick.applyOptions).toHaveBeenCalledWith({ visible: false });
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(marketSocket.subscribeMarketCandles.mock.calls.length).toBe(subscribeCalls);
    expect(marketSocket.subscribeReconnectReady.mock.calls.length).toBe(reconnectCalls);
    expect(marketSocket.setDesiredCandle.mock.calls.length).toBe(desiredCalls);

    await user.click(screen.getByRole("button", { name: "Candles" }));
    expect(screen.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
    expect(line.applyOptions).toHaveBeenCalledWith({ visible: false });
    expect(candlestick.applyOptions).toHaveBeenCalledWith({ visible: true });
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 15m historical candlestick chart",
    );
  });

  it("applies live updates to all three series after toggling Line", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(line.update).toHaveBeenCalledTimes(1));
    expect(candlestick.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 15m historical line chart",
    );
  });

  it("exposes accessible timeframe and mode controls", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    for (const interval of CANDLE_INTERVALS) {
      expect(screen.getByRole("button", { name: interval })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "BTCUSDT 15m historical candlestick chart",
    );
  });

  it("notifies the parent when a timeframe is selected", async () => {
    const user = userEvent.setup();
    const onIntervalChange = vi.fn();
    renderChart("BTCUSDT", false, { onIntervalChange });
    await user.click(await screen.findByRole("button", { name: "5m" }));
    expect(onIntervalChange).toHaveBeenCalledWith("5m");
  });

  it("applies theme colors without recreating the chart", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));

    chartApplyOptions.mockClear();
    candlestick.applyOptions.mockClear();
    line.applyOptions.mockClear();
    volume.applyOptions.mockClear();
    const volumeSetsBeforeTheme = volume.setData.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    await waitFor(() => expect(chartApplyOptions).toHaveBeenCalled());
    expect(candlestick.applyOptions).toHaveBeenCalled();
    expect(line.applyOptions).toHaveBeenCalled();
    expect(volume.applyOptions).toHaveBeenCalled();
    expect(volume.setData.mock.calls.length).toBeGreaterThan(volumeSetsBeforeTheme);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(remove).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(1);

    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    expect(line.update).toHaveBeenCalledTimes(1);
    expect(volume.update).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("disposes the chart on unmount including Strict Mode remount", async () => {
    const view = renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    expect(marketSocket.candleListeners.size).toBe(1);
    expect(marketSocket.reconnectListeners.size).toBe(1);
    expect(rangeListeners.size).toBe(1);
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });
    const lastSubscribe = subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    const removesBeforeUnmount = remove.mock.calls.length;
    view.unmount();
    expect(remove.mock.calls.length).toBeGreaterThan(removesBeforeUnmount);
    expect(unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledWith(lastSubscribe);
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith(null);
    expect(marketSocket.candleListeners.size).toBe(0);
    expect(marketSocket.reconnectListeners.size).toBe(0);
    expect(rangeListeners.size).toBe(0);
  });

  it("does not request older history for the initial latest load or fitContent overview", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
    expect(mockedGetCandles).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 500,
    });
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 0, barsAfter: 0 });
    emitVisibleRange({ from: 0, to: 20 });
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument();
  });

  it("requests older history from the left edge using barsInLogicalRange", async () => {
    const older = olderCandle();
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [older] };
      }

      return btcCandles;
    });
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 10, barsAfter: 80 });
    emitVisibleRange({ from: 0.25, to: 8 });
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(
        {
          symbol: "BTCUSDT",
          interval: "15m",
          limit: 500,
          before: btcCandle.openTime,
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    await waitFor(() =>
      expect(
        client.getQueryData(
          queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ),
      ).toEqual({
        ...btcCandles,
        candles: [older, btcCandle],
      }),
    );
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
    expect(line.setData).toHaveBeenCalledTimes(2);
    expect(volume.setData).toHaveBeenCalledTimes(2);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(setVisibleLogicalRange).toHaveBeenCalledWith({ from: 3, to: 9 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument());
    expect(candlestick.barsInLogicalRange).toHaveBeenCalled();
  });

  it("ignores repeated range events while an older request is in flight", async () => {
    let resolveOlder: (value: CandleListResponse) => void = () => undefined;
    mockedGetCandles.mockImplementation((params) => {
      if (params.before) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }

      return Promise.resolve(btcCandles);
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    emitVisibleRange();
    emitVisibleRange();
    await waitFor(() => expect(screen.getByText("Loading older data…")).toBeInTheDocument());
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    expect(
      mockedGetCandles.mock.calls.filter((call) => call[0].before !== undefined),
    ).toHaveLength(1);
    resolveOlder({ ...btcCandles, candles: [olderCandle()] });
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
  });

  it("preserves a live candle that arrives while older history is pending", async () => {
    let resolveOlder: (value: CandleListResponse) => void = () => undefined;
    mockedGetCandles.mockImplementation((params) => {
      if (params.before) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }

      return Promise.resolve(btcCandles);
    });
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(1));
    const older = olderCandle();
    resolveOlder({ ...btcCandles, candles: [older, { ...btcCandle, close: "90.00" }] });
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
    expect(
      client.getQueryData(
        queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
      ),
    ).toEqual({
      ...btcCandles,
      candles: [older, { ...btcCandle, close: "106.00" }],
    });
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("keeps prepended history after reconnect repair", async () => {
    const older = olderCandle();
    const later: Candle = {
      ...btcCandle,
      openTime: btcCandle.openTime + 900_000,
      closeTime: btcCandle.closeTime + 900_000,
      close: "108.00",
    };
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [older] };
      }

      return { ...btcCandles, candles: [btcCandle] };
    });
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() =>
      expect(
        (client.getQueryData(
          queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ) as CandleListResponse).candles,
      ).toHaveLength(2),
    );
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [older] };
      }

      return {
        ...btcCandles,
        candles: [{ ...btcCandle, open: "98.00" }, later],
      };
    });
    marketSocket.emitReconnect();
    await waitFor(() =>
      expect(
        client.getQueryData(
          queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ),
      ).toEqual({
        ...btcCandles,
        candles: [older, { ...btcCandle, open: "98.00" }, later],
      }),
    );
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("stops requesting older history after a short page", async () => {
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [] };
      }

      return btcCandles;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 0, barsAfter: 0 });
    emitVisibleRange({ from: 4, to: 20 });
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    expect(mockedGetCandles).toHaveBeenCalledTimes(2);
  });

  it("keeps the chart after a historical error and retries after leaving the edge", async () => {
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        throw new ApiError({ status: 503, code: "MARKET_DATA_UNAVAILABLE" });
      }

      return btcCandles;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    emitVisibleRange();
    expect(mockedGetCandles).toHaveBeenCalledTimes(2);
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 80, barsAfter: 10 });
    emitVisibleRange({ from: 20, to: 40 });
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(3));
  });

  it("does not let a stale older page contaminate the active symbol", async () => {
    let resolveBtcOlder: (value: CandleListResponse) => void = () => undefined;
    mockedGetCandles.mockImplementation(({ symbol: requested, before }) => {
      if (requested === "ETHUSDT") {
        return Promise.resolve(ethCandles);
      }

      if (before) {
        return new Promise((resolve) => {
          resolveBtcOlder = resolve;
        });
      }

      return Promise.resolve(btcCandles);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (nextSymbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={nextSymbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    resolveBtcOlder({ ...btcCandles, candles: [olderCandle()] });
    await waitFor(() =>
      expect(
        client.getQueryData(
          queryKeys.candles.list({ symbol: "ETHUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ),
      ).toEqual(ethCandles),
    );
    expect(candlestick.setData).toHaveBeenLastCalledWith(aligned(ethCandles.candles).candles);
  });

  it("aborts an in-flight older request on unmount without mutating cache", async () => {
    const signals: AbortSignal[] = [];
    mockedGetCandles.mockImplementation((params, options) => {
      if (params.before) {
        if (options?.signal) {
          signals.push(options.signal);
        }

        return new Promise(() => undefined);
      }

      return Promise.resolve(btcCandles);
    });
    const { client, unmount } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0]?.aborted).toBe(true);
    expect(
      client.getQueryData(
        queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
      ),
    ).toEqual(btcCandles);
    emitVisibleRange();
    expect(mockedGetCandles.mock.calls.filter((call) => call[0].before !== undefined)).toHaveLength(
      1,
    );
  });

  it("does not treat an aborted older request as a failed cursor", async () => {
    mockedGetCandles.mockImplementation((params, options) => {
      if (params.before) {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new ApiError({ status: 0, code: "NETWORK_ERROR" }));
          });
        });
      }

      return Promise.resolve(btcCandles);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (nextInterval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={nextInterval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, interval: "1h", candles: [olderCandle()] };
      }

      return { ...btcCandles, interval: "1h" };
    });
    view.rerender(tree("1h"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    emitVisibleRange();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(
        expect.objectContaining({ interval: "1h", before: btcCandle.openTime }),
        expect.anything(),
      ),
    );
  });

  it("requests a partial older page when remaining capacity is below 500", async () => {
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 9_800 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return {
          ...btcCandles,
          candles: [
            olderCandle(filled.candles[0]!.openTime - 900_000),
          ],
        };
      }

      return filled;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(
        {
          symbol: "BTCUSDT",
          interval: "15m",
          limit: 200,
          before: filled.candles[0]!.openTime,
        },
        expect.anything(),
      ),
    );
  });

  it("does not request older history at the 10_000 cap", async () => {
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: TRADE_CHART_MAX_CANDLES }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockResolvedValue(filled);
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    expect(mockedGetCandles).toHaveBeenCalledTimes(1);
  });

  it("trims oldest candles when a live append exceeds 10_000", async () => {
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: TRADE_CHART_MAX_CANDLES }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockResolvedValue(filled);
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const last = filled.candles[filled.candles.length - 1]!;
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "9.00",
      }),
    );
    await waitFor(() => expect(candlestick.setData).toHaveBeenCalledTimes(2));
    const cached = client.getQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
    ) as CandleListResponse;
    expect(cached.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(cached.candles[0]?.openTime).toBe(filled.candles[1]?.openTime);
    expect(cached.candles.at(-1)?.close).toBe("9.00");
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("caps older history when a live append fills remaining capacity during backfill", async () => {
    let resolveOlder: (value: CandleListResponse) => void = () => undefined;
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 9_999 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockImplementation((params) => {
      if (params.before) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }

      return Promise.resolve(filled);
    });
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(
        {
          symbol: "BTCUSDT",
          interval: "15m",
          limit: 1,
          before: filled.candles[0]!.openTime,
        },
        expect.anything(),
      ),
    );
    const last = filled.candles[filled.candles.length - 1]!;
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "9.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    const older = olderCandle(filled.candles[0]!.openTime - 900_000);
    resolveOlder({ ...btcCandles, candles: [older] });
    await waitFor(() => expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument());
    const cached = client.getQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
    ) as CandleListResponse;
    expect(cached.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(cached.candles[0]?.openTime).toBe(filled.candles[0]?.openTime);
    expect(cached.candles.at(-1)?.close).toBe("9.00");
    expect(cached.candles.some((candle) => candle.openTime === older.openTime)).toBe(false);
    expect(setVisibleLogicalRange).not.toHaveBeenCalled();
  });

  it("caps older history when reconnect repair grows the cache during backfill", async () => {
    let resolveOlder: (value: CandleListResponse) => void = () => undefined;
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 9_999 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockImplementation((params) => {
      if (params.before) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }

      return Promise.resolve(filled);
    });
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    const last = filled.candles[filled.candles.length - 1]!;
    const later: Candle = {
      ...last,
      openTime: last.openTime + 900_000,
      closeTime: last.closeTime + 900_000,
      close: "108.00",
    };
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [olderCandle(filled.candles[0]!.openTime - 900_000)] };
      }

      return {
        ...btcCandles,
        candles: [...filled.candles.slice(-TRADE_CHART_LIMIT), later],
      };
    });
    marketSocket.emitReconnect();
    await waitFor(() =>
      expect(
        (client.getQueryData(
          queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
        ) as CandleListResponse).candles.at(-1)?.close,
      ).toBe("108.00"),
    );
    const older = olderCandle(filled.candles[0]!.openTime - 900_000);
    resolveOlder({ ...btcCandles, candles: [older] });
    await waitFor(() => expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument());
    const cached = client.getQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
    ) as CandleListResponse;
    expect(cached.candles).toHaveLength(TRADE_CHART_MAX_CANDLES);
    expect(cached.candles.at(-1)?.close).toBe("108.00");
    expect(cached.candles.some((candle) => candle.openTime === older.openTime)).toBe(false);
  });

  it("does not let a setData range event request older history for the previous identity", async () => {
    const hourCandles: CandleListResponse = { ...btcCandles, interval: "1h" };
    mockedGetCandles.mockImplementation(async ({ interval, before }) => {
      if (before) {
        return {
          symbol: "BTCUSDT",
          interval,
          candles: [olderCandle()],
        };
      }

      return interval === "1h" ? hourCandles : btcCandles;
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (nextInterval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={nextInterval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    client.setQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
      hourCandles,
    );
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    candlestick.setData.mockImplementation(() => {
      emitVisibleRange();
    });
    fitContent.mockImplementation(() => {
      emitVisibleRange();
    });
    view.rerender(tree("1h"));
    await waitFor(() =>
      expect(candlestick.setData).toHaveBeenLastCalledWith(aligned(hourCandles.candles).candles),
    );
    expect(
      mockedGetCandles.mock.calls.filter(
        (call) => call[0].interval === "15m" && call[0].before !== undefined,
      ),
    ).toHaveLength(0);
    const hourHistorical = () =>
      mockedGetCandles.mock.calls.filter(
        (call) => call[0].interval === "1h" && call[0].before !== undefined,
      );
    if (hourHistorical().length === 0) {
      emitVisibleRange();
    }
    await waitFor(() => expect(hourHistorical().length).toBeGreaterThan(0));
    expect(hourHistorical()[0]?.[0]).toEqual({
      symbol: "BTCUSDT",
      interval: "1h",
      limit: 500,
      before: btcCandle.openTime,
    });
  });

  it("does not keep the older-history loading indicator after an identity change", async () => {
    const hourCandles: CandleListResponse = { ...btcCandles, interval: "1h" };
    mockedGetCandles.mockImplementation((params) => {
      if (params.before) {
        return new Promise(() => undefined);
      }

      return Promise.resolve(params.interval === "1h" ? hourCandles : btcCandles);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (nextInterval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={nextInterval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(screen.getByText("Loading older data…")).toBeInTheDocument());
    client.setQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
      hourCandles,
    );
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 80, barsAfter: 10 });
    view.rerender(tree("1h"));
    expect(await screen.findByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument();
  });

  it("stops requesting older history after a partial page below the actual requested limit", async () => {
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 9_800 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    const oldestOpenTime = filled.candles[0]!.openTime;
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return {
          ...btcCandles,
          candles: Array.from({ length: 199 }, (_, index) =>
            olderCandle(oldestOpenTime - (199 - index) * 900_000),
          ),
        };
      }

      return filled;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(
        {
          symbol: "BTCUSDT",
          interval: "15m",
          limit: 200,
          before: oldestOpenTime,
        },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Loading older data…")).not.toBeInTheDocument());
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 80, barsAfter: 10 });
    emitVisibleRange({ from: 20, to: 40 });
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    expect(
      mockedGetCandles.mock.calls.filter((call) => call[0].before !== undefined),
    ).toHaveLength(1);
  });
});
