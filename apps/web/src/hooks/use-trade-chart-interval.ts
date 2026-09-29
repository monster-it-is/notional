import { CANDLE_INTERVALS, type CandleInterval } from "@notional/contracts";
import { useSearchParams } from "react-router";

import { DEFAULT_TRADE_CHART_INTERVAL } from "../lib/api/candles.ts";

export function parseTradeChartInterval(value: string | null): CandleInterval {
  if (value !== null && (CANDLE_INTERVALS as readonly string[]).includes(value)) {
    return value as CandleInterval;
  }

  return DEFAULT_TRADE_CHART_INTERVAL;
}

export function useTradeChartInterval(): {
  interval: CandleInterval;
  setChartInterval: (interval: CandleInterval) => void;
} {
  const [params, setParams] = useSearchParams();
  const interval = parseTradeChartInterval(params.get("interval"));

  function setChartInterval(next: CandleInterval): void {
    const nextParams = new URLSearchParams(params);
    nextParams.set("interval", next);
    setParams(nextParams, { replace: true });
  }

  return { interval, setChartInterval };
}
