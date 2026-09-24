import { describe, expect, it } from "vitest";

import {
  LANDING_MARK_STALE_MS,
  landingFeedStatusLabel,
  resolveLandingFeedState,
} from "./landing-feed-state.ts";

const now = 1_700_000_000_000;

describe("resolveLandingFeedState", () => {
  it("is waiting with no mark while idle", () => {
    expect(
      resolveLandingFeedState({ status: "idle", markEventTime: undefined, now }),
    ).toBe("waiting");
    expect(landingFeedStatusLabel("waiting")).toBe("Waiting for the market feed");
  });

  it("is connecting until a mark arrives", () => {
    expect(
      resolveLandingFeedState({ status: "connecting", markEventTime: undefined, now }),
    ).toBe("connecting");
    expect(
      resolveLandingFeedState({
        status: "open_awaiting_hello",
        markEventTime: undefined,
        now,
      }),
    ).toBe("connecting");
    expect(landingFeedStatusLabel("connecting")).toBe("Connecting to the market feed");
  });

  it("is live only when the socket is ready and the mark is within the freshness window", () => {
    expect(
      resolveLandingFeedState({
        status: "ready",
        markEventTime: now,
        now,
      }),
    ).toBe("live");
    expect(
      resolveLandingFeedState({
        status: "ready",
        markEventTime: now - LANDING_MARK_STALE_MS,
        now,
      }),
    ).toBe("live");
    expect(landingFeedStatusLabel("live")).toBe("Live market");
  });

  it("treats a cached quote as stale when the socket is not ready", () => {
    const cached = now - 1_000;

    expect(
      resolveLandingFeedState({ status: "idle", markEventTime: cached, now }),
    ).toBe("stale");
    expect(
      resolveLandingFeedState({ status: "connecting", markEventTime: cached, now }),
    ).toBe("stale");
    expect(
      resolveLandingFeedState({ status: "reconnecting", markEventTime: cached, now }),
    ).toBe("stale");
    expect(
      resolveLandingFeedState({ status: "closed", markEventTime: cached, now }),
    ).toBe("stale");
    expect(landingFeedStatusLabel("stale")).not.toBe("Live market");
  });

  it("treats a ready socket with an aged mark as stale", () => {
    expect(
      resolveLandingFeedState({
        status: "ready",
        markEventTime: now - LANDING_MARK_STALE_MS - 1,
        now,
      }),
    ).toBe("stale");
  });

  it("does not label disconnected or protocol-error feeds as live", () => {
    expect(
      resolveLandingFeedState({ status: "closed", markEventTime: undefined, now }),
    ).toBe("disconnected");
    expect(
      resolveLandingFeedState({
        status: "protocol_error",
        markEventTime: now,
        now,
      }),
    ).toBe("error");
    expect(landingFeedStatusLabel("disconnected")).toBe("Market disconnected");
    expect(landingFeedStatusLabel("error")).toBe("Market feed error");
    expect(landingFeedStatusLabel("disconnected")).not.toBe("Live market");
    expect(landingFeedStatusLabel("error")).not.toBe("Live market");
  });
});
