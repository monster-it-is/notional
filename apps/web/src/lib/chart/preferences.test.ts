import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_INDICATOR_SETTINGS } from "./indicators/settings.ts";
import {
  DEFAULT_TRADE_CHART_PREFERENCES,
  parseTradeChartPreferences,
  readTradeChartPreferences,
  TRADE_CHART_PREFERENCES_KEY,
  writeTradeChartPreferences,
} from "./preferences.ts";

afterEach(() => {
  localStorage.removeItem(TRADE_CHART_PREFERENCES_KEY);
});

describe("trade chart preferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(readTradeChartPreferences()).toEqual(DEFAULT_TRADE_CHART_PREFERENCES);
    expect(DEFAULT_TRADE_CHART_PREFERENCES.mode).toBe("candles");
    expect(DEFAULT_TRADE_CHART_PREFERENCES.indicators).toEqual(DEFAULT_INDICATOR_SETTINGS);
    expect(DEFAULT_TRADE_CHART_PREFERENCES).not.toHaveProperty("interval");
  });

  it("restores a valid saved mode and indicator settings", () => {
    const stored = {
      version: 1,
      mode: "line",
      indicators: {
        sma: { enabled: true, period: 30 },
        ema: { enabled: true, period: 12 },
        rsi: { enabled: true, period: 21 },
        macd: { enabled: true, fast: 8, slow: 17, signal: 5 },
        bollinger: { enabled: true, period: 18, multiplier: "2.5" },
      },
    };
    localStorage.setItem(TRADE_CHART_PREFERENCES_KEY, JSON.stringify(stored));

    expect(readTradeChartPreferences()).toEqual(stored);
  });

  it("returns defaults for malformed JSON", () => {
    localStorage.setItem(TRADE_CHART_PREFERENCES_KEY, "{not-json");
    expect(readTradeChartPreferences()).toEqual(DEFAULT_TRADE_CHART_PREFERENCES);
  });

  it("returns defaults for the wrong schema version", () => {
    localStorage.setItem(
      TRADE_CHART_PREFERENCES_KEY,
      JSON.stringify({
        version: 2,
        mode: "line",
        indicators: { sma: { enabled: true, period: 30 } },
      }),
    );
    expect(readTradeChartPreferences()).toEqual(DEFAULT_TRADE_CHART_PREFERENCES);
  });

  it("returns defaults for an unknown chart mode", () => {
    expect(
      parseTradeChartPreferences({
        version: 1,
        mode: "heikin-ashi",
        indicators: DEFAULT_INDICATOR_SETTINGS,
      }),
    ).toEqual(DEFAULT_TRADE_CHART_PREFERENCES);
  });

  it("sanitizes invalid indicator values to known-valid defaults", () => {
    expect(
      parseTradeChartPreferences({
        version: 1,
        mode: "line",
        indicators: {
          sma: { enabled: true, period: 0 },
          ema: { enabled: "yes", period: 12 },
          rsi: { enabled: true, period: 1 },
          macd: { enabled: true, fast: 26, slow: 12, signal: 9 },
          bollinger: { enabled: true, period: 20, multiplier: "0" },
        },
      }),
    ).toEqual({
      version: 1,
      mode: "line",
      indicators: {
        sma: { enabled: true, period: 20 },
        ema: { enabled: false, period: 12 },
        rsi: { enabled: true, period: 14 },
        macd: { enabled: true, fast: 12, slow: 26, signal: 9 },
        bollinger: { enabled: true, period: 20, multiplier: "2" },
      },
    });
  });

  it("ignores extra unknown properties including interval and drawings", () => {
    const parsed = parseTradeChartPreferences({
      version: 1,
      mode: "line",
      interval: "1h",
      drawings: [{ id: "x" }],
      selection: { openTime: 1 },
      indicators: {
        sma: { enabled: true, period: 30, extra: true },
        ema: DEFAULT_INDICATOR_SETTINGS.ema,
        rsi: DEFAULT_INDICATOR_SETTINGS.rsi,
        macd: DEFAULT_INDICATOR_SETTINGS.macd,
        bollinger: DEFAULT_INDICATOR_SETTINGS.bollinger,
        unknown: { enabled: true },
      },
    });

    expect(parsed).toEqual({
      version: 1,
      mode: "line",
      indicators: {
        ...DEFAULT_INDICATOR_SETTINGS,
        sma: { enabled: true, period: 30 },
      },
    });
    expect(parsed).not.toHaveProperty("interval");
    expect(parsed).not.toHaveProperty("drawings");
    expect(parsed).not.toHaveProperty("selection");
  });

  it("returns defaults when storage getItem throws", () => {
    const storage = {
      getItem(): string {
        throw new Error("blocked");
      },
    };

    expect(readTradeChartPreferences(storage)).toEqual(DEFAULT_TRADE_CHART_PREFERENCES);
  });

  it("does not throw when storage setItem throws", () => {
    const storage = {
      setItem(): void {
        throw new Error("quota exceeded");
      },
    };

    expect(() =>
      writeTradeChartPreferences(
        { mode: "line", indicators: DEFAULT_INDICATOR_SETTINGS },
        storage,
      ),
    ).not.toThrow();
    expect(localStorage.getItem(TRADE_CHART_PREFERENCES_KEY)).toBeNull();
  });

  it("writes only the versioned mode and indicator payload", () => {
    writeTradeChartPreferences({
      mode: "line",
      indicators: {
        ...DEFAULT_INDICATOR_SETTINGS,
        sma: { enabled: true, period: 40 },
      },
    });

    expect(JSON.parse(localStorage.getItem(TRADE_CHART_PREFERENCES_KEY) ?? "null")).toEqual({
      version: 1,
      mode: "line",
      indicators: {
        ...DEFAULT_INDICATOR_SETTINGS,
        sma: { enabled: true, period: 40 },
      },
    });
  });
});
