import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FAUCET_COOLDOWN_MS,
  effectiveNextEligibleAt,
  isFaucetEligible,
  nextEligibleFromLastClaimAt,
  useFaucetEligibility,
} from "./faucet-eligibility.ts";

const claimedAt = "2026-01-01T00:00:00.000Z";
const nextFromClaim = "2026-01-02T00:00:00.000Z";
const serverNext = "2026-01-03T12:00:00.000Z";
const mutationClaimedAt = "2026-01-04T08:00:00.000Z";
const nextFromMutation = "2026-01-05T08:00:00.000Z";

describe("faucet eligibility", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("treats a null last claim as eligible", () => {
    expect(effectiveNextEligibleAt({})).toBeNull();
    expect(isFaucetEligible(null, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("adds a 24-hour cooldown from last claim and allows the exact boundary", () => {
    expect(nextEligibleFromLastClaimAt(claimedAt)).toBe(nextFromClaim);
    expect(FAUCET_COOLDOWN_MS).toBe(24 * 60 * 60 * 1000);

    const boundary = Date.parse(nextFromClaim);
    expect(isFaucetEligible(nextFromClaim, boundary - 1)).toBe(false);
    expect(isFaucetEligible(nextFromClaim, boundary)).toBe(true);
  });

  it("is in cooldown before the 24-hour boundary", () => {
    const next = nextEligibleFromLastClaimAt(claimedAt);
    expect(isFaucetEligible(next, Date.parse("2026-01-01T12:00:00.000Z"))).toBe(false);
  });

  it("prefers server nextClaimAt over mutation and account last-claim times", () => {
    expect(
      effectiveNextEligibleAt({
        cooldownErrorNextClaimAt: serverNext,
        mutationLastFaucetClaimAt: mutationClaimedAt,
        accountLastFaucetClaimAt: claimedAt,
      }),
    ).toBe(serverNext);
  });

  it("prefers successful mutation lastFaucetClaimAt over the account query", () => {
    expect(
      effectiveNextEligibleAt({
        mutationLastFaucetClaimAt: mutationClaimedAt,
        accountLastFaucetClaimAt: claimedAt,
      }),
    ).toBe(nextFromMutation);
  });

  it("falls back to the account query last claim", () => {
    expect(
      effectiveNextEligibleAt({
        accountLastFaucetClaimAt: claimedAt,
      }),
    ).toBe(nextFromClaim);
  });

  it("recomputes once at the boundary with a one-shot timeout, not an interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T23:59:59.000Z"));
    const interval = vi.spyOn(globalThis, "setInterval");

    const { result } = renderHook(() => useFaucetEligibility(nextFromClaim));

    expect(result.current).toBe(false);
    expect(interval).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(true);
    expect(interval).not.toHaveBeenCalled();
  });

  it("refreshes cached time when a later nextEligibleAt is already due", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:00:00.000Z"));
    const interval = vi.spyOn(globalThis, "setInterval");

    const { result, rerender } = renderHook(
      (nextEligibleAt: string | null) => useFaucetEligibility(nextEligibleAt),
      { initialProps: null as string | null },
    );

    expect(result.current).toBe(true);

    act(() => {
      vi.setSystemTime(new Date("2026-01-01T10:10:00.000Z"));
    });

    rerender("2026-01-01T10:05:00.000Z");

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(result.current).toBe(true);
    expect(interval).not.toHaveBeenCalled();
  });
});
