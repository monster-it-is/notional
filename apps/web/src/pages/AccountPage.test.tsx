import type { AccountResponse, FundingEventResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPage } from "./AccountPage.tsx";
import { claimFaucet, getAccount, getWalletFunding } from "../lib/api/account.ts";
import { ApiError } from "../lib/api/errors.ts";

const { signOut, stopRealtime, useSession } = vi.hoisted(() => ({
  signOut: vi.fn(),
  stopRealtime: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
    signOut: (...args: unknown[]) => signOut(...args),
  },
}));

vi.mock("../realtime/runtime.ts", () => ({
  stopRealtime: () => stopRealtime(),
}));

vi.mock("../lib/api/account.ts", () => ({
  getAccount: vi.fn(),
  claimFaucet: vi.fn(),
  getWalletFunding: vi.fn(),
}));

const mockedAccount = vi.mocked(getAccount);
const mockedFunding = vi.mocked(getWalletFunding);
const mockedClaim = vi.mocked(claimFaucet);

const account: AccountResponse = {
  id: "acct-secret",
  userId: "user-secret",
  currency: "USDT",
  balance: "999.999856000",
  status: "ACTIVE",
  lastFaucetClaimAt: null,
  createdAt: "2024-01-02T03:04:05.123Z",
};

const signup: FundingEventResponse = {
  id: "e-1",
  type: "SIGNUP_ALLOCATION",
  amount: "1000",
  currency: "USDT",
  createdAt: "2024-01-02T03:04:05.123Z",
};

function fiftyEvents(): FundingEventResponse[] {
  return Array.from({ length: 50 }, (_, index) => ({
    ...signup,
    id: `e-${index}`,
  }));
}

function signedIn(user: { name?: string; email?: string } = { name: "Ada", email: "ada@example.com" }) {
  useSession.mockReturnValue({
    data: { user: { id: "1", ...user } },
    isPending: false,
  });
}

function renderAccount({
  suspended = false,
  path = "/account",
}: {
  suspended?: boolean;
  path?: string;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const clear = vi.spyOn(client, "clear");

  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ suspended }} />}>
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route path="/signin" element={<p>signed out</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, client, clear };
}

describe("AccountPage", () => {
  beforeEach(() => {
    useSession.mockReset();
    signOut.mockReset();
    stopRealtime.mockReset();
    mockedAccount.mockReset();
    mockedFunding.mockReset();
    mockedClaim.mockReset();
    signOut.mockResolvedValue({});
    signedIn();
    mockedAccount.mockResolvedValue(account);
    mockedFunding.mockResolvedValue({ events: [] });
    mockedClaim.mockResolvedValue(account);
  });

  it("renders the account workspace sections", async () => {
    renderAccount();

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" }).closest(".max-w-5xl")).not.toBeNull();
    expect(screen.getByText("Paper wallet and virtual funding for this account.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Paper wallet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Virtual faucet" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wallet funding" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument();
    expect(document.querySelector(".md\\:grid-cols-2")).not.toBeNull();
    expect(screen.queryByText("acct-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("user-secret")).not.toBeInTheDocument();
  });

  it("shows a formatted balance and keeps the exact string on title", async () => {
    renderAccount();

    expect(await screen.findByText("999.999856 USDT")).toBeInTheDocument();
    expect(screen.getByTitle("999.999856000")).toBeInTheDocument();
    expect(screen.queryByText("999.999856000")).not.toBeInTheDocument();
  });

  it("shows loading when the account query has no cached data", () => {
    mockedAccount.mockReturnValue(new Promise(() => undefined));
    renderAccount();

    expect(screen.getByText("Loading account…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Paper wallet" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument();
  });

  it("shows an error when the account query fails without cached data", async () => {
    mockedAccount.mockRejectedValue(new ApiError({ status: 500, code: "REQUEST_FAILED" }));
    renderAccount();

    expect(await screen.findByRole("alert")).toHaveTextContent("REQUEST_FAILED");
    expect(screen.queryByRole("heading", { name: "Paper wallet" })).not.toBeInTheDocument();
  });

  it("disables Next while the next funding page is unresolved", async () => {
    mockedFunding.mockResolvedValue({ events: fiftyEvents() });
    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    mockedFunding.mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Loading wallet funding…")).toBeInTheDocument();
  });

  it("keeps Previous on an empty trailing funding page", async () => {
    mockedFunding.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { events: fiftyEvents() };
      }

      return { events: [] };
    });
    const user = userEvent.setup();
    renderAccount();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("No more wallet funding events.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows session name and email", async () => {
    renderAccount();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("logs out with stopRealtime, signOut, clear, then /signin", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    stopRealtime.mockImplementation(() => {
      order.push("stopRealtime");
    });
    signOut.mockImplementation(async () => {
      order.push("signOut");
      return {};
    });
    const { clear } = renderAccount();
    clear.mockImplementation(() => {
      order.push("clear");
    });

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(order).toEqual(["stopRealtime", "signOut", "clear"]);
  });

  it("still clears and navigates when a resolved signOut includes error", async () => {
    const user = userEvent.setup();
    signOut.mockResolvedValue({ error: { message: "sign out failed" } });
    const { clear } = renderAccount();

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(clear).toHaveBeenCalled();
  });

  it("shows Signing out… and ignores a second activation while pending", async () => {
    const user = userEvent.setup();
    let resolveSignOut: ((value: unknown) => void) | undefined;
    signOut.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );
    renderAccount();

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const pending = await screen.findByRole("button", { name: "Signing out…" });
    expect(pending).toBeDisabled();
    expect(signOut).toHaveBeenCalledTimes(1);
    pending.click();
    expect(signOut).toHaveBeenCalledTimes(1);
    resolveSignOut?.({});
  });

  it("resets pending and stays put when signOut throws", async () => {
    const user = userEvent.setup();
    signOut.mockRejectedValue(new Error("sign out failed"));
    const { clear } = renderAccount();

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled());
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByText("signed out")).not.toBeInTheDocument();
  });

  it("disables the faucet when the outlet is suspended", async () => {
    renderAccount({ suspended: true });

    expect(await screen.findByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(
      screen.getByText("Faucet is unavailable while this paper account is suspended."),
    ).toBeInTheDocument();
  });

  it("disables the faucet when the account status is SUSPENDED", async () => {
    mockedAccount.mockResolvedValue({ ...account, status: "SUSPENDED" });
    renderAccount();

    expect(await screen.findByRole("button", { name: "Claim virtual USDT" })).toBeDisabled();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });
});
