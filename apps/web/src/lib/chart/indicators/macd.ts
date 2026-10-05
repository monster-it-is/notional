import type { Candle } from "@notional/contracts";

import { serializeIndicatorValue, type IndicatorDecimal } from "./decimal.ts";
import {
  appendEmaSample,
  computeEmaFromSamples,
  rebuildEmaFromSamples,
  replaceEmaLatestSample,
  type EmaSession,
} from "./ema.ts";
import { isValidIndicatorPeriod, sampleFromCandle, samplesFromCandles } from "./samples.ts";
import type { ExactMacdPoint, IndicatorSample } from "./types.ts";

export const MACD_FAST_MIN = 1;
export const MACD_SLOW_MIN = 2;
export const MACD_SIGNAL_MIN = 1;
export const MACD_PERIOD_MAX = 500;

export type MacdParams = {
  fast: number;
  slow: number;
  signal: number;
};

export type MacdSession = {
  params: MacdParams;
  points: ExactMacdPoint[];
  committedPoints: ExactMacdPoint[];
  fast: EmaSession;
  slow: EmaSession;
  signal: EmaSession;
};

export function computeMacd(
  candles: readonly Candle[],
  params: MacdParams,
): ExactMacdPoint[] | null {
  if (!isValidMacdParams(params)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  const fast = computeEmaFromSamples(samples, params.fast);
  const slow = computeEmaFromSamples(samples, params.slow);

  if (!fast || !slow) {
    return null;
  }

  const macdSamples: IndicatorSample[] = [];
  const macdValues: IndicatorDecimal[] = [];
  const fastByTime = new Map<number, IndicatorDecimal>();

  for (let index = 0; index < fast.points.length; index += 1) {
    const point = fast.points[index];
    const value = fast.values[index];

    if (!point || !value) {
      return null;
    }

    fastByTime.set(point.openTime, value);
  }

  for (let index = 0; index < slow.points.length; index += 1) {
    const slowPoint = slow.points[index];
    const slowValue = slow.values[index];
    const fastValue = slowPoint ? fastByTime.get(slowPoint.openTime) : undefined;

    if (!slowPoint || !slowValue || !fastValue) {
      return null;
    }

    const macd = fastValue.minus(slowValue);
    macdSamples.push({ openTime: slowPoint.openTime, close: macd });
    macdValues.push(macd);
  }

  const signal = computeEmaFromSamples(macdSamples, params.signal);

  if (!signal) {
    return null;
  }

  const signalByTime = new Map<number, { value: IndicatorDecimal; serialized: string }>();

  for (let index = 0; index < signal.points.length; index += 1) {
    const point = signal.points[index];
    const value = signal.values[index];

    if (!point || !value) {
      return null;
    }

    signalByTime.set(point.openTime, { value, serialized: point.value });
  }

  const points: ExactMacdPoint[] = [];

  for (let index = 0; index < macdSamples.length; index += 1) {
    const sample = macdSamples[index];
    const macd = macdValues[index];

    if (!sample || !macd) {
      return null;
    }

    const macdSerialized = serializeIndicatorValue(macd);

    if (macdSerialized === null) {
      return null;
    }

    const assembled: ExactMacdPoint = { openTime: sample.openTime, macd: macdSerialized };
    const signalAt = signalByTime.get(sample.openTime);

    if (signalAt) {
      const histogram = serializeIndicatorValue(macd.minus(signalAt.value));

      if (histogram === null) {
        return null;
      }

      assembled.signal = signalAt.serialized;
      assembled.histogram = histogram;
    }

    points.push(assembled);
  }

  return points;
}

export function rebuildMacd(candles: readonly Candle[], params: MacdParams): MacdSession | null {
  if (!isValidMacdParams(params)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  const empty = emptyMacd(params);

  if (!empty) {
    return null;
  }

  let session = empty;

  for (const sample of samples) {
    const next = appendMacdSample(session, sample);

    if (!next) {
      return null;
    }

    session = next;
  }

  return session;
}

export function replaceMacdLatest(session: MacdSession, candle: Candle): MacdSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  const fast = replaceEmaLatestSample(session.fast, sample);
  const slow = replaceEmaLatestSample(session.slow, sample);

  if (!fast || !slow) {
    return null;
  }

  return finishMacd(session.params, fast, slow, session.signal, session.committedPoints, "replace");
}

export function appendMacd(session: MacdSession, candle: Candle): MacdSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  return appendMacdSample(session, sample);
}

export function isValidMacdParams(params: MacdParams): boolean {
  return (
    isValidIndicatorPeriod(params.fast, MACD_FAST_MIN, MACD_PERIOD_MAX) &&
    isValidIndicatorPeriod(params.slow, MACD_SLOW_MIN, MACD_PERIOD_MAX) &&
    isValidIndicatorPeriod(params.signal, MACD_SIGNAL_MIN, MACD_PERIOD_MAX) &&
    params.fast < params.slow
  );
}

function emptyMacd(params: MacdParams): MacdSession | null {
  const fast = rebuildEmaFromSamples([], params.fast);
  const slow = rebuildEmaFromSamples([], params.slow);
  const signal = rebuildEmaFromSamples([], params.signal);

  if (!fast || !slow || !signal) {
    return null;
  }

  return { params, points: [], committedPoints: [], fast, slow, signal };
}

function appendMacdSample(session: MacdSession, sample: IndicatorSample): MacdSession | null {
  const fast = appendEmaSample(session.fast, sample);
  const slow = appendEmaSample(session.slow, sample);

  if (!fast || !slow) {
    return null;
  }

  return finishMacd(session.params, fast, slow, session.signal, session.points, "append");
}

function finishMacd(
  params: MacdParams,
  fast: EmaSession,
  slow: EmaSession,
  previousSignal: EmaSession,
  committedPoints: ExactMacdPoint[],
  mode: "replace" | "append",
): MacdSession | null {
  const macdSample = latestMacdSample(fast, slow);
  let signal = previousSignal;

  if (macdSample) {
    const sameLatest = previousSignal.latest?.openTime === macdSample.openTime;
    const nextSignal =
      mode === "replace" && sameLatest
        ? replaceEmaLatestSample(previousSignal, macdSample)
        : appendEmaSample(previousSignal, macdSample);

    if (!nextSignal) {
      return null;
    }

    signal = nextSignal;
  }

  const latestPoint = latestMacdPoint(macdSample, signal);
  const points = latestPoint ? [...committedPoints, latestPoint] : committedPoints;

  return { params, points, committedPoints, fast, slow, signal };
}

function latestMacdSample(fast: EmaSession, slow: EmaSession): IndicatorSample | null {
  if (
    !fast.latest ||
    !slow.latest ||
    fast.latest.openTime !== slow.latest.openTime ||
    !fast.latestEma ||
    !slow.latestEma
  ) {
    return null;
  }

  return {
    openTime: slow.latest.openTime,
    close: fast.latestEma.minus(slow.latestEma),
  };
}

function latestMacdPoint(
  macdSample: IndicatorSample | null,
  signal: EmaSession,
): ExactMacdPoint | null {
  if (!macdSample) {
    return null;
  }

  const macdSerialized = serializeIndicatorValue(macdSample.close);

  if (macdSerialized === null) {
    return null;
  }

  const point: ExactMacdPoint = { openTime: macdSample.openTime, macd: macdSerialized };

  if (signal.latestPoint && signal.latest?.openTime === macdSample.openTime && signal.latestEma) {
    const histogram = serializeIndicatorValue(macdSample.close.minus(signal.latestEma));

    if (histogram === null) {
      return null;
    }

    point.signal = signal.latestPoint.value;
    point.histogram = histogram;
  }

  return point;
}
