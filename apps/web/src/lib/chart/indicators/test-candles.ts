import type { Candle } from "@notional/contracts";

export function indicatorCandle(openTime: number, close: string): Candle {
  return {
    openTime,
    closeTime: openTime + 59_999,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
  };
}

export function indicatorCandles(closes: readonly string[], start = 1_000_000): Candle[] {
  return closes.map((close, index) => indicatorCandle(start + index * 60_000, close));
}

export function manyIndicatorCandles(count: number, startClose = "100"): Candle[] {
  const candles: Candle[] = [];
  let close = startClose;

  for (let index = 0; index < count; index += 1) {
    candles.push(indicatorCandle(1_000_000 + index * 60_000, close));
    close = incrementPlainDecimal(close);
  }

  return candles;
}

function incrementPlainDecimal(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const nextWhole = `${BigInt(whole) + 1n}`;

  if (fraction.length === 0) {
    return nextWhole;
  }

  return `${nextWhole}.${fraction}`;
}
