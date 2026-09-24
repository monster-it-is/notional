import { useMutation, useQueryClient } from "@tanstack/react-query";

import { claimFaucet } from "../lib/api/account.ts";
import { isApiError } from "../lib/api/errors.ts";
import { invalidateAfterFaucet } from "../realtime/invalidate.ts";
import { Button } from "./ui/Button.tsx";
import { ErrorBanner } from "./ui/ErrorBanner.tsx";
import { NumericText } from "./ui/NumericText.tsx";

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

  const cooldown =
    isApiError(mutation.error) && mutation.error.code === "FAUCET_COOLDOWN"
      ? mutation.error.nextClaimAt
      : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-secondary">
        Claim virtual USDT from the paper faucet. The amount is set by the server. Last claim:{" "}
        <NumericText>{lastFaucetClaimAt ?? "never"}</NumericText>
      </p>
      {mutation.error ? <ErrorBanner error={mutation.error} /> : null}
      {cooldown ? (
        <p className="text-sm text-secondary">
          Next claim at <NumericText>{cooldown}</NumericText>
        </p>
      ) : null}
      <Button
        type="button"
        variant="primary"
        disabled={suspended || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Claiming…" : "Claim faucet"}
      </Button>
    </div>
  );
}
