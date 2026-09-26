import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionStatus } from "../realtime/reconnect.ts";
import {
  TRADE_MARK_STALE_MS,
  msUntilTradeMarkStale,
  resolveTradeFeedState,
  tradeFeedStatusLabel,
  useTradeFeedState,
} from "./trade-feed-state.ts";

const now = 1_700_000_000_000;

function Probe({
  status,
  markEventTime,
}: {
  status: ConnectionStatus;
  markEventTime: number | undefined;
}) {
  const state = useTradeFeedState(status, markEventTime);
  return <span data-testid="feed">{state}</span>;
}

describe("resolveTradeFeedState", () => {
  it("is waiting with no mark while idle", () => {
    expect(
      resolveTradeFeedState({ status: "idle", markEventTime: undefined, now }),
    ).toBe("waiting");
    expect(tradeFeedStatusLabel("waiting")).toBe("Waiting");
  });

  it("is connecting until a mark arrives", () => {
    expect(
      resolveTradeFeedState({ status: "connecting", markEventTime: undefined, now }),
    ).toBe("connecting");
    expect(
      resolveTradeFeedState({
        status: "open_awaiting_hello",
        markEventTime: undefined,
        now,
      }),
    ).toBe("connecting");
    expect(tradeFeedStatusLabel("connecting")).toBe("Connecting");
  });

  it("is live only when the socket is ready and the mark is inside the window", () => {
    expect(
      resolveTradeFeedState({
        status: "ready",
        markEventTime: now,
        now,
      }),
    ).toBe("live");
    expect(
      resolveTradeFeedState({
        status: "ready",
        markEventTime: now - (TRADE_MARK_STALE_MS - 1),
        now,
      }),
    ).toBe("live");
    expect(tradeFeedStatusLabel("live")).toBe("Live");
  });

  it("is not live at the freshness deadline", () => {
    expect(
      resolveTradeFeedState({
        status: "ready",
        markEventTime: now - TRADE_MARK_STALE_MS,
        now,
      }),
    ).toBe("stale");
  });

  it("never shows live when the socket is not ready", () => {
    expect(
      resolveTradeFeedState({
        status: "connecting",
        markEventTime: now,
        now,
      }),
    ).toBe("stale");
    expect(
      resolveTradeFeedState({
        status: "closed",
        markEventTime: now,
        now,
      }),
    ).toBe("stale");
    expect(tradeFeedStatusLabel("stale")).toBe("Stale");
  });

  it("is disconnected without a mark when the socket is down", () => {
    expect(
      resolveTradeFeedState({ status: "closed", markEventTime: undefined, now }),
    ).toBe("disconnected");
    expect(
      resolveTradeFeedState({
        status: "protocol_error",
        markEventTime: undefined,
        now,
      }),
    ).toBe("disconnected");
    expect(tradeFeedStatusLabel("disconnected")).toBe("Disconnected");
  });
});

describe("msUntilTradeMarkStale", () => {
  it("returns remaining ms until the deadline", () => {
    expect(msUntilTradeMarkStale(now, now)).toBe(TRADE_MARK_STALE_MS);
    expect(msUntilTradeMarkStale(now, now + 4_000)).toBe(6_000);
  });

  it("returns 0 when the mark is already stale", () => {
    expect(msUntilTradeMarkStale(now, now + TRADE_MARK_STALE_MS)).toBe(0);
    expect(msUntilTradeMarkStale(now, now + TRADE_MARK_STALE_MS + 1)).toBe(0);
  });
});

describe("useTradeFeedState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is live for a fresh mark while the socket is ready", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    render(<Probe status="ready" markEventTime={now} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");
  });

  it("becomes stale when the deadline elapses without a new mark", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    render(<Probe status="ready" markEventTime={now} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(TRADE_MARK_STALE_MS);
    });

    expect(screen.getByTestId("feed")).toHaveTextContent("stale");
  });

  it("is stale on the initial mount when the mark is already past the deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    render(<Probe status="ready" markEventTime={now - TRADE_MARK_STALE_MS} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("stale");
    expect(screen.getByTestId("feed")).not.toHaveTextContent("live");
  });

  it("does not render live when a fresh mark is replaced by an already-stale mark", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { rerender } = render(<Probe status="ready" markEventTime={now} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    rerender(<Probe status="ready" markEventTime={now - TRADE_MARK_STALE_MS - 1} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("stale");
    expect(screen.getByTestId("feed")).not.toHaveTextContent("live");
  });

  it("resets the deadline when a newer fresh mark arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { rerender } = render(<Probe status="ready" markEventTime={now} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    const nextMark = now + 6_000;
    rerender(<Probe status="ready" markEventTime={nextMark} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByTestId("feed")).toHaveTextContent("stale");
  });

  it("does not let an old timer stale a newer mark", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { rerender } = render(<Probe status="ready" markEventTime={now} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(9_000);
    });

    const nextMark = now + 9_000;
    rerender(<Probe status="ready" markEventTime={nextMark} />);
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId("feed")).toHaveTextContent("live");

    act(() => {
      vi.advanceTimersByTime(TRADE_MARK_STALE_MS - 1_000);
    });
    expect(screen.getByTestId("feed")).toHaveTextContent("stale");
  });
});
