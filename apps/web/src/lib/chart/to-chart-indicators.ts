import type { HistogramData, LineData } from "lightweight-charts";

import { decimalVisualSign } from "../decimal-string.ts";
import { toChartUtcTimestamp } from "./to-chart-candles.ts";
import type { ExactBollingerPoint, ExactIndicatorPoint, ExactMacdPoint } from "./indicators/types.ts";

export type ChartHistogramSignColors = {
  positive: string;
  negative: string;
};

/**
 * Render-only mapping from exact indicator decimal strings to Lightweight Charts
 * coordinates. Output numbers are plot geometry and must never enter order,
 * balance, margin, PnL, canonical candle cache, or indicator calculations.
 */
export function toChartIndicatorLine(points: readonly ExactIndicatorPoint[]): LineData[] {
  const line: LineData[] = [];

  for (const point of points) {
    const mapped = toChartIndicatorLinePoint(point);

    if (mapped) {
      line.push(mapped);
    }
  }

  return line;
}

export function toChartIndicatorLinePoint(point: ExactIndicatorPoint): LineData | null {
  const time = toChartUtcTimestamp(point.openTime);
  const value = Number(point.value);

  if (time === null || !Number.isFinite(value)) {
    return null;
  }

  return { time, value };
}

export function toChartBollingerPoint(point: ExactBollingerPoint): {
  upper: LineData;
  middle: LineData;
  lower: LineData;
} | null {
  const upper = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.upper });
  const middle = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.middle });
  const lower = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.lower });

  if (!upper || !middle || !lower) {
    return null;
  }

  return { upper, middle, lower };
}

export function toChartBollingerLines(points: readonly ExactBollingerPoint[]): {
  upper: LineData[];
  middle: LineData[];
  lower: LineData[];
} {
  const upper: LineData[] = [];
  const middle: LineData[] = [];
  const lower: LineData[] = [];

  for (const point of points) {
    const mapped = toChartBollingerPoint(point);

    if (!mapped) {
      continue;
    }

    upper.push(mapped.upper);
    middle.push(mapped.middle);
    lower.push(mapped.lower);
  }

  return { upper, middle, lower };
}

export function toChartMacdLines(points: readonly ExactMacdPoint[]): {
  macd: LineData[];
  signal: LineData[];
} {
  const macd: LineData[] = [];
  const signal: LineData[] = [];

  for (const point of points) {
    const macdPoint = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.macd });

    if (!macdPoint) {
      continue;
    }

    macd.push(macdPoint);

    if (point.signal === undefined) {
      continue;
    }

    const signalPoint = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.signal });

    if (signalPoint) {
      signal.push(signalPoint);
    }
  }

  return { macd, signal };
}

export function toChartMacdPoint(
  point: ExactMacdPoint,
  colors: ChartHistogramSignColors,
): {
  macd: LineData;
  signal: LineData | null;
  histogram: HistogramData | null;
} | null {
  const macd = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.macd });

  if (!macd) {
    return null;
  }

  const signal =
    point.signal === undefined
      ? null
      : toChartIndicatorLinePoint({ openTime: point.openTime, value: point.signal });

  if (point.histogram === undefined) {
    return { macd, signal, histogram: null };
  }

  const mapped = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.histogram });

  if (!mapped) {
    return { macd, signal, histogram: null };
  }

  const sign = decimalVisualSign(point.histogram);
  const histogram: HistogramData = { time: mapped.time, value: mapped.value };

  if (sign === "positive") {
    histogram.color = colors.positive;
  } else if (sign === "negative") {
    histogram.color = colors.negative;
  }

  return { macd, signal, histogram };
}

export function toChartMacdHistogram(
  points: readonly ExactMacdPoint[],
  colors: ChartHistogramSignColors,
): HistogramData[] {
  const histogram: HistogramData[] = [];

  for (const point of points) {
    const mapped = toChartMacdPoint(point, colors)?.histogram;

    if (mapped) {
      histogram.push(mapped);
    }
  }

  return histogram;
}
