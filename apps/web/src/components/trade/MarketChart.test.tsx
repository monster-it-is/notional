import type { Candle, CandleInterval, CandleListResponse, MarketCandleMessage } from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarketChart } from "./MarketChart.tsx";
import { DrawingPrimitive } from "../../lib/chart/drawings/DrawingPrimitive.ts";
import { parseDrawingHit } from "../../lib/chart/drawings/hit.ts";
import type { TrendLineDrawing } from "../../lib/chart/drawings/types.ts";
import { getCandles, TRADE_CHART_LIMIT, TRADE_CHART_MAX_CANDLES } from "../../lib/api/candles.ts";
import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  toChartLinePoints,
} from "../../lib/chart/to-chart-candles.ts";
import { computeBollinger } from "../../lib/chart/indicators/bollinger.ts";
import { computeEma } from "../../lib/chart/indicators/ema.ts";
import { computeMacd } from "../../lib/chart/indicators/macd.ts";
import { computeRsi } from "../../lib/chart/indicators/rsi.ts";
import { computeSma } from "../../lib/chart/indicators/sma.ts";
import {
  toChartBollingerPoint,
  toChartIndicatorLine,
  toChartIndicatorLinePoint,
  toChartMacdHistogram,
  toChartMacdLines,
  toChartMacdPoint,
} from "../../lib/chart/to-chart-indicators.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { ThemeProvider, useTheme } from "../../theme/ThemeProvider.tsx";
import { ApiError } from "../../lib/api/errors.ts";

const VOLUME_COLORS = { up: "#2ebd85", down: "#f0544c" };

const {
  createChart,
  remove,
  removeSeries,
  fitContent,
  addSeries,
  chartApplyOptions,
  candlestick,
  line,
  volume,
  overlaySeries,
  extraSeries,
  getChartPanes,
  subscribeVisibleLogicalRangeChange,
  unsubscribeVisibleLogicalRangeChange,
  subscribeCrosshairMove,
  unsubscribeCrosshairMove,
  subscribeClick,
  unsubscribeClick,
  getVisibleLogicalRange,
  setVisibleLogicalRange,
  rangeListeners,
  crosshairListeners,
  clickListeners,
  attachedPrimitives,
  coordinateToTime,
  timeToCoordinate,
  coordinateToPrice,
  priceToCoordinate,
} = vi.hoisted(() => {
  const rangeListeners = new Set<(range: { from: number; to: number } | null) => void>();
  const crosshairListeners = new Set<(param: Record<string, unknown>) => void>();
  const clickListeners = new Set<(param: Record<string, unknown>) => void>();
  const attachedPrimitives: Array<{
    attached?: (param: unknown) => void;
    detached?: () => void;
    setState?: (state: unknown) => void;
    getState?: () => { drawings: unknown[]; draft: unknown; selectedId: string | null };
    hitTest?: (x: number, y: number) => { externalId: string } | null;
  }> = [];
  const TIME_ORIGIN = 1_499_040_000;
  const coordinateToTime = vi.fn((x: number) => {
    if (!Number.isFinite(x) || x < 0) {
      return null;
    }

    return TIME_ORIGIN + x;
  });
  const timeToCoordinate = vi.fn((time: unknown) => {
    if (typeof time !== "number" || !Number.isFinite(time) || time < TIME_ORIGIN) {
      return null;
    }

    return time - TIME_ORIGIN;
  });
  const coordinateToPrice = vi.fn((y: number) => {
    if (!Number.isFinite(y) || y < 0) {
      return null;
    }

    return 400 - y;
  });
  const priceToCoordinate = vi.fn((price: number) => {
    if (!Number.isFinite(price) || price < 0 || price > 10_000) {
      return null;
    }

    return 400 - price;
  });
  type MockPriceLine = {
    applyOptions: ReturnType<typeof vi.fn>;
    options: ReturnType<typeof vi.fn>;
  };
  type MockPane = {
    series: MockSeries[];
    stretchFactor: number;
    paneIndex: () => number;
    moveTo: ReturnType<typeof vi.fn>;
    setStretchFactor: ReturnType<typeof vi.fn>;
    getSeries: () => MockSeries[];
  };
  type MockSeries = {
    type: string;
    setData: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    applyOptions: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    getPane: () => MockPane;
    priceLines: MockPriceLine[];
    pane: MockPane | null;
    barsInLogicalRange: ReturnType<typeof vi.fn>;
    attachPrimitive: ReturnType<typeof vi.fn>;
    detachPrimitive: ReturnType<typeof vi.fn>;
    coordinateToPrice: ReturnType<typeof vi.fn>;
    priceToCoordinate: ReturnType<typeof vi.fn>;
  };
  const panes: MockPane[] = [];
  const extraSeries: MockSeries[] = [];
  const overlaySeries: MockSeries[] = [];

  function createPane(): MockPane {
    const pane: MockPane = {
      series: [],
      stretchFactor: 1,
      paneIndex() {
        return panes.indexOf(pane);
      },
      moveTo: vi.fn((index: number) => {
        const from = panes.indexOf(pane);
        if (from < 0 || from === index) {
          return;
        }

        panes.splice(from, 1);
        panes.splice(index, 0, pane);
      }),
      setStretchFactor: vi.fn((value: number) => {
        pane.stretchFactor = value;
      }),
      getSeries() {
        return pane.series;
      },
    };
    panes.push(pane);
    return pane;
  }

  function attachCore(series: MockSeries, pane: MockPane): MockSeries {
    series.pane = pane;
    pane.series.push(series);
    return series;
  }

  function createExtraSeries(type: string, pane: MockPane): MockSeries {
    const series: MockSeries = {
      type,
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      priceLines: [],
      pane,
      createPriceLine: vi.fn((options: { price: number }) => {
        const priceLine = { applyOptions: vi.fn(), options: vi.fn(() => options) };
        series.priceLines.push(priceLine);
        return priceLine;
      }),
      barsInLogicalRange: vi.fn(() => ({ barsBefore: 0, barsAfter: 0 })),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      coordinateToPrice,
      priceToCoordinate,
      getPane: () => {
        if (!series.pane) {
          throw new Error("series pane was removed");
        }

        return series.pane;
      },
    };
    pane.series.push(series);
    extraSeries.push(series);
    if (pane.paneIndex() === 0) {
      overlaySeries.push(series);
    }

    return series;
  }

  let candlestickAssigned = false;
  let closeLineAssigned = false;
  let volumeAssigned = false;
  const candlestick: MockSeries = {
    type: "Candlestick",
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(),
    priceLines: [],
    pane: null,
    getPane: () => {
      if (!candlestick.pane) {
        throw new Error("candlestick pane missing");
      }

      return candlestick.pane;
    },
    barsInLogicalRange: vi.fn(() => ({ barsBefore: 0, barsAfter: 0 })),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    coordinateToPrice,
    priceToCoordinate,
  };
  const line: MockSeries = {
    type: "Line",
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(),
    priceLines: [],
    pane: null,
    getPane: () => {
      if (!line.pane) {
        throw new Error("line pane missing");
      }

      return line.pane;
    },
    barsInLogicalRange: vi.fn(() => ({ barsBefore: 0, barsAfter: 0 })),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    coordinateToPrice,
    priceToCoordinate,
  };
  const volume: MockSeries = {
    type: "Histogram",
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(),
    priceLines: [],
    pane: null,
    getPane: () => {
      if (!volume.pane) {
        throw new Error("volume pane missing");
      }

      return volume.pane;
    },
    barsInLogicalRange: vi.fn(() => ({ barsBefore: 0, barsAfter: 0 })),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    coordinateToPrice,
    priceToCoordinate,
  };
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
  const subscribeCrosshairMove = vi.fn((handler: (param: { time?: unknown; seriesData?: unknown }) => void) => {
    crosshairListeners.add(handler);
  });
  const unsubscribeCrosshairMove = vi.fn(
    (handler: (param: { time?: unknown; seriesData?: unknown }) => void) => {
      crosshairListeners.delete(handler);
    },
  );
  const subscribeClick = vi.fn((handler: (param: Record<string, unknown>) => void) => {
    clickListeners.add(handler);
  });
  const unsubscribeClick = vi.fn((handler: (param: Record<string, unknown>) => void) => {
    clickListeners.delete(handler);
  });
  candlestick.attachPrimitive.mockImplementation(
    (primitive: {
      attached?: (param: unknown) => void;
      updateAllViews?: () => void;
    }) => {
      attachedPrimitives.push(primitive);
      primitive.attached?.({
        chart: currentChart,
        series: candlestick,
        requestUpdate: vi.fn(() => {
          primitive.updateAllViews?.();
        }),
        horzScaleBehavior: {},
      });
    },
  );
  candlestick.detachPrimitive.mockImplementation(
    (primitive: { detached?: () => void }) => {
      const index = attachedPrimitives.indexOf(primitive);
      if (index >= 0) {
        attachedPrimitives.splice(index, 1);
      }

      primitive.detached?.();
    },
  );
  let currentChart: { timeScale: () => unknown } | null = null;
  const chartApplyOptions = vi.fn();
  const addSeries = vi.fn((definition: { type: string }, _options?: unknown, paneIndex?: number) => {
    const index = paneIndex ?? 0;
    while (panes.length <= index) {
      createPane();
    }

    const pane = panes[index];
    if (!pane) {
      throw new Error("pane missing");
    }

    if (definition.type === "Candlestick" && !candlestickAssigned) {
      candlestickAssigned = true;
      return attachCore(candlestick, pane);
    }

    if (definition.type === "Line" && !closeLineAssigned && index === 0) {
      closeLineAssigned = true;
      return attachCore(line, pane);
    }

    if (definition.type === "Histogram" && !volumeAssigned && index === 0) {
      volumeAssigned = true;
      return attachCore(volume, pane);
    }

    return createExtraSeries(definition.type, pane);
  });
  const removeSeries = vi.fn((series: MockSeries) => {
    const overlayIndex = overlaySeries.indexOf(series);
    if (overlayIndex >= 0) {
      overlaySeries.splice(overlayIndex, 1);
    }

    const extraIndex = extraSeries.indexOf(series);
    if (extraIndex >= 0) {
      extraSeries.splice(extraIndex, 1);
    }

    const pane = series.pane;
    if (!pane) {
      return;
    }

    const seriesIndex = pane.series.indexOf(series);
    if (seriesIndex >= 0) {
      pane.series.splice(seriesIndex, 1);
    }

    const panePos = panes.indexOf(pane);
    if (pane.series.length === 0 && panePos > 0) {
      panes.splice(panePos, 1);
    }

    series.pane = null;
  });
  const createChart = vi.fn(() => {
    candlestickAssigned = false;
    closeLineAssigned = false;
    volumeAssigned = false;
    overlaySeries.length = 0;
    extraSeries.length = 0;
    panes.length = 0;
    createPane();
    candlestick.pane = null;
    line.pane = null;
    volume.pane = null;
    const chart = {
      addSeries,
      removeSeries,
      panes: () => panes,
      applyOptions: chartApplyOptions,
      timeScale: () => ({
        fitContent,
        subscribeVisibleLogicalRangeChange,
        unsubscribeVisibleLogicalRangeChange,
        getVisibleLogicalRange,
        setVisibleLogicalRange,
        coordinateToTime,
        timeToCoordinate,
      }),
      priceScale: () => ({ applyOptions: vi.fn() }),
      subscribeCrosshairMove,
      unsubscribeCrosshairMove,
      subscribeClick,
      unsubscribeClick,
      remove,
    };
    currentChart = chart;
    return chart;
  });
  const remove = vi.fn();
  return {
    createChart,
    remove,
    removeSeries,
    fitContent,
    addSeries,
    chartApplyOptions,
    candlestick,
    line,
    volume,
    overlaySeries,
    extraSeries,
    attachedPrimitives,
    clickListeners,
    subscribeClick,
    unsubscribeClick,
    coordinateToTime,
    timeToCoordinate,
    coordinateToPrice,
    priceToCoordinate,
    getChartPanes: () => panes,
    subscribeVisibleLogicalRangeChange,
    unsubscribeVisibleLogicalRangeChange,
    subscribeCrosshairMove,
    unsubscribeCrosshairMove,
    getVisibleLogicalRange,
    setVisibleLogicalRange,
    rangeListeners,
    crosshairListeners,
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
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
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

const earlierBtcCandle: Candle = {
  openTime: 1_499_039_100_000,
  closeTime: 1_499_039_999_999,
  open: "90.00",
  high: "95.00",
  low: "85.00",
  close: "88.00",
  volume: "8.25",
};

const btcCandles: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [btcCandle],
};

const btcHistory: CandleListResponse = {
  symbol: "BTCUSDT",
  interval: "15m",
  candles: [earlierBtcCandle, btcCandle],
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

function emitCrosshair(param: Record<string, unknown> = {}) {
  for (const handler of crosshairListeners) {
    handler(param);
  }
}

function emitClick(param: Record<string, unknown> = {}) {
  for (const handler of clickListeners) {
    handler(param);
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

function oscillatorCandles(count: number, close = "105.00"): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    ...btcCandle,
    openTime: btcCandle.openTime + index * 900_000,
    closeTime: btcCandle.closeTime + index * 900_000,
    open: close,
    high: close,
    low: close,
    close,
  }));
}

function rampedOscillatorCandles(count: number, start: number, step: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = String(start + index * step);
    return {
      ...btcCandle,
      openTime: btcCandle.openTime + index * 900_000,
      closeTime: btcCandle.closeTime + index * 900_000,
      open: close,
      high: close,
      low: close,
      close,
    };
  });
}

const DEFAULT_MACD_PARAMS = { fast: 12, slow: 26, signal: 9 };
const MACD_HISTOGRAM_COLORS = { positive: "#2ebd85", negative: "#f0544c" };

function expectedMacdChartData(candles: Candle[]) {
  const points = computeMacd(candles, DEFAULT_MACD_PARAMS) ?? [];
  const lines = toChartMacdLines(points);
  return {
    macd: lines.macd,
    signal: lines.signal,
    histogram: toChartMacdHistogram(points, MACD_HISTOGRAM_COLORS),
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
    removeSeries.mockClear();
    overlaySeries.length = 0;
    extraSeries.length = 0;
    chartApplyOptions.mockClear();
    subscribeVisibleLogicalRangeChange.mockClear();
    unsubscribeVisibleLogicalRangeChange.mockClear();
    subscribeCrosshairMove.mockClear();
    unsubscribeCrosshairMove.mockClear();
    subscribeClick.mockClear();
    unsubscribeClick.mockClear();
    candlestick.attachPrimitive.mockClear();
    candlestick.detachPrimitive.mockClear();
    coordinateToTime.mockClear();
    timeToCoordinate.mockClear();
    coordinateToPrice.mockClear();
    priceToCoordinate.mockClear();
    coordinateToTime.mockImplementation((x: number) => {
      if (!Number.isFinite(x) || x < 0) {
        return null;
      }

      return 1_499_040_000 + x;
    });
    timeToCoordinate.mockImplementation((time: unknown) => {
      if (typeof time !== "number" || !Number.isFinite(time) || time < 1_499_040_000) {
        return null;
      }

      return time - 1_499_040_000;
    });
    coordinateToPrice.mockImplementation((y: number) => {
      if (!Number.isFinite(y) || y < 0) {
        return null;
      }

      return 400 - y;
    });
    priceToCoordinate.mockImplementation((price: number) => {
      if (!Number.isFinite(price) || price < 0 || price > 10_000) {
        return null;
      }

      return 400 - price;
    });
    getVisibleLogicalRange.mockClear();
    setVisibleLogicalRange.mockClear();
    candlestick.barsInLogicalRange.mockClear();
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 0, barsAfter: 0 });
    getVisibleLogicalRange.mockReturnValue({ from: 2, to: 8 });
    rangeListeners.clear();
    crosshairListeners.clear();
    clickListeners.clear();
    attachedPrimitives.length = 0;
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
    expect(crosshairListeners.size).toBe(1);
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith({
      symbol: "BTCUSDT",
      interval: "15m",
    });
    const lastSubscribe = subscribeVisibleLogicalRangeChange.mock.calls.at(-1)?.[0];
    const lastCrosshair = subscribeCrosshairMove.mock.calls.at(-1)?.[0];
    const removesBeforeUnmount = remove.mock.calls.length;
    view.unmount();
    expect(remove.mock.calls.length).toBeGreaterThan(removesBeforeUnmount);
    expect(unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledWith(lastSubscribe);
    expect(unsubscribeCrosshairMove).toHaveBeenCalledWith(lastCrosshair);
    expect(marketSocket.setDesiredCandle).toHaveBeenLastCalledWith(null);
    expect(marketSocket.candleListeners.size).toBe(0);
    expect(marketSocket.reconnectListeners.size).toBe(0);
    expect(rangeListeners.size).toBe(0);
    expect(crosshairListeners.size).toBe(0);
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

  it("shows the latest canonical candle in the legend by default", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(screen.getByText("BTCUSDT · 15m · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("105.00")).toBeInTheDocument();
    expect(screen.getByText("+5.00")).toBeInTheDocument();
    expect(screen.getByText("+5.00%")).toBeInTheDocument();
    expect(screen.getByText("12.50")).toBeInTheDocument();
    expect(subscribeCrosshairMove).toHaveBeenCalledTimes(1);
    expect(crosshairListeners.size).toBe(1);
    expect(document.querySelector("dl")).not.toHaveAttribute("aria-live");
  });

  it("does not render fake OHLC values while loading, on error, or when empty", async () => {
    mockedGetCandles.mockReturnValue(new Promise(() => undefined));
    const loading = renderChart();
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    loading.unmount();

    mockedGetCandles.mockRejectedValue(
      new ApiError({ status: 503, code: "MARKET_DATA_UNAVAILABLE" }),
    );
    const errorView = renderChart();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    errorView.unmount();

    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: [] });
    renderChart();
    expect(await screen.findByText("No candle data available")).toBeInTheDocument();
    expect(screen.queryByText("O")).not.toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
  });

  it("shows exact canonical OHLCV for a historical crosshair candle and ignores seriesData", async () => {
    mockedGetCandles.mockResolvedValue(btcHistory);
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(screen.getByText("105.00")).toBeInTheDocument();

    const setDataCalls = candlestick.setData.mock.calls.length;
    emitCrosshair({
      time: 1_499_039_100,
      seriesData: new Map([
        [{}, { open: 999, high: 999, low: 999, close: 999, value: 9_999 }],
      ]),
    });

    expect(await screen.findByText("88.00")).toBeInTheDocument();
    expect(screen.getByText("90.00")).toBeInTheDocument();
    expect(screen.getByText("-2.00")).toBeInTheDocument();
    expect(screen.getByText("-2.22%")).toBeInTheDocument();
    expect(screen.getByText("8.25")).toBeInTheDocument();
    expect(screen.queryByText("999")).not.toBeInTheDocument();
    expect(screen.queryByText("999.00")).not.toBeInTheDocument();
    expect(screen.queryByText("9,999.00")).not.toBeInTheDocument();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);

    emitCrosshair({ time: 1_499_039_100 });
    emitCrosshair({ time: 1_499_039_100 });
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);
    expect(candlestick.update).not.toHaveBeenCalled();
    expect(screen.getByText("88.00")).toBeInTheDocument();
  });

  it("updates the legend when the crosshair moves to another candle and returns to latest on exit", async () => {
    mockedGetCandles.mockResolvedValue(btcHistory);
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();

    emitCrosshair({ time: 1_499_040_000 });
    expect(await screen.findByText("105.00")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();

    emitCrosshair({ time: undefined });
    expect(screen.getByText("105.00")).toBeInTheDocument();
    emitCrosshair({});
    expect(screen.getByText("105.00")).toBeInTheDocument();
  });

  it("still shows full OHLCV in Line mode", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
    expect(screen.getByText("105.00")).toBeInTheDocument();
    expect(screen.getByText("+5.00")).toBeInTheDocument();
  });

  it("updates the default latest legend from live candle frames", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    expect(await screen.findByText("106.00")).toBeInTheDocument();
    expect(screen.getByText("+6.00")).toBeInTheDocument();
  });

  it("keeps a historical selection while an unrelated live update arrives", async () => {
    mockedGetCandles.mockResolvedValue(btcHistory);
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    expect(screen.getByText("88.00")).toBeInTheDocument();
    expect(screen.queryByText("106.00")).not.toBeInTheDocument();
  });

  it("tracks live updates when the current candle is explicitly selected", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_040_000 });
    marketSocket.emitCandle(liveFrame({ close: "107.00", high: "111.00" }));
    expect(await screen.findByText("107.00")).toBeInTheDocument();
    expect(screen.getByText("111.00")).toBeInTheDocument();
    expect(screen.getByText("+7.00")).toBeInTheDocument();
  });

  it("moves the default panel to a new live candle on rollover", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        open: "105.00",
        high: "109.00",
        low: "104.00",
        close: "108.00",
      }),
    );
    expect(await screen.findByText("108.00")).toBeInTheDocument();
    expect(screen.getByText("+3.00")).toBeInTheDocument();
  });

  it("keeps an explicit current-candle selection after a live rollover", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_040_000 });
    marketSocket.emitCandle(
      liveFrame({
        openTime: 1_499_040_900_000,
        closeTime: 1_499_041_799_999,
        open: "105.00",
        high: "109.00",
        low: "104.00",
        close: "108.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    expect(screen.getByText("105.00")).toBeInTheDocument();
    expect(screen.getByText("+5.00")).toBeInTheDocument();
    expect(screen.queryByText("108.00")).not.toBeInTheDocument();
  });

  it("preserves the selected candle after older history is prepended", async () => {
    mockedGetCandles.mockResolvedValue(btcHistory);
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    const older = olderCandle(earlierBtcCandle.openTime - 900_000);
    client.setQueryData(queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }), {
      ...btcHistory,
      candles: [older, ...btcHistory.candles],
    });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    expect(screen.queryByText("99.00")).not.toBeInTheDocument();
  });

  it("falls back to the latest candle when the selected bar is dropped by the cap", async () => {
    mockedGetCandles.mockResolvedValue(btcHistory);
    const { client } = renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    client.setQueryData(queryKeys.candles.list({ symbol: "BTCUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }), {
      ...btcHistory,
      candles: [btcCandle],
    });
    expect(await screen.findByText("105.00")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
  });

  it("cannot display a prior symbol candle after a symbol switch", async () => {
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT" ? ethCandles : btcHistory,
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
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    view.rerender(tree("ETHUSDT"));
    expect(await screen.findByText("210.00")).toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT · 15m · 2017-07-03 00:00:00 UTC")).not.toBeInTheDocument();
    expect(screen.getByText("ETHUSDT · 15m · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
  });

  it("cannot display a prior interval candle after an interval switch", async () => {
    const hourCandles: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "1h",
      candles: [
        {
          ...btcCandle,
          open: "300.00",
          high: "310.00",
          low: "290.00",
          close: "305.00",
        },
      ],
    };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcHistory,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
      hourCandles,
    );
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    view.rerender(tree("1h"));
    expect(await screen.findByText("305.00")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 1h · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
  });

  it("does not resurrect a historical hover after a symbol round trip", async () => {
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT" ? ethCandles : btcHistory,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      queryKeys.candles.list({ symbol: "ETHUSDT", interval: "15m", limit: TRADE_CHART_LIMIT }),
      ethCandles,
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();

    view.rerender(tree("ETHUSDT"));
    expect(await screen.findByText("210.00")).toBeInTheDocument();
    view.rerender(tree("BTCUSDT"));

    expect(await screen.findByText("105.00")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 15m · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(crosshairListeners.size).toBe(1);
    expect(createChart).toHaveBeenCalledTimes(3);
    expect(fitContent).toHaveBeenCalledTimes(3);

    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
  });

  it("does not resurrect a historical hover after an interval round trip", async () => {
    const hourCandles: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "1h",
      candles: [
        {
          ...btcCandle,
          open: "300.00",
          high: "310.00",
          low: "290.00",
          close: "305.00",
        },
      ],
    };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcHistory,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
      hourCandles,
    );
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    const subscribeCalls = subscribeCrosshairMove.mock.calls.length;

    view.rerender(tree("1h"));
    expect(await screen.findByText("305.00")).toBeInTheDocument();
    view.rerender(tree("15m"));

    expect(await screen.findByText("105.00")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 15m · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(subscribeCrosshairMove.mock.calls.length).toBe(subscribeCalls);
    expect(crosshairListeners.size).toBe(1);
    expect(fitContent).toHaveBeenCalledTimes(3);

    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
  });

  it("keeps the final identity in the legend after rapid symbol and interval changes", async () => {
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
    view.rerender(tree("ETHUSDT", "1h"));
    view.rerender(tree("BTCUSDT", "1d"));
    resolvers.get("BTCUSDT:15m")?.({ ...btcHistory, interval: "15m" });
    resolvers.get("ETHUSDT:1h")?.({
      symbol: "ETHUSDT",
      interval: "1h",
      candles: [{ ...btcCandle, open: "200.00", high: "220.00", low: "180.00", close: "210.00" }],
    });
    expect(screen.queryByText("210.00")).not.toBeInTheDocument();
    resolvers.get("BTCUSDT:1d")?.({ ...btcCandles, interval: "1d", candles: [{ ...btcCandle, close: "120.00" }] });
    expect(await screen.findByText("120.00")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 1d · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("210.00")).not.toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
  });

  it("uses the committed new identity when setData synchronously emits a crosshair event", async () => {
    const hourCandles: CandleListResponse = {
      symbol: "BTCUSDT",
      interval: "1h",
      candles: [
        {
          ...earlierBtcCandle,
          open: "400.00",
          high: "410.00",
          low: "390.00",
          close: "405.00",
        },
      ],
    };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcHistory,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      queryKeys.candles.list({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
      hourCandles,
    );
    const tree = (interval: CandleInterval) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol="BTCUSDT" interval={interval} onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("15m"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    emitCrosshair({ time: 1_499_039_100 });
    expect(await screen.findByText("88.00")).toBeInTheDocument();
    candlestick.setData.mockImplementation(() => {
      emitCrosshair({ time: 1_499_039_100 });
    });
    fitContent.mockImplementation(() => {
      emitCrosshair({ time: 1_499_039_100 });
    });
    view.rerender(tree("1h"));
    expect(await screen.findByText("405.00")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 1h · 2017-07-02 23:45:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("88.00")).not.toBeInTheDocument();
  });

  it("keeps a compact wrapping legend overlay that does not intercept pointer events", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const legend = document.querySelector("dl");
    expect(legend?.className).toContain("pointer-events-none");
    expect(legend?.className).toContain("flex-wrap");
    expect(legend?.className).toContain("max-w-full");
    expect(legend?.className).toContain("min-w-0");
    expect(legend?.className).not.toMatch(/min-w-(?!0\b)\S+/);
    expect(legend?.parentElement?.className).toContain("relative");
  });

  it("keeps exactly three core series when all indicators are off", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(overlaySeries).toHaveLength(0);
    expect(extraSeries).toHaveLength(0);
    expect(getChartPanes()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Indicators" })).toHaveAttribute("aria-expanded", "false");
  });

  it("adds one pane-0 SMA overlay and removes it without recreating the chart", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const fitBefore = fitContent.mock.calls.length;
    const crosshairBefore = subscribeCrosshairMove.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    expect(addSeries.mock.calls.at(-1)?.[2]).toBe(0);
    expect(overlaySeries[0]?.setData).toHaveBeenCalledWith(
      toChartIndicatorLine(computeSma([btcCandle], 1) ?? []),
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(subscribeCrosshairMove).toHaveBeenCalledTimes(crosshairBefore);

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(0));
    expect(removeSeries).toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
  });

  it("keeps enabled overlay series identity when toggling an unrelated overlay", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const fitBefore = fitContent.mock.calls.length;
    const addBefore = addSeries.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("EMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const ema = overlaySeries[0];
    expect(ema).toBeDefined();

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(2));
    expect(overlaySeries[0]).toBe(ema);
    expect(removeSeries.mock.calls.some((call) => call[0] === ema)).toBe(false);
    expect(addSeries.mock.calls.length).toBe(addBefore + 2);
    expect(addSeries.mock.calls.at(-1)?.[2]).toBe(0);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    const sma = overlaySeries[1];
    expect(sma).toBeDefined();
    expect(sma).not.toBe(ema);

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    expect(overlaySeries[0]).toBe(ema);
    expect(removeSeries).toHaveBeenCalledWith(sma);
    expect(removeSeries.mock.calls.some((call) => call[0] === ema)).toBe(false);
    expect(addSeries.mock.calls.length).toBe(addBefore + 2);

    const addAfterSmaOff = addSeries.mock.calls.length;
    await user.click(screen.getByLabelText("Bollinger Bands"));
    await waitFor(() => expect(overlaySeries).toHaveLength(4));
    expect(overlaySeries[0]).toBe(ema);
    expect(addSeries.mock.calls.length).toBe(addAfterSmaOff + 3);
    expect(addSeries.mock.calls.slice(-3).every((call) => call[2] === 0)).toBe(true);
    expect(removeSeries.mock.calls.some((call) => call[0] === ema)).toBe(false);
    const bands = overlaySeries.slice(1, 4);
    expect(bands).toHaveLength(3);

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(5));
    expect(overlaySeries[0]).toBe(ema);
    expect(overlaySeries.slice(1, 4)).toEqual(bands);
    expect(bands.every((series) => !removeSeries.mock.calls.some((call) => call[0] === series))).toBe(
      true,
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(volume.setData).toHaveBeenCalled();
  });

  it("keeps overlay series identity under Strict Mode when toggling an unrelated overlay", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const chartsBefore = createChart.mock.calls.length;
    const fitBefore = fitContent.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("EMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const ema = overlaySeries[0];
    expect(ema).toBeDefined();

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(2));
    expect(overlaySeries[0]).toBe(ema);
    expect(removeSeries.mock.calls.some((call) => call[0] === ema)).toBe(false);
    expect(createChart).toHaveBeenCalledTimes(chartsBefore);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
  });

  it("updates overlay data on backfill without fitContent", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [olderCandle()] };
      }

      return btcCandles;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const fitBefore = fitContent.mock.calls.length;
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() =>
      expect(overlaySeries[0]?.setData.mock.calls.some((call) => call[0].length === 2)).toBe(true),
    );
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(setVisibleLogicalRange).toHaveBeenCalled();
  });

  it("applies overlay theme options without recreating the chart", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const appliesBefore = overlaySeries[0]?.applyOptions.mock.calls.length ?? 0;
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() =>
      expect(overlaySeries[0]?.applyOptions.mock.calls.length).toBeGreaterThan(appliesBefore),
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not resurrect BTC overlay values after switching to ETH", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT" ? ethCandles : btcCandles,
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(overlaySeries[0]?.setData).toHaveBeenLastCalledWith(
        toChartIndicatorLine(computeSma(ethCandles.candles, 1) ?? []),
      ),
    );
  });

  it("bootstraps the new symbol overlay once after chart recreation", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT" ? ethCandles : btcCandles,
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const sma = overlaySeries[0]!;
    await waitFor(() =>
      expect(sma.setData).toHaveBeenLastCalledWith(
        toChartIndicatorLine(computeSma(ethCandles.candles, 1) ?? []),
      ),
    );
    expect(sma.setData).toHaveBeenCalledTimes(1);
  });

  it("creates an RSI pane with 0–100 scale and 70/30/50 guides", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(5) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const fitBefore = fitContent.mock.calls.length;
    const crosshairBefore = subscribeCrosshairMove.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];
    expect(rsi?.type).toBe("Line");
    expect(rsi?.getPane().paneIndex()).toBe(1);
    expect(getChartPanes()).toHaveLength(2);
    expect(rsi?.createPriceLine.mock.calls.map((call) => call[0].price)).toEqual([70, 50, 30]);
    const rsiOptions = addSeries.mock.calls
      .map((call) => call[1] as { autoscaleInfoProvider?: () => { priceRange: { minValue: number; maxValue: number } } } | undefined)
      .find((options) => options?.autoscaleInfoProvider);
    expect(rsiOptions?.autoscaleInfoProvider?.()).toEqual({
      priceRange: { minValue: 0, maxValue: 100 },
    });
    expect(rsi?.setData).toHaveBeenCalledWith(
      toChartIndicatorLine(computeRsi(oscillatorCandles(5), 2) ?? []),
    );
    expect(screen.getByRole("img").className).toContain("h-[28rem]");
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(subscribeCrosshairMove).toHaveBeenCalledTimes(crosshairBefore);
    expect(getChartPanes()[0]?.stretchFactor).toBe(3);
    expect(rsi?.getPane().stretchFactor).toBe(1);

    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(0));
    expect(getChartPanes()).toHaveLength(1);
    expect(removeSeries).toHaveBeenCalledWith(rsi);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(screen.getByRole("img").className).toContain("h-72");
  });

  it("creates a MACD pane with two lines, histogram, and a zero guide", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(40) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const fitBefore = fitContent.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    expect(macdLine?.type).toBe("Line");
    expect(signal?.type).toBe("Line");
    expect(histogram?.type).toBe("Histogram");
    expect(macdLine?.getPane().paneIndex()).toBe(1);
    expect(signal?.getPane()).toBe(macdLine?.getPane());
    expect(histogram?.getPane()).toBe(macdLine?.getPane());
    expect(getChartPanes()).toHaveLength(2);
    expect(macdLine?.createPriceLine.mock.calls.map((call) => call[0].price)).toEqual([0]);
    const macd = computeMacd(oscillatorCandles(40), { fast: 12, slow: 26, signal: 9 }) ?? [];
    expect(macdLine?.setData).toHaveBeenCalledWith(toChartMacdLines(macd).macd);
    expect(signal?.setData).toHaveBeenCalledWith(toChartMacdLines(macd).signal);
    expect(histogram?.setData).toHaveBeenCalledWith(
      toChartMacdHistogram(macd, { positive: "#2ebd85", negative: "#f0544c" }),
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);

    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(0));
    expect(getChartPanes()).toHaveLength(1);
    expect(removeSeries).toHaveBeenCalledWith(histogram);
    expect(removeSeries).toHaveBeenCalledWith(signal);
    expect(removeSeries).toHaveBeenCalledWith(macdLine);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("orders RSI then MACD panes and keeps series identity across toggles", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const fitBefore = fitContent.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const macdTrio = [...extraSeries];
    expect(macdTrio[0]?.getPane().paneIndex()).toBe(1);

    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(4));
    const rsi = extraSeries.find((series) => !macdTrio.includes(series));
    expect(rsi?.getPane().paneIndex()).toBe(1);
    expect(macdTrio[0]?.getPane().paneIndex()).toBe(2);
    expect(extraSeries.slice(0, 3)).toEqual(macdTrio);
    expect(macdTrio.every((series) => !removeSeries.mock.calls.some((call) => call[0] === series))).toBe(
      true,
    );
    expect(getChartPanes()).toHaveLength(3);
    expect(screen.getByRole("img").className).toContain("h-[34rem]");
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);

    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    expect(extraSeries).toEqual(macdTrio);
    expect(macdTrio[0]?.getPane().paneIndex()).toBe(1);
    expect(getChartPanes()).toHaveLength(2);
    expect(removeSeries.mock.calls.some((call) => call[0] === rsi)).toBe(true);
    expect(macdTrio.every((series) => !removeSeries.mock.calls.some((call) => call[0] === series))).toBe(
      true,
    );

    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(4));
    expect(extraSeries[0]).toBe(macdTrio[0]);
    expect(extraSeries.find((series) => !macdTrio.includes(series))?.getPane().paneIndex()).toBe(1);
    expect(macdTrio[0]?.getPane().paneIndex()).toBe(2);

    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    expect(extraSeries[0]?.type).toBe("Line");
    expect(extraSeries[0]?.getPane().paneIndex()).toBe(1);
    expect(getChartPanes()).toHaveLength(2);
    expect(macdTrio.every((series) => removeSeries.mock.calls.some((call) => call[0] === series))).toBe(
      true,
    );
  });

  it("places MACD in pane 2 when RSI is already enabled", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];
    expect(rsi?.getPane().paneIndex()).toBe(1);

    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(4));
    expect(rsi?.getPane().paneIndex()).toBe(1);
    expect(rsi).toBe(extraSeries[0]);
    const macdPane = extraSeries[1]?.getPane();
    expect(macdPane?.paneIndex()).toBe(2);
    expect(extraSeries[2]?.getPane()).toBe(macdPane);
    expect(extraSeries[3]?.getPane()).toBe(macdPane);
    expect(getChartPanes()).toHaveLength(3);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("keeps RSI identity when toggling a price overlay", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    expect(extraSeries[0]).toBe(rsi);
    expect(removeSeries.mock.calls.some((call) => call[0] === rsi)).toBe(false);
    expect(rsi?.getPane().paneIndex()).toBe(1);

    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(0));
    expect(extraSeries[0]).toBe(rsi);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("keeps the MACD trio when toggling EMA", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const trio = [...extraSeries];

    await user.click(screen.getByLabelText("EMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    expect(extraSeries.slice(0, 3)).toEqual(trio);
    expect(trio.every((series) => !removeSeries.mock.calls.some((call) => call[0] === series))).toBe(true);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("updates RSI data on period change without recreating the series", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(8) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];
    const addsBefore = addSeries.mock.calls.length;

    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(rsi?.setData).toHaveBeenCalledWith(
        toChartIndicatorLine(computeRsi(oscillatorCandles(8), 2) ?? []),
      ),
    );
    expect(extraSeries[0]).toBe(rsi);
    expect(addSeries.mock.calls.length).toBe(addsBefore);
  });

  it("commits a valid MACD triple without recreating series and ignores invalid drafts", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(40) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    const defaultMacd = computeMacd(oscillatorCandles(40), { fast: 12, slow: 26, signal: 9 }) ?? [];
    await waitFor(() =>
      expect(macdLine?.setData).toHaveBeenCalledWith(toChartMacdLines(defaultMacd).macd),
    );
    const addsBefore = addSeries.mock.calls.length;

    const fast = screen.getByLabelText("MACD fast");
    await user.clear(fast);
    await user.type(fast, "30");
    await user.tab();
    expect(macdLine?.setData).toHaveBeenLastCalledWith(toChartMacdLines(defaultMacd).macd);
    expect(extraSeries.slice(0, 3)).toEqual([macdLine, signal, histogram]);

    const slow = screen.getByLabelText("MACD slow");
    await user.clear(slow);
    await user.type(slow, "40");
    await user.keyboard("{Enter}");
    const nextMacd = computeMacd(oscillatorCandles(40), { fast: 30, slow: 40, signal: 9 }) ?? [];
    await waitFor(() =>
      expect(macdLine?.setData).toHaveBeenCalledWith(toChartMacdLines(nextMacd).macd),
    );
    expect(signal?.setData).toHaveBeenCalledWith(toChartMacdLines(nextMacd).signal);
    expect(histogram?.setData).toHaveBeenCalledWith(
      toChartMacdHistogram(nextMacd, { positive: "#2ebd85", negative: "#f0544c" }),
    );
    expect(extraSeries.slice(0, 3)).toEqual([macdLine, signal, histogram]);
    expect(addSeries.mock.calls.length).toBe(addsBefore);
  });

  it("expands chart height with oscillators without recreating the chart", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("img").className).toContain("h-72");
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(screen.getByRole("img").className).toContain("h-[28rem]"));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(screen.getByRole("img").className).toContain("h-[34rem]"));
    expect(createChart).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText("MACD"));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(screen.getByRole("img").className).toContain("h-72"));
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("applies RSI and MACD theme options without recreating series", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(40) });
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(4));
    const rsi = extraSeries.find((series) => series.createPriceLine.mock.calls.length === 3);
    const histogram = extraSeries.find((series) => series.type === "Histogram");
    const rsiApplies = rsi?.applyOptions.mock.calls.length ?? 0;
    const histApplies = histogram?.applyOptions.mock.calls.length ?? 0;
    const guideApplies = rsi?.priceLines[0]?.applyOptions.mock.calls.length ?? 0;
    const histSets = histogram?.setData.mock.calls.length ?? 0;

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(rsi?.applyOptions.mock.calls.length).toBeGreaterThan(rsiApplies));
    expect(histogram?.applyOptions.mock.calls.length).toBeGreaterThan(histApplies);
    expect(rsi?.priceLines[0]?.applyOptions.mock.calls.length).toBeGreaterThan(guideApplies);
    expect(histogram?.setData.mock.calls.length).toBeGreaterThan(histSets);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(extraSeries).toHaveLength(4);
  });

  it("does not paint stale RSI or MACD after a symbol switch", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const btcOsc = oscillatorCandles(8, "105.00");
    const ethOsc = oscillatorCandles(8, "210.00");
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT"
        ? { ...ethCandles, candles: ethOsc }
        : { ...btcCandles, candles: btcOsc },
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(extraSeries[0]?.setData).toHaveBeenLastCalledWith(
        toChartIndicatorLine(computeRsi(ethOsc, 2) ?? []),
      ),
    );
    expect(screen.getByLabelText("RSI")).toBeChecked();
  });

  it("does not paint stale MACD after a symbol switch", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const btcOsc = rampedOscillatorCandles(40, 100, 1);
    const ethOsc = rampedOscillatorCandles(40, 200, 3);
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT"
        ? { ...ethCandles, candles: ethOsc }
        : { ...btcCandles, candles: btcOsc },
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const btcMacd = expectedMacdChartData(btcOsc);
    await waitFor(() => expect(extraSeries[0]?.setData).toHaveBeenLastCalledWith(btcMacd.macd));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    const ethMacd = expectedMacdChartData(ethOsc);
    expect(macdLine?.setData).toHaveBeenLastCalledWith(ethMacd.macd);
    expect(signal?.setData).toHaveBeenLastCalledWith(ethMacd.signal);
    expect(histogram?.setData).toHaveBeenLastCalledWith(ethMacd.histogram);
    expect(macdLine?.setData.mock.calls.at(-1)?.[0]).not.toEqual(btcMacd.macd);
    expect(signal?.setData.mock.calls.at(-1)?.[0]).not.toEqual(btcMacd.signal);
    expect(screen.getByLabelText("MACD")).toBeChecked();
  });

  it("does not resurrect the first BTC MACD after BTC → ETH → BTC", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const firstBtc = rampedOscillatorCandles(40, 100, 1);
    const ethOsc = rampedOscillatorCandles(40, 200, 3);
    mockedGetCandles.mockImplementation(async ({ symbol }) =>
      symbol === "ETHUSDT"
        ? { ...ethCandles, candles: ethOsc }
        : { ...btcCandles, candles: firstBtc },
    );
    const tree = (symbol: string) => (
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MarketChart symbol={symbol} interval="15m" onIntervalChange={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    );
    const view = render(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    view.rerender(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const currentBtc = expectedMacdChartData(firstBtc);
    const ethMacd = expectedMacdChartData(ethOsc);
    const [macdLine, signal, histogram] = extraSeries;
    expect(macdLine?.setData).toHaveBeenLastCalledWith(currentBtc.macd);
    expect(signal?.setData).toHaveBeenLastCalledWith(currentBtc.signal);
    expect(histogram?.setData).toHaveBeenLastCalledWith(currentBtc.histogram);
    expect(macdLine?.setData.mock.calls.at(-1)?.[0]).not.toEqual(ethMacd.macd);
    expect(signal?.setData.mock.calls.at(-1)?.[0]).not.toEqual(ethMacd.signal);
    expect(screen.getByLabelText("MACD")).toBeChecked();
  });

  it("updates RSI data on interval change without recreating the chart", async () => {
    const user = userEvent.setup();
    const hourCandles = oscillatorCandles(8, "150.00");
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h"
        ? { ...btcCandles, interval: "1h", candles: hourCandles }
        : { ...btcCandles, candles: oscillatorCandles(8) },
    );
    const onIntervalChange = vi.fn();
    const view = renderChart("BTCUSDT", false, { onIntervalChange });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];
    view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={view.client}>
          <MarketChart symbol="BTCUSDT" interval="1h" onIntervalChange={onIntervalChange} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(rsi?.setData).toHaveBeenCalledWith(toChartIndicatorLine(computeRsi(hourCandles, 2) ?? [])),
    );
    expect(extraSeries[0]).toBe(rsi);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("updates MACD data on interval change without recreating series", async () => {
    const user = userEvent.setup();
    const minuteCandles = rampedOscillatorCandles(40, 100, 1);
    const hourCandles = rampedOscillatorCandles(40, 150, 2);
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h"
        ? { ...btcCandles, interval: "1h", candles: hourCandles }
        : { ...btcCandles, candles: minuteCandles },
    );
    const onIntervalChange = vi.fn();
    const view = renderChart("BTCUSDT", false, { onIntervalChange });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    const macdPane = macdLine?.getPane();
    await view.client.prefetchQuery({
      queryKey: queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: TRADE_CHART_LIMIT,
      }),
      queryFn: () => getCandles({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
    });
    view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={view.client}>
          <MarketChart symbol="BTCUSDT" interval="1h" onIntervalChange={onIntervalChange} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const hourMacd = expectedMacdChartData(hourCandles);
    const minuteMacd = expectedMacdChartData(minuteCandles);
    await waitFor(() => expect(macdLine?.setData).toHaveBeenLastCalledWith(hourMacd.macd));
    expect(signal?.setData).toHaveBeenLastCalledWith(hourMacd.signal);
    expect(histogram?.setData).toHaveBeenLastCalledWith(hourMacd.histogram);
    expect(extraSeries[0]).toBe(macdLine);
    expect(extraSeries[1]).toBe(signal);
    expect(extraSeries[2]).toBe(histogram);
    expect(macdLine?.getPane()).toBe(macdPane);
    expect(signal?.getPane()).toBe(macdPane);
    expect(histogram?.getPane()).toBe(macdPane);
    expect(macdPane?.paneIndex()).toBe(1);
    expect(macdLine?.setData.mock.calls.at(-1)?.[0]).not.toEqual(minuteMacd.macd);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("bootstraps an enabled indicator once on a prefetched interval change", async () => {
    const user = userEvent.setup();
    const minuteCandles = oscillatorCandles(8, "105.00");
    const hourCandles = oscillatorCandles(8, "150.00");
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h"
        ? { ...btcCandles, interval: "1h", candles: hourCandles }
        : { ...btcCandles, candles: minuteCandles },
    );
    const onIntervalChange = vi.fn();
    const view = renderChart("BTCUSDT", false, { onIntervalChange });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const sma = overlaySeries[0]!;
    await view.client.prefetchQuery({
      queryKey: queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: TRADE_CHART_LIMIT,
      }),
      queryFn: () => getCandles({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
    });
    sma.setData.mockClear();
    sma.update.mockClear();
    const fitBefore = fitContent.mock.calls.length;
    const addsBefore = addSeries.mock.calls.length;
    view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={view.client}>
          <MarketChart symbol="BTCUSDT" interval="1h" onIntervalChange={onIntervalChange} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(sma.setData).toHaveBeenLastCalledWith(toChartIndicatorLine(computeSma(hourCandles, 1) ?? [])),
    );
    expect(sma.setData).toHaveBeenCalledTimes(1);
    expect(sma.update).not.toHaveBeenCalled();
    expect(overlaySeries[0]).toBe(sma);
    expect(addSeries.mock.calls.length).toBe(addsBefore);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore + 1);
  });

  it("recomputes RSI and MACD on backfill without fitContent", async () => {
    const user = userEvent.setup();
    const latest = oscillatorCandles(40);
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [olderCandle(latest[0]!.openTime - 900_000)] };
      }

      return { ...btcCandles, candles: latest };
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(4));
    const rsi = extraSeries[0];
    const macdLine = extraSeries[1];
    const signal = extraSeries[2];
    const histogram = extraSeries[3];
    const fitBefore = fitContent.mock.calls.length;
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    const prepended = [olderCandle(latest[0]!.openTime - 900_000), ...latest];
    const prependedMacd = expectedMacdChartData(prepended);
    await waitFor(() =>
      expect(rsi?.setData).toHaveBeenCalledWith(
        toChartIndicatorLine(computeRsi(prepended, 2) ?? []),
      ),
    );
    expect(macdLine?.setData).toHaveBeenCalledWith(prependedMacd.macd);
    expect(signal?.setData).toHaveBeenCalledWith(prependedMacd.signal);
    expect(histogram?.setData).toHaveBeenCalledWith(prependedMacd.histogram);
    expect(extraSeries[0]).toBe(rsi);
    expect(extraSeries[1]).toBe(macdLine);
    expect(extraSeries[2]).toBe(signal);
    expect(extraSeries[3]).toBe(histogram);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(setVisibleLogicalRange).toHaveBeenCalled();
  });

  it("keeps oscillator identity under Strict Mode after an unrelated overlay toggle", async () => {
    const user = userEvent.setup();
    const view = renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0];
    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    expect(extraSeries[0]).toBe(rsi);
    expect(getChartPanes()).toHaveLength(2);
    const removesBeforeUnmount = remove.mock.calls.length;
    view.unmount();
    expect(remove.mock.calls.length).toBeGreaterThan(removesBeforeUnmount);
  });

  it("uses series.update for SMA live replacements and does not setData after bootstrap", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(overlaySeries[0]?.setData).toHaveBeenCalledWith(
        toChartIndicatorLine(computeSma([btcCandle], 1) ?? []),
      ),
    );
    const sma = overlaySeries[0]!;
    sma.setData.mockClear();
    sma.update.mockClear();

    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(sma.update).toHaveBeenCalledTimes(1));
    expect(sma.update).toHaveBeenLastCalledWith(
      toChartIndicatorLinePoint(computeSma([{ ...btcCandle, close: "106.00" }], 1)![0]!),
    );
    expect(sma.setData).not.toHaveBeenCalled();

    marketSocket.emitCandle(liveFrame({ close: "107.00" }));
    await waitFor(() => expect(sma.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ close: "108.00" }));
    await waitFor(() => expect(sma.update).toHaveBeenCalledTimes(3));
    expect(sma.setData).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(overlaySeries[0]).toBe(sma);
  });

  it("uses series.update for EMA live replacements without compounding setData", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(5) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("EMA"));
    const period = screen.getByLabelText("EMA period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    const history = oscillatorCandles(5);
    await waitFor(() =>
      expect(overlaySeries[0]?.setData).toHaveBeenCalledWith(
        toChartIndicatorLine(computeEma(history, 2) ?? []),
      ),
    );
    const ema = overlaySeries[0]!;
    ema.setData.mockClear();
    ema.update.mockClear();
    const last = history[history.length - 1]!;

    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "120.00" }));
    await waitFor(() => expect(ema.update).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "130.00" }));
    await waitFor(() => expect(ema.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "90.00" }));
    await waitFor(() => expect(ema.update).toHaveBeenCalledTimes(3));
    expect(ema.setData).not.toHaveBeenCalled();

    const replaced = [...history.slice(0, -1), { ...last, close: "90.00" }];
    const appended = {
      ...last,
      openTime: last.openTime + 900_000,
      closeTime: last.closeTime + 900_000,
      close: "95.00",
    };
    const fitBefore = fitContent.mock.calls.length;
    const addsBefore = addSeries.mock.calls.length;
    marketSocket.emitCandle(
      liveFrame({
        openTime: appended.openTime,
        closeTime: appended.closeTime,
        close: appended.close,
      }),
    );
    await waitFor(() => expect(ema.update).toHaveBeenCalledTimes(4));
    expect(ema.update).toHaveBeenLastCalledWith(
      toChartIndicatorLinePoint(computeEma([...replaced, appended], 2)!.at(-1)!),
    );
    expect(ema.setData).not.toHaveBeenCalled();
    expect(overlaySeries[0]).toBe(ema);
    expect(addSeries.mock.calls.length).toBe(addsBefore);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
  });

  it("updates three Bollinger series on live replacement without setData", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(5) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("Bollinger Bands"));
    const period = screen.getByLabelText("Bollinger period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(3));
    for (const series of overlaySeries) {
      series.setData.mockClear();
      series.update.mockClear();
    }
    const last = oscillatorCandles(5).at(-1)!;
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "140.00" }));
    await waitFor(() => expect(overlaySeries[0]?.update).toHaveBeenCalledTimes(1));
    expect(overlaySeries[1]?.update).toHaveBeenCalledTimes(1);
    expect(overlaySeries[2]?.update).toHaveBeenCalledTimes(1);
    const bands = toChartBollingerPoint(
      computeBollinger(
        [...oscillatorCandles(5).slice(0, -1), { ...last, close: "140.00" }],
        2,
        "2",
      )!.at(-1)!,
    );
    expect(overlaySeries[0]?.update).toHaveBeenLastCalledWith(bands?.upper);
    expect(overlaySeries[1]?.update).toHaveBeenLastCalledWith(bands?.middle);
    expect(overlaySeries[2]?.update).toHaveBeenLastCalledWith(bands?.lower);
    expect(overlaySeries.every((series) => series.setData.mock.calls.length === 0)).toBe(true);

    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "80.00" }));
    await waitFor(() => expect(overlaySeries[0]?.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "110.00" }));
    await waitFor(() => expect(overlaySeries[0]?.update).toHaveBeenCalledTimes(3));
    expect(overlaySeries.every((series) => series.setData.mock.calls.length === 0)).toBe(true);

    const replaced = [...oscillatorCandles(5).slice(0, -1), { ...last, close: "110.00" }];
    const appended = {
      ...last,
      openTime: last.openTime + 900_000,
      closeTime: last.closeTime + 900_000,
      close: "125.00",
    };
    const fitBefore = fitContent.mock.calls.length;
    const addsBefore = addSeries.mock.calls.length;
    marketSocket.emitCandle(
      liveFrame({
        openTime: appended.openTime,
        closeTime: appended.closeTime,
        close: appended.close,
      }),
    );
    await waitFor(() => expect(overlaySeries[0]?.update).toHaveBeenCalledTimes(4));
    expect(overlaySeries[1]?.update).toHaveBeenCalledTimes(4);
    expect(overlaySeries[2]?.update).toHaveBeenCalledTimes(4);
    const appendBands = toChartBollingerPoint(
      computeBollinger([...replaced, appended], 2, "2")!.at(-1)!,
    );
    expect(overlaySeries[0]?.update).toHaveBeenLastCalledWith(appendBands?.upper);
    expect(overlaySeries[1]?.update).toHaveBeenLastCalledWith(appendBands?.middle);
    expect(overlaySeries[2]?.update).toHaveBeenLastCalledWith(appendBands?.lower);
    expect(overlaySeries.every((series) => series.setData.mock.calls.length === 0)).toBe(true);
    expect(overlaySeries).toHaveLength(3);
    expect(addSeries.mock.calls.length).toBe(addsBefore);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
  });

  it("updates RSI with series.update on live replacement and append", async () => {
    const user = userEvent.setup();
    const history = oscillatorCandles(6, "10");
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: history });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0]!;
    rsi.setData.mockClear();
    rsi.update.mockClear();
    const last = history[history.length - 1]!;

    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "20" }));
    await waitFor(() => expect(rsi.update).toHaveBeenCalledTimes(1));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "4" }));
    await waitFor(() => expect(rsi.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "16" }));
    await waitFor(() => expect(rsi.update).toHaveBeenCalledTimes(3));
    expect(rsi.setData).not.toHaveBeenCalled();

    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "18",
      }),
    );
    await waitFor(() => expect(rsi.update).toHaveBeenCalledTimes(4));
    expect(rsi.setData).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(extraSeries[0]).toBe(rsi);
  });

  it("updates MACD line, signal, and histogram on live replacement and append", async () => {
    const user = userEvent.setup();
    const history = rampedOscillatorCandles(40, 100, 1);
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: history });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    macdLine!.setData.mockClear();
    signal!.setData.mockClear();
    histogram!.setData.mockClear();
    macdLine!.update.mockClear();
    signal!.update.mockClear();
    histogram!.update.mockClear();
    const last = history[history.length - 1]!;

    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "200" }));
    await waitFor(() => expect(macdLine?.update).toHaveBeenCalledTimes(1));
    expect(signal?.update).toHaveBeenCalledTimes(1);
    expect(histogram?.update).toHaveBeenCalledTimes(1);
    const replaced = computeMacd(
      [...history.slice(0, -1), { ...last, close: "200" }],
      DEFAULT_MACD_PARAMS,
    )!.at(-1)!;
    const mapped = toChartMacdPoint(replaced, MACD_HISTOGRAM_COLORS);
    expect(macdLine?.update).toHaveBeenLastCalledWith(mapped?.macd);
    expect(signal?.update).toHaveBeenLastCalledWith(mapped?.signal);
    expect(histogram?.update).toHaveBeenLastCalledWith(mapped?.histogram);

    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "80" }));
    await waitFor(() => expect(macdLine?.update).toHaveBeenCalledTimes(2));
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "150" }));
    await waitFor(() => expect(macdLine?.update).toHaveBeenCalledTimes(3));
    expect(macdLine?.setData).not.toHaveBeenCalled();
    expect(signal?.setData).not.toHaveBeenCalled();
    expect(histogram?.setData).not.toHaveBeenCalled();

    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "160",
      }),
    );
    await waitFor(() => expect(macdLine?.update).toHaveBeenCalledTimes(4));
    expect(signal?.update).toHaveBeenCalledTimes(4);
    expect(histogram?.update).toHaveBeenCalledTimes(4);
    expect(macdLine?.setData).not.toHaveBeenCalled();
    expect(signal?.setData).not.toHaveBeenCalled();
    expect(histogram?.setData).not.toHaveBeenCalled();
    expect(extraSeries.slice(0, 3)).toEqual([macdLine, signal, histogram]);
  });

  it("appends an SMA point with update and skips warm-up output", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(2) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "3");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const sma = overlaySeries[0]!;
    sma.setData.mockClear();
    sma.update.mockClear();
    const last = oscillatorCandles(2).at(-1)!;
    marketSocket.emitCandle(liveFrame({ openTime: last.openTime, closeTime: last.closeTime, close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    expect(sma.update).not.toHaveBeenCalled();
    expect(sma.setData).not.toHaveBeenCalled();

    sma.setData.mockClear();
    sma.update.mockClear();
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "107.00",
      }),
    );
    await waitFor(() => expect(sma.update).toHaveBeenCalledTimes(1));
    expect(sma.setData).not.toHaveBeenCalled();
  });

  it("rebuilds SMA with setData on cap eviction and does not treat it as a live append", async () => {
    const user = userEvent.setup();
    const filled: CandleListResponse = {
      ...btcCandles,
      candles: Array.from({ length: TRADE_CHART_MAX_CANDLES }, (_, index) => ({
        ...btcCandle,
        openTime: btcCandle.openTime + index * 900_000,
        closeTime: btcCandle.closeTime + index * 900_000,
        close: String(100 + (index % 17)),
      })),
    };
    mockedGetCandles.mockResolvedValue(filled);
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const sma = overlaySeries[0]!;
    sma.setData.mockClear();
    sma.update.mockClear();
    const last = filled.candles[filled.candles.length - 1]!;
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime + 900_000,
        closeTime: last.closeTime + 900_000,
        close: "9.00",
      }),
    );
    await waitFor(() => expect(sma.setData).toHaveBeenCalledTimes(1));
    expect(sma.update).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("rebuilds RSI with setData after reconnect repair", async () => {
    const user = userEvent.setup();
    const first = oscillatorCandles(8, "105.00");
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: first });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0]!;
    rsi.setData.mockClear();
    rsi.update.mockClear();
    const repaired = oscillatorCandles(8, "80.00");
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: repaired });
    marketSocket.emitReconnect();
    await waitFor(() =>
      expect(rsi.setData).toHaveBeenLastCalledWith(toChartIndicatorLine(computeRsi(repaired, 2) ?? [])),
    );
    expect(rsi.update).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(extraSeries[0]).toBe(rsi);
  });

  it("rebuilds indicators with setData when reconnect only changes the last candle, then returns to update", async () => {
    const user = userEvent.setup();
    const first = oscillatorCandles(8, "105.00");
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: first });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("RSI"));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(extraSeries).toHaveLength(1));
    const rsi = extraSeries[0]!;
    rsi.setData.mockClear();
    rsi.update.mockClear();
    candlestick.setData.mockClear();
    candlestick.update.mockClear();
    const fitBefore = fitContent.mock.calls.length;
    const last = first[first.length - 1]!;
    const repaired = [...first.slice(0, -1), { ...last, close: "140.00" }];
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: repaired });
    marketSocket.emitReconnect();
    await waitFor(() => expect(rsi.setData).toHaveBeenCalledTimes(1));
    expect(rsi.setData).toHaveBeenLastCalledWith(toChartIndicatorLine(computeRsi(repaired, 2) ?? []));
    expect(rsi.update).not.toHaveBeenCalled();
    expect(candlestick.update).toHaveBeenCalled();
    expect(candlestick.setData).not.toHaveBeenCalled();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(fitContent).toHaveBeenCalledTimes(fitBefore);
    expect(extraSeries[0]).toBe(rsi);

    rsi.setData.mockClear();
    rsi.update.mockClear();
    marketSocket.emitCandle(
      liveFrame({
        openTime: last.openTime,
        closeTime: last.closeTime,
        close: "141.00",
      }),
    );
    await waitFor(() => expect(rsi.update).toHaveBeenCalledTimes(1));
    expect(rsi.setData).not.toHaveBeenCalled();
    expect(extraSeries[0]).toBe(rsi);
  });

  it("rebuilds only SMA on period change and keeps EMA identity", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: oscillatorCandles(8) });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("EMA"));
    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(2));
    const ema = overlaySeries[0]!;
    const sma = overlaySeries[1]!;
    ema.setData.mockClear();
    sma.setData.mockClear();
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "2");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(sma.setData).toHaveBeenCalledWith(
        toChartIndicatorLine(computeSma(oscillatorCandles(8), 2) ?? []),
      ),
    );
    expect(ema.setData).not.toHaveBeenCalled();
    expect(overlaySeries[0]).toBe(ema);
    expect(overlaySeries[1]).toBe(sma);
    expect(createChart).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a disabled SMA session after live updates", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(0));
    marketSocket.emitCandle(liveFrame({ close: "140.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    await user.click(screen.getByLabelText("SMA"));
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    await waitFor(() =>
      expect(overlaySeries[0]?.setData).toHaveBeenLastCalledWith(
        toChartIndicatorLine(computeSma([{ ...btcCandle, close: "140.00" }], 1) ?? []),
      ),
    );
  });

  it("keeps MACD histogram theme setData separate from live mutation", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockResolvedValue({ ...btcCandles, candles: rampedOscillatorCandles(40, 100, 1) });
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("MACD"));
    await waitFor(() => expect(extraSeries).toHaveLength(3));
    const [macdLine, signal, histogram] = extraSeries;
    macdLine!.setData.mockClear();
    signal!.setData.mockClear();
    histogram!.setData.mockClear();
    macdLine!.update.mockClear();
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(histogram?.setData.mock.calls.length).toBeGreaterThan(0));
    expect(macdLine?.setData).not.toHaveBeenCalled();
    expect(signal?.setData).not.toHaveBeenCalled();
    expect(macdLine?.update).not.toHaveBeenCalled();
  });

  it("applies SMA live updates once under Strict Mode", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(overlaySeries).toHaveLength(1));
    const sma = overlaySeries[0]!;
    sma.setData.mockClear();
    sma.update.mockClear();
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(sma.update).toHaveBeenCalledTimes(1));
    expect(sma.setData).not.toHaveBeenCalled();
    expect(overlaySeries).toHaveLength(1);
  });

  async function activateDrawingTool(
    user: ReturnType<typeof userEvent.setup>,
    name: "Trend Line" | "Horizontal Line" | "Select",
  ) {
    await user.click(screen.getByRole("button", { name: /Drawings/ }));
    await user.click(screen.getByRole("button", { name }));
  }

  function clickPane(paneIndex: number, x: number, y: number, hoveredObjectId?: string) {
    emitClick({
      paneIndex,
      point: { x, y },
      hoveredInfo: hoveredObjectId
        ? {
            objectId: hoveredObjectId,
            sourceKind: "series-primitive",
            type: "primitive",
            objectKind: "primitive",
          }
        : undefined,
    });
  }

  function hostPointer(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    x: number,
    y: number,
  ) {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      clientX: x,
      clientY: y,
    });
    const target = type === "pointerdown" ? screen.getByRole("img") : window;
    target.dispatchEvent(event);
  }

  async function createSelectedTrend(user: ReturnType<typeof userEvent.setup>) {
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    clickPane(0, 50, 80);
    const drawing = drawingPrimitive().getState().drawings[0] as TrendLineDrawing;
    clickPane(0, 30, 60, drawing.id);
    return drawing;
  }

  async function createSelectedHorizontal(user: ReturnType<typeof userEvent.setup>) {
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const drawing = drawingPrimitive().getState().drawings[0];
    clickPane(0, 20, 40, drawing?.id as string);
    return drawing;
  }

  function drawingPrimitive(): DrawingPrimitive {
    const current = attachedPrimitives.at(-1);
    expect(current).toBeInstanceOf(DrawingPrimitive);
    return current as unknown as DrawingPrimitive;
  }

  it("attaches one drawing primitive to the candle series without recreating the chart", async () => {
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(candlestick.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(attachedPrimitives).toHaveLength(1);
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    expect(addSeries).toHaveBeenCalledTimes(3);
    expect(fitContent).toHaveBeenCalledTimes(1);
  });

  it("creates a trend line draft then commits on the second pane-0 click and returns to Select", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const setDataCalls = candlestick.setData.mock.calls.length;
    const fitCalls = fitContent.mock.calls.length;
    const fetchCalls = mockedGetCandles.mock.calls.length;
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    expect(drawingPrimitive().getState().draft).toEqual({
      type: "trend-line",
      a: { time: 1_499_040_010, price: 360 },
      b: null,
    });
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    emitCrosshair({ paneIndex: 0, point: { x: 30, y: 60 } });
    expect(drawingPrimitive().getState().draft).toEqual({
      type: "trend-line",
      a: { time: 1_499_040_010, price: 360 },
      b: { time: 1_499_040_030, price: 340 },
    });
    clickPane(0, 50, 80);
    expect(drawingPrimitive().getState().draft).toBeNull();
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        type: "trend-line",
        symbol: "BTCUSDT",
        a: { time: 1_499_040_010, price: 360 },
        b: { time: 1_499_040_050, price: 320 },
      }),
    ]);
    expect(screen.getByRole("button", { name: /^Drawings/ })).toBeInTheDocument();
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);
    expect(fitContent.mock.calls.length).toBe(fitCalls);
    expect(mockedGetCandles.mock.calls.length).toBe(fetchCalls);
  });

  it("cancels a trend draft on Escape without committing", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    expect(drawingPrimitive().getState().draft).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(drawingPrimitive().getState().draft).toBeNull();
    expect(drawingPrimitive().getState().drawings).toEqual([]);
  });

  it("commits a horizontal line on one pane-0 click and returns to Select", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        type: "horizontal-line",
        symbol: "BTCUSDT",
        price: 360,
      }),
    ]);
    expect(drawingPrimitive().getState().draft).toBeNull();
    expect(screen.getByRole("button", { name: /^Drawings/ })).toBeInTheDocument();
  });

  it("does not create a drawing from indicator pane clicks", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Trend Line");
    clickPane(1, 10, 40);
    clickPane(2, 10, 40);
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(1, 10, 40);
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    expect(drawingPrimitive().getState().draft).toBeNull();
  });

  it("selects a drawing from hoveredInfo and deselects on an empty pane-0 click", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const id = drawingPrimitive().getState().drawings[0]?.id as string;
    expect(drawingPrimitive().hitTest(20, 40)?.externalId).toBeDefined();
    expect(parseDrawingHit(drawingPrimitive().hitTest(20, 40)?.externalId)?.drawingId).toBe(id);
    clickPane(0, 20, 40, id);
    expect(drawingPrimitive().getState().selectedId).toBe(id);
    expect(document.activeElement).toBe(screen.getByRole("img"));
    clickPane(0, 20, 40);
    expect(drawingPrimitive().getState().selectedId).toBeNull();
  });

  it("deletes the selected drawing with Delete and Backspace unless an input is focused", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const firstId = drawingPrimitive().getState().drawings[0]?.id as string;
    clickPane(0, 20, 40, firstId);
    await user.keyboard("{Delete}");
    expect(drawingPrimitive().getState().drawings).toEqual([]);

    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 16, 50);
    const secondId = drawingPrimitive().getState().drawings[0]?.id as string;
    clickPane(0, 20, 50, secondId);
    await user.keyboard("{Backspace}");
    expect(drawingPrimitive().getState().drawings).toEqual([]);

    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 18, 60);
    const thirdId = drawingPrimitive().getState().drawings[0]?.id as string;
    clickPane(0, 20, 60, thirdId);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    screen.getByLabelText("SMA period").focus();
    await user.keyboard("{Delete}{Backspace}");
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({ id: thirdId }),
    ]);
  });

  it("does not delete a selected drawing while an unrelated control is focused", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const id = drawingPrimitive().getState().drawings[0]?.id as string;
    clickPane(0, 20, 40, id);
    expect(document.activeElement).toBe(screen.getByRole("img"));
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(document.activeElement).not.toBe(screen.getByRole("img"));
    await user.keyboard("{Delete}{Backspace}");
    expect(drawingPrimitive().getState().drawings).toEqual([expect.objectContaining({ id })]);
    document.body.tabIndex = 0;
    document.body.focus();
    await user.keyboard("{Delete}");
    expect(drawingPrimitive().getState().drawings).toEqual([expect.objectContaining({ id })]);
    document.body.removeAttribute("tabIndex");
  });

  it("isolates completed drawings by symbol", async () => {
    const user = userEvent.setup();
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
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const btcDrawing = drawingPrimitive().getState().drawings[0];
    expect(btcDrawing?.symbol).toBe("BTCUSDT");
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    view.rerender(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(3));
    expect(drawingPrimitive().getState().drawings).toEqual([btcDrawing]);
  });

  it("keeps drawings across a prefetched interval change and cancels an in-progress draft", async () => {
    const user = userEvent.setup();
    const hourCandles: CandleListResponse = { ...btcCandles, interval: "1h" };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcCandles,
    );
    const onIntervalChange = vi.fn();
    const view = renderChart("BTCUSDT", false, { onIntervalChange });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const drawing = drawingPrimitive().getState().drawings[0];
    const attached = drawingPrimitive();
    await view.client.prefetchQuery({
      queryKey: queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: TRADE_CHART_LIMIT,
      }),
      queryFn: () => getCandles({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
    });
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    expect(drawingPrimitive().getState().draft).not.toBeNull();
    view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={view.client}>
          <MarketChart symbol="BTCUSDT" interval="1h" onIntervalChange={onIntervalChange} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", "BTCUSDT 1h historical candlestick chart"),
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(drawingPrimitive()).toBe(attached);
    expect(drawingPrimitive().getState().drawings).toEqual([drawing]);
    expect(drawingPrimitive().getState().draft).toBeNull();
  });

  it("updates drawing colors on theme change without recreating the chart or primitive", async () => {
    const user = userEvent.setup();
    renderChart("BTCUSDT", false, { themeToggle: true });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const attached = drawingPrimitive();
    const setDataCalls = candlestick.setData.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(chartApplyOptions).toHaveBeenCalled());
    expect(drawingPrimitive()).toBe(attached);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);
    expect(attached.getState().colors.line.length).toBeGreaterThan(0);
  });

  it("does not mutate drawing state on live replace, live append, or backfill", async () => {
    const user = userEvent.setup();
    mockedGetCandles.mockImplementation(async (params) => {
      if (params.before) {
        return { ...btcCandles, candles: [olderCandle()] };
      }

      return btcCandles;
    });
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Horizontal Line");
    clickPane(0, 12, 40);
    const before = drawingPrimitive().getState().drawings;
    const fitBefore = fitContent.mock.calls.length;
    marketSocket.emitCandle(liveFrame({ close: "106.00" }));
    await waitFor(() => expect(candlestick.update).toHaveBeenCalled());
    expect(drawingPrimitive().getState().drawings).toEqual(before);
    marketSocket.emitCandle(
      liveFrame({
        openTime: btcCandle.openTime + 900_000,
        closeTime: btcCandle.closeTime + 900_000,
        isClosed: false,
        close: "107.00",
      }),
    );
    await waitFor(() => expect(candlestick.update).toHaveBeenCalledTimes(2));
    expect(drawingPrimitive().getState().drawings).toEqual(before);
    candlestick.barsInLogicalRange.mockReturnValue({ barsBefore: 5, barsAfter: 90 });
    emitVisibleRange();
    await waitFor(() => expect(candlestick.setData.mock.calls.length).toBeGreaterThan(1));
    expect(drawingPrimitive().getState().drawings).toEqual(before);
    expect(fitContent.mock.calls.length).toBe(fitBefore);
  });

  it("keeps a single primitive and unduplicated listeners under Strict Mode", async () => {
    const user = userEvent.setup();
    const view = renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    expect(clickListeners.size).toBe(1);
    expect(crosshairListeners.size).toBe(1);
    expect(attachedPrimitives).toHaveLength(1);
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    expect(drawingPrimitive().getState().draft).not.toBeNull();
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    view.unmount();
    expect(candlestick.detachPrimitive).toHaveBeenCalled();
    expect(unsubscribeClick).toHaveBeenCalled();
  });

  it("drags trend endpoint A without moving B and commits on pointer up", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    const setDataCalls = candlestick.setData.mock.calls.length;
    const lineCalls = line.setData.mock.calls.length;
    const volumeCalls = volume.setData.mock.calls.length;
    const overlayCalls = overlaySeries.reduce((sum, series) => sum + series.setData.mock.calls.length, 0);
    const extraCalls = extraSeries.reduce((sum, series) => sum + series.setData.mock.calls.length, 0);
    const fitCalls = fitContent.mock.calls.length;
    const fetchCalls = mockedGetCandles.mock.calls.length;
    const charts = createChart.mock.calls.length;
    const rangeCalls = setVisibleLogicalRange.mock.calls.length;
    hostPointer("pointerdown", 10, 40);
    hostPointer("pointermove", 20, 50);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        id: original.id,
        a: { time: 1_499_040_020, price: 350 },
        b: original.b,
      }),
    ]);
    hostPointer("pointerup", 20, 50);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        id: original.id,
        a: { time: 1_499_040_020, price: 350 },
        b: original.b,
      }),
    ]);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);
    expect(line.setData.mock.calls.length).toBe(lineCalls);
    expect(volume.setData.mock.calls.length).toBe(volumeCalls);
    expect(overlaySeries.reduce((sum, series) => sum + series.setData.mock.calls.length, 0)).toBe(
      overlayCalls,
    );
    expect(extraSeries.reduce((sum, series) => sum + series.setData.mock.calls.length, 0)).toBe(
      extraCalls,
    );
    expect(fitContent.mock.calls.length).toBe(fitCalls);
    expect(mockedGetCandles.mock.calls.length).toBe(fetchCalls);
    expect(createChart).toHaveBeenCalledTimes(charts);
    expect(setVisibleLogicalRange.mock.calls.length).toBe(rangeCalls);
  });

  it("drags trend endpoint B without moving A", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    hostPointer("pointerdown", 50, 80);
    hostPointer("pointermove", 60, 90);
    hostPointer("pointerup", 60, 90);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        id: original.id,
        a: original.a,
        b: { time: 1_499_040_060, price: 310 },
      }),
    ]);
  });

  it("drags the trend body while preserving shape and without compounding", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    hostPointer("pointerdown", 30, 60);
    hostPointer("pointermove", 40, 70);
    const first = drawingPrimitive().getState().drawings[0] as TrendLineDrawing;
    expect(first.a).toEqual({ time: 1_499_040_020, price: 350 });
    expect(first.b).toEqual({ time: 1_499_040_060, price: 310 });
    expect(first.b.price - first.a.price).toBe(original.b.price - original.a.price);
    hostPointer("pointermove", 50, 80);
    const second = drawingPrimitive().getState().drawings[0] as TrendLineDrawing;
    expect(second.a).toEqual({ time: 1_499_040_030, price: 340 });
    expect(second.b).toEqual({ time: 1_499_040_070, price: 300 });
    expect(second.b.price - second.a.price).toBe(original.b.price - original.a.price);
    hostPointer("pointerup", 50, 80);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(second);
  });

  it("keeps the last valid trend preview when coordinate conversion fails", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await createSelectedTrend(user);
    hostPointer("pointerdown", 10, 40);
    hostPointer("pointermove", 20, 50);
    const preview = drawingPrimitive().getState().drawings[0];
    hostPointer("pointermove", -1, 50);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(preview);
    hostPointer("pointerup", -1, 50);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(preview);
  });

  it("restores the original trend on Escape during a drag and keeps selection", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    hostPointer("pointerdown", 30, 60);
    hostPointer("pointermove", 40, 70);
    expect(drawingPrimitive().getState().drawings[0]).not.toEqual(original);
    await user.keyboard("{Escape}");
    expect(drawingPrimitive().getState().drawings[0]).toEqual(original);
    expect(drawingPrimitive().getState().selectedId).toBe(original.id);
  });

  it("cancels an in-progress drag on pointercancel without committing", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    const setDataCalls = candlestick.setData.mock.calls.length;
    const fitCalls = fitContent.mock.calls.length;
    const charts = createChart.mock.calls.length;
    hostPointer("pointerdown", 30, 60);
    hostPointer("pointermove", 40, 70);
    expect(drawingPrimitive().getState().drawings[0]).not.toEqual(original);
    hostPointer("pointercancel", 40, 70);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(original);
    expect(drawingPrimitive().getState().selectedId).toBe(original.id);
    expect(candlestick.setData.mock.calls.length).toBe(setDataCalls);
    expect(fitContent.mock.calls.length).toBe(fitCalls);
    expect(createChart).toHaveBeenCalledTimes(charts);
  });

  it("drags a horizontal line vertically and ignores invalid conversions until commit", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedHorizontal(user);
    hostPointer("pointerdown", 20, 40);
    hostPointer("pointermove", 20, 20);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({ id: original?.id, price: 380 }),
    ]);
    hostPointer("pointermove", 20, -1);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({ id: original?.id, price: 380 }),
    ]);
    hostPointer("pointerup", 20, 20);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({ id: original?.id, price: 380 }),
    ]);
  });

  it("does not expose endpoint drag on an unselected trend", async () => {
    const user = userEvent.setup();
    renderChart();
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    await activateDrawingTool(user, "Trend Line");
    clickPane(0, 10, 40);
    clickPane(0, 50, 80);
    const original = drawingPrimitive().getState().drawings[0];
    expect(drawingPrimitive().getState().selectedId).toBeNull();
    hostPointer("pointerdown", 10, 40);
    hostPointer("pointermove", 20, 50);
    hostPointer("pointerup", 20, 50);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(original);
  });

  it("cancels an in-progress drag on symbol change without committing the preview", async () => {
    const user = userEvent.setup();
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
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    hostPointer("pointerdown", 30, 60);
    hostPointer("pointermove", 40, 70);
    expect(drawingPrimitive().getState().drawings[0]).not.toEqual(original);
    view.rerender(tree("ETHUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(2));
    expect(drawingPrimitive().getState().drawings).toEqual([]);
    view.rerender(tree("BTCUSDT"));
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(3));
    expect(drawingPrimitive().getState().drawings[0]).toEqual(original);
    expect(drawingPrimitive().getState().selectedId).toBeNull();
  });

  it("cancels an in-progress drag on interval change and keeps the last committed drawing", async () => {
    const user = userEvent.setup();
    const hourCandles: CandleListResponse = { ...btcCandles, interval: "1h" };
    mockedGetCandles.mockImplementation(async ({ interval }) =>
      interval === "1h" ? hourCandles : btcCandles,
    );
    const onIntervalChange = vi.fn();
    const view = renderChart("BTCUSDT", false, { onIntervalChange });
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    const original = await createSelectedTrend(user);
    const attached = drawingPrimitive();
    await view.client.prefetchQuery({
      queryKey: queryKeys.candles.list({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: TRADE_CHART_LIMIT,
      }),
      queryFn: () => getCandles({ symbol: "BTCUSDT", interval: "1h", limit: TRADE_CHART_LIMIT }),
    });
    hostPointer("pointerdown", 30, 60);
    hostPointer("pointermove", 40, 70);
    expect(drawingPrimitive().getState().drawings[0]).not.toEqual(original);
    view.rerender(
      <ThemeProvider>
        <QueryClientProvider client={view.client}>
          <MarketChart symbol="BTCUSDT" interval="1h" onIntervalChange={onIntervalChange} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", "BTCUSDT 1h historical candlestick chart"),
    );
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(drawingPrimitive()).toBe(attached);
    expect(drawingPrimitive().getState().drawings[0]).toEqual(original);
  });

  it("does not duplicate drawing pointer listeners under Strict Mode", async () => {
    const user = userEvent.setup();
    const view = renderChart("BTCUSDT", true);
    await waitFor(() => expect(createChart).toHaveBeenCalled());
    await createSelectedTrend(user);
    const addSpy = vi.spyOn(window, "addEventListener");
    hostPointer("pointerdown", 30, 60);
    const pointerMoves = addSpy.mock.calls.filter((call) => call[0] === "pointermove");
    expect(pointerMoves).toHaveLength(1);
    hostPointer("pointermove", 40, 70);
    hostPointer("pointermove", 50, 80);
    expect(drawingPrimitive().getState().drawings).toEqual([
      expect.objectContaining({
        a: { time: 1_499_040_030, price: 340 },
        b: { time: 1_499_040_070, price: 300 },
      }),
    ]);
    addSpy.mockRestore();
    view.unmount();
    hostPointer("pointermove", 80, 90);
  });
});
