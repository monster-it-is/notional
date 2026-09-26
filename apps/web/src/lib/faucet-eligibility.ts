import { useEffect, useState } from "react";

export const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type FaucetEligibilitySources = {
  cooldownErrorNextClaimAt?: string | null;
  mutationLastFaucetClaimAt?: string | null;
  accountLastFaucetClaimAt?: string | null;
};

export function nextEligibleFromLastClaimAt(lastFaucetClaimAt: string): string | null {
  const claimedMs = Date.parse(lastFaucetClaimAt);

  if (Number.isNaN(claimedMs)) {
    return null;
  }

  return new Date(claimedMs + FAUCET_COOLDOWN_MS).toISOString();
}

export function effectiveNextEligibleAt(sources: FaucetEligibilitySources): string | null {
  if (sources.cooldownErrorNextClaimAt) {
    return sources.cooldownErrorNextClaimAt;
  }

  if (sources.mutationLastFaucetClaimAt) {
    return nextEligibleFromLastClaimAt(sources.mutationLastFaucetClaimAt);
  }

  if (sources.accountLastFaucetClaimAt) {
    return nextEligibleFromLastClaimAt(sources.accountLastFaucetClaimAt);
  }

  return null;
}

export function isFaucetEligible(nextEligibleAt: string | null, nowMs: number): boolean {
  if (nextEligibleAt === null) {
    return true;
  }

  const nextMs = Date.parse(nextEligibleAt);

  if (Number.isNaN(nextMs)) {
    return true;
  }

  return nextMs <= nowMs;
}

export function useFaucetEligibility(nextEligibleAt: string | null): boolean {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (nextEligibleAt === null) {
      return;
    }

    const nextMs = Date.parse(nextEligibleAt);

    if (Number.isNaN(nextMs)) {
      return;
    }

    const remaining = nextMs - Date.now();
    const maxTimeoutMs = 2_147_483_647;

    if (remaining > maxTimeoutMs) {
      return;
    }

    const delay = remaining <= 0 ? 0 : remaining;
    const timer = setTimeout(() => {
      setNowMs(Date.now());
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [nextEligibleAt]);

  return isFaucetEligible(nextEligibleAt, nowMs);
}
