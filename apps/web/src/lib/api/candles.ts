import type { CandleInterval, CandleListResponse } from "@notional/contracts";

import { apiRequest, type RequestOptions } from "./client.ts";

export const DEFAULT_TRADE_CHART_INTERVAL = "15m" satisfies CandleInterval;
export const TRADE_CHART_LIMIT = 500;
export const TRADE_CHART_MAX_CANDLES = 10_000;

export function historicalBackfillLimit(loadedCount: number): number {
  const remainingCapacity = TRADE_CHART_MAX_CANDLES - loadedCount;

  if (remainingCapacity <= 0) {
    return 0;
  }

  return Math.min(TRADE_CHART_LIMIT, remainingCapacity);
}

export function getCandles(
  params: {
    symbol: string;
    interval: CandleInterval;
    limit: number;
    before?: number;
  },
  options?: Pick<RequestOptions, "signal">,
): Promise<CandleListResponse> {
  const search = new URLSearchParams();
  search.set("interval", params.interval);
  search.set("limit", String(params.limit));

  if (params.before !== undefined) {
    search.set("before", String(params.before));
  }

  const path = `/api/market-data/${encodeURIComponent(params.symbol)}/candles?${search.toString()}`;

  return options === undefined
    ? apiRequest<CandleListResponse>(path)
    : apiRequest<CandleListResponse>(path, options);
}
