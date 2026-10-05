import type { Candle, CandleListResponse } from "@notional/contracts";

export function mergeLatestSnapshot(
  current: CandleListResponse | undefined,
  snapshot: CandleListResponse,
  maxCandles: number,
): CandleListResponse | undefined {
  if (!current) {
    return capCandles(snapshot, maxCandles);
  }

  if (current.symbol !== snapshot.symbol || current.interval !== snapshot.interval) {
    return current;
  }

  const byOpenTime = new Map<number, Candle>();

  for (const candle of current.candles) {
    byOpenTime.set(candle.openTime, candle);
  }

  for (const candle of snapshot.candles) {
    byOpenTime.set(candle.openTime, candle);
  }

  const merged = [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);

  return {
    ...current,
    candles: merged.length > maxCandles ? merged.slice(merged.length - maxCandles) : merged,
  };
}

function capCandles(snapshot: CandleListResponse, maxCandles: number): CandleListResponse {
  if (snapshot.candles.length <= maxCandles) {
    return snapshot;
  }

  return {
    ...snapshot,
    candles: snapshot.candles.slice(snapshot.candles.length - maxCandles),
  };
}
