import type { Candle } from "@notional/contracts";

import type { IndicatorDecimal } from "./decimal.ts";

/**
 * Canonical input for every D11C calculator: chronological Candle rows whose
 * `close` fields are finite plain decimal strings. Calculators never skip a
 * malformed close; the entire computation fails closed (`null`) instead.
 */
export type IndicatorCandleInput = readonly Candle[];

export type ExactIndicatorPoint = {
  openTime: number;
  value: string;
};

export type ExactBollingerPoint = {
  openTime: number;
  middle: string;
  upper: string;
  lower: string;
};

export type ExactMacdPoint = {
  openTime: number;
  macd: string;
  signal?: string;
  histogram?: string;
};

export type IndicatorSample = {
  openTime: number;
  close: IndicatorDecimal;
};

export type IndicatorSession<TPoint> = {
  points: TPoint[];
};
