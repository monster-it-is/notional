import { useEffect, useState } from "react";

import type { ConnectionStatus } from "../realtime/reconnect.ts";

/**
 * Trade-desk mark freshness uses the same 10s window as the API default
 * MARKET_DATA_MARK_STALE_MS. Not shared with landing on purpose.
 */
export const TRADE_MARK_STALE_MS = 10_000;

export type TradeFeedState = "live" | "connecting" | "stale" | "disconnected" | "waiting";

export function resolveTradeFeedState(input: {
  status: ConnectionStatus;
  markEventTime: number | undefined;
  now: number;
}): TradeFeedState {
  const hasMark = input.markEventTime !== undefined;
  const fresh =
    input.markEventTime !== undefined && input.now - input.markEventTime < TRADE_MARK_STALE_MS;

  if (input.status === "ready") {
    if (fresh) {
      return "live";
    }

    return hasMark ? "stale" : "waiting";
  }

  if (
    input.status === "connecting" ||
    input.status === "open_awaiting_hello" ||
    input.status === "reconnecting"
  ) {
    return hasMark ? "stale" : "connecting";
  }

  if (
    input.status === "closed" ||
    input.status === "auth_expired" ||
    input.status === "protocol_error"
  ) {
    return hasMark ? "stale" : "disconnected";
  }

  return hasMark ? "stale" : "waiting";
}

export function tradeFeedStatusLabel(state: TradeFeedState): string {
  if (state === "live") {
    return "Live";
  }

  if (state === "stale") {
    return "Stale";
  }

  if (state === "connecting") {
    return "Connecting";
  }

  if (state === "waiting") {
    return "Waiting";
  }

  return "Disconnected";
}

export function msUntilTradeMarkStale(markEventTime: number, now: number): number {
  const deadline = markEventTime + TRADE_MARK_STALE_MS;
  if (now >= deadline) {
    return 0;
  }

  return deadline - now;
}

export function useTradeFeedState(
  status: ConnectionStatus,
  markEventTime: number | undefined,
): TradeFeedState {
  const [deadlineTick, setDeadlineTick] = useState(0);

  useEffect(() => {
    if (markEventTime === undefined) {
      return;
    }

    const delay = msUntilTradeMarkStale(markEventTime, Date.now());
    if (delay === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setDeadlineTick((tick) => tick + 1);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [markEventTime, status]);

  void deadlineTick;

  return resolveTradeFeedState({
    status,
    markEventTime,
    now: Date.now(),
  });
}
