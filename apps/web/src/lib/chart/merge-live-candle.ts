import type { Candle, CandleInterval, CandleListResponse } from "@notional/contracts";

export type LiveCandleUpdate = {
  symbol: string;
  interval: CandleInterval;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

export function mergeLiveCandle(
  current: CandleListResponse | undefined,
  incoming: LiveCandleUpdate,
  limit: number,
): CandleListResponse | undefined {
  if (!current || current.symbol !== incoming.symbol || current.interval !== incoming.interval) {
    return undefined;
  }

  const candle: Candle = {
    openTime: incoming.openTime,
    closeTime: incoming.closeTime,
    open: incoming.open,
    high: incoming.high,
    low: incoming.low,
    close: incoming.close,
    volume: incoming.volume,
  };

  if (current.candles.length === 0) {
    return { ...current, candles: [candle] };
  }

  const last = current.candles[current.candles.length - 1];

  if (!last) {
    return { ...current, candles: [candle] };
  }

  if (incoming.openTime === last.openTime) {
    return {
      ...current,
      candles: [...current.candles.slice(0, -1), candle],
    };
  }

  if (incoming.openTime > last.openTime) {
    const appended = [...current.candles, candle];
    return {
      ...current,
      candles: appended.length > limit ? appended.slice(appended.length - limit) : appended,
    };
  }

  return undefined;
}
