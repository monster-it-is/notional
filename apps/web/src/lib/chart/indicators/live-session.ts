import type { Candle, CandleInterval } from "@notional/contracts";

import { appendBollinger, rebuildBollinger, replaceBollingerLatest, type BollingerSession } from "./bollinger.ts";
import { appendEma, rebuildEma, replaceEmaLatest, type EmaSession } from "./ema.ts";
import { appendMacd, rebuildMacd, replaceMacdLatest, type MacdSession } from "./macd.ts";
import { appendRsi, rebuildRsi, replaceRsiLatest, type RsiSession } from "./rsi.ts";
import type { IndicatorSettings } from "./settings.ts";
import { appendSma, rebuildSma, replaceSmaLatest, type SmaSession } from "./sma.ts";
import type { ExactBollingerPoint, ExactIndicatorPoint, ExactMacdPoint } from "./types.ts";

export type IndicatorKind = "sma" | "ema" | "bollinger" | "rsi" | "macd";

export type IndicatorSessionIdentity = {
  symbol: string;
  interval: CandleInterval;
  settings: IndicatorSettings;
};

export type IndicatorLiveSessions = {
  identity: IndicatorSessionIdentity;
  lastOpenTime: number | null;
  lastCount: number;
  sma: SmaSession | null;
  ema: EmaSession | null;
  bollinger: BollingerSession | null;
  rsi: RsiSession | null;
  macd: MacdSession | null;
};

export type IndicatorLiveUpdates = {
  sma?: ExactIndicatorPoint | null;
  ema?: ExactIndicatorPoint | null;
  bollinger?: ExactBollingerPoint | null;
  rsi?: ExactIndicatorPoint | null;
  macd?: ExactMacdPoint | null;
  unsafe: IndicatorKind[];
};

export type LiveIndicatorApplication = {
  sessions: IndicatorLiveSessions;
  updates: IndicatorLiveUpdates;
};

export type IndicatorSettingsReconcile = {
  sessions: IndicatorLiveSessions;
  rebuilt: IndicatorKind[];
};

const ALL_KINDS: IndicatorKind[] = ["sma", "ema", "bollinger", "rsi", "macd"];

export function createIndicatorSessionIdentity(
  symbol: string,
  interval: CandleInterval,
  settings: IndicatorSettings,
): IndicatorSessionIdentity {
  return { symbol, interval, settings };
}

export function emptyIndicatorSessions(identity: IndicatorSessionIdentity): IndicatorLiveSessions {
  return {
    identity,
    lastOpenTime: null,
    lastCount: 0,
    sma: null,
    ema: null,
    bollinger: null,
    rsi: null,
    macd: null,
  };
}

export function anyIndicatorEnabled(settings: IndicatorSettings): boolean {
  return (
    settings.sma.enabled ||
    settings.ema.enabled ||
    settings.rsi.enabled ||
    settings.macd.enabled ||
    settings.bollinger.enabled
  );
}

export function bootstrapIndicatorSessions(
  candles: readonly Candle[],
  identity: IndicatorSessionIdentity,
): IndicatorLiveSessions {
  const last = candles[candles.length - 1];

  return {
    identity,
    lastOpenTime: last?.openTime ?? null,
    lastCount: candles.length,
    sma: identity.settings.sma.enabled ? rebuildSma(candles, identity.settings.sma.period) : null,
    ema: identity.settings.ema.enabled ? rebuildEma(candles, identity.settings.ema.period) : null,
    bollinger: identity.settings.bollinger.enabled
      ? rebuildBollinger(
          candles,
          identity.settings.bollinger.period,
          identity.settings.bollinger.multiplier,
        )
      : null,
    rsi: identity.settings.rsi.enabled ? rebuildRsi(candles, identity.settings.rsi.period) : null,
    macd: identity.settings.macd.enabled ? rebuildMacd(candles, identity.settings.macd) : null,
  };
}

export function reconcileIndicatorSettings(
  previous: IndicatorLiveSessions | null,
  candles: readonly Candle[],
  identity: IndicatorSessionIdentity,
): IndicatorSettingsReconcile {
  if (
    !previous ||
    previous.identity.symbol !== identity.symbol ||
    previous.identity.interval !== identity.interval
  ) {
    return {
      sessions: bootstrapIndicatorSessions(candles, identity),
      rebuilt: enabledKinds(identity.settings),
    };
  }

  const rebuilt: IndicatorKind[] = [];
  const sessions: IndicatorLiveSessions = {
    identity,
    lastOpenTime: previous.lastOpenTime,
    lastCount: previous.lastCount,
    sma: previous.sma,
    ema: previous.ema,
    bollinger: previous.bollinger,
    rsi: previous.rsi,
    macd: previous.macd,
  };

  if (!identity.settings.sma.enabled) {
    sessions.sma = null;
  } else if (
    !previous.identity.settings.sma.enabled ||
    previous.identity.settings.sma.period !== identity.settings.sma.period ||
    !previous.sma
  ) {
    sessions.sma = rebuildSma(candles, identity.settings.sma.period);
    rebuilt.push("sma");
  }

  if (!identity.settings.ema.enabled) {
    sessions.ema = null;
  } else if (
    !previous.identity.settings.ema.enabled ||
    previous.identity.settings.ema.period !== identity.settings.ema.period ||
    !previous.ema
  ) {
    sessions.ema = rebuildEma(candles, identity.settings.ema.period);
    rebuilt.push("ema");
  }

  if (!identity.settings.bollinger.enabled) {
    sessions.bollinger = null;
  } else if (
    !previous.identity.settings.bollinger.enabled ||
    previous.identity.settings.bollinger.period !== identity.settings.bollinger.period ||
    previous.identity.settings.bollinger.multiplier !== identity.settings.bollinger.multiplier ||
    !previous.bollinger
  ) {
    sessions.bollinger = rebuildBollinger(
      candles,
      identity.settings.bollinger.period,
      identity.settings.bollinger.multiplier,
    );
    rebuilt.push("bollinger");
  }

  if (!identity.settings.rsi.enabled) {
    sessions.rsi = null;
  } else if (
    !previous.identity.settings.rsi.enabled ||
    previous.identity.settings.rsi.period !== identity.settings.rsi.period ||
    !previous.rsi
  ) {
    sessions.rsi = rebuildRsi(candles, identity.settings.rsi.period);
    rebuilt.push("rsi");
  }

  if (!identity.settings.macd.enabled) {
    sessions.macd = null;
  } else if (
    !previous.identity.settings.macd.enabled ||
    previous.identity.settings.macd.fast !== identity.settings.macd.fast ||
    previous.identity.settings.macd.slow !== identity.settings.macd.slow ||
    previous.identity.settings.macd.signal !== identity.settings.macd.signal ||
    !previous.macd
  ) {
    sessions.macd = rebuildMacd(candles, identity.settings.macd);
    rebuilt.push("macd");
  }

  const last = candles[candles.length - 1];
  sessions.lastOpenTime = last?.openTime ?? null;
  sessions.lastCount = candles.length;
  return { sessions, rebuilt };
}

export function sessionsAgreeWithCanonical(
  sessions: IndicatorLiveSessions,
  candles: readonly Candle[],
): boolean {
  const last = candles[candles.length - 1];

  if (sessions.lastCount !== candles.length || (last?.openTime ?? null) !== sessions.lastOpenTime) {
    return false;
  }

  return latestSessionsMatchOpenTime(sessions, last?.openTime ?? null);
}

export function canApplyLiveReplace(
  sessions: IndicatorLiveSessions,
  candles: readonly Candle[],
): boolean {
  return sessionsAgreeWithCanonical(sessions, candles);
}

export function canApplyLiveAppend(
  sessions: IndicatorLiveSessions,
  previousLength: number,
  candles: readonly Candle[],
): boolean {
  const last = candles[candles.length - 1];

  if (
    sessions.lastCount !== previousLength ||
    !last ||
    sessions.lastOpenTime === null ||
    last.openTime <= sessions.lastOpenTime
  ) {
    return false;
  }

  return latestSessionsMatchOpenTime(sessions, sessions.lastOpenTime);
}

export function classifyLiveIndicatorPath(
  chartMutation: "update" | "setData",
  previousLength: number,
  nextLength: number,
): "replace" | "append" | "rebuild" {
  if (chartMutation !== "update") {
    return "rebuild";
  }

  if (previousLength === nextLength) {
    return "replace";
  }

  if (nextLength === previousLength + 1) {
    return "append";
  }

  return "rebuild";
}

export function applyLiveIndicatorReplace(
  sessions: IndicatorLiveSessions,
  candle: Candle,
): LiveIndicatorApplication | null {
  return applyLiveIndicatorMutation(sessions, candle, "replace");
}

export function applyLiveIndicatorAppend(
  sessions: IndicatorLiveSessions,
  candle: Candle,
): LiveIndicatorApplication | null {
  return applyLiveIndicatorMutation(sessions, candle, "append");
}

function applyLiveIndicatorMutation(
  sessions: IndicatorLiveSessions,
  candle: Candle,
  mode: "replace" | "append",
): LiveIndicatorApplication | null {
  const settings = sessions.identity.settings;
  const updates: IndicatorLiveUpdates = { unsafe: [] };
  const next: IndicatorLiveSessions = {
    identity: sessions.identity,
    lastOpenTime: candle.openTime,
    lastCount: mode === "append" ? sessions.lastCount + 1 : sessions.lastCount,
    sma: sessions.sma,
    ema: sessions.ema,
    bollinger: sessions.bollinger,
    rsi: sessions.rsi,
    macd: sessions.macd,
  };

  if (settings.sma.enabled) {
    if (!sessions.sma) {
      return null;
    }

    const sma = mode === "replace" ? replaceSmaLatest(sessions.sma, candle) : appendSma(sessions.sma, candle);

    if (!sma) {
      return null;
    }

    next.sma = sma;
    updates.sma = sma.latestPoint;
    pushUnsafe(updates.unsafe, "sma", sessions.sma.latestPoint, sma.latestPoint);
  } else {
    next.sma = null;
  }

  if (settings.ema.enabled) {
    if (!sessions.ema) {
      return null;
    }

    const ema = mode === "replace" ? replaceEmaLatest(sessions.ema, candle) : appendEma(sessions.ema, candle);

    if (!ema) {
      return null;
    }

    next.ema = ema;
    updates.ema = ema.latestPoint;
    pushUnsafe(updates.unsafe, "ema", sessions.ema.latestPoint, ema.latestPoint);
  } else {
    next.ema = null;
  }

  if (settings.bollinger.enabled) {
    if (!sessions.bollinger) {
      return null;
    }

    const bollinger =
      mode === "replace"
        ? replaceBollingerLatest(sessions.bollinger, candle)
        : appendBollinger(sessions.bollinger, candle);

    if (!bollinger) {
      return null;
    }

    next.bollinger = bollinger;
    updates.bollinger = bollinger.latestPoint;
    pushUnsafe(updates.unsafe, "bollinger", sessions.bollinger.latestPoint, bollinger.latestPoint);
  } else {
    next.bollinger = null;
  }

  if (settings.rsi.enabled) {
    if (!sessions.rsi) {
      return null;
    }

    const rsi = mode === "replace" ? replaceRsiLatest(sessions.rsi, candle) : appendRsi(sessions.rsi, candle);

    if (!rsi) {
      return null;
    }

    next.rsi = rsi;
    updates.rsi = rsi.latestPoint;
    pushUnsafe(updates.unsafe, "rsi", sessions.rsi.latestPoint, rsi.latestPoint);
  } else {
    next.rsi = null;
  }

  if (settings.macd.enabled) {
    if (!sessions.macd) {
      return null;
    }

    const macd =
      mode === "replace" ? replaceMacdLatest(sessions.macd, candle) : appendMacd(sessions.macd, candle);

    if (!macd) {
      return null;
    }

    next.macd = macd;
    const previousLatest = sessions.macd.points[sessions.macd.points.length - 1];
    const latest = macd.points[macd.points.length - 1];
    const latestForCandle = latest && latest.openTime === candle.openTime ? latest : null;
    updates.macd = latestForCandle;
    pushUnsafe(updates.unsafe, "macd", previousLatest?.openTime === candle.openTime ? previousLatest : null, latestForCandle);

    if (previousLatest && latestForCandle) {
      if (previousLatest.signal !== undefined && latestForCandle.signal === undefined) {
        pushUnsafeKind(updates.unsafe, "macd");
      }

      if (previousLatest.histogram !== undefined && latestForCandle.histogram === undefined) {
        pushUnsafeKind(updates.unsafe, "macd");
      }
    }
  } else {
    next.macd = null;
  }

  return { sessions: next, updates };
}

export function rebuildIndicatorKind(
  sessions: IndicatorLiveSessions,
  candles: readonly Candle[],
  kind: IndicatorKind,
): IndicatorLiveSessions {
  const next: IndicatorLiveSessions = {
    ...sessions,
    lastOpenTime: candles[candles.length - 1]?.openTime ?? null,
    lastCount: candles.length,
  };
  const settings = sessions.identity.settings;

  if (kind === "sma") {
    next.sma = settings.sma.enabled ? rebuildSma(candles, settings.sma.period) : null;
  } else if (kind === "ema") {
    next.ema = settings.ema.enabled ? rebuildEma(candles, settings.ema.period) : null;
  } else if (kind === "bollinger") {
    next.bollinger = settings.bollinger.enabled
      ? rebuildBollinger(candles, settings.bollinger.period, settings.bollinger.multiplier)
      : null;
  } else if (kind === "rsi") {
    next.rsi = settings.rsi.enabled ? rebuildRsi(candles, settings.rsi.period) : null;
  } else {
    next.macd = settings.macd.enabled ? rebuildMacd(candles, settings.macd) : null;
  }

  return next;
}

export function enabledKinds(settings: IndicatorSettings): IndicatorKind[] {
  return ALL_KINDS.filter((kind) => {
    if (kind === "sma") {
      return settings.sma.enabled;
    }

    if (kind === "ema") {
      return settings.ema.enabled;
    }

    if (kind === "bollinger") {
      return settings.bollinger.enabled;
    }

    if (kind === "rsi") {
      return settings.rsi.enabled;
    }

    return settings.macd.enabled;
  });
}

function latestSessionsMatchOpenTime(
  sessions: IndicatorLiveSessions,
  openTime: number | null,
): boolean {
  if (openTime === null) {
    return true;
  }

  if (sessions.sma && sessions.sma.latest?.openTime !== openTime) {
    return false;
  }

  if (sessions.ema && sessions.ema.latest?.openTime !== openTime) {
    return false;
  }

  if (sessions.bollinger && sessions.bollinger.latest?.openTime !== openTime) {
    return false;
  }

  if (sessions.rsi && sessions.rsi.latest?.openTime !== openTime) {
    return false;
  }

  if (sessions.macd && sessions.macd.fast.latest?.openTime !== openTime) {
    return false;
  }

  return true;
}

function pushUnsafeKind(unsafe: IndicatorKind[], kind: IndicatorKind): void {
  if (!unsafe.includes(kind)) {
    unsafe.push(kind);
  }
}

function pushUnsafe<T>(
  unsafe: IndicatorKind[],
  kind: IndicatorKind,
  previous: T | null | undefined,
  next: T | null | undefined,
): void {
  if (previous != null && next == null) {
    pushUnsafeKind(unsafe, kind);
  }
}
