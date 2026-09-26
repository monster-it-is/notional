import type { FundingEventResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { WalletFundingTable } from "./WalletFundingTable.tsx";
import { getWalletFunding } from "../lib/api/account.ts";
import { ApiError } from "../lib/api/errors.ts";

vi.mock("../lib/api/account.ts", () => ({
  getWalletFunding: vi.fn(),
}));

const mocked = vi.mocked(getWalletFunding);

const signup: FundingEventResponse = {
  id: "e-signup",
  type: "SIGNUP_ALLOCATION",
  amount: "1000",
  currency: "USDT",
  createdAt: "2024-01-02T03:04:05.123Z",
};

const faucet: FundingEventResponse = {
  id: "e-faucet",
  type: "FAUCET_CLAIM",
  amount: "100.5000",
  currency: "USDT",
  createdAt: "2024-01-03T03:04:05.123Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("WalletFundingTable", () => {
  it("labels events, formats timestamps, and prefixes exact credit amounts", async () => {
    mocked.mockResolvedValue({ events: [faucet, signup] });
    render(<WalletFundingTable limit={50} offset={0} />, { wrapper });

    expect(await screen.findByRole("columnheader", { name: "Event" })).toBeInTheDocument();
    expect(screen.getByText("Signup allocation")).toBeInTheDocument();
    expect(screen.getByText("Faucet claim")).toBeInTheDocument();
    expect(screen.getByText("2024-01-02 03:04:05 UTC")).toBeInTheDocument();
    expect(screen.getByText("2024-01-03 03:04:05 UTC")).toBeInTheDocument();
    expect(screen.getByText("+1,000.00 USDT")).toBeInTheDocument();
    expect(screen.getByText("+100.50 USDT")).toHaveClass("text-positive");
    expect(screen.queryByText("SIGNUP_ALLOCATION")).not.toBeInTheDocument();
    expect(screen.queryByText("FAUCET_CLAIM")).not.toBeInTheDocument();
  });

  it("shows the first-page empty copy", async () => {
    mocked.mockResolvedValue({ events: [] });
    render(<WalletFundingTable limit={50} offset={0} />, { wrapper });
    expect(await screen.findByText("No wallet funding events.")).toBeInTheDocument();
  });

  it("shows the trailing-page empty copy", async () => {
    mocked.mockResolvedValue({ events: [] });
    render(<WalletFundingTable limit={50} offset={50} />, { wrapper });
    expect(await screen.findByText("No more wallet funding events.")).toBeInTheDocument();
  });

  it("shows loading and error states", async () => {
    mocked.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(<WalletFundingTable limit={50} offset={0} />, { wrapper });
    expect(screen.getByText("Loading wallet funding…")).toBeInTheDocument();
    unmount();

    mocked.mockRejectedValue(new ApiError({ status: 500, code: "REQUEST_FAILED" }));
    render(<WalletFundingTable limit={50} offset={0} />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("REQUEST_FAILED");
  });

  it("reports row count on success and null while unresolved", async () => {
    const onRowCountChange = vi.fn();
    mocked.mockReturnValue(new Promise(() => undefined));
    const { unmount } = render(
      <WalletFundingTable limit={50} offset={0} onRowCountChange={onRowCountChange} />,
      { wrapper },
    );
    await waitFor(() => expect(onRowCountChange).toHaveBeenCalledWith(null));
    unmount();

    mocked.mockResolvedValue({ events: [signup, faucet] });
    render(
      <WalletFundingTable limit={50} offset={0} onRowCountChange={onRowCountChange} />,
      { wrapper },
    );
    await waitFor(() => expect(onRowCountChange).toHaveBeenCalledWith(2));
  });
});
