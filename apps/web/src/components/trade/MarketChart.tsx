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
import { DrawingsMenu } from "./DrawingsMenu.tsx";
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
import {
  anyIndicatorEnabled,
  applyLiveIndicatorAppend,
  applyLiveIndicatorReplace,
  bootstrapIndicatorSessions,
  canApplyLiveAppend,
  canApplyLiveReplace,
  classifyLiveIndicatorPath,
  createIndicatorSessionIdentity,
  reconcileIndicatorSettings,
  rebuildIndicatorKind,
  type IndicatorKind,
  type IndicatorLiveSessions,
  type IndicatorLiveUpdates,
  type IndicatorSessionIdentity,
} from "../../lib/chart/indicators/live-session.ts";
import { oscillatorEnabledCount, type IndicatorSettings } from "../../lib/chart/indicators/settings.ts";
import {
  readTradeChartPreferences,
  writeTradeChartPreferences,
  type ChartDisplayMode,
} from "../../lib/chart/preferences.ts";
import {
  toChartBollingerLines,
  toChartBollingerPoint,
  toChartIndicatorLine,
  toChartIndicatorLinePoint,
  toChartMacdHistogram,
  toChartMacdLines,
  toChartMacdPoint,
} from "../../lib/chart/to-chart-indicators.ts";
import {
  colorChartVolumePoints,
  toAlignedChartPoints,
  type AlignedChartPoints,
} from "../../lib/chart/to-chart-candles.ts";
import { DrawingPrimitive } from "../../lib/chart/drawings/DrawingPrimitive.ts";
import {
  previewDrawingDrag,
  replaceDrawing,
  startDrawingDrag,
  type DrawingDrag,
} from "../../lib/chart/drawings/drag.ts";
import { parseDrawingHit } from "../../lib/chart/drawings/hit.ts";
import {
  chartPointFromPointer,
  isEditableKeyboardTarget,
  readHoveredDrawingId,
  resolveDrawingPoint,
} from "../../lib/chart/drawings/point.ts";
import {
  createDrawingId,
  type ChartDrawing,
  type DrawingDraft,
  type DrawingTool,
} from "../../lib/chart/drawings/types.ts";
import { queryKeys } from "../../lib/query-keys.ts";
import { getMarketSocket } from "../../realtime/runtime.ts";
import { useTheme } from "../../theme/ThemeProvider.tsx";

const HOST_HEIGHT_CLASSES = {
  0: "h-72 w-full min-w-0 md:h-[22rem] lg:h-[26rem] xl:h-[28rem]",
  1: "h-[28rem] w-full min-w-0 md:h-[30rem] lg:h-[34rem] xl:h-[36rem]",
  2: "h-[34rem] w-full min-w-0 md:h-[36rem] lg:h-[40rem] xl:h-[42rem]",
} as const;

const CHART_INTERACTION_LOCKED = {
  handleScroll: {
    pressedMouseMove: false,
    horzTouchDrag: false,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: false,
    pinch: false,
  },
} as const;

const CHART_INTERACTION_UNLOCKED = {
  handleScroll: {
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    pinch: true,
  },
} as const;

function dragCursor(type: DrawingDrag["type"]): string {
  if (type === "trend-a" || type === "trend-b") {
    return "pointer";
  }

  if (type === "horizontal") {
    return "ns-resize";
  }

  return "grabbing";
}

function chartHostHeightClass(oscillatorCount: number): string {
  if (oscillatorCount >= 2) {
    return HOST_HEIGHT_CLASSES[2];
  }

  if (oscillatorCount === 1) {
    return HOST_HEIGHT_CLASSES[1];
  }

  return HOST_HEIGHT_CLASSES[0];
}

const CHART_FOCUS_RING =
  "overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function chartHostClass(oscillatorCount: number, isFullscreen: boolean): string {
  const height = isFullscreen
    ? "h-full min-h-0 w-full min-w-0 flex-1"
    : chartHostHeightClass(oscillatorCount);
  return `${height} ${CHART_FOCUS_RING}`;
}

function chartSlotClass(oscillatorCount: number, isFullscreen: boolean): string {
  if (isFullscreen) {
    return "flex min-h-0 w-full min-w-0 flex-1 items-center justify-center";
  }

  return `${chartHostHeightClass(oscillatorCount)} flex items-center justify-center`;
}

function chartWrapperClass(isFullscreen: boolean): string {
  return isFullscreen
    ? "flex h-svh max-h-svh min-h-0 min-w-0 flex-col overflow-hidden bg-background p-3"
    : "min-w-0";
}

function chartPaneClass(isFullscreen: boolean): string {
  return isFullscreen ? "relative min-h-0 min-w-0 flex-1" : "relative min-w-0";
}

const EMPTY_POINTS: AlignedChartPoints = {
  candles: [],
  line: [],
  volume: [],
};
const EMPTY_CANDLES: Candle[] = [];

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
  const [initialPreferences] = useState(readTradeChartPreferences);
  const [mode, setMode] = useState<ChartDisplayMode>(initialPreferences.mode);
  const [indicatorSettings, setIndicatorSettings] = useState<IndicatorSettings>(
    initialPreferences.indicators,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selection, setSelection] = useState<ChartCandleSelection>(null);
  const [identitySession, setIdentitySession] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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
  const indicatorSessionsRef = useRef<IndicatorLiveSessions | null>(null);
  const indicatorSettingsRef = useRef(indicatorSettings);
  const indicatorDataIdentityRef = useRef<string | null>(null);
  const indicatorReconnectRepairRef = useRef<{ symbol: string; interval: CandleInterval } | null>(
    null,
  );
  const fittedKeyRef = useRef<string | null>(null);
  const previousPointsRef = useRef<CandlestickData[]>([]);
  const pointsRef = useRef(EMPTY_POINTS);
  const modeRef = useRef<ChartDisplayMode>(initialPreferences.mode);
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
  const handleChartClickRef = useRef<(param: MouseEventParams) => void>(() => undefined);
  const handleDrawingKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const handleViewKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const resetChartViewRef = useRef<() => void>(() => undefined);
  const toggleChartFullscreenRef = useRef<() => Promise<void>>(async () => undefined);
  const handleDrawingPointerDownRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const handleDrawingPointerMoveRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const handleDrawingPointerUpRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const handleDrawingPointerCancelRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const drawingPrimitiveRef = useRef<DrawingPrimitive | null>(null);
  const drawingToolRef = useRef<DrawingTool>("select");
  const drawingDraftRef = useRef<DrawingDraft | null>(null);
  const drawingsBySymbolRef = useRef<Record<string, ChartDrawing[]>>({});
  const selectedDrawingIdRef = useRef<string | null>(null);
  const hoveredDrawingIdRef = useRef<string | null>(null);
  const drawingDragRef = useRef<DrawingDrag | null>(null);
  const drawingDragPreviewRef = useRef<ChartDrawing | null>(null);
  const drawingDragWindowAttachedRef = useRef(false);
  const skipChartClickRef = useRef(false);
  const attachDrawingDragListenersRef = useRef<() => void>(() => undefined);
  const detachDrawingDragListenersRef = useRef<() => void>(() => undefined);
  const cancelDrawingDragRef = useRef<() => void>(() => undefined);
  const drawingsSymbolRef = useRef(symbol);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("select");
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<Record<string, ChartDrawing[]>>({});
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

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

  useLayoutEffect(() => {
    indicatorSettingsRef.current = indicatorSettings;
  }, [indicatorSettings]);

  useLayoutEffect(() => {
    drawingToolRef.current = drawingTool;
  }, [drawingTool]);

  useLayoutEffect(() => {
    drawingsBySymbolRef.current = drawingsBySymbol;
  }, [drawingsBySymbol]);

  useLayoutEffect(() => {
    selectedDrawingIdRef.current = selectedDrawingId;
  }, [selectedDrawingId]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    exhaustedRef.current = false;
    blockedBeforeRef.current = null;
    backfillInFlightRef.current = false;
    backfillGenerationRef.current += 1;
    identitySessionRef.current += 1;
    emittedSelectionKeyRef.current = candleSelectionKey(null);
    indicatorReconnectRepairRef.current = null;
    drawingDraftRef.current = null;
    hoveredDrawingIdRef.current = null;
    cancelDrawingDragRef.current();
    drawingPrimitiveRef.current?.setState({ draft: null, hoveredId: null });

    if (drawingsSymbolRef.current !== symbol) {
      drawingsSymbolRef.current = symbol;
      setSelectedDrawingId(null);
    }

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

      if (emittedSelectionKeyRef.current !== key) {
        emittedSelectionKeyRef.current = key;
        setSelection(next);
      }

      const primitive = drawingPrimitiveRef.current;
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const tool = drawingToolRef.current;
      let nextDraft = drawingDraftRef.current;

      if (tool === "trend-line" && nextDraft?.type === "trend-line" && param.paneIndex === 0 && param.point && chart && series) {
        const point = resolveDrawingPoint(chart, series, param.point);

        if (point) {
          nextDraft = { type: "trend-line", a: nextDraft.a, b: point };
          drawingDraftRef.current = nextDraft;
        }
      }

      const hoveredId = tool === "select" ? readHoveredDrawingId(param) : null;
      hoveredDrawingIdRef.current = hoveredId;
      primitive?.setState({ draft: nextDraft, hoveredId });
    };

    handleChartClickRef.current = (param: MouseEventParams) => {
      if (param.paneIndex !== 0) {
        return;
      }

      if (skipChartClickRef.current) {
        skipChartClickRef.current = false;
        return;
      }

      if (drawingDragRef.current) {
        return;
      }

      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const identity = identityRef.current.symbol;
      const tool = drawingToolRef.current;

      if (!chart || !series || !identity || !param.point) {
        return;
      }

      hostRef.current?.focus({ preventScroll: true });

      if (tool === "trend-line") {
        const point = resolveDrawingPoint(chart, series, param.point);

        if (!point) {
          return;
        }

        const draft = drawingDraftRef.current;

        if (!draft || draft.type !== "trend-line") {
          drawingDraftRef.current = { type: "trend-line", a: point, b: null };
          drawingPrimitiveRef.current?.setState({ draft: drawingDraftRef.current });
          return;
        }

        const committed: ChartDrawing = {
          id: createDrawingId(),
          type: "trend-line",
          symbol: identity,
          a: draft.a,
          b: point,
        };
        drawingDraftRef.current = null;
        const nextDrawings = [...(drawingsBySymbolRef.current[identity] ?? []), committed];
        drawingsBySymbolRef.current = { ...drawingsBySymbolRef.current, [identity]: nextDrawings };
        drawingToolRef.current = "select";
        drawingPrimitiveRef.current?.setState({ drawings: nextDrawings, draft: null });
        setDrawingsBySymbol((current) => ({
          ...current,
          [identity]: [...(current[identity] ?? []), committed],
        }));
        setDrawingTool("select");
        return;
      }

      if (tool === "horizontal-line") {
        const point = resolveDrawingPoint(chart, series, param.point);

        if (!point) {
          return;
        }

        const committed: ChartDrawing = {
          id: createDrawingId(),
          type: "horizontal-line",
          symbol: identity,
          price: point.price,
        };
        drawingDraftRef.current = null;
        const nextDrawings = [...(drawingsBySymbolRef.current[identity] ?? []), committed];
        drawingsBySymbolRef.current = { ...drawingsBySymbolRef.current, [identity]: nextDrawings };
        drawingToolRef.current = "select";
        drawingPrimitiveRef.current?.setState({ drawings: nextDrawings, draft: null });
        setDrawingsBySymbol((current) => ({
          ...current,
          [identity]: [...(current[identity] ?? []), committed],
        }));
        setDrawingTool("select");
        return;
      }

      const hovered = readHoveredDrawingId(param);
      const drawings = drawingsBySymbolRef.current[identity] ?? [];
      const nextSelected = hovered && drawings.some((drawing) => drawing.id === hovered) ? hovered : null;
      selectedDrawingIdRef.current = nextSelected;
      drawingPrimitiveRef.current?.setState({ selectedId: nextSelected });
      setSelectedDrawingId(nextSelected);
    };

    function setChartInteractionLocked(locked: boolean): void {
      chartRef.current?.applyOptions(locked ? CHART_INTERACTION_LOCKED : CHART_INTERACTION_UNLOCKED);
    }

    function publishDragPreview(preview: ChartDrawing): void {
      drawingDragPreviewRef.current = preview;
      const identity = identityRef.current.symbol;
      const drawings = identity
        ? replaceDrawing(drawingsBySymbolRef.current[identity] ?? [], preview)
        : [preview];
      drawingPrimitiveRef.current?.setState({
        drawings,
        selectedId: preview.id,
        draft: null,
      });
    }

    function cancelDrawingDrag(): void {
      if (!drawingDragRef.current) {
        detachDrawingDragListenersRef.current();
        return;
      }

      drawingDragRef.current = null;
      drawingDragPreviewRef.current = null;
      skipChartClickRef.current = false;
      setChartInteractionLocked(false);
      detachDrawingDragListenersRef.current();
      const host = hostRef.current;
      if (host) {
        host.style.cursor = "";
      }
      const identity = identityRef.current.symbol;
      const drawings = identity ? (drawingsBySymbolRef.current[identity] ?? []) : [];
      drawingPrimitiveRef.current?.setState({
        drawings,
        selectedId: selectedDrawingIdRef.current,
        draft: drawingDraftRef.current,
      });
    }

    cancelDrawingDragRef.current = cancelDrawingDrag;

    handleDrawingPointerDownRef.current = (event: PointerEvent) => {
      skipChartClickRef.current = false;

      if (event.button !== 0 || drawingToolRef.current !== "select" || drawingDragRef.current) {
        return;
      }

      const host = hostRef.current;
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const primitive = drawingPrimitiveRef.current;
      const identity = identityRef.current.symbol;
      const selectedId = selectedDrawingIdRef.current;

      if (!host || !chart || !series || !primitive || !identity || !selectedId) {
        return;
      }

      const pointer = chartPointFromPointer(host, event);
      const hit = parseDrawingHit(primitive.hitTest(pointer.x, pointer.y)?.externalId);

      if (!hit || hit.drawingId !== selectedId || !hit.region) {
        return;
      }

      const drawing = (drawingsBySymbolRef.current[identity] ?? []).find(
        (item) => item.id === selectedId,
      );

      if (!drawing) {
        return;
      }

      const drag = startDrawingDrag(drawing, hit.region, pointer, chart, series);

      if (!drag) {
        return;
      }

      event.preventDefault();
      host.focus({ preventScroll: true });
      drawingDragRef.current = drag;
      drawingDragPreviewRef.current = drawing;
      skipChartClickRef.current = true;
      setChartInteractionLocked(true);
      host.style.cursor = dragCursor(drag.type);
      attachDrawingDragListenersRef.current();

      if (typeof host.setPointerCapture === "function" && event.pointerId !== undefined) {
        try {
          host.setPointerCapture(event.pointerId);
        } catch {
          // jsdom and some browsers reject capture on detached nodes.
        }
      }
    };

    handleDrawingPointerMoveRef.current = (event: PointerEvent) => {
      const drag = drawingDragRef.current;
      const host = hostRef.current;
      const chart = chartRef.current;
      const series = candleSeriesRef.current;

      if (!drag || !host || !chart || !series) {
        return;
      }

      const pointer = chartPointFromPointer(host, event);
      const preview = previewDrawingDrag(drag, pointer, chart, series);

      if (!preview) {
        return;
      }

      publishDragPreview(preview);
    };

    handleDrawingPointerUpRef.current = (event: PointerEvent) => {
      const drag = drawingDragRef.current;
      const preview = drawingDragPreviewRef.current;
      const identity = identityRef.current.symbol;
      const host = hostRef.current;

      if (!drag) {
        return;
      }

      if (host && typeof host.releasePointerCapture === "function" && event.pointerId !== undefined) {
        try {
          if (host.hasPointerCapture?.(event.pointerId)) {
            host.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already have been released.
        }
      }

      drawingDragRef.current = null;
      drawingDragPreviewRef.current = null;
      setChartInteractionLocked(false);
      detachDrawingDragListenersRef.current();
      if (host) {
        host.style.cursor = "";
      }

      if (!preview || !identity) {
        skipChartClickRef.current = false;
        return;
      }

      const nextDrawings = replaceDrawing(drawingsBySymbolRef.current[identity] ?? [], preview);
      drawingsBySymbolRef.current = { ...drawingsBySymbolRef.current, [identity]: nextDrawings };
      selectedDrawingIdRef.current = preview.id;
      drawingPrimitiveRef.current?.setState({
        drawings: nextDrawings,
        selectedId: preview.id,
        draft: null,
      });
      setDrawingsBySymbol((current) => ({
        ...current,
        [identity]: replaceDrawing(current[identity] ?? [], preview),
      }));
      setSelectedDrawingId(preview.id);
    };

    handleDrawingPointerCancelRef.current = (event: PointerEvent) => {
      if (!drawingDragRef.current) {
        return;
      }

      const host = hostRef.current;

      if (host && typeof host.releasePointerCapture === "function" && event.pointerId !== undefined) {
        try {
          if (host.hasPointerCapture?.(event.pointerId)) {
            host.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already have been released.
        }
      }

      const selectedId = selectedDrawingIdRef.current;
      cancelDrawingDrag();
      selectedDrawingIdRef.current = selectedId;
      drawingPrimitiveRef.current?.setState({ selectedId });
    };

    handleDrawingKeyDownRef.current = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (drawingDragRef.current) {
          const selectedId = selectedDrawingIdRef.current;
          cancelDrawingDrag();
          selectedDrawingIdRef.current = selectedId;
          drawingPrimitiveRef.current?.setState({ selectedId });
          return;
        }

        if (drawingDraftRef.current) {
          drawingDraftRef.current = null;
          drawingPrimitiveRef.current?.setState({ draft: null });
          return;
        }

        if (selectedDrawingIdRef.current) {
          setSelectedDrawingId(null);
          return;
        }

        if (drawingToolRef.current !== "select") {
          drawingToolRef.current = "select";
          setDrawingTool("select");
        }

        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const host = hostRef.current;

      if (!host || document.activeElement !== host) {
        return;
      }

      const selectedId = selectedDrawingIdRef.current;
      const currentSymbol = identityRef.current.symbol;

      if (!selectedId || !currentSymbol) {
        return;
      }

      event.preventDefault();
      const remaining = (drawingsBySymbolRef.current[currentSymbol] ?? []).filter(
        (drawing) => drawing.id !== selectedId,
      );
      drawingsBySymbolRef.current = { ...drawingsBySymbolRef.current, [currentSymbol]: remaining };
      selectedDrawingIdRef.current = null;
      drawingPrimitiveRef.current?.setState({ drawings: remaining, selectedId: null });
      setDrawingsBySymbol((current) => ({
        ...current,
        [currentSymbol]: remaining,
      }));
      setSelectedDrawingId(null);
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

          indicatorReconnectRepairRef.current = { symbol, interval };
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
    const onChartClick = (param: MouseEventParams) => {
      handleChartClickRef.current(param);
    };
    timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
    chart.subscribeCrosshairMove(onCrosshairMove);
    chart.subscribeClick(onChartClick);

    const onPointerDown = (event: PointerEvent) => {
      handleDrawingPointerDownRef.current(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      handleDrawingPointerMoveRef.current(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      handleDrawingPointerUpRef.current(event);
    };
    const onPointerCancel = (event: PointerEvent) => {
      handleDrawingPointerCancelRef.current(event);
    };
    host.addEventListener("pointerdown", onPointerDown, true);
    attachDrawingDragListenersRef.current = () => {
      if (drawingDragWindowAttachedRef.current) {
        return;
      }

      drawingDragWindowAttachedRef.current = true;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    };
    detachDrawingDragListenersRef.current = () => {
      if (!drawingDragWindowAttachedRef.current) {
        return;
      }

      drawingDragWindowAttachedRef.current = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const drawingPrimitive = new DrawingPrimitive();
    candleSeries.attachPrimitive(drawingPrimitive);
    drawingPrimitiveRef.current = drawingPrimitive;
    drawingPrimitive.setState({
      drawings: drawingsBySymbolRef.current[symbol] ?? [],
      draft: drawingDraftRef.current,
      selectedId: selectedDrawingIdRef.current,
      hoveredId: hoveredDrawingIdRef.current,
      colors: drawingColorsFrom(colors),
    });

    return () => {
      drawingDragRef.current = null;
      drawingDragPreviewRef.current = null;
      detachDrawingDragListenersRef.current();
      attachDrawingDragListenersRef.current = () => undefined;
      detachDrawingDragListenersRef.current = () => undefined;
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.style.cursor = "";
      chart.unsubscribeClick(onChartClick);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
      const attachedPrimitive = drawingPrimitiveRef.current;
      if (attachedPrimitive) {
        candleSeries.detachPrimitive(attachedPrimitive);
        drawingPrimitiveRef.current = null;
      }
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
      indicatorSessionsRef.current = null;
      indicatorDataIdentityRef.current = null;
      indicatorReconnectRepairRef.current = null;
    };
  }, [symbol, hasRenderableData]);

  useEffect(() => {
    const chart = chartRef.current;

    if (!chart || !hasRenderableData || !symbol) {
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

    if (indicatorDataIdentityRef.current !== `${symbol}:${interval}`) {
      return;
    }

    const identity = createIndicatorSessionIdentity(symbol, interval, indicatorSettings);
    const { sessions, rebuilt } = reconcileIndicatorSettings(
      indicatorSessionsRef.current,
      candlesRef.current,
      identity,
    );
    indicatorSessionsRef.current = sessions;
    applyIndicatorKindsSetData(
      rebuilt,
      {
        sma: smaSeriesRef.current,
        ema: emaSeriesRef.current,
        bbUpper: bbUpperSeriesRef.current,
        bbMiddle: bbMiddleSeriesRef.current,
        bbLower: bbLowerSeriesRef.current,
        rsi: rsiSeriesRef.current,
        macdLine: macdLineSeriesRef.current,
        macdSignal: macdSignalSeriesRef.current,
        macdHistogram: macdHistogramSeriesRef.current,
      },
      sessions,
      colors,
    );
  }, [symbol, interval, hasRenderableData, indicatorSettings]);

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
    const previousChartPoints = previousPointsRef.current;
    const mutation = identityChanged
      ? "setData"
      : classifyChartSeriesMutation(previousChartPoints, points.candles);
    const prepended = identityChanged
      ? 0
      : countLeftPrependedBars(previousChartPoints, points.candles);
    const visibleLogicalRange =
      prepended > 0 ? chart.timeScale().getVisibleLogicalRange() : null;
    const candles = candlesRef.current;
    const indicatorIdentity = createIndicatorSessionIdentity(
      symbol,
      interval,
      indicatorSettingsRef.current,
    );
    const indicatorSeries = {
      sma: smaSeriesRef.current,
      ema: emaSeriesRef.current,
      bbUpper: bbUpperSeriesRef.current,
      bbMiddle: bbMiddleSeriesRef.current,
      bbLower: bbLowerSeriesRef.current,
      rsi: rsiSeriesRef.current,
      macdLine: macdLineSeriesRef.current,
      macdSignal: macdSignalSeriesRef.current,
      macdHistogram: macdHistogramSeriesRef.current,
    };
    const reconnectRepair = takeIndicatorReconnectRepair(
      indicatorReconnectRepairRef,
      symbol,
      interval,
    );

    if (mutation === "update" && lastCandle && lastLine && lastVolume) {
      candleSeries.update(lastCandle);
      lineSeries.update(lastLine);
      volumeSeries.update(lastVolume);
      if (reconnectRepair) {
        rebuildIndicatorChartSessions(
          candles,
          indicatorIdentity,
          indicatorSeries,
          colors,
          indicatorSessionsRef,
          indicatorDataIdentityRef,
        );
      } else {
        applyLiveIndicatorChartPath({
          mutation,
          previousLength: previousChartPoints.length,
          candles,
          identity: indicatorIdentity,
          colors,
          sessionsRef: indicatorSessionsRef,
          dataIdentityRef: indicatorDataIdentityRef,
          series: indicatorSeries,
        });
      }
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

      rebuildIndicatorChartSessions(
        candles,
        indicatorIdentity,
        indicatorSeries,
        colors,
        indicatorSessionsRef,
        indicatorDataIdentityRef,
      );
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
      const histogram = macdHistogramSeriesRef.current;
      const macdPoints = indicatorSessionsRef.current?.macd?.points ?? [];

      if (histogram) {
        histogram.setData(
          toChartMacdHistogram(macdPoints, {
            positive: colors.positive,
            negative: colors.negative,
          }),
        );
      }
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

  useEffect(() => {
    const primitive = drawingPrimitiveRef.current;

    if (!primitive) {
      return;
    }

    const symbolDrawings = symbol ? (drawingsBySymbol[symbol] ?? []) : [];
    const selected =
      selectedDrawingId && symbolDrawings.some((drawing) => drawing.id === selectedDrawingId)
        ? selectedDrawingId
        : null;
    const colors = drawingColorsFrom(readChartColors());

    if (drawingDragRef.current) {
      primitive.setState({
        selectedId: selected,
        hoveredId: hoveredDrawingIdRef.current,
        colors,
      });
      return;
    }

    primitive.setState({
      drawings: symbolDrawings,
      draft: drawingDraftRef.current,
      selectedId: selected,
      hoveredId: hoveredDrawingIdRef.current,
      colors,
    });
  }, [symbol, drawingsBySymbol, selectedDrawingId, theme, hasRenderableData]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleDrawingKeyDownRef.current(event);
      handleViewKeyDownRef.current(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useLayoutEffect(() => {
    resetChartViewRef.current = () => {
      chartRef.current?.timeScale().fitContent();
    };
    toggleChartFullscreenRef.current = async () => {
      const wrapper = wrapperRef.current;

      if (!wrapper) {
        return;
      }

      try {
        if (document.fullscreenElement === wrapper) {
          await document.exitFullscreen();
          return;
        }

        if (document.fullscreenElement) {
          return;
        }

        await wrapper.requestFullscreen();
      } catch {
        // Browsers may reject requestFullscreen; keep listening for fullscreenchange.
      }
    };
    handleViewKeyDownRef.current = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key !== "f" && event.key !== "F" && event.key !== "r" && event.key !== "R") {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const host = hostRef.current;

      if (!host || document.activeElement !== host) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleChartFullscreenRef.current();
        return;
      }

      event.preventDefault();
      resetChartViewRef.current();
    };
  }, []);

  function changeDrawingTool(next: DrawingTool): void {
    cancelDrawingDragRef.current();
    drawingDraftRef.current = null;
    hoveredDrawingIdRef.current = null;
    drawingToolRef.current = next;
    drawingPrimitiveRef.current?.setState({ draft: null, hoveredId: null });
    setDrawingTool(next);
  }

  function changeChartMode(next: ChartDisplayMode): void {
    modeRef.current = next;
    setMode(next);
    writeTradeChartPreferences({ mode: next, indicators: indicatorSettingsRef.current });
  }

  function changeIndicatorSettings(next: IndicatorSettings): void {
    indicatorSettingsRef.current = next;
    setIndicatorSettings(next);
    writeTradeChartPreferences({ mode: modeRef.current, indicators: next });
  }

  function resetChartView(): void {
    resetChartViewRef.current();
  }

  function toggleChartFullscreen(): void {
    void toggleChartFullscreenRef.current();
  }

  const oscillatorCount = oscillatorEnabledCount(indicatorSettings);
  const hostClass = chartHostClass(oscillatorCount, isFullscreen);
  const slotClass = chartSlotClass(oscillatorCount, isFullscreen);
  const wrapperClass = chartWrapperClass(isFullscreen);
  const paneClass = chartPaneClass(isFullscreen);
  const chartReady =
    Boolean(symbol) && hasRenderableData && !candlesQuery.isLoading && !candlesQuery.error;
  const heading = (
    <ChartToolbar
      symbol={symbol}
      interval={interval}
      mode={mode}
      loadingOlder={loadingOlder}
      indicatorSettings={indicatorSettings}
      isFullscreen={isFullscreen}
      chartReady={chartReady}
      onIntervalChange={onIntervalChange}
      onModeChange={changeChartMode}
      onIndicatorSettingsChange={changeIndicatorSettings}
      drawingTool={drawingTool}
      onDrawingToolChange={changeDrawingTool}
      onResetView={resetChartView}
      onToggleFullscreen={toggleChartFullscreen}
    />
  );

  if (!symbol) {
    return (
      <div
        ref={wrapperRef}
        className={wrapperClass}
        data-chart-shell=""
        data-chart-fullscreen={isFullscreen ? "true" : "false"}
      >
        {heading}
        <div className={slotClass}>
          <EmptyState>Select an instrument to load historical candles.</EmptyState>
        </div>
      </div>
    );
  }

  if (candlesQuery.isLoading) {
    return (
      <div
        ref={wrapperRef}
        className={wrapperClass}
        data-chart-shell=""
        aria-busy="true"
        data-chart-fullscreen={isFullscreen ? "true" : "false"}
      >
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
      <div
        ref={wrapperRef}
        className={wrapperClass}
        data-chart-shell=""
        data-chart-fullscreen={isFullscreen ? "true" : "false"}
      >
        {heading}
        <div className={slotClass}>
          <ErrorBanner error={candlesQuery.error} />
        </div>
      </div>
    );
  }

  if (points.candles.length === 0) {
    return (
      <div
        ref={wrapperRef}
        className={wrapperClass}
        data-chart-shell=""
        data-chart-fullscreen={isFullscreen ? "true" : "false"}
      >
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
    <div
      ref={wrapperRef}
      className={wrapperClass}
      data-chart-shell=""
      data-chart-fullscreen={isFullscreen ? "true" : "false"}
    >
      {heading}
      <div className={paneClass}>
        {legendCandle ? (
          <CandleLegend symbol={symbol} interval={interval} candle={legendCandle} />
        ) : null}
        <div
          ref={hostRef}
          className={hostClass}
          role="img"
          tabIndex={0}
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
  drawingTool,
  isFullscreen,
  chartReady,
  onIntervalChange,
  onModeChange,
  onIndicatorSettingsChange,
  onDrawingToolChange,
  onResetView,
  onToggleFullscreen,
}: {
  symbol: string | null;
  interval: CandleInterval;
  mode: ChartDisplayMode;
  loadingOlder: boolean;
  indicatorSettings: IndicatorSettings;
  drawingTool: DrawingTool;
  isFullscreen: boolean;
  chartReady: boolean;
  onIntervalChange: (interval: CandleInterval) => void;
  onModeChange: (mode: ChartDisplayMode) => void;
  onIndicatorSettingsChange: (settings: IndicatorSettings) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onResetView: () => void;
  onToggleFullscreen: () => void;
}) {
  const fullscreenLabel = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";

  return (
    <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center gap-2">
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
      <DrawingsMenu tool={drawingTool} onToolChange={onDrawingToolChange} />
      <div role="group" aria-label="Chart view" className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label="Reset view"
          title="Reset view"
          disabled={!chartReady}
          onClick={onResetView}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isFullscreen ? "primary" : "secondary"}
          aria-label={fullscreenLabel}
          title={fullscreenLabel}
          aria-pressed={isFullscreen}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? "Exit" : "Fullscreen"}
        </Button>
      </div>
      {loadingOlder ? (
        <p className="min-w-0 max-w-full basis-full text-xs text-secondary sm:basis-auto" aria-live="polite">
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
  drawing: string;
  drawingSelected: string;
  drawingHandle: string;
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
  sessions: IndicatorLiveSessions | null,
): void {
  if (series.sma) {
    series.sma.setData(toChartIndicatorLine(sessions?.sma?.points ?? []));
  }

  if (series.ema) {
    series.ema.setData(toChartIndicatorLine(sessions?.ema?.points ?? []));
  }

  const bands = toChartBollingerLines(sessions?.bollinger?.points ?? []);

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
  sessions: IndicatorLiveSessions | null,
  colors: ChartColors,
): void {
  if (series.rsi) {
    series.rsi.setData(toChartIndicatorLine(sessions?.rsi?.points ?? []));
  }

  const macdPoints = sessions?.macd?.points ?? [];
  const macd = toChartMacdLines(macdPoints);
  const histogram = toChartMacdHistogram(macdPoints, {
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

type IndicatorChartSeries = {
  sma: ISeriesApi<"Line"> | null;
  ema: ISeriesApi<"Line"> | null;
  bbUpper: ISeriesApi<"Line"> | null;
  bbMiddle: ISeriesApi<"Line"> | null;
  bbLower: ISeriesApi<"Line"> | null;
  rsi: ISeriesApi<"Line"> | null;
  macdLine: ISeriesApi<"Line"> | null;
  macdSignal: ISeriesApi<"Line"> | null;
  macdHistogram: ISeriesApi<"Histogram"> | null;
};

function applyIndicatorKindsSetData(
  kinds: readonly IndicatorKind[],
  series: IndicatorChartSeries,
  sessions: IndicatorLiveSessions | null,
  colors: ChartColors,
): void {
  for (const kind of kinds) {
    applyIndicatorKindSetData(kind, series, sessions, colors);
  }
}

function applyIndicatorKindSetData(
  kind: IndicatorKind,
  series: IndicatorChartSeries,
  sessions: IndicatorLiveSessions | null,
  colors: ChartColors,
): void {
  if (kind === "sma") {
    series.sma?.setData(toChartIndicatorLine(sessions?.sma?.points ?? []));
    return;
  }

  if (kind === "ema") {
    series.ema?.setData(toChartIndicatorLine(sessions?.ema?.points ?? []));
    return;
  }

  if (kind === "bollinger") {
    const bands = toChartBollingerLines(sessions?.bollinger?.points ?? []);
    series.bbUpper?.setData(bands.upper);
    series.bbMiddle?.setData(bands.middle);
    series.bbLower?.setData(bands.lower);
    return;
  }

  if (kind === "rsi") {
    series.rsi?.setData(toChartIndicatorLine(sessions?.rsi?.points ?? []));
    return;
  }

  const macdPoints = sessions?.macd?.points ?? [];
  const macd = toChartMacdLines(macdPoints);
  series.macdLine?.setData(macd.macd);
  series.macdSignal?.setData(macd.signal);
  series.macdHistogram?.setData(
    toChartMacdHistogram(macdPoints, {
      positive: colors.positive,
      negative: colors.negative,
    }),
  );
}

function rebuildIndicatorChartSessions(
  candles: readonly Candle[],
  identity: IndicatorSessionIdentity,
  series: IndicatorChartSeries,
  colors: ChartColors,
  sessionsRef: { current: IndicatorLiveSessions | null },
  dataIdentityRef: { current: string | null },
): void {
  const sessions = bootstrapIndicatorSessions(candles, identity);
  sessionsRef.current = sessions;
  dataIdentityRef.current = `${identity.symbol}:${identity.interval}`;

  if (!anyIndicatorEnabled(identity.settings) || seriesDetached(series)) {
    return;
  }

  applyOverlaySeriesData(series, sessions);
  applyOscillatorSeriesData(series, sessions, colors);
}

function takeIndicatorReconnectRepair(
  ref: { current: { symbol: string; interval: CandleInterval } | null },
  symbol: string,
  interval: CandleInterval,
): boolean {
  const pending = ref.current;
  ref.current = null;

  return Boolean(pending && pending.symbol === symbol && pending.interval === interval);
}

function applyLiveIndicatorChartPath({
  mutation,
  previousLength,
  candles,
  identity,
  colors,
  sessionsRef,
  dataIdentityRef,
  series,
}: {
  mutation: "update" | "setData";
  previousLength: number;
  candles: readonly Candle[];
  identity: IndicatorSessionIdentity;
  colors: ChartColors;
  sessionsRef: { current: IndicatorLiveSessions | null };
  dataIdentityRef: { current: string | null };
  series: IndicatorChartSeries;
}): void {
  if (!anyIndicatorEnabled(identity.settings) || seriesDetached(series) || candles.length === 0) {
    sessionsRef.current = bootstrapIndicatorSessions(candles, identity);
    dataIdentityRef.current = `${identity.symbol}:${identity.interval}`;
    return;
  }

  const latest = candles[candles.length - 1];
  const path = classifyLiveIndicatorPath(mutation, previousLength, candles.length);
  const current = sessionsRef.current;
  const canLive =
    current &&
    current.identity.symbol === identity.symbol &&
    current.identity.interval === identity.interval &&
    latest &&
    ((path === "replace" && canApplyLiveReplace(current, candles)) ||
      (path === "append" && canApplyLiveAppend(current, previousLength, candles)));

  if (!canLive || !current || !latest) {
    rebuildIndicatorChartSessions(candles, identity, series, colors, sessionsRef, dataIdentityRef);
    return;
  }

  const applied =
    path === "replace"
      ? applyLiveIndicatorReplace(current, latest)
      : applyLiveIndicatorAppend(current, latest);

  if (!applied) {
    rebuildIndicatorChartSessions(candles, identity, series, colors, sessionsRef, dataIdentityRef);
    return;
  }

  if (applied.updates.unsafe.length > 0) {
    let sessions = applied.sessions;

    for (const kind of applied.updates.unsafe) {
      sessions = rebuildIndicatorKind(sessions, candles, kind);
      applyIndicatorKindSetData(kind, series, sessions, colors);
    }

    sessionsRef.current = sessions;
    applySafeLiveIndicatorUpdates(applied.updates, applied.updates.unsafe, series, colors);
    return;
  }

  if (!applySafeLiveIndicatorUpdates(applied.updates, [], series, colors)) {
    rebuildIndicatorChartSessions(candles, identity, series, colors, sessionsRef, dataIdentityRef);
    return;
  }

  sessionsRef.current = applied.sessions;
}

function applySafeLiveIndicatorUpdates(
  updates: IndicatorLiveUpdates,
  skip: readonly IndicatorKind[],
  series: IndicatorChartSeries,
  colors: ChartColors,
): boolean {
  if (!skip.includes("sma") && updates.sma) {
    const point = toChartIndicatorLinePoint(updates.sma);

    if (!point || !series.sma) {
      return false;
    }

    series.sma.update(point);
  }

  if (!skip.includes("ema") && updates.ema) {
    const point = toChartIndicatorLinePoint(updates.ema);

    if (!point || !series.ema) {
      return false;
    }

    series.ema.update(point);
  }

  if (!skip.includes("bollinger") && updates.bollinger) {
    const point = toChartBollingerPoint(updates.bollinger);

    if (!point || !series.bbUpper || !series.bbMiddle || !series.bbLower) {
      return false;
    }

    series.bbUpper.update(point.upper);
    series.bbMiddle.update(point.middle);
    series.bbLower.update(point.lower);
  }

  if (!skip.includes("rsi") && updates.rsi) {
    const point = toChartIndicatorLinePoint(updates.rsi);

    if (!point || !series.rsi) {
      return false;
    }

    series.rsi.update(point);
  }

  if (!skip.includes("macd") && updates.macd) {
    const mapped = toChartMacdPoint(updates.macd, {
      positive: colors.positive,
      negative: colors.negative,
    });

    if (!mapped || !series.macdLine) {
      return false;
    }

    if (updates.macd.signal !== undefined && !mapped.signal) {
      return false;
    }

    if (updates.macd.histogram !== undefined && !mapped.histogram) {
      return false;
    }

    series.macdLine.update(mapped.macd);

    if (mapped.signal && series.macdSignal) {
      series.macdSignal.update(mapped.signal);
    }

    if (mapped.histogram && series.macdHistogram) {
      series.macdHistogram.update(mapped.histogram);
    }
  }

  return true;
}

function seriesDetached(series: IndicatorChartSeries): boolean {
  return (
    !series.sma &&
    !series.ema &&
    !series.bbUpper &&
    !series.rsi &&
    !series.macdLine
  );
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
    drawing: readToken(styles, "--chart-drawing", "#c4a35a"),
    drawingSelected: readToken(styles, "--chart-drawing-selected", "#e8c36a"),
    drawingHandle: readToken(styles, "--chart-drawing-handle", "#f0d78c"),
  };
}

function drawingColorsFrom(colors: ChartColors) {
  return {
    line: colors.drawing,
    selected: colors.drawingSelected,
    handle: colors.drawingHandle,
  };
}

function readToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}
