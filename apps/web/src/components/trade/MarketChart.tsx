import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import { getCandles, TRADE_CHART_INTERVAL, TRADE_CHART_LIMIT } from "../../lib/api/candles.ts";
import { toChartCandles } from "../../lib/chart/to-chart-candles.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";

const HOST_CLASS =
  "h-72 w-full min-w-0 overflow-hidden md:h-[22rem] lg:h-[26rem] xl:h-[28rem]";

export function MarketChart({ symbol }: { symbol: string | null }) {
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fittedKeyRef = useRef<string | null>(null);
  const candlesQuery = useQuery({
    queryKey: symbol
      ? queryKeys.candles.list({
          symbol,
          interval: TRADE_CHART_INTERVAL,
          limit: TRADE_CHART_LIMIT,
        })
      : queryKeys.candles.all,
    queryFn: () =>
      getCandles({
        symbol: symbol as string,
        interval: TRADE_CHART_INTERVAL,
        limit: TRADE_CHART_LIMIT,
      }),
    enabled: Boolean(symbol),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const points = useMemo(
    () => (candlesQuery.data ? toChartCandles(candlesQuery.data.candles) : []),
    [candlesQuery.data],
  );
  const hasRenderableData = points.length > 0;

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
    const series: ISeriesApi<"Candlestick"> = chart.addSeries(
      CandlestickSeries,
      seriesAppearanceOptions(colors),
    );
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      fittedKeyRef.current = null;
    };
  }, [symbol, hasRenderableData]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;

    if (!chart || !series || !symbol || points.length === 0) {
      return;
    }

    series.setData(points);

    const fitKey = `${symbol}:${TRADE_CHART_INTERVAL}`;
    if (fittedKeyRef.current !== fitKey) {
      chart.timeScale().fitContent();
      fittedKeyRef.current = fitKey;
    }
  }, [points, symbol]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;

    if (!chart || !series) {
      return;
    }

    const colors = readChartColors();
    chart.applyOptions(chartAppearanceOptions(colors));
    series.applyOptions(seriesAppearanceOptions(colors));
  }, [theme]);

  const heading = (
    <div className="mb-2 flex min-w-0 items-baseline gap-2">
      <h2 className="font-heading text-base text-foreground">{symbol ?? "Chart"}</h2>
      <p className="text-xs text-secondary">{TRADE_CHART_INTERVAL}</p>
    </div>
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

  if (points.length === 0) {
    return (
      <div>
        {heading}
        <EmptyState>No candle data available</EmptyState>
      </div>
    );
  }

  return (
    <div>
      {heading}
      <div
        ref={hostRef}
        className={HOST_CLASS}
        role="img"
        aria-label={`${symbol} ${TRADE_CHART_INTERVAL} historical candlestick chart`}
      />
    </div>
  );
}

type ChartColors = {
  background: string;
  text: string;
  grid: string;
  positive: string;
  negative: string;
};

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
    timeScale: { borderColor: colors.grid },
  };
}

function seriesAppearanceOptions(colors: ChartColors) {
  return {
    upColor: colors.positive,
    downColor: colors.negative,
    borderUpColor: colors.positive,
    borderDownColor: colors.negative,
    wickUpColor: colors.positive,
    wickDownColor: colors.negative,
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
  };
}

function readToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}
