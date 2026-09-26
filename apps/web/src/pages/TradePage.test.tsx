import type { InstrumentResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";

import { TradePage } from "./TradePage.tsx";
import { listExecutions } from "../lib/api/executions.ts";
import { listInstruments } from "../lib/api/instruments.ts";
import { getMarginSettings } from "../lib/api/margin.ts";
import { cancelOrder, listOrders } from "../lib/api/orders.ts";
import { listPositions } from "../lib/api/positions.ts";

const { setDesiredSymbol } = vi.hoisted(() => ({
  setDesiredSymbol: vi.fn(),
}));

vi.mock("../lib/api/instruments.ts", () => ({
  listInstruments: vi.fn(),
}));
vi.mock("../lib/api/positions.ts", () => ({
  listPositions: vi.fn(),
}));
vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));
vi.mock("../lib/api/executions.ts", () => ({
  listExecutions: vi.fn(),
}));
vi.mock("../lib/api/margin.ts", () => ({
  getMarginSettings: vi.fn(),
  putMarginSettings: vi.fn(),
}));
vi.mock("../realtime/runtime.ts", () => ({
  getMarketSocket: () => ({
    setDesiredSymbol,
  }),
}));

const mockedInstruments = vi.mocked(listInstruments);
const mockedPositions = vi.mocked(listPositions);
const mockedOrders = vi.mocked(listOrders);
const mockedCancel = vi.mocked(cancelOrder);
const mockedExecutions = vi.mocked(listExecutions);
const mockedMargin = vi.mocked(getMarginSettings);

const btc: InstrumentResponse = {
  id: "1",
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  contractType: "PERPETUAL",
  status: "ACTIVE",
  tickSize: "0.1",
  minPrice: "0.1",
  maxPrice: "1000000",
  stepSize: "0.001",
  minQty: "0.001",
  maxQty: "1000",
  marketStepSize: "0.001",
  marketMinQty: "0.001",
  marketMaxQty: "120",
  minNotional: "5",
};

const eth: InstrumentResponse = {
  ...btc,
  id: "2",
  symbol: "ETHUSDT",
  baseAsset: "ETH",
};

function renderTrade({
  suspended = false,
  path = "/trade",
}: {
  suspended?: boolean;
  path?: string;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ suspended }} />}>
            <Route path="/trade" element={<TradePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TradePage", () => {
  beforeEach(() => {
    setDesiredSymbol.mockReset();
    mockedInstruments.mockReset();
    mockedPositions.mockReset();
    mockedOrders.mockReset();
    mockedCancel.mockReset();
    mockedExecutions.mockReset();
    mockedMargin.mockReset();
    mockedInstruments.mockResolvedValue({ instruments: [btc, eth] });
    mockedPositions.mockResolvedValue({ positions: [] });
    mockedOrders.mockResolvedValue({ orders: [] });
    mockedExecutions.mockResolvedValue({ executions: [] });
    mockedMargin.mockResolvedValue({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 20,
    });
  });

  it("renders the trading terminal sections", async () => {
    renderTrade();
    expect(await screen.findByRole("heading", { name: "Trade" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order ticket" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUY" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SELL" })).toBeInTheDocument();
    expect(screen.queryByText(/24h/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/order book/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/open interest/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Available$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Available balance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Available margin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Equity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Free collateral/i)).not.toBeInTheDocument();
  });

  it("shows instrument loading copy", () => {
    mockedInstruments.mockReturnValue(new Promise(() => undefined));
    renderTrade();
    expect(screen.getByText("Loading instruments…")).toBeInTheDocument();
  });

  it("shows an instrument error", async () => {
    mockedInstruments.mockRejectedValue(new Error("catalog down"));
    renderTrade();
    expect(await screen.findByText("catalog down")).toBeInTheDocument();
  });

  it("shows No instruments and keeps placement disabled when the catalog is empty", async () => {
    mockedInstruments.mockResolvedValue({ instruments: [] });
    renderTrade();
    expect(await screen.findByText("No instruments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Place MARKET BUY/i })).toBeDisabled();
  });

  it("subscribes the market socket to the selected symbol from the URL", async () => {
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    const selector = await screen.findByLabelText("Instrument");
    expect(selector).toHaveValue("ETHUSDT");
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("ETHUSDT"));
  });

  it("changes the market socket subscription when the instrument select changes", async () => {
    const user = userEvent.setup();
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    const selector = await screen.findByLabelText("Instrument");
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("ETHUSDT"));
    await user.selectOptions(selector, "BTCUSDT");
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("BTCUSDT"));
    expect(selector).toHaveValue("BTCUSDT");
  });

  it("keeps Cancel available while the account is suspended", async () => {
    mockedOrders.mockResolvedValue({
      orders: [
        {
          id: "ord-1",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          quantity: "0.001",
          limitPrice: "100",
          reduceOnly: false,
          status: "OPEN",
          origin: "USER",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    mockedCancel.mockResolvedValue({
      id: "ord-1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.001",
      limitPrice: "100",
      reduceOnly: false,
      status: "CANCELLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });

    const user = userEvent.setup();
    renderTrade({ suspended: true });
    expect(await screen.findByRole("button", { name: /Place MARKET BUY/i })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("ord-1"));
  });
});
