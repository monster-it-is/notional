import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CandleInterval, CandleListResponse } from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import { getCandles, TRADE_CHART_LIMIT } from "../../lib/api/candles.ts";
import { classifyChartSeriesMutation } from "../../lib/chart/classify-series-mutation.ts";
import { mergeLiveCandle } from "../../lib/chart/merge-live-candle.ts";
import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  type AlignedChartPoints,
} from "../../lib/chart/to-chart-candles.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { getMarketSocket } from "../../realtime/runtime.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";

const HOST_CLASS =
  "h-72 w-full min-w-0 overflow-hidden md:h-[22rem] lg:h-[26rem] xl:h-[28rem]";

const EMPTY_POINTS: AlignedChartPoints = {
  candles: [],
  line: [],
  volume: [],
};

type ChartDisplayMode = "candles" | "line";

export function MarketChart({
  symbol,
  interval,
  onIntervalChange,
}: {
  symbol: string | null;
  interval: CandleInterval;
  onIntervalChange: (interval: CandleInterval) => void;
}) {
  const { theme } = useTheme();
  const previousThemeRef = useRef(theme);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ChartDisplayMode>("candles");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const previousPointsRef = useRef<CandlestickData[]>([]);
  const pointsRef = useRef(EMPTY_POINTS);
  const modeRef = useRef<ChartDisplayMode>("candles");

  const candlesQuery = useQuery({
    queryKey: symbol
      ? queryKeys.candles.list({
          symbol,
          interval,
          limit: TRADE_CHART_LIMIT,
        })
      : queryKeys.candles.all,
    queryFn: () =>
      getCandles({
        symbol: symbol as string,
        interval,
        limit: TRADE_CHART_LIMIT,
      }),
    enabled: Boolean(symbol),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const points = useMemo(
    () => (candlesQuery.data ? toAlignedChartPoints(candlesQuery.data.candles) : EMPTY_POINTS),
    [candlesQuery.data],
  );
  const hasRenderableData = points.candles.length > 0;

  useEffect(() => {
    const socket = getMarketSocket();
    const candleQueryKey = symbol
      ? queryKeys.candles.list({
          symbol,
          interval,
          limit: TRADE_CHART_LIMIT,
        })
      : queryKeys.candles.all;
    socket.setDesiredCandle(symbol ? { symbol, interval } : null);
    const unsubscribeCandles = socket.subscribeMarketCandles((message) => {
      if (!symbol || message.symbol !== symbol || message.interval !== interval) {
        return;
      }

      queryClient.setQueryData<CandleListResponse>(candleQueryKey, (current) => {
        return mergeLiveCandle(current, message, TRADE_CHART_LIMIT) ?? current;
      });
    });
    const unsubscribeReconnect = socket.subscribeReconnectReady(() => {
      if (!symbol) {
        return;
      }

      void queryClient.refetchQueries({ queryKey: candleQueryKey });
    });

    return () => {
      unsubscribeCandles();
      unsubscribeReconnect();
      socket.setDesiredCandle(null);
    };
  }, [symbol, interval, queryClient]);

  useEffect(() => {
    const host = hostRef.current;

    if (!host || !symbol || !hasRenderableData) {
      return;
    }

    const colors = readChartColors();
    const chart: IChartApi = createChart(host, {
      autoSize: true,
      ...chartAppearanceOptions(colors),
    });
    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(
      CandlestickSeries,
      {
        ...candleAppearanceOptions(colors),
        visible: modeRef.current === "candles",
      },
    );
    const lineSeries: ISeriesApi<"Line"> = chart.addSeries(LineSeries, {
      ...lineAppearanceOptions(colors),
      visible: modeRef.current === "line",
    });
    const volumeSeries: ISeriesApi<"Histogram"> = chart.addSeries(HistogramSeries, {
      ...volumeAppearanceOptions(),
    });
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.08, bottom: 0.22 },
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;
    previousPointsRef.current = [];

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      fittedKeyRef.current = null;
      previousPointsRef.current = [];
    };
  }, [symbol, hasRenderableData]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!chart || !candleSeries || !lineSeries || !volumeSeries || !symbol || points.candles.length === 0) {
      return;
    }

    pointsRef.current = points;

    const colors = readChartColors();
    const volume = colorVolume(points, colors);
    const identity = `${symbol}:${interval}`;
    const lastCandle = points.candles[points.candles.length - 1];
    const lastLine = points.line[points.line.length - 1];
    const lastVolume = volume[volume.length - 1];
    const identityChanged = fittedKeyRef.current !== identity;
    const mutation = identityChanged
      ? "setData"
      : classifyChartSeriesMutation(previousPointsRef.current, points.candles);

    if (mutation === "update" && lastCandle && lastLine && lastVolume) {
      candleSeries.update(lastCandle);
      lineSeries.update(lastLine);
      volumeSeries.update(lastVolume);
    } else {
      candleSeries.setData(points.candles);
      lineSeries.setData(points.line);
      volumeSeries.setData(volume);
    }

    if (identityChanged) {
      chart.timeScale().fitContent();
      fittedKeyRef.current = identity;
    }

    previousPointsRef.current = points.candles;
  }, [points, symbol, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;

    if (!chart || !candleSeries || !lineSeries || !volumeSeries) {
      return;
    }

    const colors = readChartColors();
    const latest = pointsRef.current;
    chart.applyOptions(chartAppearanceOptions(colors));
    candleSeries.applyOptions(candleAppearanceOptions(colors));
    lineSeries.applyOptions(lineAppearanceOptions(colors));
    volumeSeries.applyOptions(volumeAppearanceOptions());

    if (previousThemeRef.current !== theme && latest.candles.length > 0) {
      volumeSeries.setData(colorVolume(latest, colors));
    }
    previousThemeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    modeRef.current = mode;
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;

    if (!candleSeries || !lineSeries) {
      return;
    }

    candleSeries.applyOptions({ visible: mode === "candles" });
    lineSeries.applyOptions({ visible: mode === "line" });
  }, [mode]);

  const heading = (
    <ChartToolbar
      symbol={symbol}
      interval={interval}
      mode={mode}
      onIntervalChange={onIntervalChange}
      onModeChange={setMode}
    />
  );

  if (!symbol) {
    return (
      <div>
        {heading}
        <EmptyState>Select an instrument to load historical candles.</EmptyState>
      </div>
    );
  }

  if (candlesQuery.isLoading) {
    return (
      <div>
        {heading}
        <div
          className={`${HOST_CLASS} animate-pulse rounded-md bg-surface-subtle`}
          aria-hidden="true"
        />
        <p className="sr-only">Loading historical candles</p>
      </div>
    );
  }

  if (candlesQuery.error) {
    return (
      <div>
        {heading}
        <ErrorBanner error={candlesQuery.error} />
      </div>
    );
  }

  if (points.candles.length === 0) {
    return (
      <div>
        {heading}
        <EmptyState>No candle data available</EmptyState>
      </div>
    );
  }

  const chartKind = mode === "line" ? "line" : "candlestick";

  return (
    <div>
      {heading}
      <div
        ref={hostRef}
        className={HOST_CLASS}
        role="img"
        aria-label={`${symbol} ${interval} historical ${chartKind} chart`}
      />
    </div>
  );
}

function ChartToolbar({
  symbol,
  interval,
  mode,
  onIntervalChange,
  onModeChange,
}: {
  symbol: string | null;
  interval: CandleInterval;
  mode: ChartDisplayMode;
  onIntervalChange: (interval: CandleInterval) => void;
  onModeChange: (mode: ChartDisplayMode) => void;
}) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
      <h2 className="font-heading text-base text-foreground">{symbol ?? "Chart"}</h2>
      <div
        role="group"
        aria-label="Chart interval"
        className="flex min-w-0 max-w-full flex-1 items-center gap-1 overflow-x-auto"
      >
        {CANDLE_INTERVALS.map((value) => {
          const selected = value === interval;

          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={selected ? "primary" : "secondary"}
              aria-pressed={selected}
              className="shrink-0 px-2"
              onClick={() => onIntervalChange(value)}
            >
              {value}
            </Button>
          );
        })}
      </div>
      <div role="group" aria-label="Chart mode" className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={mode === "candles" ? "primary" : "secondary"}
          aria-pressed={mode === "candles"}
          onClick={() => onModeChange("candles")}
        >
          Candles
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "line" ? "primary" : "secondary"}
          aria-pressed={mode === "line"}
          onClick={() => onModeChange("line")}
        >
          Line
        </Button>
      </div>
    </div>
  );
}

type ChartColors = {
  background: string;
  text: string;
  grid: string;
  positive: string;
  negative: string;
  accent: string;
};

function colorVolume(points: AlignedChartPoints, colors: ChartColors): HistogramData[] {
  return colorChartVolumePoints(points.volume, points.candles, {
    up: colors.positive,
    down: colors.negative,
  });
}

function chartAppearanceOptions(colors: ChartColors) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: colors.background },
      textColor: colors.text,
    },
    grid: {
      vertLines: { color: colors.grid },
      horzLines: { color: colors.grid },
    },
    rightPriceScale: { borderColor: colors.grid },
    overlayPriceScales: { borderColor: colors.grid },
    timeScale: { borderColor: colors.grid },
  };
}

function candleAppearanceOptions(colors: ChartColors) {
  return {
    upColor: colors.positive,
    downColor: colors.negative,
    borderUpColor: colors.positive,
    borderDownColor: colors.negative,
    wickUpColor: colors.positive,
    wickDownColor: colors.negative,
  };
}

function lineAppearanceOptions(colors: ChartColors) {
  return {
    color: colors.accent,
    lineWidth: 2 as const,
    lastValueVisible: true,
    priceLineVisible: true,
  };
}

function volumeAppearanceOptions() {
  return {
    priceScaleId: "volume",
    priceFormat: { type: "volume" as const },
    lastValueVisible: false,
    priceLineVisible: false,
  };
}

function readChartColors(): ChartColors {
  const styles = getComputedStyle(document.documentElement);

  return {
    background: readToken(styles, "--surface", "#0d1119"),
    text: readToken(styles, "--text-primary", "#f2f5f9"),
    grid: readToken(styles, "--border", "#232e40"),
    positive: readToken(styles, "--positive", "#2ebd85"),
    negative: readToken(styles, "--negative", "#f0544c"),
    accent: readToken(styles, "--accent", "#f0b429"),
  };
}

function readToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}
