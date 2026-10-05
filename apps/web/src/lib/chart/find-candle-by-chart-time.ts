import type { Candle } from "@notional/contracts";

import { toChartUtcTimestamp } from "./to-chart-candles.ts";

/**
 * Exact O(log n) lookup from Lightweight Charts UTC seconds (or openTime ms)
 * back to a canonical Candle.
 *
 * Precondition: `candles` is chronological by finite `openTime` values, as
 * produced by the market-data cache (initial REST page, live append, historical
 * prepend, reconnect snapshot). This is the only supported input. Lookup is
 * exact-match binary search; an invalid midpoint openTime is outside this
 * contract and is not recovered by a linear scan.
 */

export function findCandleByChartTime(
  candles: readonly Candle[],
  time: unknown,
): Candle | null {
  const chartSeconds = parseChartUtcSeconds(time);

  if (chartSeconds === null || candles.length === 0) {
    return null;
  }

  let low = 0;
  let high = candles.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const candle = candles[mid];

    if (!candle) {
      return null;
    }

    const seconds = toChartUtcTimestamp(candle.openTime);

    if (seconds === null) {
      return null;
    }

    if (seconds === chartSeconds) {
      return candle;
    }

    if (seconds < chartSeconds) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return null;
}

export function findCandleByOpenTime(
  candles: readonly Candle[],
  openTime: number,
): Candle | null {
  if (!Number.isFinite(openTime) || candles.length === 0) {
    return null;
  }

  let low = 0;
  let high = candles.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const candle = candles[mid];

    if (!candle) {
      return null;
    }

    if (candle.openTime === openTime) {
      return candle;
    }

    if (candle.openTime < openTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return null;
}

function parseChartUtcSeconds(time: unknown): number | null {
  if (
    typeof time !== "number" ||
    !Number.isFinite(time) ||
    !Number.isSafeInteger(time) ||
    time < 0
  ) {
    return null;
  }

  return time;
}
