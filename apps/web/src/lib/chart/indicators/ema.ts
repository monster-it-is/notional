import type { Candle } from "@notional/contracts";

import {
  INDICATOR_ONE,
  INDICATOR_TWO,
  INDICATOR_ZERO,
  indicatorInteger,
  serializeIndicatorValue,
  type IndicatorDecimal,
} from "./decimal.ts";
import { isValidIndicatorPeriod, sampleFromCandle, samplesFromCandles } from "./samples.ts";
import type { ExactIndicatorPoint, IndicatorSample } from "./types.ts";

export const EMA_PERIOD_MIN = 1;
export const EMA_PERIOD_MAX = 500;

export type EmaSession = {
  period: number;
  alpha: IndicatorDecimal;
  oneMinusAlpha: IndicatorDecimal;
  points: ExactIndicatorPoint[];
  committedCount: number;
  seedCloses: IndicatorDecimal[];
  seedSum: IndicatorDecimal;
  emaThroughTMinus1: IndicatorDecimal | null;
  committedPoints: ExactIndicatorPoint[];
  committedValues: IndicatorDecimal[];
  latest: IndicatorSample | null;
  latestPoint: ExactIndicatorPoint | null;
  latestEma: IndicatorDecimal | null;
  values: IndicatorDecimal[];
};

export function computeEma(
  candles: readonly Candle[],
  period: number,
): ExactIndicatorPoint[] | null {
  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  return computeEmaFromSamples(samples, period)?.points ?? null;
}

export function computeEmaFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
): { points: ExactIndicatorPoint[]; values: IndicatorDecimal[] } | null {
  if (!isValidIndicatorPeriod(period, EMA_PERIOD_MIN, EMA_PERIOD_MAX)) {
    return null;
  }

  const periodValue = indicatorInteger(period);
  const alpha = INDICATOR_TWO.div(periodValue.plus(INDICATOR_ONE));
  const oneMinusAlpha = INDICATOR_ONE.minus(alpha);
  const points: ExactIndicatorPoint[] = [];
  const values: IndicatorDecimal[] = [];
  let seedSum = INDICATOR_ZERO;
  let seedCount = 0;
  let ema: IndicatorDecimal | null = null;

  for (const sample of samples) {
    if (!ema) {
      seedCount += 1;
      seedSum = seedSum.plus(sample.close);

      if (seedCount !== period) {
        continue;
      }

      ema = seedSum.div(periodValue);
    } else {
      ema = sample.close.times(alpha).plus(ema.times(oneMinusAlpha));
    }

    if (!ema.isFinite()) {
      return null;
    }

    const serialized = serializeIndicatorValue(ema);

    if (serialized === null) {
      return null;
    }

    points.push({ openTime: sample.openTime, value: serialized });
    values.push(ema);
  }

  return { points, values };
}

export function rebuildEma(candles: readonly Candle[], period: number): EmaSession | null {
  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  return rebuildEmaFromSamples(samples, period);
}

export function rebuildEmaFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
): EmaSession | null {
  if (!isValidIndicatorPeriod(period, EMA_PERIOD_MIN, EMA_PERIOD_MAX)) {
    return null;
  }

  return bootstrapEmaFromSamples(samples, period);
}

export function replaceEmaLatest(session: EmaSession, candle: Candle): EmaSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  return replaceEmaLatestSample(session, sample);
}

export function replaceEmaLatestSample(
  session: EmaSession,
  sample: IndicatorSample,
): EmaSession | null {
  if (!session.latest || sample.openTime !== session.latest.openTime) {
    return null;
  }

  return applyEmaLatest(session, sample);
}

export function appendEma(session: EmaSession, candle: Candle): EmaSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  return appendEmaSample(session, sample);
}

export function appendEmaSample(session: EmaSession, sample: IndicatorSample): EmaSession | null {
  if (session.latest && sample.openTime <= session.latest.openTime) {
    return null;
  }

  if (!session.latest) {
    return applyEmaLatest(session, sample);
  }

  const committed = commitEmaLatest(session);
  return applyEmaLatest(committed, sample);
}

function bootstrapEmaFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
): EmaSession | null {
  const session = emptyEma(period);

  if (samples.length === 0) {
    return session;
  }

  const committedPoints: ExactIndicatorPoint[] = [];
  const committedValues: IndicatorDecimal[] = [];
  const seedCloses: IndicatorDecimal[] = [];
  let seedSum = INDICATOR_ZERO;
  let emaThroughTMinus1: IndicatorDecimal | null = null;
  const lastIndex = samples.length - 1;

  for (let index = 0; index < lastIndex; index += 1) {
    const sample = samples[index];

    if (!sample) {
      return null;
    }

    if (!emaThroughTMinus1 && seedCloses.length + 1 < period) {
      seedCloses.push(sample.close);
      seedSum = seedSum.plus(sample.close);
      continue;
    }

    let ema: IndicatorDecimal;

    if (emaThroughTMinus1) {
      ema = sample.close.times(session.alpha).plus(emaThroughTMinus1.times(session.oneMinusAlpha));
    } else {
      ema = seedSum.plus(sample.close).div(indicatorInteger(period));
      seedCloses.length = 0;
      seedSum = INDICATOR_ZERO;
    }

    if (!ema.isFinite()) {
      return null;
    }

    const serialized = serializeIndicatorValue(ema);

    if (serialized === null) {
      return null;
    }

    emaThroughTMinus1 = ema;
    committedPoints.push({ openTime: sample.openTime, value: serialized });
    committedValues.push(ema);
  }

  const last = samples[lastIndex];

  if (!last) {
    return null;
  }

  return applyEmaLatest(
    {
      period,
      alpha: session.alpha,
      oneMinusAlpha: session.oneMinusAlpha,
      points: committedPoints,
      committedCount: lastIndex,
      seedCloses: emaThroughTMinus1 ? [] : seedCloses,
      seedSum: emaThroughTMinus1 ? INDICATOR_ZERO : seedSum,
      emaThroughTMinus1,
      committedPoints,
      committedValues,
      latest: null,
      latestPoint: null,
      latestEma: null,
      values: committedValues,
    },
    last,
  );
}

function emptyEma(period: number): EmaSession {
  const periodValue = indicatorInteger(period);
  const alpha = INDICATOR_TWO.div(periodValue.plus(INDICATOR_ONE));

  return {
    period,
    alpha,
    oneMinusAlpha: INDICATOR_ONE.minus(alpha),
    points: [],
    committedCount: 0,
    seedCloses: [],
    seedSum: INDICATOR_ZERO,
    emaThroughTMinus1: null,
    committedPoints: [],
    committedValues: [],
    latest: null,
    latestPoint: null,
    latestEma: null,
    values: [],
  };
}

function commitEmaLatest(session: EmaSession): EmaSession {
  if (!session.latest) {
    return session;
  }

  const seeded = session.emaThroughTMinus1 !== null || session.latestEma !== null;
  const seedCloses = seeded ? [] : [...session.seedCloses, session.latest.close];
  const seedSum = seeded ? INDICATOR_ZERO : session.seedSum.plus(session.latest.close);
  const emaThroughTMinus1 = session.latestEma ?? session.emaThroughTMinus1;
  const committedPoints = session.latestPoint
    ? [...session.committedPoints, session.latestPoint]
    : [...session.committedPoints];
  const committedValues = session.latestEma
    ? [...session.committedValues, session.latestEma]
    : [...session.committedValues];

  return {
    period: session.period,
    alpha: session.alpha,
    oneMinusAlpha: session.oneMinusAlpha,
    points: committedPoints,
    committedCount: session.committedCount + 1,
    seedCloses,
    seedSum,
    emaThroughTMinus1,
    committedPoints,
    committedValues,
    latest: null,
    latestPoint: null,
    latestEma: null,
    values: committedValues,
  };
}

function applyEmaLatest(session: EmaSession, sample: IndicatorSample): EmaSession | null {
  const next: EmaSession = {
    period: session.period,
    alpha: session.alpha,
    oneMinusAlpha: session.oneMinusAlpha,
    committedCount: session.committedCount,
    seedCloses: session.seedCloses,
    seedSum: session.seedSum,
    emaThroughTMinus1: session.emaThroughTMinus1,
    committedPoints: session.committedPoints,
    committedValues: session.committedValues,
    latest: sample,
    latestPoint: null,
    latestEma: null,
    points: session.committedPoints,
    values: session.committedValues,
  };

  const total = next.committedCount + 1;

  if (total < next.period) {
    return next;
  }

  let ema: IndicatorDecimal;

  if (next.emaThroughTMinus1) {
    ema = sample.close.times(next.alpha).plus(next.emaThroughTMinus1.times(next.oneMinusAlpha));
  } else {
    const seedSum = next.seedSum.plus(sample.close);
    ema = seedSum.div(indicatorInteger(next.period));
  }

  if (!ema.isFinite()) {
    return null;
  }

  const serialized = serializeIndicatorValue(ema);

  if (serialized === null) {
    return null;
  }

  const latestPoint: ExactIndicatorPoint = { openTime: sample.openTime, value: serialized };
  next.latestEma = ema;
  next.latestPoint = latestPoint;
  next.points = [...next.committedPoints, latestPoint];
  next.values = [...next.committedValues, ema];
  return next;
}
