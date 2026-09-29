import type { Candle } from "@notional/contracts";
import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

/**
 * Render-only mapping from canonical Candle decimal strings to Lightweight Charts
 * coordinates. Output numbers are plot geometry and must never enter order,
 * balance, margin, or PnL paths.
 */
export function toChartCandles(candles: readonly Candle[]): CandlestickData[] {
  const points: CandlestickData[] = [];

  for (const candle of candles) {
    const time = toUtcTimestamp(candle.openTime);
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
      continue;
    }

    points.push({ time, open, high, low, close });
  }

  return points;
}

function toUtcTimestamp(openTimeMs: number): UTCTimestamp | null {
  if (!Number.isFinite(openTimeMs) || openTimeMs < 0) {
    return null;
  }

  const seconds = Math.floor(openTimeMs / 1000);

  if (!Number.isSafeInteger(seconds)) {
    return null;
  }

  return seconds as UTCTimestamp;
}
