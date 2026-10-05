import type { Candle } from "@notional/contracts";

import {
  INDICATOR_DECIMAL_PRECISION,
  INDICATOR_ZERO,
  indicatorInteger,
  parseIndicatorDecimal,
  serializeIndicatorValue,
  type IndicatorDecimal,
} from "./decimal.ts";
import { isValidIndicatorPeriod, sampleFromCandle, samplesFromCandles } from "./samples.ts";
import type { ExactBollingerPoint, IndicatorSample } from "./types.ts";

export const BOLLINGER_PERIOD_MIN = 2;
export const BOLLINGER_PERIOD_MAX = 500;
export const BOLLINGER_MULTIPLIER_MAX = "20";

export type BollingerSession = {
  period: number;
  multiplier: IndicatorDecimal;
  points: ExactBollingerPoint[];
  committedCount: number;
  committedWindow: IndicatorDecimal[];
  committedSum: IndicatorDecimal;
  committedSumSquares: IndicatorDecimal;
  committedPoints: ExactBollingerPoint[];
  latest: IndicatorSample | null;
  latestPoint: ExactBollingerPoint | null;
};

export function computeBollinger(
  candles: readonly Candle[],
  period: number,
  multiplier: string,
): ExactBollingerPoint[] | null {
  const parsedMultiplier = parseBollingerMultiplier(multiplier);

  if (!parsedMultiplier || !isValidIndicatorPeriod(period, BOLLINGER_PERIOD_MIN, BOLLINGER_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  const window: IndicatorDecimal[] = [];
  let sum = INDICATOR_ZERO;
  let sumSquares = INDICATOR_ZERO;
  const points: ExactBollingerPoint[] = [];
  const periodValue = indicatorInteger(period);

  for (const sample of samples) {
    window.push(sample.close);
    sum = sum.plus(sample.close);
    sumSquares = sumSquares.plus(square(sample.close));

    if (window.length > period) {
      const removed = window.shift();

      if (removed) {
        sum = sum.minus(removed);
        sumSquares = sumSquares.minus(square(removed));
      }
    }

    if (window.length !== period) {
      continue;
    }

    const mean = sum.div(periodValue);
    const meanSquare = mean.times(mean);
    const varianceCandidate = sumSquares.div(periodValue).minus(meanSquare);
    const scale = maxMagnitude(meanSquare, sumSquares.div(periodValue));
    const variance = resolvePopulationVariance(varianceCandidate, scale);

    if (variance === null) {
      return null;
    }

    const stdDev = variance.sqrt();

    if (!stdDev.isFinite()) {
      return null;
    }

    const offset = parsedMultiplier.times(stdDev);
    const middle = serializeIndicatorValue(mean);
    const upper = serializeIndicatorValue(mean.plus(offset));
    const lower = serializeIndicatorValue(mean.minus(offset));

    if (middle === null || upper === null || lower === null) {
      return null;
    }

    points.push({ openTime: sample.openTime, middle, upper, lower });
  }

  return points;
}

export function rebuildBollinger(
  candles: readonly Candle[],
  period: number,
  multiplier: string,
): BollingerSession | null {
  const parsedMultiplier = parseBollingerMultiplier(multiplier);

  if (!parsedMultiplier || !isValidIndicatorPeriod(period, BOLLINGER_PERIOD_MIN, BOLLINGER_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  return bootstrapBollingerFromSamples(samples, period, parsedMultiplier);
}

export function replaceBollingerLatest(
  session: BollingerSession,
  candle: Candle,
): BollingerSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample || !session.latest || sample.openTime !== session.latest.openTime) {
    return null;
  }

  return applyBollingerLatest(session, sample);
}

export function appendBollinger(session: BollingerSession, candle: Candle): BollingerSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  if (session.latest && sample.openTime <= session.latest.openTime) {
    return null;
  }

  return appendBollingerSample(session, sample);
}

export function parseBollingerMultiplier(value: string): IndicatorDecimal | null {
  const parsed = parseIndicatorDecimal(value);

  if (!parsed || !parsed.isFinite() || parsed.lte(INDICATOR_ZERO)) {
    return null;
  }

  const max = parseIndicatorDecimal(BOLLINGER_MULTIPLIER_MAX);

  if (!max || parsed.gt(max)) {
    return null;
  }

  return parsed;
}

/**
 * Population variance is mathematically >= 0. Tiny negatives within a few ULPs
 * of `scale` at IndicatorDecimal precision are clamped to 0. A materially
 * negative variance fails closed (`null`).
 */
export function resolvePopulationVariance(
  variance: IndicatorDecimal,
  scale: IndicatorDecimal,
): IndicatorDecimal | null {
  if (!variance.isFinite()) {
    return null;
  }

  if (!variance.isNegative()) {
    return variance.isZero() ? INDICATOR_ZERO : variance;
  }

  const abs = variance.abs();
  const reference = scale.abs();
  const exponent = reference.isZero() ? variance.e : reference.e;
  const threshold = indicatorInteger(10).pow(exponent - INDICATOR_DECIMAL_PRECISION + 8);

  if (abs.lte(threshold)) {
    return INDICATOR_ZERO;
  }

  return null;
}

function bootstrapBollingerFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
  multiplier: IndicatorDecimal,
): BollingerSession | null {
  if (samples.length === 0) {
    return emptyBollinger(period, multiplier);
  }

  const committedWindow: IndicatorDecimal[] = [];
  let committedSum = INDICATOR_ZERO;
  let committedSumSquares = INDICATOR_ZERO;
  const committedPoints: ExactBollingerPoint[] = [];
  const periodValue = indicatorInteger(period);
  const lastIndex = samples.length - 1;

  for (let index = 0; index < lastIndex; index += 1) {
    const sample = samples[index];

    if (!sample) {
      return null;
    }

    committedWindow.push(sample.close);
    committedSum = committedSum.plus(sample.close);
    committedSumSquares = committedSumSquares.plus(square(sample.close));

    if (committedWindow.length > period) {
      const removed = committedWindow.shift();

      if (removed) {
        committedSum = committedSum.minus(removed);
        committedSumSquares = committedSumSquares.minus(square(removed));
      }
    }

    if (committedWindow.length !== period) {
      continue;
    }

    const point = bollingerPointFromWindow(
      sample.openTime,
      committedSum,
      committedSumSquares,
      periodValue,
      multiplier,
    );

    if (!point) {
      return null;
    }

    committedPoints.push(point);
  }

  const last = samples[lastIndex];

  if (!last) {
    return null;
  }

  return applyBollingerLatest(
    {
      period,
      multiplier,
      points: committedPoints,
      committedCount: lastIndex,
      committedWindow,
      committedSum,
      committedSumSquares,
      committedPoints,
      latest: null,
      latestPoint: null,
    },
    last,
  );
}

function bollingerPointFromWindow(
  openTime: number,
  sum: IndicatorDecimal,
  sumSquares: IndicatorDecimal,
  periodValue: IndicatorDecimal,
  multiplier: IndicatorDecimal,
): ExactBollingerPoint | null {
  const mean = sum.div(periodValue);
  const meanSquare = mean.times(mean);
  const varianceCandidate = sumSquares.div(periodValue).minus(meanSquare);
  const scale = maxMagnitude(meanSquare, sumSquares.div(periodValue));
  const variance = resolvePopulationVariance(varianceCandidate, scale);

  if (variance === null) {
    return null;
  }

  const stdDev = variance.sqrt();

  if (!stdDev.isFinite()) {
    return null;
  }

  const offset = multiplier.times(stdDev);
  const middle = serializeIndicatorValue(mean);
  const upper = serializeIndicatorValue(mean.plus(offset));
  const lower = serializeIndicatorValue(mean.minus(offset));

  if (middle === null || upper === null || lower === null) {
    return null;
  }

  return { openTime, middle, upper, lower };
}

function emptyBollinger(period: number, multiplier: IndicatorDecimal): BollingerSession {
  return {
    period,
    multiplier,
    points: [],
    committedCount: 0,
    committedWindow: [],
    committedSum: INDICATOR_ZERO,
    committedSumSquares: INDICATOR_ZERO,
    committedPoints: [],
    latest: null,
    latestPoint: null,
  };
}

function appendBollingerSample(
  session: BollingerSession,
  sample: IndicatorSample,
): BollingerSession | null {
  if (!session.latest) {
    return applyBollingerLatest(session, sample);
  }

  return applyBollingerLatest(commitBollingerLatest(session), sample);
}

function commitBollingerLatest(session: BollingerSession): BollingerSession {
  if (!session.latest) {
    return session;
  }

  const committedWindow = [...session.committedWindow, session.latest.close];
  let committedSum = session.committedSum.plus(session.latest.close);
  let committedSumSquares = session.committedSumSquares.plus(square(session.latest.close));

  if (committedWindow.length > session.period) {
    const removed = committedWindow.shift();

    if (removed) {
      committedSum = committedSum.minus(removed);
      committedSumSquares = committedSumSquares.minus(square(removed));
    }
  }

  const committedPoints = session.latestPoint
    ? [...session.committedPoints, session.latestPoint]
    : [...session.committedPoints];

  return {
    period: session.period,
    multiplier: session.multiplier,
    points: committedPoints,
    committedCount: session.committedCount + 1,
    committedWindow,
    committedSum,
    committedSumSquares,
    committedPoints,
    latest: null,
    latestPoint: null,
  };
}

function applyBollingerLatest(
  session: BollingerSession,
  sample: IndicatorSample,
): BollingerSession | null {
  const next: BollingerSession = {
    period: session.period,
    multiplier: session.multiplier,
    committedCount: session.committedCount,
    committedWindow: session.committedWindow,
    committedSum: session.committedSum,
    committedSumSquares: session.committedSumSquares,
    committedPoints: session.committedPoints,
    latest: sample,
    latestPoint: null,
    points: session.committedPoints,
  };

  const total = next.committedCount + 1;

  if (total < next.period) {
    return next;
  }

  const periodValue = indicatorInteger(next.period);
  const latestPoint = bollingerPointFromWindow(
    sample.openTime,
    windowSum(next, sample.close),
    windowSumSquares(next, sample.close),
    periodValue,
    next.multiplier,
  );

  if (!latestPoint) {
    return null;
  }

  next.latestPoint = latestPoint;
  next.points = [...next.committedPoints, latestPoint];
  return next;
}

function windowSum(session: BollingerSession, latestClose: IndicatorDecimal): IndicatorDecimal {
  if (session.committedWindow.length === session.period) {
    const oldest = session.committedWindow[0];

    if (!oldest) {
      return latestClose;
    }

    return session.committedSum.minus(oldest).plus(latestClose);
  }

  return session.committedSum.plus(latestClose);
}

function windowSumSquares(session: BollingerSession, latestClose: IndicatorDecimal): IndicatorDecimal {
  if (session.committedWindow.length === session.period) {
    const oldest = session.committedWindow[0];

    if (!oldest) {
      return square(latestClose);
    }

    return session.committedSumSquares.minus(square(oldest)).plus(square(latestClose));
  }

  return session.committedSumSquares.plus(square(latestClose));
}

function square(value: IndicatorDecimal): IndicatorDecimal {
  return value.times(value);
}

function maxMagnitude(left: IndicatorDecimal, right: IndicatorDecimal): IndicatorDecimal {
  return left.abs().gte(right.abs()) ? left.abs() : right.abs();
}
