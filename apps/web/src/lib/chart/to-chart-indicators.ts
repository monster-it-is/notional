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

export function toChartBollingerLines(points: readonly ExactBollingerPoint[]): {
  upper: LineData[];
  middle: LineData[];
  lower: LineData[];
} {
  const upper: LineData[] = [];
  const middle: LineData[] = [];
  const lower: LineData[] = [];

  for (const point of points) {
    const upperPoint = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.upper });
    const middlePoint = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.middle });
    const lowerPoint = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.lower });

    if (!upperPoint || !middlePoint || !lowerPoint) {
      continue;
    }

    upper.push(upperPoint);
    middle.push(middlePoint);
    lower.push(lowerPoint);
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

export function toChartMacdHistogram(
  points: readonly ExactMacdPoint[],
  colors: ChartHistogramSignColors,
): HistogramData[] {
  const histogram: HistogramData[] = [];

  for (const point of points) {
    if (point.histogram === undefined) {
      continue;
    }

    const mapped = toChartIndicatorLinePoint({ openTime: point.openTime, value: point.histogram });

    if (!mapped) {
      continue;
    }

    const sign = decimalVisualSign(point.histogram);
    const bar: HistogramData = { time: mapped.time, value: mapped.value };

    if (sign === "positive") {
      bar.color = colors.positive;
    } else if (sign === "negative") {
      bar.color = colors.negative;
    }

    histogram.push(bar);
  }

  return histogram;
}
