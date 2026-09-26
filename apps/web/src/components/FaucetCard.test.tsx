import type { AccountResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FaucetCard } from "./FaucetCard.tsx";
import { claimFaucet } from "../lib/api/account.ts";
import { ApiError } from "../lib/api/errors.ts";
import {
  FAUCET_COOLDOWN_MS,
  nextEligibleFromLastClaimAt,
} from "../lib/faucet-eligibility.ts";
import { formatTimestamp } from "../lib/format-timestamp.ts";
import { invalidateAfterFaucet } from "../realtime/invalidate.ts";

vi.mock("../lib/api/account.ts", () => ({
  claimFaucet: vi.fn(),
}));

vi.mock("../realtime/invalidate.ts", () => ({
  invalidateAfterFaucet: vi.fn(),
}));

const mockedClaim = vi.mocked(claimFaucet);
const mockedInvalidate = vi.mocked(invalidateAfterFaucet);

const claimedAt = "2026-01-01T00:00:00.000Z";

const account: AccountResponse = {
  id: "a",
  userId: "u",
  currency: "USDT",
  balance: "1100",
  status: "ACTIVE",
  lastFaucetClaimAt: claimedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderFaucet(
  props: { lastFaucetClaimAt: string | null; suspended?: boolean },
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <FaucetCard lastFaucetClaimAt={props.lastFaucetClaimAt} suspended={props.suspended ?? false} />
    </QueryClientProvider>,
  );

  return { ...view, client };
}

describe("FaucetCard", () => {
  beforeEach(() => {
    mockedClaim.mockReset();
    mockedInvalidate.mockReset();
  });

  it("enables Claim virtual USDT when there is no last claim", () => {
    renderFaucet({ lastFaucetClaimAt: null });

    const button = screen.getByRole("button", { name: "Claim virtual USDT" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByText("Last claim: never")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Virtual USDT for paper trading. Not withdrawable. Credit amount is set by the server.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/100\s*USDT/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim faucet" })).not.toBeInTheDocument();
  });

  it("disables the claim from a derived cooldown before any POST", () => {
    renderFaucet({ lastFaucetClaimAt: new Date().toISOString() });

    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(screen.getByText(/Next claim /)).toBeInTheDocument();
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("shows Claiming… and disables while the request is pending", async () => {
    const user = userEvent.setup();
    mockedClaim.mockReturnValue(new Promise(() => undefined));
    renderFaucet({ lastFaucetClaimAt: null });

    await user.click(screen.getByRole("button", { name: "Claim virtual USDT" }));

    const pending = await screen.findByRole("button", { name: "Claiming…" });
    expect(pending).toBeDisabled();
  });

  it("uses the success lastFaucetClaimAt immediately and still invalidates", async () => {
    const user = userEvent.setup();
    const justClaimed = new Date().toISOString();
    const nextClaim = nextEligibleFromLastClaimAt(justClaimed);
    mockedClaim.mockResolvedValue({ ...account, lastFaucetClaimAt: justClaimed });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = renderFaucet({ lastFaucetClaimAt: null }, client);

    await user.click(screen.getByRole("button", { name: "Claim virtual USDT" }));

    expect(await screen.findByText("Virtual USDT credited.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(screen.getByText(`Next claim ${formatTimestamp(nextClaim ?? "")}`)).toBeInTheDocument();
    expect(screen.getByText(`Last claim: ${formatTimestamp(justClaimed)}`)).toBeInTheDocument();
    expect(mockedInvalidate).toHaveBeenCalledTimes(1);

    rerender(
      <QueryClientProvider client={client}>
        <FaucetCard lastFaucetClaimAt={null} suspended={false} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(screen.getByText("Virtual USDT credited.")).toBeInTheDocument();
  });

  it("shows the server nextClaimAt on FAUCET_COOLDOWN without a generic banner", async () => {
    const user = userEvent.setup();
    const nextClaimAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockedClaim.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "FAUCET_COOLDOWN",
        nextClaimAt,
      }),
    );
    renderFaucet({ lastFaucetClaimAt: null });

    await user.click(screen.getByRole("button", { name: "Claim virtual USDT" }));

    expect(await screen.findByText(`Next claim ${formatTimestamp(nextClaimAt)}`)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("FAUCET_COOLDOWN")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
  });

  it("shows ErrorBanner for other API errors", async () => {
    const user = userEvent.setup();
    mockedClaim.mockRejectedValue(
      new ApiError({ status: 503, code: "FUNDING_DATA_UNAVAILABLE" }),
    );
    renderFaucet({ lastFaucetClaimAt: null });

    await user.click(screen.getByRole("button", { name: "Claim virtual USDT" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("FUNDING_DATA_UNAVAILABLE");
  });

  it("disables the faucet while the paper account is suspended", () => {
    renderFaucet({ lastFaucetClaimAt: null, suspended: true });

    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(
      screen.getByText("Faucet is unavailable while this paper account is suspended."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("enables after a last claim that is at least 24 hours old", () => {
    const last = new Date(Date.now() - FAUCET_COOLDOWN_MS).toISOString();
    renderFaucet({ lastFaucetClaimAt: last });

    expect(screen.getByRole("button", { name: "Claim virtual USDT" })).toBeEnabled();
  });
});
