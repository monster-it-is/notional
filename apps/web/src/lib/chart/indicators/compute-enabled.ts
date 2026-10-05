import type { Candle } from "@notional/contracts";

import { computeBollinger } from "./bollinger.ts";
import { computeEma } from "./ema.ts";
import { computeMacd } from "./macd.ts";
import { computeRsi } from "./rsi.ts";
import type { IndicatorSettings } from "./settings.ts";
import { computeSma } from "./sma.ts";
import type { ExactBollingerPoint, ExactIndicatorPoint, ExactMacdPoint } from "./types.ts";

export type ComputedEnabledIndicators = {
  sma?: ExactIndicatorPoint[] | null;
  ema?: ExactIndicatorPoint[] | null;
  rsi?: ExactIndicatorPoint[] | null;
  macd?: ExactMacdPoint[] | null;
  bollinger?: ExactBollingerPoint[] | null;
};

const EMPTY_COMPUTED: ComputedEnabledIndicators = {};

export function computeEnabledIndicators(
  candles: readonly Candle[],
  settings: IndicatorSettings,
): ComputedEnabledIndicators {
  const computed: ComputedEnabledIndicators = {};
  let anyEnabled = false;

  if (settings.sma.enabled) {
    anyEnabled = true;
    computed.sma = computeSma(candles, settings.sma.period);
  }

  if (settings.ema.enabled) {
    anyEnabled = true;
    computed.ema = computeEma(candles, settings.ema.period);
  }

  if (settings.rsi.enabled) {
    anyEnabled = true;
    computed.rsi = computeRsi(candles, settings.rsi.period);
  }

  if (settings.macd.enabled) {
    anyEnabled = true;
    computed.macd = computeMacd(candles, settings.macd);
  }

  if (settings.bollinger.enabled) {
    anyEnabled = true;
    computed.bollinger = computeBollinger(
      candles,
      settings.bollinger.period,
      settings.bollinger.multiplier,
    );
  }

  return anyEnabled ? computed : EMPTY_COMPUTED;
}
