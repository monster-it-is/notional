import type { Candle, CandleListResponse } from "@notional/contracts";

export function prependOlderCandles(
  current: CandleListResponse | undefined,
  older: CandleListResponse,
  maxCandles: number,
): CandleListResponse | undefined {
  if (!current || current.symbol !== older.symbol || current.interval !== older.interval) {
    return current;
  }

  const byOpenTime = new Map<number, Candle>();

  for (const candle of older.candles) {
    byOpenTime.set(candle.openTime, candle);
  }

  for (const candle of current.candles) {
    byOpenTime.set(candle.openTime, candle);
  }

  const merged = [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);
  const candles =
    merged.length > maxCandles ? merged.slice(merged.length - maxCandles) : merged;

  return {
    ...current,
    candles,
  };
}
