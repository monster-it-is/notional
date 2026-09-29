import type { CandleInterval, CandleListResponse } from "@notional/contracts";

import { apiRequest } from "./client.ts";

export const TRADE_CHART_INTERVAL = "15m" satisfies CandleInterval;
export const TRADE_CHART_LIMIT = 500;

export function getCandles(params: {
  symbol: string;
  interval: CandleInterval;
  limit: number;
}): Promise<CandleListResponse> {
  const search = new URLSearchParams();
  search.set("interval", params.interval);
  search.set("limit", String(params.limit));

  return apiRequest<CandleListResponse>(
    `/api/market-data/${encodeURIComponent(params.symbol)}/candles?${search.toString()}`,
  );
}
