import type { Candle } from "@notional/contracts";

import {
  INDICATOR_ZERO,
  indicatorInteger,
  serializeIndicatorValue,
  type IndicatorDecimal,
} from "./decimal.ts";
import { isValidIndicatorPeriod, sampleFromCandle, samplesFromCandles } from "./samples.ts";
import type { ExactIndicatorPoint, IndicatorSample } from "./types.ts";

export const SMA_PERIOD_MIN = 1;
export const SMA_PERIOD_MAX = 500;

export type SmaSession = {
  period: number;
  points: ExactIndicatorPoint[];
  committedCount: number;
  committedWindow: IndicatorDecimal[];
  committedSum: IndicatorDecimal;
  committedPoints: ExactIndicatorPoint[];
  latest: IndicatorSample | null;
  latestPoint: ExactIndicatorPoint | null;
};

export function computeSma(
  candles: readonly Candle[],
  period: number,
): ExactIndicatorPoint[] | null {
  if (!isValidIndicatorPeriod(period, SMA_PERIOD_MIN, SMA_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  const window: IndicatorDecimal[] = [];
  let sum = INDICATOR_ZERO;
  const points: ExactIndicatorPoint[] = [];
  const periodValue = indicatorInteger(period);

  for (const sample of samples) {
    window.push(sample.close);
    sum = sum.plus(sample.close);

    if (window.length > period) {
      const removed = window.shift();

      if (removed) {
        sum = sum.minus(removed);
      }
    }

    if (window.length === period) {
      const serialized = serializeIndicatorValue(sum.div(periodValue));

      if (serialized === null) {
        return null;
      }

      points.push({ openTime: sample.openTime, value: serialized });
    }
  }

  return points;
}

export function rebuildSma(candles: readonly Candle[], period: number): SmaSession | null {
  if (!isValidIndicatorPeriod(period, SMA_PERIOD_MIN, SMA_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  return bootstrapSmaFromSamples(samples, period);
}

export function replaceSmaLatest(session: SmaSession, candle: Candle): SmaSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample || !session.latest || sample.openTime !== session.latest.openTime) {
    return null;
  }

  return applySmaLatest(session, sample);
}

export function appendSma(session: SmaSession, candle: Candle): SmaSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  if (session.latest && sample.openTime <= session.latest.openTime) {
    return null;
  }

  return appendSmaSample(session, sample);
}

function bootstrapSmaFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
): SmaSession | null {
  if (samples.length === 0) {
    return emptySma(period);
  }

  const committedWindow: IndicatorDecimal[] = [];
  let committedSum = INDICATOR_ZERO;
  const committedPoints: ExactIndicatorPoint[] = [];
  const periodValue = indicatorInteger(period);
  const lastIndex = samples.length - 1;

  for (let index = 0; index < lastIndex; index += 1) {
    const sample = samples[index];

    if (!sample) {
      return null;
    }

    committedWindow.push(sample.close);
    committedSum = committedSum.plus(sample.close);

    if (committedWindow.length > period) {
      const removed = committedWindow.shift();

      if (removed) {
        committedSum = committedSum.minus(removed);
      }
    }

    if (committedWindow.length !== period) {
      continue;
    }

    const serialized = serializeIndicatorValue(committedSum.div(periodValue));

    if (serialized === null) {
      return null;
    }

    committedPoints.push({ openTime: sample.openTime, value: serialized });
  }

  const last = samples[lastIndex];

  if (!last) {
    return null;
  }

  return applySmaLatest(
    {
      period,
      points: committedPoints,
      committedCount: lastIndex,
      committedWindow,
      committedSum,
      committedPoints,
      latest: null,
      latestPoint: null,
    },
    last,
  );
}

function emptySma(period: number): SmaSession {
  return {
    period,
    points: [],
    committedCount: 0,
    committedWindow: [],
    committedSum: INDICATOR_ZERO,
    committedPoints: [],
    latest: null,
    latestPoint: null,
  };
}

function appendSmaSample(session: SmaSession, sample: IndicatorSample): SmaSession | null {
  if (!session.latest) {
    return applySmaLatest(session, sample);
  }

  const committed = commitSmaLatest(session);
  return applySmaLatest(committed, sample);
}

function commitSmaLatest(session: SmaSession): SmaSession {
  if (!session.latest) {
    return cloneSma(session);
  }

  const committedWindow = [...session.committedWindow, session.latest.close];
  let committedSum = session.committedSum.plus(session.latest.close);

  if (committedWindow.length > session.period) {
    const removed = committedWindow.shift();

    if (removed) {
      committedSum = committedSum.minus(removed);
    }
  }

  const committedPoints = session.latestPoint
    ? [...session.committedPoints, session.latestPoint]
    : [...session.committedPoints];

  return {
    period: session.period,
    points: committedPoints,
    committedCount: session.committedCount + 1,
    committedWindow,
    committedSum,
    committedPoints,
    latest: null,
    latestPoint: null,
  };
}

function applySmaLatest(session: SmaSession, sample: IndicatorSample): SmaSession | null {
  const next: SmaSession = {
    period: session.period,
    committedCount: session.committedCount,
    committedWindow: session.committedWindow,
    committedSum: session.committedSum,
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
  const currentSum = smaWindowSum(next, sample.close);
  const mean = currentSum.div(periodValue);
  const serialized = serializeIndicatorValue(mean);

  if (serialized === null) {
    return null;
  }

  const latestPoint: ExactIndicatorPoint = { openTime: sample.openTime, value: serialized };
  next.latestPoint = latestPoint;
  next.points = [...next.committedPoints, latestPoint];
  return next;
}

function smaWindowSum(session: SmaSession, latestClose: IndicatorDecimal): IndicatorDecimal {
  if (session.period === 1) {
    return latestClose;
  }

  if (session.committedWindow.length === session.period) {
    const oldest = session.committedWindow[0];

    if (!oldest) {
      return latestClose;
    }

    return session.committedSum.minus(oldest).plus(latestClose);
  }

  return session.committedSum.plus(latestClose);
}

function cloneSma(session: SmaSession): SmaSession {
  return {
    period: session.period,
    points: [...session.points],
    committedCount: session.committedCount,
    committedWindow: [...session.committedWindow],
    committedSum: session.committedSum,
    committedPoints: [...session.committedPoints],
    latest: session.latest,
    latestPoint: session.latestPoint,
  };
}
