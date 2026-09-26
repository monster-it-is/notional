import { useMutation, useQueryClient } from "@tanstack/react-query";

import { claimFaucet } from "../lib/api/account.ts";
import { isApiError } from "../lib/api/errors.ts";
import {
  effectiveNextEligibleAt,
  useFaucetEligibility,
} from "../lib/faucet-eligibility.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { invalidateAfterFaucet } from "../realtime/invalidate.ts";
import { Button } from "./ui/Button.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";

export function FaucetCard({
  lastFaucetClaimAt,
  suspended,
}: {
  lastFaucetClaimAt: string | null;
  suspended: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    retry: false,
    mutationFn: claimFaucet,
    onSuccess: () => {
      invalidateAfterFaucet(queryClient);
    },
  });

  const cooldownErrorNextClaimAt =
    mutation.isError && isApiError(mutation.error) && mutation.error.code === "FAUCET_COOLDOWN"
      ? (mutation.error.nextClaimAt ?? null)
      : null;
  const suspendedError =
    mutation.isError && isApiError(mutation.error) && mutation.error.code === "ACCOUNT_SUSPENDED";
  const otherError =
    mutation.isError &&
    !(isApiError(mutation.error) && mutation.error.code === "FAUCET_COOLDOWN") &&
    !suspendedError;
  const showSuspended = suspended || suspendedError;

  const mutationLastFaucetClaimAt =
    mutation.isSuccess && mutation.data.lastFaucetClaimAt ? mutation.data.lastFaucetClaimAt : null;

  const nextEligibleAt = effectiveNextEligibleAt({
    cooldownErrorNextClaimAt,
    mutationLastFaucetClaimAt,
    accountLastFaucetClaimAt: lastFaucetClaimAt,
  });
  const eligible = useFaucetEligibility(nextEligibleAt);
  const lastClaimAt = mutationLastFaucetClaimAt ?? lastFaucetClaimAt;

  return (
    <div className="space-y-3">
      <p className="text-sm text-secondary">
        Virtual USDT for paper trading. Not withdrawable. Credit amount is set by the server.
      </p>
      <p className="text-sm text-secondary">
        Last claim: {lastClaimAt ? formatTimestamp(lastClaimAt) : "never"}
      </p>
      {mutation.isSuccess ? (
        <p className="text-sm text-secondary">Virtual USDT credited.</p>
      ) : null}
      {showSuspended ? (
        <p className="text-sm text-secondary">
          Faucet is unavailable while this paper account is suspended.
        </p>
      ) : null}
      {otherError ? <ErrorBanner error={mutation.error} /> : null}
      {!showSuspended && !eligible && nextEligibleAt ? (
        <p className="text-sm text-secondary">Next claim {formatTimestamp(nextEligibleAt)}</p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={showSuspended || mutation.isPending || !eligible}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Claiming…" : "Claim virtual USDT"}
      </Button>
    </div>
  );
}
