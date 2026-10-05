import { describe, expect, it } from "vitest";

import { computeBollinger } from "./bollinger.ts";
import { computeEma } from "./ema.ts";
import { computeMacd } from "./macd.ts";
import { computeRsi } from "./rsi.ts";
import {
  applyLiveIndicatorAppend,
  applyLiveIndicatorReplace,
  bootstrapIndicatorSessions,
  canApplyLiveAppend,
  canApplyLiveReplace,
  classifyLiveIndicatorPath,
  createIndicatorSessionIdentity,
  reconcileIndicatorSettings,
} from "./live-session.ts";
import { DEFAULT_INDICATOR_SETTINGS, type IndicatorSettings } from "./settings.ts";
import { computeSma } from "./sma.ts";
import { indicatorCandle, indicatorCandles } from "./test-candles.ts";

const IDENTITY = createIndicatorSessionIdentity("BTCUSDT", "15m", DEFAULT_INDICATOR_SETTINGS);

function settingsWith(overrides: Partial<IndicatorSettings>): IndicatorSettings {
  return {
    ...DEFAULT_INDICATOR_SETTINGS,
    ...overrides,
    sma: { ...DEFAULT_INDICATOR_SETTINGS.sma, ...overrides.sma },
    ema: { ...DEFAULT_INDICATOR_SETTINGS.ema, ...overrides.ema },
    rsi: { ...DEFAULT_INDICATOR_SETTINGS.rsi, ...overrides.rsi },
    macd: { ...DEFAULT_INDICATOR_SETTINGS.macd, ...overrides.macd },
    bollinger: { ...DEFAULT_INDICATOR_SETTINGS.bollinger, ...overrides.bollinger },
  };
}

describe("indicator live sessions", () => {
  it("does not read candle closes when every indicator is disabled", () => {
    const candles = [
      {
        openTime: 1,
        closeTime: 2,
        open: "1",
        high: "1",
        low: "1",
        volume: "1",
        get close(): string {
          throw new Error("disabled indicators must not read candle close");
        },
      },
    ];

    const sessions = bootstrapIndicatorSessions(candles, IDENTITY);
    expect(sessions.sma).toBeNull();
    expect(sessions.ema).toBeNull();
    expect(sessions.bollinger).toBeNull();
    expect(sessions.rsi).toBeNull();
    expect(sessions.macd).toBeNull();
  });

  it("replaces v1/v2/v3 and appends matching compute* for every indicator", () => {
    const history = indicatorCandles(["10", "11", "12", "13", "14", "15", "16", "17"]);
    const openTime = 1_000_000 + 480_000;
    const v1 = indicatorCandle(openTime, "18");
    const v2 = indicatorCandle(openTime, "30");
    const v3 = indicatorCandle(openTime, "8");
    const next = indicatorCandle(openTime + 60_000, "22");
    const identity = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({
        sma: { enabled: true, period: 3 },
        ema: { enabled: true, period: 3 },
        rsi: { enabled: true, period: 2 },
        macd: { enabled: true, fast: 2, slow: 4, signal: 2 },
        bollinger: { enabled: true, period: 3, multiplier: "2" },
      }),
    );

    const sessionV1 = bootstrapIndicatorSessions([...history, v1], identity);
    expect(sessionV1.sma?.points).toEqual(computeSma([...history, v1], 3));
    expect(sessionV1.ema?.points).toEqual(computeEma([...history, v1], 3));
    expect(sessionV1.rsi?.points).toEqual(computeRsi([...history, v1], 2));
    expect(sessionV1.macd?.points).toEqual(computeMacd([...history, v1], { fast: 2, slow: 4, signal: 2 }));
    expect(sessionV1.bollinger?.points).toEqual(computeBollinger([...history, v1], 3, "2"));
    expect(canApplyLiveReplace(sessionV1, [...history, v1])).toBe(true);

    const sessionV2 = applyLiveIndicatorReplace(sessionV1, v2);
    expect(sessionV2?.updates.unsafe).toEqual([]);
    expect(sessionV2?.sessions.sma?.points).toEqual(computeSma([...history, v2], 3));
    expect(sessionV2?.sessions.ema?.points).toEqual(computeEma([...history, v2], 3));
    expect(sessionV2?.sessions.rsi?.points).toEqual(computeRsi([...history, v2], 2));
    expect(sessionV2?.sessions.macd?.points).toEqual(computeMacd([...history, v2], { fast: 2, slow: 4, signal: 2 }));
    expect(sessionV2?.sessions.bollinger?.points).toEqual(computeBollinger([...history, v2], 3, "2"));
    expect(sessionV2?.sessions.ema?.emaThroughTMinus1?.eq(sessionV1.ema!.emaThroughTMinus1!)).toBe(true);
    expect(sessionV2?.sessions.rsi?.avgGainThroughTMinus1?.eq(sessionV1.rsi!.avgGainThroughTMinus1!)).toBe(
      true,
    );
    expect(sessionV2?.sessions.macd?.fast.emaThroughTMinus1?.eq(sessionV1.macd!.fast.emaThroughTMinus1!)).toBe(
      true,
    );

    const sessionV3 = applyLiveIndicatorReplace(sessionV2!.sessions, v3);
    expect(sessionV3?.sessions.sma?.points).toEqual(computeSma([...history, v3], 3));
    expect(sessionV3?.sessions.ema?.points).toEqual(computeEma([...history, v3], 3));
    expect(sessionV3?.sessions.rsi?.points).toEqual(computeRsi([...history, v3], 2));
    expect(sessionV3?.sessions.macd?.points).toEqual(computeMacd([...history, v3], { fast: 2, slow: 4, signal: 2 }));
    expect(sessionV3?.sessions.bollinger?.points).toEqual(computeBollinger([...history, v3], 3, "2"));
    expect(canApplyLiveAppend(sessionV3!.sessions, history.length + 1, [...history, v3, next])).toBe(true);

    const appended = applyLiveIndicatorAppend(sessionV3!.sessions, next);
    expect(appended?.updates.unsafe).toEqual([]);
    expect(appended?.sessions.sma?.points).toEqual(computeSma([...history, v3, next], 3));
    expect(appended?.sessions.ema?.points).toEqual(computeEma([...history, v3, next], 3));
    expect(appended?.sessions.rsi?.points).toEqual(computeRsi([...history, v3, next], 2));
    expect(appended?.sessions.macd?.points).toEqual(
      computeMacd([...history, v3, next], { fast: 2, slow: 4, signal: 2 }),
    );
    expect(appended?.sessions.bollinger?.points).toEqual(computeBollinger([...history, v3, next], 3, "2"));
  });

  it("does not invent a warm-up point", () => {
    const candles = indicatorCandles(["1", "2"]);
    const identity = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({ sma: { enabled: true, period: 5 } }),
    );
    const sessions = bootstrapIndicatorSessions(candles, identity);
    expect(sessions.sma?.latestPoint).toBeNull();
    const replaced = applyLiveIndicatorReplace(sessions, {
      ...candles[1]!,
      close: "9",
    });
    expect(replaced?.updates.sma).toBeNull();
    expect(replaced?.updates.unsafe).toEqual([]);
  });

  it("rebuilds only the indicator whose params changed", () => {
    const candles = indicatorCandles(["1", "2", "3", "4", "5"]);
    const smaEma = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({
        sma: { enabled: true, period: 2 },
        ema: { enabled: true, period: 2 },
      }),
    );
    const previous = bootstrapIndicatorSessions(candles, smaEma);
    const nextIdentity = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({
        sma: { enabled: true, period: 3 },
        ema: { enabled: true, period: 2 },
      }),
    );
    const reconciled = reconcileIndicatorSettings(previous, candles, nextIdentity);
    expect(reconciled.rebuilt).toEqual(["sma"]);
    expect(reconciled.sessions.ema).toBe(previous.ema);
    expect(reconciled.sessions.sma?.points).toEqual(computeSma(candles, 3));
  });

  it("drops a disabled session and bootstraps on re-enable", () => {
    const candles = indicatorCandles(["1", "2", "3", "4"]);
    const enabled = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({ sma: { enabled: true, period: 2 } }),
    );
    const previous = bootstrapIndicatorSessions(candles, enabled);
    const disabled = reconcileIndicatorSettings(
      previous,
      candles,
      createIndicatorSessionIdentity("BTCUSDT", "15m", DEFAULT_INDICATOR_SETTINGS),
    );
    expect(disabled.sessions.sma).toBeNull();
    expect(disabled.rebuilt).toEqual([]);

    const reenabled = reconcileIndicatorSettings(disabled.sessions, candles, enabled);
    expect(reenabled.rebuilt).toEqual(["sma"]);
    expect(reenabled.sessions.sma).not.toBe(previous.sma);
    expect(reenabled.sessions.sma?.points).toEqual(computeSma(candles, 2));
  });

  it("does not resurrect a previous-interval session", () => {
    const candles = indicatorCandles(["1", "2", "3", "4"]);
    const fifteen = createIndicatorSessionIdentity(
      "BTCUSDT",
      "15m",
      settingsWith({ sma: { enabled: true, period: 2 } }),
    );
    const previous = bootstrapIndicatorSessions(candles, fifteen);
    const hourly = reconcileIndicatorSettings(
      previous,
      candles,
      createIndicatorSessionIdentity(
        "BTCUSDT",
        "1h",
        settingsWith({ sma: { enabled: true, period: 2 } }),
      ),
    );
    expect(hourly.rebuilt).toEqual(["sma"]);
    expect(hourly.sessions.sma).not.toBe(previous.sma);
    expect(hourly.sessions.identity.interval).toBe("1h");
  });

  it("classifies classifier update outputs into replace, append, or rebuild", () => {
    expect(classifyLiveIndicatorPath("update", 10, 10)).toBe("replace");
    expect(classifyLiveIndicatorPath("update", 10, 11)).toBe("append");
    expect(classifyLiveIndicatorPath("update", 10, 10_000)).toBe("rebuild");
    expect(classifyLiveIndicatorPath("setData", 10, 10)).toBe("rebuild");
  });
});
