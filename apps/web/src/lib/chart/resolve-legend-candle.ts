import type { Candle, CandleInterval } from "@notional/contracts";

import { findCandleByOpenTime } from "./find-candle-by-chart-time.ts";

export type ChartCandleSelection = {
  symbol: string;
  interval: CandleInterval;
  openTime: number;
  session: number;
} | null;

export function candleSelectionKey(selection: ChartCandleSelection): string {
  if (selection === null) {
    return "";
  }

  return `${selection.symbol}:${selection.interval}:${selection.openTime}:${selection.session}`;
}

export function resolveLegendCandle(params: {
  candles: readonly Candle[];
  selection: ChartCandleSelection;
  symbol: string;
  interval: CandleInterval;
  session: number;
}): Candle | null {
  const latest = params.candles[params.candles.length - 1] ?? null;

  if (latest === null) {
    return null;
  }

  if (
    params.selection === null ||
    params.selection.symbol !== params.symbol ||
    params.selection.interval !== params.interval ||
    params.selection.session !== params.session
  ) {
    return latest;
  }

  return findCandleByOpenTime(params.candles, params.selection.openTime) ?? latest;
}
