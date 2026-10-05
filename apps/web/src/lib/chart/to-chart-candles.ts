import type { Candle } from "@notional/contracts";
import type { CandlestickData, HistogramData, LineData, UTCTimestamp } from "lightweight-charts";

export type ChartVolumeColors = {
  up: string;
  down: string;
};

export type AlignedChartPoints = {
  candles: CandlestickData[];
  line: LineData[];
  volume: HistogramData[];
};

/**
 * Render-only mapping from canonical Candle decimal strings to Lightweight Charts
 * coordinates. Output numbers are plot geometry and must never enter order,
 * balance, margin, or PnL paths.
 */
export function toChartCandles(candles: readonly Candle[]): CandlestickData[] {
  const points: CandlestickData[] = [];

  for (const candle of candles) {
    const point = toChartCandle(candle);

    if (point) {
      points.push(point);
    }
  }

  return points;
}

export function toChartCandle(candle: Candle): CandlestickData | null {
  const time = toChartUtcTimestamp(candle.openTime);
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);

  if (
    time === null ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return { time, open, high, low, close };
}

export function toChartLinePoint(candle: Candle): LineData | null {
  const point = toChartCandle(candle);

  if (!point) {
    return null;
  }

  return { time: point.time, value: point.close };
}

export function toChartLinePoints(candles: readonly Candle[]): LineData[] {
  const points: LineData[] = [];

  for (const candle of candles) {
    const point = toChartLinePoint(candle);

    if (point) {
      points.push(point);
    }
  }

  return points;
}

export function toChartVolumePoint(
  candle: Candle,
  colors?: ChartVolumeColors,
): HistogramData | null {
  const point = toChartCandle(candle);
  const volume = Number(candle.volume);

  if (!point || !Number.isFinite(volume)) {
    return null;
  }

  if (!colors) {
    return { time: point.time, value: volume };
  }

  return {
    time: point.time,
    value: volume,
    color: point.close >= point.open ? colors.up : colors.down,
  };
}

export function toChartVolumePoints(
  candles: readonly Candle[],
  colors?: ChartVolumeColors,
): HistogramData[] {
  const points: HistogramData[] = [];

  for (const candle of candles) {
    const point = toChartVolumePoint(candle, colors);

    if (point) {
      points.push(point);
    }
  }

  return points;
}

export function colorChartVolumePoints(
  volumes: readonly HistogramData[],
  candles: readonly CandlestickData[],
  colors: ChartVolumeColors,
): HistogramData[] {
  return volumes.map((point, index) => {
    const candle = candles[index];

    if (!candle) {
      return { ...point };
    }

    return {
      ...point,
      color: candle.close >= candle.open ? colors.up : colors.down,
    };
  });
}

export function toAlignedChartPoints(candles: readonly Candle[]): AlignedChartPoints {
  const aligned: AlignedChartPoints = {
    candles: [],
    line: [],
    volume: [],
  };

  for (const candle of candles) {
    const candlePoint = toChartCandle(candle);
    const linePoint = toChartLinePoint(candle);
    const volumePoint = toChartVolumePoint(candle);

    if (!candlePoint || !linePoint || !volumePoint) {
      continue;
    }

    aligned.candles.push(candlePoint);
    aligned.line.push(linePoint);
    aligned.volume.push(volumePoint);
  }

  return aligned;
}

export function toChartUtcTimestamp(openTimeMs: number): UTCTimestamp | null {
  if (!Number.isFinite(openTimeMs) || openTimeMs < 0) {
    return null;
  }

  const seconds = Math.floor(openTimeMs / 1000);

  if (!Number.isSafeInteger(seconds)) {
    return null;
  }

  return seconds as UTCTimestamp;
}
