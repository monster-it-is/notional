import type { Candle } from "@notional/contracts";

import {
  INDICATOR_HUNDRED,
  INDICATOR_ONE,
  INDICATOR_ZERO,
  indicatorInteger,
  serializeIndicatorValue,
  type IndicatorDecimal,
} from "./decimal.ts";
import { isValidIndicatorPeriod, sampleFromCandle, samplesFromCandles } from "./samples.ts";
import type { ExactIndicatorPoint, IndicatorSample } from "./types.ts";

export const RSI_PERIOD_MIN = 2;
export const RSI_PERIOD_MAX = 500;

export type RsiSession = {
  period: number;
  points: ExactIndicatorPoint[];
  committedCount: number;
  seedCloses: IndicatorDecimal[];
  prevClose: IndicatorDecimal | null;
  avgGainThroughTMinus1: IndicatorDecimal | null;
  avgLossThroughTMinus1: IndicatorDecimal | null;
  committedPoints: ExactIndicatorPoint[];
  latest: IndicatorSample | null;
  latestPoint: ExactIndicatorPoint | null;
};

export function computeRsi(
  candles: readonly Candle[],
  period: number,
): ExactIndicatorPoint[] | null {
  if (!isValidIndicatorPeriod(period, RSI_PERIOD_MIN, RSI_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  const points: ExactIndicatorPoint[] = [];
  const needed = period + 1;

  if (samples.length < needed) {
    return points;
  }

  const seedCloses = samples.slice(0, needed).map((sample) => sample.close);
  let averages = initialAverages(seedCloses, period);
  let serialized = serializeIndicatorValue(rsiFromAverages(averages.avgGain, averages.avgLoss));

  if (serialized === null) {
    return null;
  }

  const first = samples[needed - 1];

  if (!first) {
    return null;
  }

  points.push({ openTime: first.openTime, value: serialized });

  for (let index = needed; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (!previous || !current) {
      return null;
    }

    averages = wilderStep(
      previous.close,
      current.close,
      averages.avgGain,
      averages.avgLoss,
      period,
    );
    serialized = serializeIndicatorValue(rsiFromAverages(averages.avgGain, averages.avgLoss));

    if (serialized === null) {
      return null;
    }

    points.push({ openTime: current.openTime, value: serialized });
  }

  return points;
}

export function rebuildRsi(candles: readonly Candle[], period: number): RsiSession | null {
  if (!isValidIndicatorPeriod(period, RSI_PERIOD_MIN, RSI_PERIOD_MAX)) {
    return null;
  }

  const samples = samplesFromCandles(candles);

  if (!samples) {
    return null;
  }

  return bootstrapRsiFromSamples(samples, period);
}

export function replaceRsiLatest(session: RsiSession, candle: Candle): RsiSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample || !session.latest || sample.openTime !== session.latest.openTime) {
    return null;
  }

  return applyRsiLatest(session, sample);
}

export function appendRsi(session: RsiSession, candle: Candle): RsiSession | null {
  const sample = sampleFromCandle(candle);

  if (!sample) {
    return null;
  }

  return appendRsiSample(session, sample);
}

function appendRsiSample(session: RsiSession, sample: IndicatorSample): RsiSession | null {
  if (session.latest && sample.openTime <= session.latest.openTime) {
    return null;
  }

  if (!session.latest) {
    return applyRsiLatest(session, sample);
  }

  return applyRsiLatest(commitRsiLatest(session), sample);
}

function bootstrapRsiFromSamples(
  samples: readonly IndicatorSample[],
  period: number,
): RsiSession | null {
  if (samples.length === 0) {
    return emptyRsi(period);
  }

  const seedCloses: IndicatorDecimal[] = [];
  let prevClose: IndicatorDecimal | null = null;
  let avgGainThroughTMinus1: IndicatorDecimal | null = null;
  let avgLossThroughTMinus1: IndicatorDecimal | null = null;
  const committedPoints: ExactIndicatorPoint[] = [];
  const needed = period + 1;
  const lastIndex = samples.length - 1;

  for (let index = 0; index < lastIndex; index += 1) {
    const sample = samples[index];

    if (!sample) {
      return null;
    }

    if (avgGainThroughTMinus1 === null || avgLossThroughTMinus1 === null) {
      seedCloses.push(sample.close);

      if (seedCloses.length === needed) {
        const initial = initialAverages(seedCloses, period);
        avgGainThroughTMinus1 = initial.avgGain;
        avgLossThroughTMinus1 = initial.avgLoss;
        seedCloses.length = 0;
        const serialized = serializeIndicatorValue(
          rsiFromAverages(avgGainThroughTMinus1, avgLossThroughTMinus1),
        );

        if (serialized === null) {
          return null;
        }

        committedPoints.push({ openTime: sample.openTime, value: serialized });
      }
    } else if (prevClose) {
      const wilder = wilderStep(
        prevClose,
        sample.close,
        avgGainThroughTMinus1,
        avgLossThroughTMinus1,
        period,
      );
      avgGainThroughTMinus1 = wilder.avgGain;
      avgLossThroughTMinus1 = wilder.avgLoss;
      const serialized = serializeIndicatorValue(
        rsiFromAverages(avgGainThroughTMinus1, avgLossThroughTMinus1),
      );

      if (serialized === null) {
        return null;
      }

      committedPoints.push({ openTime: sample.openTime, value: serialized });
    }

    prevClose = sample.close;
  }

  const last = samples[lastIndex];

  if (!last) {
    return null;
  }

  return applyRsiLatest(
    {
      period,
      points: committedPoints,
      committedCount: lastIndex,
      seedCloses: avgGainThroughTMinus1 === null ? seedCloses : [],
      prevClose,
      avgGainThroughTMinus1,
      avgLossThroughTMinus1,
      committedPoints,
      latest: null,
      latestPoint: null,
    },
    last,
  );
}

function emptyRsi(period: number): RsiSession {
  return {
    period,
    points: [],
    committedCount: 0,
    seedCloses: [],
    prevClose: null,
    avgGainThroughTMinus1: null,
    avgLossThroughTMinus1: null,
    committedPoints: [],
    latest: null,
    latestPoint: null,
  };
}

function commitRsiLatest(session: RsiSession): RsiSession {
  if (!session.latest) {
    return session;
  }

  const seeded = session.avgGainThroughTMinus1 !== null;
  const seedCloses = seeded ? [] : [...session.seedCloses, session.latest.close];
  const committedPoints = session.latestPoint
    ? [...session.committedPoints, session.latestPoint]
    : [...session.committedPoints];

  let avgGain = session.avgGainThroughTMinus1;
  let avgLoss = session.avgLossThroughTMinus1;

  if (!seeded && seedCloses.length === session.period + 1) {
    const initial = initialAverages(seedCloses, session.period);
    avgGain = initial.avgGain;
    avgLoss = initial.avgLoss;
  } else if (seeded && session.prevClose) {
    const wilder = wilderStep(
      session.prevClose,
      session.latest.close,
      session.avgGainThroughTMinus1 as IndicatorDecimal,
      session.avgLossThroughTMinus1 as IndicatorDecimal,
      session.period,
    );
    avgGain = wilder.avgGain;
    avgLoss = wilder.avgLoss;
  }

  return {
    period: session.period,
    points: committedPoints,
    committedCount: session.committedCount + 1,
    seedCloses,
    prevClose: session.latest.close,
    avgGainThroughTMinus1: avgGain,
    avgLossThroughTMinus1: avgLoss,
    committedPoints,
    latest: null,
    latestPoint: null,
  };
}

function applyRsiLatest(session: RsiSession, sample: IndicatorSample): RsiSession | null {
  const next: RsiSession = {
    period: session.period,
    committedCount: session.committedCount,
    seedCloses: session.seedCloses,
    prevClose: session.prevClose,
    avgGainThroughTMinus1: session.avgGainThroughTMinus1,
    avgLossThroughTMinus1: session.avgLossThroughTMinus1,
    committedPoints: session.committedPoints,
    latest: sample,
    latestPoint: null,
    points: session.committedPoints,
  };

  const total = next.committedCount + 1;
  const needed = next.period + 1;

  if (total < needed) {
    return next;
  }

  let avgGain: IndicatorDecimal;
  let avgLoss: IndicatorDecimal;

  if (next.avgGainThroughTMinus1 !== null && next.avgLossThroughTMinus1 !== null && next.prevClose) {
    const wilder = wilderStep(
      next.prevClose,
      sample.close,
      next.avgGainThroughTMinus1,
      next.avgLossThroughTMinus1,
      next.period,
    );
    avgGain = wilder.avgGain;
    avgLoss = wilder.avgLoss;
  } else {
    const seed = [...next.seedCloses, sample.close];
    const initial = initialAverages(seed, next.period);
    avgGain = initial.avgGain;
    avgLoss = initial.avgLoss;
  }

  const rsi = rsiFromAverages(avgGain, avgLoss);
  const serialized = serializeIndicatorValue(rsi);

  if (serialized === null) {
    return null;
  }

  const latestPoint: ExactIndicatorPoint = { openTime: sample.openTime, value: serialized };
  next.latestPoint = latestPoint;
  next.points = [...next.committedPoints, latestPoint];
  return next;
}

function initialAverages(
  closes: readonly IndicatorDecimal[],
  period: number,
): { avgGain: IndicatorDecimal; avgLoss: IndicatorDecimal } {
  let gainSum = INDICATOR_ZERO;
  let lossSum = INDICATOR_ZERO;

  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];

    if (!previous || !current) {
      continue;
    }

    const change = current.minus(previous);

    if (change.isPositive()) {
      gainSum = gainSum.plus(change);
    } else if (change.isNegative()) {
      lossSum = lossSum.plus(change.negated());
    }
  }

  const periodValue = indicatorInteger(period);
  return {
    avgGain: gainSum.div(periodValue),
    avgLoss: lossSum.div(periodValue),
  };
}

function wilderStep(
  previousClose: IndicatorDecimal,
  currentClose: IndicatorDecimal,
  prevAvgGain: IndicatorDecimal,
  prevAvgLoss: IndicatorDecimal,
  period: number,
): { avgGain: IndicatorDecimal; avgLoss: IndicatorDecimal } {
  const change = currentClose.minus(previousClose);
  const currentGain = change.isPositive() ? change : INDICATOR_ZERO;
  const currentLoss = change.isNegative() ? change.negated() : INDICATOR_ZERO;
  const periodValue = indicatorInteger(period);
  const periodMinusOne = indicatorInteger(period - 1);

  return {
    avgGain: prevAvgGain.times(periodMinusOne).plus(currentGain).div(periodValue),
    avgLoss: prevAvgLoss.times(periodMinusOne).plus(currentLoss).div(periodValue),
  };
}

function rsiFromAverages(avgGain: IndicatorDecimal, avgLoss: IndicatorDecimal): IndicatorDecimal {
  if (avgGain.isZero() && avgLoss.isZero()) {
    return indicatorInteger(50);
  }

  if (avgLoss.isZero() && avgGain.gt(INDICATOR_ZERO)) {
    return INDICATOR_HUNDRED;
  }

  if (avgGain.isZero() && avgLoss.gt(INDICATOR_ZERO)) {
    return INDICATOR_ZERO;
  }

  const rs = avgGain.div(avgLoss);
  return INDICATOR_HUNDRED.minus(INDICATOR_HUNDRED.div(INDICATOR_ONE.plus(rs)));
}
