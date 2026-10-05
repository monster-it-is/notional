import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candle, CandleInterval, CandleListResponse } from "@notional/contracts";
import { CANDLE_INTERVALS } from "@notional/contracts";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
} from "lightweight-charts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CandleLegend } from "./CandleLegend.tsx";
import { IndicatorsMenu } from "./IndicatorsMenu.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ErrorBanner } from "../ui/ErrorBanner.tsx";
import {
  getCandles,
  historicalBackfillLimit,
  TRADE_CHART_LIMIT,
  TRADE_CHART_MAX_CANDLES,
} from "../../lib/api/candles.ts";
import {
  classifyChartSeriesMutation,
  countLeftPrependedBars,
} from "../../lib/chart/classify-series-mutation.ts";
import { findCandleByChartTime } from "../../lib/chart/find-candle-by-chart-time.ts";
import { mergeLatestSnapshot } from "../../lib/chart/merge-latest-snapshot.ts";
import { mergeLiveCandle } from "../../lib/chart/merge-live-candle.ts";
import { prependOlderCandles } from "../../lib/chart/prepend-older-candles.ts";
import {
  candleSelectionKey,
  resolveLegendCandle,
  type ChartCandleSelection,
} from "../../lib/chart/resolve-legend-candle.ts";
import { shouldRequestOlderCandles } from "../../lib/chart/should-request-older-candles.ts";
import { computeEnabledIndicators } from "../../lib/chart/indicators/compute-enabled.ts";
import {
  DEFAULT_INDICATOR_SETTINGS,
  oscillatorEnabledCount,
  type IndicatorSettings,
} from "../../lib/chart/indicators/settings.ts";
import {
  toChartBollingerLines,
  toChartIndicatorLine,
  toChartMacdHistogram,
  toChartMacdLines,
} from "../../lib/chart/to-chart-indicators.ts";
import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  type AlignedChartPoints,
} from "../../lib/chart/to-chart-candles.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { getMarketSocket } from "../../realtime/runtime.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";

const HOST_HEIGHT_CLASSES = {
  0: "h-72 w-full min-w-0 md:h-[22rem] lg:h-[26rem] xl:h-[28rem]",
  1: "h-[28rem] w-full min-w-0 md:h-[30rem] lg:h-[34rem] xl:h-[36rem]",
  2: "h-[34rem] w-full min-w-0 md:h-[36rem] lg:h-[40rem] xl:h-[42rem]",
} as const;

function chartHostHeightClass(oscillatorCount: number): string {
  if (oscillatorCount >= 2) {
    return HOST_HEIGHT_CLASSES[2];
  }

  if (oscillatorCount === 1) {
    return HOST_HEIGHT_CLASSES[1];
  }

  return HOST_HEIGHT_CLASSES[0];
}

function chartHostClass(oscillatorCount: number): string {
  return `${chartHostHeightClass(oscillatorCount)} overflow-hidden`;
}

function chartSlotClass(oscillatorCount: number): string {
  return `${chartHostHeightClass(oscillatorCount)} flex items-center justify-center`;
}

const EMPTY_POINTS: AlignedChartPoints = {
  candles: [],
  line: [],
  volume: [],
};
const EMPTY_CANDLES: Candle[] = [];

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
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>(
    DEFAULT_INDICATOR_SETTINGS,
  );
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selection, setSelection] = useState<ChartCandleSelection>(null);
  const [identitySession, setIdentitySession] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiOverboughtLineRef = useRef<IPriceLine | null>(null);
  const rsiMidLineRef = useRef<IPriceLine | null>(null);
  const rsiOversoldLineRef = useRef<IPriceLine | null>(null);
  const macdZeroLineRef = useRef<IPriceLine | null>(null);
  const overlayValuesRef = useRef(computeEnabledIndicators([], DEFAULT_INDICATOR_SETTINGS));
  const fittedKeyRef = useRef<string | null>(null);
  const previousPointsRef = useRef<CandlestickData[]>([]);
  const pointsRef = useRef(EMPTY_POINTS);
  const modeRef = useRef<ChartDisplayMode>("candles");
  const abortRef = useRef<AbortController | null>(null);
  const exhaustedRef = useRef(false);
  const blockedBeforeRef = useRef<number | null>(null);
  const backfillInFlightRef = useRef(false);
  const backfillGenerationRef = useRef(0);
  const handleVisibleLogicalRangeRef = useRef<(range: LogicalRange | null) => void>(() => undefined);
  const requestOlderHistoryRef = useRef<() => Promise<void>>(async () => undefined);
  const candlesRef = useRef<readonly Candle[]>(EMPTY_CANDLES);
  const identityRef = useRef<{ symbol: string | null; interval: CandleInterval }>({
    symbol,
    interval,
  });
  const identitySessionRef = useRef(0);
  const emittedSelectionKeyRef = useRef(candleSelectionKey(null));
  const handleCrosshairMoveRef = useRef<(param: MouseEventParams) => void>(() => undefined);

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
    refetchOnReconnect: false,
  });

  const points = useMemo(
    () => (candlesQuery.data ? toAlignedChartPoints(candlesQuery.data.candles) : EMPTY_POINTS),
    [candlesQuery.data],
  );
  const hasRenderableData = points.candles.length > 0;
  const overlayValues = useMemo(
    () =>
      computeEnabledIndicators(candlesQuery.data?.candles ?? EMPTY_CANDLES, indicatorSettings),
    [candlesQuery.data, indicatorSettings],
  );

  useLayoutEffect(() => {
    overlayValuesRef.current = overlayValues;
  }, [overlayValues]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    exhaustedRef.current = false;
    blockedBeforeRef.current = null;
    backfillInFlightRef.current = false;
    backfillGenerationRef.current += 1;
    identitySessionRef.current += 1;
    emittedSelectionKeyRef.current = candleSelectionKey(null);
    setIdentitySession(identitySessionRef.current);
    setLoadingOlder(false);

    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    };
  }, [symbol, interval]);

  useLayoutEffect(() => {
    candlesRef.current = candlesQuery.data?.candles ?? EMPTY_CANDLES;
    identityRef.current = { symbol, interval };
  }, [candlesQuery.data, symbol, interval]);

  useLayoutEffect(() => {
    requestOlderHistoryRef.current = async () => {
      if (!symbol || backfillInFlightRef.current || exhaustedRef.current) {
        return;
      }

      const candleQueryKey = queryKeys.candles.list({
        symbol,
        interval,
        limit: TRADE_CHART_LIMIT,
      });
      const current = queryClient.getQueryData<CandleListResponse>(candleQueryKey);
      const oldestOpenTime = current?.candles[0]?.openTime;

      if (!current || oldestOpenTime === undefined) {
        return;
      }

      if (blockedBeforeRef.current === oldestOpenTime) {
        return;
      }

      const backfillLimit = historicalBackfillLimit(current.candles.length);

      if (backfillLimit <= 0) {
        return;
      }

      const signal = abortRef.current?.signal;

      if (signal?.aborted) {
        return;
      }

      const generation = backfillGenerationRef.current;
      backfillInFlightRef.current = true;
      setLoadingOlder(true);

      try {
        const page = await getCandles(
          {
            symbol,
            interval,
            limit: backfillLimit,
            before: oldestOpenTime,
          },
          signal ? { signal } : undefined,
        );

        if (signal?.aborted || generation !== backfillGenerationRef.current) {
          return;
        }

        if (page.candles.length < backfillLimit) {
          exhaustedRef.current = true;
        }

        queryClient.setQueryData<CandleListResponse>(candleQueryKey, (cached) => {
          return prependOlderCandles(cached, page, TRADE_CHART_MAX_CANDLES) ?? cached;
        });
      } catch {
        if (signal?.aborted || generation !== backfillGenerationRef.current) {
          return;
        }

        blockedBeforeRef.current = oldestOpenTime;
      } finally {
        if (generation === backfillGenerationRef.current) {
          backfillInFlightRef.current = false;

          if (!signal?.aborted) {
            setLoadingOlder(false);
          }
        }
      }
    };

    handleVisibleLogicalRangeRef.current = (range: LogicalRange | null) => {
      const series = candleSeriesRef.current;

      if (!series || !range || !symbol) {
        return;
      }

      const info = series.barsInLogicalRange(range);
      const nearLeftEdge = shouldRequestOlderCandles(
        info ? { barsBefore: info.barsBefore, barsAfter: info.barsAfter } : null,
      );

      if (!nearLeftEdge) {
        blockedBeforeRef.current = null;
        return;
      }

      void requestOlderHistoryRef.current();
    };

    handleCrosshairMoveRef.current = (param: MouseEventParams) => {
      const identity = identityRef.current;
      const candles = candlesRef.current;
      const candle = findCandleByChartTime(candles, param.time);
      const next: ChartCandleSelection =
        candle && identity.symbol
          ? {
              symbol: identity.symbol,
              interval: identity.interval,
              openTime: candle.openTime,
              session: identitySessionRef.current,
            }
          : null;
      const key = candleSelectionKey(next);

      if (emittedSelectionKeyRef.current === key) {
        return;
      }

      emittedSelectionKeyRef.current = key;
      setSelection(next);
    };
  }, [symbol, interval, queryClient]);

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
        return mergeLiveCandle(current, message, TRADE_CHART_MAX_CANDLES) ?? current;
      });
    });
    const unsubscribeReconnect = socket.subscribeReconnectReady(() => {
      if (!symbol) {
        return;
      }

      const signal = abortRef.current?.signal;
      void (async () => {
        try {
          const latest = await getCandles(
            { symbol, interval, limit: TRADE_CHART_LIMIT },
            signal ? { signal } : undefined,
          );

          if (signal?.aborted) {
            return;
          }

          queryClient.setQueryData<CandleListResponse>(candleQueryKey, (current) => {
            return mergeLatestSnapshot(current, latest, TRADE_CHART_MAX_CANDLES) ?? current;
          });
        } catch {
          if (signal?.aborted) {
            return;
          }
        }
      })();
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

    const timeScale = chart.timeScale();
    const onVisibleLogicalRangeChange = (range: LogicalRange | null) => {
      handleVisibleLogicalRangeRef.current(range);
    };
    const onCrosshairMove = (param: MouseEventParams) => {
      handleCrosshairMoveRef.current(param);
    };
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
    chart.subscribeCrosshairMove(onCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbMiddleSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      rsiSeriesRef.current = null;
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
      rsiOverboughtLineRef.current = null;
      rsiMidLineRef.current = null;
      rsiOversoldLineRef.current = null;
      macdZeroLineRef.current = null;
      fittedKeyRef.current = null;
      previousPointsRef.current = [];
    };
  }, [symbol, hasRenderableData]);

  useEffect(() => {
    const chart = chartRef.current;

    if (!chart || !hasRenderableData) {
      return;
    }

    const colors = readChartColors();
    const smaEnabled = indicatorSettings.sma.enabled;
    const emaEnabled = indicatorSettings.ema.enabled;
    const bollingerEnabled = indicatorSettings.bollinger.enabled;
    reconcileOverlaySeries(
      chart,
      {
        sma: smaSeriesRef,
        ema: emaSeriesRef,
        bbUpper: bbUpperSeriesRef,
        bbMiddle: bbMiddleSeriesRef,
        bbLower: bbLowerSeriesRef,
      },
      { smaEnabled, emaEnabled, bollingerEnabled },
      colors,
    );
    applyOverlaySeriesData(
      {
        sma: smaSeriesRef.current,
        ema: emaSeriesRef.current,
        bbUpper: bbUpperSeriesRef.current,
        bbMiddle: bbMiddleSeriesRef.current,
        bbLower: bbLowerSeriesRef.current,
      },
      overlayValuesRef.current,
    );
  }, [symbol, hasRenderableData, indicatorSettings.sma.enabled, indicatorSettings.ema.enabled, indicatorSettings.bollinger.enabled]);

  useEffect(() => {
    const chart = chartRef.current;

    if (!chart || !hasRenderableData) {
      return;
    }

    const colors = readChartColors();
    reconcileOscillatorSeries(
      chart,
      {
        rsi: rsiSeriesRef,
        macdLine: macdLineSeriesRef,
        macdSignal: macdSignalSeriesRef,
        macdHistogram: macdHistogramSeriesRef,
        rsiOverbought: rsiOverboughtLineRef,
        rsiMid: rsiMidLineRef,
        rsiOversold: rsiOversoldLineRef,
        macdZero: macdZeroLineRef,
      },
      {
        rsiEnabled: indicatorSettings.rsi.enabled,
        macdEnabled: indicatorSettings.macd.enabled,
      },
      colors,
    );
    applyOscillatorSeriesData(
      {
        rsi: rsiSeriesRef.current,
        macdLine: macdLineSeriesRef.current,
        macdSignal: macdSignalSeriesRef.current,
        macdHistogram: macdHistogramSeriesRef.current,
      },
      overlayValuesRef.current,
      colors,
    );
  }, [symbol, hasRenderableData, indicatorSettings.rsi.enabled, indicatorSettings.macd.enabled]);

  useEffect(() => {
    const colors = readChartColors();
    applyOverlaySeriesData(
      {
        sma: smaSeriesRef.current,
        ema: emaSeriesRef.current,
        bbUpper: bbUpperSeriesRef.current,
        bbMiddle: bbMiddleSeriesRef.current,
        bbLower: bbLowerSeriesRef.current,
      },
      overlayValues,
    );
    applyOscillatorSeriesData(
      {
        rsi: rsiSeriesRef.current,
        macdLine: macdLineSeriesRef.current,
        macdSignal: macdSignalSeriesRef.current,
        macdHistogram: macdHistogramSeriesRef.current,
      },
      overlayValues,
      colors,
    );
  }, [overlayValues]);

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
    const prepended = identityChanged
      ? 0
      : countLeftPrependedBars(previousPointsRef.current, points.candles);
    const visibleLogicalRange =
      prepended > 0 ? chart.timeScale().getVisibleLogicalRange() : null;

    if (mutation === "update" && lastCandle && lastLine && lastVolume) {
      candleSeries.update(lastCandle);
      lineSeries.update(lastLine);
      volumeSeries.update(lastVolume);
    } else {
      candleSeries.setData(points.candles);
      lineSeries.setData(points.line);
      volumeSeries.setData(volume);

      if (visibleLogicalRange) {
        chart.timeScale().setVisibleLogicalRange({
          from: visibleLogicalRange.from + prepended,
          to: visibleLogicalRange.to + prepended,
        });
      }
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
    smaSeriesRef.current?.applyOptions(smaAppearanceOptions(colors));
    emaSeriesRef.current?.applyOptions(emaAppearanceOptions(colors));
    bbUpperSeriesRef.current?.applyOptions(bollingerBandAppearanceOptions(colors.bbUpper, true));
    bbMiddleSeriesRef.current?.applyOptions(bollingerBandAppearanceOptions(colors.bbMiddle, false));
    bbLowerSeriesRef.current?.applyOptions(bollingerBandAppearanceOptions(colors.bbLower, true));
    rsiSeriesRef.current?.applyOptions(rsiAppearanceOptions(colors));
    macdLineSeriesRef.current?.applyOptions(macdLineAppearanceOptions(colors));
    macdSignalSeriesRef.current?.applyOptions(macdSignalAppearanceOptions(colors));
    macdHistogramSeriesRef.current?.applyOptions(macdHistogramAppearanceOptions());
    rsiOverboughtLineRef.current?.applyOptions(rsiGuideLineOptions(70, colors, LineStyle.Dashed));
    rsiMidLineRef.current?.applyOptions(rsiGuideLineOptions(50, colors, LineStyle.Dotted));
    rsiOversoldLineRef.current?.applyOptions(rsiGuideLineOptions(30, colors, LineStyle.Dashed));
    macdZeroLineRef.current?.applyOptions(macdZeroLineOptions(colors));

    if (previousThemeRef.current !== theme && latest.candles.length > 0) {
      volumeSeries.setData(colorVolume(latest, colors));
      applyOscillatorSeriesData(
        {
          rsi: rsiSeriesRef.current,
          macdLine: macdLineSeriesRef.current,
          macdSignal: macdSignalSeriesRef.current,
          macdHistogram: macdHistogramSeriesRef.current,
        },
        overlayValuesRef.current,
        colors,
      );
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

  const oscillatorCount = oscillatorEnabledCount(indicatorSettings);
  const hostClass = chartHostClass(oscillatorCount);
  const slotClass = chartSlotClass(oscillatorCount);
  const heading = (
    <ChartToolbar
      symbol={symbol}
      interval={interval}
      mode={mode}
      loadingOlder={loadingOlder}
      indicatorSettings={indicatorSettings}
      onIntervalChange={onIntervalChange}
      onModeChange={setMode}
      onIndicatorSettingsChange={setIndicatorSettings}
    />
  );

  if (!symbol) {
    return (
      <div className="min-w-0">
        {heading}
        <div className={slotClass}>
          <EmptyState>Select an instrument to load historical candles.</EmptyState>
        </div>
      </div>
    );
  }

  if (candlesQuery.isLoading) {
    return (
      <div className="min-w-0" aria-busy="true">
        {heading}
        <div
          className={`${hostClass} animate-pulse rounded-md bg-surface-subtle`}
          aria-hidden="true"
        />
        <p className="sr-only">Loading historical candles</p>
      </div>
    );
  }

  if (candlesQuery.error) {
    return (
      <div className="min-w-0">
        {heading}
        <div className={slotClass}>
          <ErrorBanner error={candlesQuery.error} />
        </div>
      </div>
    );
  }

  if (points.candles.length === 0) {
    return (
      <div className="min-w-0">
        {heading}
        <div className={slotClass}>
          <EmptyState>No candle data available</EmptyState>
        </div>
      </div>
    );
  }

  const chartKind = mode === "line" ? "line" : "candlestick";
  const legendCandle = resolveLegendCandle({
    candles: candlesQuery.data?.candles ?? EMPTY_CANDLES,
    selection,
    symbol,
    interval,
    session: identitySession,
  });

  return (
    <div className="min-w-0">
      {heading}
      <div className="relative min-w-0">
        {legendCandle ? (
          <CandleLegend symbol={symbol} interval={interval} candle={legendCandle} />
        ) : null}
        <div
          ref={hostRef}
          className={hostClass}
          role="img"
          aria-label={`${symbol} ${interval} historical ${chartKind} chart`}
        />
      </div>
    </div>
  );
}

function ChartToolbar({
  symbol,
  interval,
  mode,
  loadingOlder,
  indicatorSettings,
  onIntervalChange,
  onModeChange,
  onIndicatorSettingsChange,
}: {
  symbol: string | null;
  interval: CandleInterval;
  mode: ChartDisplayMode;
  loadingOlder: boolean;
  indicatorSettings: IndicatorSettings;
  onIntervalChange: (interval: CandleInterval) => void;
  onModeChange: (mode: ChartDisplayMode) => void;
  onIndicatorSettingsChange: (settings: IndicatorSettings) => void;
}) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
      <h2 className="shrink-0 font-heading text-base text-foreground">{symbol ?? "Chart"}</h2>
      <div
        role="group"
        aria-label="Chart interval"
        className="flex min-w-0 max-w-full flex-[1_1_12rem] items-center gap-1 overflow-x-auto overscroll-x-contain scrollbar-thin"
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
              className="min-w-11 shrink-0 px-2 lg:min-w-0"
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
      <IndicatorsMenu settings={indicatorSettings} onSettingsChange={onIndicatorSettingsChange} />
      {loadingOlder ? (
        <p className="text-xs text-secondary" aria-live="polite">
          Loading older data…
        </p>
      ) : null}
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
  sma: string;
  ema: string;
  bbUpper: string;
  bbMiddle: string;
  bbLower: string;
  rsi: string;
  macd: string;
  signal: string;
  guide: string;
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

function overlayLineAppearance(color: string, dashed: boolean) {
  return {
    color,
    lineWidth: 1 as const,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
  };
}

function smaAppearanceOptions(colors: ChartColors) {
  return overlayLineAppearance(colors.sma, false);
}

function emaAppearanceOptions(colors: ChartColors) {
  return overlayLineAppearance(colors.ema, false);
}

function bollingerBandAppearanceOptions(color: string, dashed: boolean) {
  return overlayLineAppearance(color, dashed);
}

function rsiAppearanceOptions(colors: ChartColors) {
  return {
    ...overlayLineAppearance(colors.rsi, false),
    autoscaleInfoProvider: () => ({
      priceRange: {
        minValue: 0,
        maxValue: 100,
      },
    }),
  };
}

function macdLineAppearanceOptions(colors: ChartColors) {
  return overlayLineAppearance(colors.macd, false);
}

function macdSignalAppearanceOptions(colors: ChartColors) {
  return overlayLineAppearance(colors.signal, false);
}

function macdHistogramAppearanceOptions() {
  return {
    base: 0,
    lastValueVisible: false,
    priceLineVisible: false,
  };
}

function rsiGuideLineOptions(price: number, colors: ChartColors, lineStyle: LineStyle) {
  return {
    price,
    color: colors.guide,
    lineWidth: 1 as const,
    lineStyle,
    axisLabelVisible: false,
    title: "",
  };
}

function macdZeroLineOptions(colors: ChartColors) {
  return rsiGuideLineOptions(0, colors, LineStyle.Dashed);
}

type OverlaySeriesRefs = {
  sma: { current: ISeriesApi<"Line"> | null };
  ema: { current: ISeriesApi<"Line"> | null };
  bbUpper: { current: ISeriesApi<"Line"> | null };
  bbMiddle: { current: ISeriesApi<"Line"> | null };
  bbLower: { current: ISeriesApi<"Line"> | null };
};

function reconcileOverlaySeries(
  chart: IChartApi,
  refs: OverlaySeriesRefs,
  enabled: { smaEnabled: boolean; emaEnabled: boolean; bollingerEnabled: boolean },
  colors: ChartColors,
): void {
  refs.sma.current = ensureLineSeries(
    chart,
    refs.sma.current,
    enabled.smaEnabled,
    smaAppearanceOptions(colors),
  );
  refs.ema.current = ensureLineSeries(
    chart,
    refs.ema.current,
    enabled.emaEnabled,
    emaAppearanceOptions(colors),
  );
  refs.bbUpper.current = ensureLineSeries(
    chart,
    refs.bbUpper.current,
    enabled.bollingerEnabled,
    bollingerBandAppearanceOptions(colors.bbUpper, true),
  );
  refs.bbMiddle.current = ensureLineSeries(
    chart,
    refs.bbMiddle.current,
    enabled.bollingerEnabled,
    bollingerBandAppearanceOptions(colors.bbMiddle, false),
  );
  refs.bbLower.current = ensureLineSeries(
    chart,
    refs.bbLower.current,
    enabled.bollingerEnabled,
    bollingerBandAppearanceOptions(colors.bbLower, true),
  );
}

function ensureLineSeries(
  chart: IChartApi,
  series: ISeriesApi<"Line"> | null,
  enabled: boolean,
  options: ReturnType<typeof overlayLineAppearance>,
): ISeriesApi<"Line"> | null {
  if (enabled) {
    if (series) {
      series.applyOptions(options);
      return series;
    }

    return chart.addSeries(LineSeries, options, 0);
  }

  if (series) {
    chart.removeSeries(series);
  }

  return null;
}

function applyOverlaySeriesData(
  series: {
    sma: ISeriesApi<"Line"> | null;
    ema: ISeriesApi<"Line"> | null;
    bbUpper: ISeriesApi<"Line"> | null;
    bbMiddle: ISeriesApi<"Line"> | null;
    bbLower: ISeriesApi<"Line"> | null;
  },
  values: ReturnType<typeof computeEnabledIndicators>,
): void {
  if (series.sma) {
    series.sma.setData(toChartIndicatorLine(values.sma ?? []));
  }

  if (series.ema) {
    series.ema.setData(toChartIndicatorLine(values.ema ?? []));
  }

  const bands = toChartBollingerLines(values.bollinger ?? []);

  if (series.bbUpper) {
    series.bbUpper.setData(bands.upper);
  }

  if (series.bbMiddle) {
    series.bbMiddle.setData(bands.middle);
  }

  if (series.bbLower) {
    series.bbLower.setData(bands.lower);
  }
}

type OscillatorSeriesRefs = {
  rsi: { current: ISeriesApi<"Line"> | null };
  macdLine: { current: ISeriesApi<"Line"> | null };
  macdSignal: { current: ISeriesApi<"Line"> | null };
  macdHistogram: { current: ISeriesApi<"Histogram"> | null };
  rsiOverbought: { current: IPriceLine | null };
  rsiMid: { current: IPriceLine | null };
  rsiOversold: { current: IPriceLine | null };
  macdZero: { current: IPriceLine | null };
};

function reconcileOscillatorSeries(
  chart: IChartApi,
  refs: OscillatorSeriesRefs,
  enabled: { rsiEnabled: boolean; macdEnabled: boolean },
  colors: ChartColors,
): void {
  refs.rsi.current = ensureRsiSeries(chart, refs, enabled.rsiEnabled, colors);
  ensureMacdSeries(chart, refs, enabled.macdEnabled, colors);
  normalizeOscillatorPaneOrder(refs.rsi.current, refs.macdLine.current);
  normalizeOscillatorStretch(chart, refs.rsi.current, refs.macdLine.current);
}

function ensureRsiSeries(
  chart: IChartApi,
  refs: OscillatorSeriesRefs,
  enabled: boolean,
  colors: ChartColors,
): ISeriesApi<"Line"> | null {
  const options = rsiAppearanceOptions(colors);

  if (enabled) {
    if (refs.rsi.current) {
      refs.rsi.current.applyOptions(options);
      return refs.rsi.current;
    }

    const series = chart.addSeries(LineSeries, options, chart.panes().length);
    refs.rsiOverbought.current = series.createPriceLine(
      rsiGuideLineOptions(70, colors, LineStyle.Dashed),
    );
    refs.rsiMid.current = series.createPriceLine(rsiGuideLineOptions(50, colors, LineStyle.Dotted));
    refs.rsiOversold.current = series.createPriceLine(
      rsiGuideLineOptions(30, colors, LineStyle.Dashed),
    );
    return series;
  }

  if (refs.rsi.current) {
    chart.removeSeries(refs.rsi.current);
  }

  refs.rsiOverbought.current = null;
  refs.rsiMid.current = null;
  refs.rsiOversold.current = null;
  return null;
}

function ensureMacdSeries(
  chart: IChartApi,
  refs: OscillatorSeriesRefs,
  enabled: boolean,
  colors: ChartColors,
): void {
  if (enabled) {
    if (refs.macdLine.current && refs.macdSignal.current && refs.macdHistogram.current) {
      refs.macdLine.current.applyOptions(macdLineAppearanceOptions(colors));
      refs.macdSignal.current.applyOptions(macdSignalAppearanceOptions(colors));
      refs.macdHistogram.current.applyOptions(macdHistogramAppearanceOptions());
      return;
    }

    removeMacdSeries(chart, refs);
    const line = chart.addSeries(
      LineSeries,
      macdLineAppearanceOptions(colors),
      chart.panes().length,
    );
    const paneIndex = line.getPane().paneIndex();
    refs.macdLine.current = line;
    refs.macdSignal.current = chart.addSeries(
      LineSeries,
      macdSignalAppearanceOptions(colors),
      paneIndex,
    );
    refs.macdHistogram.current = chart.addSeries(
      HistogramSeries,
      macdHistogramAppearanceOptions(),
      paneIndex,
    );
    refs.macdZero.current = line.createPriceLine(macdZeroLineOptions(colors));
    return;
  }

  removeMacdSeries(chart, refs);
}

function removeMacdSeries(chart: IChartApi, refs: OscillatorSeriesRefs): void {
  if (refs.macdHistogram.current) {
    chart.removeSeries(refs.macdHistogram.current);
    refs.macdHistogram.current = null;
  }

  if (refs.macdSignal.current) {
    chart.removeSeries(refs.macdSignal.current);
    refs.macdSignal.current = null;
  }

  if (refs.macdLine.current) {
    chart.removeSeries(refs.macdLine.current);
    refs.macdLine.current = null;
  }

  refs.macdZero.current = null;
}

function normalizeOscillatorPaneOrder(
  rsi: ISeriesApi<"Line"> | null,
  macdLine: ISeriesApi<"Line"> | null,
): void {
  if (rsi) {
    const rsiPane = rsi.getPane();

    if (rsiPane.paneIndex() !== 1) {
      rsiPane.moveTo(1);
    }
  }

  if (macdLine) {
    const macdPane = macdLine.getPane();
    const desired = rsi ? 2 : 1;

    if (macdPane.paneIndex() !== desired) {
      macdPane.moveTo(desired);
    }
  }
}

function normalizeOscillatorStretch(
  chart: IChartApi,
  rsi: ISeriesApi<"Line"> | null,
  macdLine: ISeriesApi<"Line"> | null,
): void {
  chart.panes()[0]?.setStretchFactor(3);
  rsi?.getPane().setStretchFactor(1);
  macdLine?.getPane().setStretchFactor(1);
}

function applyOscillatorSeriesData(
  series: {
    rsi: ISeriesApi<"Line"> | null;
    macdLine: ISeriesApi<"Line"> | null;
    macdSignal: ISeriesApi<"Line"> | null;
    macdHistogram: ISeriesApi<"Histogram"> | null;
  },
  values: ReturnType<typeof computeEnabledIndicators>,
  colors: ChartColors,
): void {
  if (series.rsi) {
    series.rsi.setData(toChartIndicatorLine(values.rsi ?? []));
  }

  const macd = toChartMacdLines(values.macd ?? []);
  const histogram = toChartMacdHistogram(values.macd ?? [], {
    positive: colors.positive,
    negative: colors.negative,
  });

  if (series.macdLine) {
    series.macdLine.setData(macd.macd);
  }

  if (series.macdSignal) {
    series.macdSignal.setData(macd.signal);
  }

  if (series.macdHistogram) {
    series.macdHistogram.setData(histogram);
  }
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
    sma: readToken(styles, "--chart-sma", "#6ea8ff"),
    ema: readToken(styles, "--chart-ema", "#c48ad9"),
    bbUpper: readToken(styles, "--chart-bb-upper", "#5f9ec9"),
    bbMiddle: readToken(styles, "--chart-bb-middle", "#8b9bb0"),
    bbLower: readToken(styles, "--chart-bb-lower", "#5f9ec9"),
    rsi: readToken(styles, "--chart-rsi", "#4ecdc4"),
    macd: readToken(styles, "--chart-macd", "#e8a87c"),
    signal: readToken(styles, "--chart-signal", "#9bb7d4"),
    guide: readToken(styles, "--chart-guide", "#6b7a8f"),
  };
}

function readToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}
