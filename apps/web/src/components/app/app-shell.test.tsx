import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOutletContext } from "react-router";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedLayout } from "../../layouts/AuthenticatedLayout.tsx";
import { ThemeProvider } from "../../theme/ThemeProvider.tsx";
import { THEME_STORAGE_KEY } from "../../theme/theme.ts";
import { useRealtimeStatusStore } from "../../stores/realtime-status-store.ts";
import { AppBottomNav } from "./AppBottomNav.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { APP_NAV } from "./app-nav.ts";

const { signOut, stopRealtime, useSession } = vi.hoisted(() => ({
  signOut: vi.fn(),
  stopRealtime: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("../../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
    signOut: (...args: unknown[]) => signOut(...args),
  },
}));

vi.mock("../../realtime/runtime.ts", () => ({
  stopRealtime: () => stopRealtime(),
  getMarketSocket: () => ({
    acquire: () => undefined,
    release: () => undefined,
    setDesiredSymbol: () => undefined,
  }),
}));

vi.mock("../../hooks/use-market-socket.ts", () => ({
  useMarketSocket: () => undefined,
}));

vi.mock("../../hooks/use-account-socket.ts", () => ({
  useAccountSocket: () => undefined,
}));

const account = {
  id: "a",
  userId: "u",
  currency: "USDT" as const,
  balance: "2500.00",
  status: "ACTIVE" as const,
  lastFaucetClaimAt: null,
  createdAt: "t",
};

vi.mock("../../lib/api/account.ts", () => ({
  getAccount: () => Promise.resolve(account),
}));

vi.mock("../../auth/account-bootstrap.ts", () => ({
  runAccountBootstrap: () =>
    Promise.resolve({
      kind: "ready",
      initialized: false,
      account,
    }),
}));

function signedIn(user: { name?: string; email?: string } = { name: "Ada", email: "ada@example.com" }) {
  useSession.mockReturnValue({
    data: { user: { id: "1", ...user } },
    isPending: false,
  });
}

function renderShell({
  accountReady = true,
  walletBalance,
  path = "/trade",
}: {
  accountReady?: boolean;
  walletBalance?: string;
  path?: string;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const clear = vi.spyOn(client, "clear");

  const view = render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              element={
                <>
                  <AppHeader accountReady={accountReady} walletBalance={walletBalance} />
                  <main id="main">
                    <p>desk</p>
                  </main>
                  <AppBottomNav />
                </>
              }
            >
              <Route path="/trade" element={<p>trade desk</p>} />
              <Route path="/history" element={<p>history page</p>} />
              <Route path="/account" element={<p>account page</p>} />
            </Route>
            <Route path="/signin" element={<p>signed out</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

  return { ...view, client, clear };
}

describe("authenticated app shell", () => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    useSession.mockReset();
    signOut.mockReset();
    stopRealtime.mockReset();
    signOut.mockResolvedValue({});
    signedIn();
    useRealtimeStatusStore.setState({ market: "idle", account: "idle" });
  });

  it("exposes Trade, History, and Account links and no Markets destination", () => {
    renderShell();

    expect(APP_NAV.map((item) => item.to)).toEqual(["/trade", "/history", "/account"]);

    const trade = screen.getAllByRole("link", { name: "Trade" });
    expect(trade.length).toBeGreaterThan(1);
    for (const link of trade) {
      expect(link).toHaveAttribute("href", "/trade");
    }

    const history = screen.getAllByRole("link", { name: "History" });
    expect(history.length).toBeGreaterThan(1);
    for (const link of history) {
      expect(link).toHaveAttribute("href", "/history");
    }

    const accountLinks = screen.getAllByRole("link", { name: "Account" });
    expect(accountLinks.length).toBeGreaterThan(1);
    for (const link of accountLinks) {
      expect(link).toHaveAttribute("href", "/account");
    }

    expect(screen.queryByRole("link", { name: "Markets" })).not.toBeInTheDocument();
  });

  it("marks the active destination with aria-current on header and bottom nav", () => {
    renderShell({ path: "/history" });

    const current = screen.getAllByRole("link", { name: "History" });
    expect(current.length).toBeGreaterThan(1);
    for (const link of current) {
      expect(link).toHaveAttribute("aria-current", "page");
    }

    for (const link of screen.getAllByRole("link", { name: "Trade" })) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("prefers a meaningful name for the account control", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Ada" })).toBeInTheDocument();
  });

  it("falls back to email and keeps the full accessible name", async () => {
    const user = userEvent.setup();
    signedIn({ email: "only@example.com" });
    renderShell();
    const trigger = screen.getByRole("button", { name: "only@example.com" });
    expect(trigger).toHaveAccessibleName("only@example.com");
    await user.click(trigger);
    expect(trigger).toHaveAccessibleName("only@example.com");
  });

  it("treats a blank name as missing and uses email", () => {
    signedIn({ name: "   ", email: "ada@example.com" });
    renderShell();
    expect(screen.getByRole("button", { name: "ada@example.com" })).toBeInTheDocument();
  });

  it("includes ThemeToggle and skip link targeting main", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(document.getElementById("main")).not.toBeNull();
  });

  it("opens a disclosure popover, not an ARIA menu", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Ada" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();

    const popover = document.getElementById(
      screen.getByRole("button", { name: "Ada" }).getAttribute("aria-controls") ?? "",
    );
    expect(popover).not.toBeNull();
    const account = within(popover as HTMLElement).getByRole("link", { name: "Account" });
    expect(account).toHaveAttribute("href", "/account");
    expect(within(popover as HTMLElement).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("toggles, closes on Escape with focus return, and closes on outside pointer", async () => {
    const user = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: "Ada" });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(screen.getByText("desk"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("does not trap Tab inside the disclosure", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: "Ada" }));

    const popover = document.getElementById(
      screen.getByRole("button", { name: "Ada" }).getAttribute("aria-controls") ?? "",
    ) as HTMLElement;
    const account = within(popover).getByRole("link", { name: "Account" });
    account.focus();
    await user.tab();
    expect(within(popover).getByRole("button", { name: "Log out" })).toHaveFocus();
    await user.tab();
    expect(within(popover).getByRole("button", { name: "Log out" })).not.toHaveFocus();
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
    const { clear } = renderShell();
    clear.mockImplementation(() => {
      order.push("clear");
    });

    await user.click(screen.getByRole("button", { name: "Ada" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(order).toEqual(["stopRealtime", "signOut", "clear"]);
  });

  it("still clears and navigates when a resolved signOut includes error", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    stopRealtime.mockImplementation(() => {
      order.push("stopRealtime");
    });
    signOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: { message: "sign out failed" } };
    });
    const { clear } = renderShell();
    clear.mockImplementation(() => {
      order.push("clear");
    });

    await user.click(screen.getByRole("button", { name: "Ada" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByText("signed out")).toBeInTheDocument());
    expect(order).toEqual(["stopRealtime", "signOut", "clear"]);
  });

  it("shows Signing out… and ignores a second activation while pending", async () => {
    const user = userEvent.setup();
    let resolveSignOut: ((value: unknown) => void) | undefined;
    signOut.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );
    renderShell();

    await user.click(screen.getByRole("button", { name: "Ada" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

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
    const { clear } = renderShell();

    await user.click(screen.getByRole("button", { name: "Ada" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled());
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByText("desk")).toBeInTheDocument();
    expect(screen.queryByText("signed out")).not.toBeInTheDocument();
  });

  it("omits wallet and Account realtime when account is not ready", () => {
    renderShell({ accountReady: false });
    expect(screen.queryByLabelText(/Wallet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Account disconnected/)).not.toBeInTheDocument();
    expect(screen.getByText(/Market disconnected/)).toBeInTheDocument();
  });

  it("renders wallet and Account status when ready with a balance", () => {
    renderShell({ accountReady: true, walletBalance: "2500.00" });
    expect(screen.getByLabelText("Wallet 2500.00 USDT")).toBeInTheDocument();
    expect(screen.getByText(/Account disconnected/)).toBeInTheDocument();
  });
});

function SuspendedProbe() {
  const { suspended } = useOutletContext<{ suspended: boolean }>();
  return <p>{suspended ? "suspended-true" : "suspended-false"}</p>;
}

describe("AuthenticatedLayout outlet", () => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    signedIn();
    useRealtimeStatusStore.setState({ market: "idle", account: "idle" });
  });

  it("renders the outlet and preserves suspended context", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/trade"]}>
            <Routes>
              <Route element={<AuthenticatedLayout />}>
                <Route path="/trade" element={<SuspendedProbe />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("suspended-false")).toBeInTheDocument();
    expect(document.getElementById("main")).not.toBeNull();
  });
});
