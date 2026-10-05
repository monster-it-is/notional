import { parseBollingerMultiplier } from "./bollinger.ts";
import { isValidMacdParams } from "./macd.ts";
import { isValidIndicatorPeriod } from "./samples.ts";

export const INDICATOR_PERIOD_MAX = 500;

export type SmaSettings = {
  enabled: boolean;
  period: number;
};

export type EmaSettings = {
  enabled: boolean;
  period: number;
};

export type RsiSettings = {
  enabled: boolean;
  period: number;
};

export type MacdSettings = {
  enabled: boolean;
  fast: number;
  slow: number;
  signal: number;
};

export type BollingerSettings = {
  enabled: boolean;
  period: number;
  multiplier: string;
};

export type IndicatorSettings = {
  sma: SmaSettings;
  ema: EmaSettings;
  rsi: RsiSettings;
  macd: MacdSettings;
  bollinger: BollingerSettings;
};

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
  sma: { enabled: false, period: 20 },
  ema: { enabled: false, period: 20 },
  rsi: { enabled: false, period: 14 },
  macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
  bollinger: { enabled: false, period: 20, multiplier: "2" },
};

export function anyOverlayEnabled(settings: IndicatorSettings): boolean {
  return settings.sma.enabled || settings.ema.enabled || settings.bollinger.enabled;
}

export function overlayEnabledCount(settings: IndicatorSettings): number {
  return (
    (settings.sma.enabled ? 1 : 0) +
    (settings.ema.enabled ? 1 : 0) +
    (settings.bollinger.enabled ? 1 : 0)
  );
}

export function parsePeriodInput(raw: string): number | null {
  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number.parseInt(trimmed, 10);

  if (!Number.isInteger(value)) {
    return null;
  }

  return value;
}

export function parseSmaPeriod(raw: string): number | null {
  return parseBoundedPeriod(raw, 1, INDICATOR_PERIOD_MAX);
}

export function parseEmaPeriod(raw: string): number | null {
  return parseBoundedPeriod(raw, 1, INDICATOR_PERIOD_MAX);
}

export function parseRsiPeriod(raw: string): number | null {
  return parseBoundedPeriod(raw, 2, INDICATOR_PERIOD_MAX);
}

export function parseMacdFast(raw: string): number | null {
  return parseBoundedPeriod(raw, 1, INDICATOR_PERIOD_MAX);
}

export function parseMacdSlow(raw: string): number | null {
  return parseBoundedPeriod(raw, 2, INDICATOR_PERIOD_MAX);
}

export function parseMacdSignal(raw: string): number | null {
  return parseBoundedPeriod(raw, 1, INDICATOR_PERIOD_MAX);
}

export function parseBollingerPeriod(raw: string): number | null {
  return parseBoundedPeriod(raw, 2, INDICATOR_PERIOD_MAX);
}

export function parseBollingerMultiplierInput(raw: string): string | null {
  const trimmed = raw.trim();
  const parsed = parseBollingerMultiplier(trimmed);
  return parsed ? trimmed : null;
}

export function isValidMacdTriple(fast: number, slow: number, signal: number): boolean {
  return isValidMacdParams({ fast, slow, signal });
}

function parseBoundedPeriod(raw: string, min: number, max: number): number | null {
  const value = parsePeriodInput(raw);

  if (value === null || !isValidIndicatorPeriod(value, min, max)) {
    return null;
  }

  return value;
}
