import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../theme/ThemeProvider.tsx";
import { THEME_STORAGE_KEY } from "../../theme/theme.ts";
import { LandingPage } from "../../pages/LandingPage.tsx";
import { useMarketStore } from "../../stores/market-store.ts";
import { useRealtimeStatusStore } from "../../stores/realtime-status-store.ts";

const { useSession } = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock("../../auth/auth-client.ts", () => ({
  authClient: {
    useSession: () => useSession(),
  },
}));

vi.mock("../../realtime/runtime.ts", () => ({
  getMarketSocket: () => ({
    acquire: () => undefined,
    release: () => undefined,
    setDesiredSymbol: () => undefined,
  }),
}));

function renderPage(): void {
  render(
    <ThemeProvider>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function seedCachedMark(markEventTime: number): void {
  useMarketStore.getState().applyMark({
    type: "market.mark",
    symbol: "BTCUSDT",
    markPrice: "100000",
    indexPrice: "99900",
    fundingRate: "0.0001",
    nextFundingTime: markEventTime + 28_800_000,
    markEventTime,
  });
}

describe("landing page", () => {
  beforeEach(() => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    useSession.mockReset();
    useSession.mockReturnValue({ data: null, isPending: false });
    useMarketStore.getState().clear();
    useRealtimeStatusStore.setState({ market: "idle", account: "idle" });
  });

  it("sends signed-out visitors to log in and sign up", () => {
    renderPage();

    expect(screen.getByRole("link", { name: /^Log in$/ })).toHaveAttribute("href", "/signin");
    expect(screen.queryByRole("link", { name: /^Sign in$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Sign up$/ })).not.toBeInTheDocument();

    for (const link of screen.getAllByRole("link", { name: "Start Paper Trading" })) {
      expect(link).toHaveAttribute("href", "/signup");
      expect(link.className).toContain("bg-accent");
      expect(link.className).not.toMatch(/positive|negative/);
    }

    for (const link of screen.getAllByRole("link", { name: "Explore how it works" })) {
      expect(link).toHaveAttribute("href", "#how-it-works");
      expect(link.className).not.toContain("bg-accent");
      expect(link.className).not.toMatch(/positive|negative/);
    }

    const heading = screen.getByRole("heading", { level: 1 });
    const desk = screen.getByRole("region", { name: /sample position, not your account/i });
    expect(heading.compareDocumentPosition(desk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends a signed-in visitor to the desk and hides sign-in", () => {
    useSession.mockReturnValue({
      data: { user: { id: "1", email: "ada@example.com", name: "Ada" } },
      isPending: false,
    });
    renderPage();

    expect(screen.queryByRole("link", { name: /^Log in$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Sign in$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Sign up$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Trade$/ })).toHaveAttribute("href", "/trade");
    expect(screen.getByRole("link", { name: "ada@example.com" })).toHaveAttribute("href", "/account");

    for (const link of screen.getAllByRole("link", { name: "Start Paper Trading" })) {
      expect(link).toHaveAttribute("href", "/trade");
    }
  });

  it("does not offer sign-in while the session is still loading", () => {
    useSession.mockReturnValue({ data: null, isPending: true });
    renderPage();

    expect(screen.queryByRole("link", { name: /^Log in$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start Paper Trading" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Start Paper Trading").length).toBeGreaterThan(0);
  });

  it("labels the trading preview as a simulation and waits for the market feed", () => {
    renderPage();

    expect(screen.getByRole("region", { name: /sample position, not your account/i })).toBeInTheDocument();
    expect(screen.getAllByText(/not a historical chart/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Simulation$/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: /product preview/i })).toBeInTheDocument();
    expect(screen.getAllByText(/illustrative/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/waiting for the market feed/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/order book/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/24h/i)).not.toBeInTheDocument();
  });

  it("does not label a cached quote as live when the market socket is disconnected", () => {
    seedCachedMark(Date.now());
    useRealtimeStatusStore.getState().setMarket("closed");
    renderPage();

    expect(screen.queryByText("Live market")).not.toBeInTheDocument();
    expect(screen.getAllByText("Stale market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Up$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Down$/)).not.toBeInTheDocument();
  });

  it("does not label a cached quote as live while reconnecting", () => {
    seedCachedMark(Date.now());
    useRealtimeStatusStore.getState().setMarket("reconnecting");
    renderPage();

    expect(screen.queryByText("Live market")).not.toBeInTheDocument();
    expect(screen.getAllByText("Stale market").length).toBeGreaterThan(0);
  });

  it("does not label a ready socket with an aged mark as live", () => {
    seedCachedMark(Date.now() - 30_000);
    useRealtimeStatusStore.getState().setMarket("ready");
    renderPage();

    expect(screen.queryByText("Live market")).not.toBeInTheDocument();
    expect(screen.getAllByText("Stale market").length).toBeGreaterThan(0);
  });

  it("opens and closes the mobile menu", async () => {
    const user = userEvent.setup();
    renderPage();
    const menu = screen.getByRole("button", { name: "Menu" });

    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();

    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  it("switches the shared market symbol", async () => {
    const user = userEvent.setup();
    renderPage();
    const switches = screen.getAllByRole("button", { name: "ETHUSDT" });

    await user.click(switches[0]!);

    for (const button of screen.getAllByRole("button", { name: "ETHUSDT" })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("toggles the landing theme", async () => {
    const user = userEvent.setup();
    renderPage();

    const toLight = screen.getByRole("button", { name: "Switch to light theme" });
    expect(toLight).toHaveAttribute("title", "Switch to light theme");
    await user.click(toLight);
    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    const toDark = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(toDark).toHaveAttribute("title", "Switch to dark theme");
    await user.click(toDark);
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("discloses an FAQ answer from the keyboard and hides it again", async () => {
    const user = userEvent.setup();
    renderPage();
    const question = screen.getByRole("button", { name: "Is this real-money trading?" });

    question.focus();
    expect(question).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");

    const answer = screen.getByRole("region", { name: "Is this real-money trading?" });
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(answer).toHaveTextContent(/virtual USDT/i);

    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Is this real-money trading?" })).not.toBeInTheDocument();
  });

  it("recalculates the leverage lab for direction and an adverse move", async () => {
    const user = userEvent.setup();
    renderPage();
    const estimate = screen.getByRole("group", { name: "Estimate" });

    expect(estimate).toHaveTextContent("+100.00");
    expect(estimate).toHaveTextContent(/\bgain\b/);
    expect(estimate).toHaveTextContent("10,000.00");
    expect(estimate).toHaveTextContent("+10.00%");
    expect(estimate).not.toHaveTextContent(/at or below maintenance margin/i);

    await user.click(screen.getByRole("radio", { name: "Short" }));
    expect(estimate).toHaveTextContent("-100.00");
    expect(estimate).toHaveTextContent(/\bloss\b/);

    await user.click(screen.getByRole("radio", { name: "Long" }));
    fireEvent.change(screen.getByRole("slider", { name: "Market movement" }), {
      target: { value: "-10" },
    });
    expect(estimate).toHaveTextContent("-1,000.00");
    expect(estimate).toHaveTextContent(/\bloss\b/);
    expect(estimate).toHaveTextContent(/at or below maintenance margin/i);
  });
});
