import type { Candle, CandleListResponse, MarketCandleMessage } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarketChart } from "./MarketChart.tsx";
import { getCandles, TRADE_CHART_INTERVAL, TRADE_CHART_LIMIT } from "../../lib/api/candles.ts";
import { toChartCandles } from "../../lib/chart/to-chart-candles.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { ThemeProvider, useTheme } from "../../theme/ThemeProvider.tsx";
import { ApiError } from "../../lib/api/errors.ts";

const {
  createChart,
  setData,
  update,
  remove,
  fitContent,
  addSeries,
  chartApplyOptions,
  seriesApplyOptions,
} = vi.hoisted(() => {
  const setData = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const fitContent = vi.fn();
  const chartApplyOptions = vi.fn();
  const seriesApplyOptions = vi.fn();
  const addSeries = vi.fn(() => ({ setData, update, applyOptions: seriesApplyOptions }));
  const createChart = vi.fn(() => ({
    addSeries,
    applyOptions: chartApplyOptions,
    timeScale: () => ({ fitContent }),
    remove,
  }));
  return {
    createChart,
    setData,
    update,
    remove,
    fitContent,
    addSeries,
    chartApplyOptions,
    seriesApplyOptions,
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
  { themeToggle = false }: { themeToggle?: boolean } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {themeToggle ? <ThemeToggleProbe /> : null}
        <MarketChart symbol={symbol} />
      </QueryClientProvider>
    </ThemeProvider>
  );

  return { ...render(strict ? <StrictMode>{tree}</StrictMode> : tree), client };
}

describe("MarketChart", () => {
  beforeEach(() => {
    mockedGetCandles.mockReset();
    createChart.mockClear();
    setData.mockClear();
    update.mockClear();
    remove.mockClear();
    fitContent.mockClear();
    addSeries.mockClear();
    chartApplyOptions.mockClear();
    seriesApplyOptions.mockClear();
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
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(screen.getByText("Loading historical candles")).toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
  });

  it("shows an API error without crashing", async () => {
    mockedGetCandles.mockRejectedValue(
      new ApiError({ status: 503, code: "MARKET_DATA_UNAVAILABLE" }),
    );
    renderChart();
    expect(await screen.findByRole("alert")).toHaveTextContent("MARKET_DATA_UNAVAILABLE");
    expect(createChart).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no candles", async () => {
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: [] });
    renderChart();
    expect(await screen.findByText("No candle data available")).toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
  });

  it("passes adapted historical candles into the chart series with setData", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(mockedGetCandles).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
      limit: 500,
    });
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith(toChartCandles(btcCandles.candles));
    expect(update).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(marketSocket.setDesiredCandle).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });
  });

  it("updates the live current candle with series.update", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(toChartCandles([{ ...btcCandle, close: "106.00" }])[0]);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ close: "107.00" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        close: "108.00",
      }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));

    expect(marketSocket.setDesiredCandle.mock.calls.map((call) => call[0])).toEqual(desiredCalls);
    expect(marketSocket.setDesiredCandle).not.toHaveBeenCalledWith(null);
    expect(marketSocket.subscribeMarketCandles.mock.calls.length).toBe(subscribeCalls);
    expect(marketSocket.subscribeReconnectReady.mock.calls.length).toBe(reconnectCalls);
  });

  it("appends the next candle with series.update", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        close: "108.00",
      }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(setData).toHaveBeenCalledTimes(1);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("uses setData when older history changes", async () => {
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    client.setQueryData(
      queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: TRADE_CHART_INTERVAL,
        limit: TRADE_CHART_LIMIT,
      }),
      {
        ...btcCandles,
        candles: [
          { ...btcCandle, open: "99.00" },
          {
            ...btcCandle,
            openTime: 1_499_040_900_000,
            closeTime: 1_499_041_799_999,
            close: "108.00",
          },
        ],
      },
    );
    await waitFor(() => expect(setData).toHaveBeenCalledTimes(2));
    expect(update).not.toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("uses setData for a 500-window rollover", async () => {
    const windowed: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: 500 }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
      })),
    };
    mockedGetCandles.mockResolvedValue(windowed);
    renderChart();
    await waitFor(() => expect(setData).toHaveBeenCalledTimes(1));
    const last = windowed.candles[windowed.candles.length - 1]!;
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "9.00",
      }),
    );
    await waitFor(() => expect(setData).toHaveBeenCalledTimes(2));
    expect(update).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
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
          <MarketChart symbol={symbol} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTCUSDT" })),
    );
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(setData).toHaveBeenCalledWith(toChartCandles(btcCandles.candles));
    expect(fitContent).toHaveBeenCalledTimes(1);

    view.rerender(tree("ETHUSDT"));
    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGetCandles).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ETHUSDT" })),
    );
    await waitFor(() => expect(remove).toHaveBeenCalled());
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(addSeries).toHaveBeenCalledTimes(2));
    expect(setData).toHaveBeenLastCalledWith(toChartCandles(ethCandles.candles));
    expect(fitContent).toHaveBeenCalledTimes(2);
    expect(marketSocket.setDesiredCandle.mock.calls.map((call) => call[0])).toEqual([
      { symbol: "BTCUSDT", interval: "15m" },
      null,
      { symbol: "ETHUSDT", interval: "15m" },
    ]);
  });

  it("repairs history with setData after a reconnect refetch", async () => {
    const later: Candle = {
      ...btcCandle,
      openTime: 1_499_040_900_000,
      closeTime: 1_499_041_799_999,
      close: "108.00",
    };
    mockedGetCandles.mockResolvedValue({
      ...btcCandles,
      candles: [btcCandle, later],
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    mockedGetCandles.mockResolvedValue({
      ...btcCandles,
      candles: [{ ...btcCandle, open: "98.00" }, later],
    });
    marketSocket.emitReconnect();
    await waitFor(() => expect(mockedGetCandles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(setData).toHaveBeenCalledTimes(2));
    expect(setData).toHaveBeenLastCalledWith(
      toChartCandles([{ ...btcCandle, open: "98.00" }, later]),
    );
    expect(update).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("applies theme colors without recreating the chart", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));

    chartApplyOptions.mockClear();
    seriesApplyOptions.mockClear();

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    await waitFor(() => expect(chartApplyOptions).toHaveBeenCalled());
    expect(seriesApplyOptions).toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(addSeries).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("disposes the chart on unmount including Strict Mode remount", async () => {
    const view = renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const removesBeforeUnmount = remove.mock.calls.length;
    view.unmount();
    expect(remove.mock.calls.length).toBeGreaterThan(removesBeforeUnmount);
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith(null);
    expect(marketSocket.candleListeners.size).toBe(0);
    expect(marketSocket.reconnectListeners.size).toBe(0);
  });
});
