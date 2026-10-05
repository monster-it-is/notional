import {
  DEFAULT_INDICATOR_SETTINGS,
  isValidMacdTriple,
  parseBollingerMultiplierInput,
  parseBollingerPeriod,
  parseEmaPeriod,
  parseMacdFast,
  parseMacdSignal,
  parseMacdSlow,
  parseRsiPeriod,
  parseSmaPeriod,
  type IndicatorSettings,
} from "./indicators/settings.ts";

export const TRADE_CHART_PREFERENCES_KEY = "notional.trade-chart.preferences.v1";
export const TRADE_CHART_PREFERENCES_VERSION = 1;

export type ChartDisplayMode = "candles" | "line";

export type TradeChartPreferences = {
  version: typeof TRADE_CHART_PREFERENCES_VERSION;
  mode: ChartDisplayMode;
  indicators: IndicatorSettings;
};

export const DEFAULT_TRADE_CHART_PREFERENCES: TradeChartPreferences = {
  version: TRADE_CHART_PREFERENCES_VERSION,
  mode: "candles",
  indicators: DEFAULT_INDICATOR_SETTINGS,
};

type StorageReader = Pick<Storage, "getItem"> | null;
type StorageWriter = Pick<Storage, "setItem"> | null;

export function isChartDisplayMode(value: unknown): value is ChartDisplayMode {
  return value === "candles" || value === "line";
}

export function readTradeChartPreferences(
  storage: StorageReader = defaultStorage(),
): TradeChartPreferences {
  if (!storage) {
    return copyPreferences(DEFAULT_TRADE_CHART_PREFERENCES);
  }

  try {
    const raw = storage.getItem(TRADE_CHART_PREFERENCES_KEY);

    if (raw == null) {
      return copyPreferences(DEFAULT_TRADE_CHART_PREFERENCES);
    }

    return parseTradeChartPreferences(JSON.parse(raw));
  } catch {
    return copyPreferences(DEFAULT_TRADE_CHART_PREFERENCES);
  }
}

export function parseTradeChartPreferences(value: unknown): TradeChartPreferences {
  if (!isRecord(value) || value.version !== TRADE_CHART_PREFERENCES_VERSION) {
    return copyPreferences(DEFAULT_TRADE_CHART_PREFERENCES);
  }

  if (!isChartDisplayMode(value.mode)) {
    return copyPreferences(DEFAULT_TRADE_CHART_PREFERENCES);
  }

  return {
    version: TRADE_CHART_PREFERENCES_VERSION,
    mode: value.mode,
    indicators: sanitizeIndicatorSettings(value.indicators),
  };
}

export function writeTradeChartPreferences(
  preferences: Pick<TradeChartPreferences, "mode" | "indicators">,
  storage: StorageWriter = defaultStorage(),
): void {
  if (!storage || !isChartDisplayMode(preferences.mode)) {
    return;
  }

  const payload: TradeChartPreferences = {
    version: TRADE_CHART_PREFERENCES_VERSION,
    mode: preferences.mode,
    indicators: sanitizeIndicatorSettings(preferences.indicators),
  };

  try {
    storage.setItem(TRADE_CHART_PREFERENCES_KEY, JSON.stringify(payload));
  } catch {
    // Persistence cannot survive reload when storage is unavailable.
  }
}

function sanitizeIndicatorSettings(value: unknown): IndicatorSettings {
  if (!isRecord(value)) {
    return copyIndicatorSettings(DEFAULT_INDICATOR_SETTINGS);
  }

  return {
    sma: sanitizeSma(value.sma),
    ema: sanitizeEma(value.ema),
    rsi: sanitizeRsi(value.rsi),
    macd: sanitizeMacd(value.macd),
    bollinger: sanitizeBollinger(value.bollinger),
  };
}

function sanitizeSma(value: unknown): IndicatorSettings["sma"] {
  const defaults = DEFAULT_INDICATOR_SETTINGS.sma;

  if (!isRecord(value)) {
    return { ...defaults };
  }

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    period: parseSmaPeriod(toPeriodInput(value.period)) ?? defaults.period,
  };
}

function sanitizeEma(value: unknown): IndicatorSettings["ema"] {
  const defaults = DEFAULT_INDICATOR_SETTINGS.ema;

  if (!isRecord(value)) {
    return { ...defaults };
  }

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    period: parseEmaPeriod(toPeriodInput(value.period)) ?? defaults.period,
  };
}

function sanitizeRsi(value: unknown): IndicatorSettings["rsi"] {
  const defaults = DEFAULT_INDICATOR_SETTINGS.rsi;

  if (!isRecord(value)) {
    return { ...defaults };
  }

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    period: parseRsiPeriod(toPeriodInput(value.period)) ?? defaults.period,
  };
}

function sanitizeMacd(value: unknown): IndicatorSettings["macd"] {
  const defaults = DEFAULT_INDICATOR_SETTINGS.macd;

  if (!isRecord(value)) {
    return { ...defaults };
  }

  const fast = parseMacdFast(toPeriodInput(value.fast));
  const slow = parseMacdSlow(toPeriodInput(value.slow));
  const signal = parseMacdSignal(toPeriodInput(value.signal));
  const valid =
    fast !== null && slow !== null && signal !== null && isValidMacdTriple(fast, slow, signal);

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    fast: valid ? fast : defaults.fast,
    slow: valid ? slow : defaults.slow,
    signal: valid ? signal : defaults.signal,
  };
}

function sanitizeBollinger(value: unknown): IndicatorSettings["bollinger"] {
  const defaults = DEFAULT_INDICATOR_SETTINGS.bollinger;

  if (!isRecord(value)) {
    return { ...defaults };
  }

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    period: parseBollingerPeriod(toPeriodInput(value.period)) ?? defaults.period,
    multiplier: parseBollingerMultiplierInput(toMultiplierInput(value.multiplier)) ?? defaults.multiplier,
  };
}

function toPeriodInput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return value.toString(10);
  }

  return "";
}

function toMultiplierInput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return "";
}

function copyPreferences(value: TradeChartPreferences): TradeChartPreferences {
  return {
    version: value.version,
    mode: value.mode,
    indicators: copyIndicatorSettings(value.indicators),
  };
}

function copyIndicatorSettings(value: IndicatorSettings): IndicatorSettings {
  return {
    sma: { ...value.sma },
    ema: { ...value.ema },
    rsi: { ...value.rsi },
    macd: { ...value.macd },
    bollinger: { ...value.bollinger },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultStorage(): (StorageReader & StorageWriter) | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}
