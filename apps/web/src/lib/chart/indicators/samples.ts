import type { Candle } from "@notional/contracts";

import { parseIndicatorDecimal } from "./decimal.ts";
import type { IndicatorSample } from "./types.ts";

function isFiniteOpenTime(openTime: number): boolean {
  return typeof openTime === "number" && Number.isFinite(openTime) && openTime >= 0;
}

/**
 * Parse canonical candles into Decimal samples.
 *
 * Precondition: `close` values are chronological plain decimals. Any invalid
 * close, non-finite openTime, or non-increasing openTime fails closed (`null`)
 * rather than skipping the row and compressing time.
 */
export function samplesFromCandles(candles: readonly Candle[]): IndicatorSample[] | null {
  const samples: IndicatorSample[] = [];
  let previousOpenTime: number | null = null;

  for (const candle of candles) {
    if (
      !isFiniteOpenTime(candle.openTime) ||
      (previousOpenTime !== null && candle.openTime <= previousOpenTime)
    ) {
      return null;
    }

    const close = parseIndicatorDecimal(candle.close);

    if (!close) {
      return null;
    }

    samples.push({ openTime: candle.openTime, close });
    previousOpenTime = candle.openTime;
  }

  return samples;
}

export function sampleFromCandle(candle: Candle): IndicatorSample | null {
  if (!isFiniteOpenTime(candle.openTime)) {
    return null;
  }

  const close = parseIndicatorDecimal(candle.close);

  if (!close) {
    return null;
  }

  return { openTime: candle.openTime, close };
}

export function isValidIndicatorPeriod(period: number, min: number, max: number): boolean {
  return Number.isInteger(period) && period >= min && period <= max;
}
