import type { ConnectionStatus } from "../../realtime/reconnect.ts";

/**
 * Landing mark freshness uses the same 10s window as the API default
 * MARKET_DATA_MARK_STALE_MS. Compared against market.mark markEventTime.
 */
export const LANDING_MARK_STALE_MS = 10_000;

export type LandingFeedState =
  | "waiting"
  | "connecting"
  | "live"
  | "stale"
  | "disconnected"
  | "error";

export function resolveLandingFeedState(input: {
  status: ConnectionStatus;
  markEventTime: number | undefined;
  now: number;
}): LandingFeedState {
  const hasMark = input.markEventTime !== undefined;
  const fresh =
    input.markEventTime !== undefined &&
    input.now - input.markEventTime <= LANDING_MARK_STALE_MS;

  if (input.status === "protocol_error") {
    return "error";
  }

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

  if (input.status === "closed" || input.status === "auth_expired") {
    return hasMark ? "stale" : "disconnected";
  }

  return hasMark ? "stale" : "waiting";
}

export function landingFeedStatusLabel(state: LandingFeedState): string {
  if (state === "live") {
    return "Live market";
  }

  if (state === "stale") {
    return "Stale market";
  }

  if (state === "connecting") {
    return "Connecting to the market feed";
  }

  if (state === "waiting") {
    return "Waiting for the market feed";
  }

  if (state === "error") {
    return "Market feed error";
  }

  return "Market disconnected";
}

export function isLandingFeedLive(state: LandingFeedState): boolean {
  return state === "live";
}
