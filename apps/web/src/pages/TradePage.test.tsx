import type { InstrumentResponse, PositionResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";

import { TradePage } from "./TradePage.tsx";
import { listExecutions } from "../lib/api/executions.ts";
import { listInstruments } from "../lib/api/instruments.ts";
import { getMarginSettings } from "../lib/api/margin.ts";
import { cancelOrder, listOrders, placeOrder } from "../lib/api/orders.ts";
import { listPositions } from "../lib/api/positions.ts";
import { queryKeys } from "../lib/query-keys.ts";

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
  placeOrder: vi.fn(),
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
const mockedPlace = vi.mocked(placeOrder);
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

  const view = render(
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

  return { client, ...view };
}

function tradePosition(overrides: Partial<PositionResponse> = {}): PositionResponse {
  return {
    symbol: "BTCUSDT",
    quantity: "1.5",
    entryPrice: "100",
    markPrice: null,
    unrealizedPnl: null,
    cumulativeRealizedPnl: "0",
    marginMode: "CROSS",
    leverage: 1,
    updatedAt: "t",
    ...overrides,
  };
}

describe("TradePage", () => {
  beforeEach(() => {
    setDesiredSymbol.mockReset();
    mockedInstruments.mockReset();
    mockedPositions.mockReset();
    mockedOrders.mockReset();
    mockedCancel.mockReset();
    mockedPlace.mockReset();
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
    const selector = await screen.findByRole("combobox", { name: "Instrument" });
    expect(selector).toHaveValue("ETHUSDT");
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("ETHUSDT"));
  });

  it("changes the market socket subscription when a catalog instrument is chosen", async () => {
    const user = userEvent.setup();
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    const selector = await screen.findByRole("combobox", { name: "Instrument" });
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("ETHUSDT"));
    await user.click(selector);
    await user.click(await screen.findByRole("option", { name: /BTCUSDT/ }));
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("BTCUSDT"));
    expect(selector).toHaveValue("BTCUSDT");
  });

  it("does not change the desired symbol while typing in the picker", async () => {
    const user = userEvent.setup();
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    const selector = await screen.findByRole("combobox", { name: "Instrument" });
    await waitFor(() => expect(setDesiredSymbol).toHaveBeenCalledWith("ETHUSDT"));
    const callsAfterLoad = setDesiredSymbol.mock.calls.length;
    await user.click(selector);
    await user.type(selector, "BTC");
    expect(setDesiredSymbol.mock.calls.length).toBe(callsAfterLoad);
    expect(setDesiredSymbol).not.toHaveBeenCalledWith("B");
    expect(setDesiredSymbol).not.toHaveBeenCalledWith("BT");
    expect(setDesiredSymbol).not.toHaveBeenCalledWith("BTC");
    expect(setDesiredSymbol).not.toHaveBeenCalledWith("BTCUSDT");
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

  it("disables position Close while the account is suspended", async () => {
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    renderTrade({ suspended: true });
    expect(await screen.findByRole("button", { name: "Close BTCUSDT" })).toBeDisabled();
  });

  it("keeps a pending close mounted when a background positions refetch fails", async () => {
    const user = userEvent.setup();
    let resolveClose: (order: Awaited<ReturnType<typeof placeOrder>>) => void = () => undefined;
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClose = resolve;
        }),
    );
    const { client } = renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    const dialog = screen.getByRole("dialog", { name: "Close BTCUSDT" });
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    const idempotencyKey = mockedPlace.mock.calls[0]?.[1];

    mockedPositions.mockRejectedValue(new Error("positions refresh failed"));
    await client.refetchQueries({ queryKey: queryKeys.positions.all });

    expect(await screen.findByRole("alert")).toHaveTextContent("positions refresh failed");
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeEnabled();
    expect(screen.getByRole("cell", { name: "1.5" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    await user.click(screen.getByRole("tab", { name: "Recent executions" }));
    expect(screen.getByRole("tab", { name: "Positions" })).toHaveAttribute("aria-selected", "true");
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(mockedPlace.mock.calls[0]?.[1]).toBe(idempotencyKey);

    mockedPositions.mockResolvedValue({
      positions: [tradePosition({ markPrice: "110", unrealizedPnl: "15" })],
    });
    await client.refetchQueries({ queryKey: queryKeys.positions.all });

    expect(await screen.findByText("110")).toBeInTheDocument();
    expect(screen.queryByText("positions refresh failed")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeDisabled();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(mockedPlace.mock.calls[0]?.[1]).toBe(idempotencyKey);

    resolveClose({
      id: "close-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "1.5",
      limitPrice: null,
      reduceOnly: true,
      status: "FILLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeEnabled();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(mockedPlace.mock.calls[0]?.[1]).toBe(idempotencyKey);
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
  });

  it("retries the same close intent after a refetch failure during a pending close", async () => {
    const user = userEvent.setup();
    let rejectClose: (reason: unknown) => void = () => undefined;
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectClose = reject;
        }),
    );
    const { client } = renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    const dialog = screen.getByRole("dialog", { name: "Close BTCUSDT" });
    expect(mockedPlace).toHaveBeenCalledTimes(1);

    mockedPositions.mockRejectedValue(new Error("positions refresh failed"));
    await client.refetchQueries({ queryKey: queryKeys.positions.all });
    expect(await screen.findByText("positions refresh failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();

    rejectClose(new Error("network"));
    expect(await screen.findByText("network")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).toBe(mockedPlace.mock.calls[0]?.[1]);
    expect(mockedPlace.mock.calls[1]?.[0]).toEqual(mockedPlace.mock.calls[0]?.[0]);
  });

  it("keeps Positions mounted while a close POST is pending", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Recent executions" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    await user.click(screen.getByRole("tab", { name: "Recent executions" }));
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Positions" })).toHaveAttribute("aria-selected", "true");
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("allows Trade tab changes after a failed close", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockRejectedValue(new Error("network"));
    renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByText("network")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    const ordersTab = screen.getByRole("tab", { name: "Open orders" });
    expect(ordersTab).toBeEnabled();
    await user.click(ordersTab);
    expect(screen.queryByRole("dialog", { name: "Close BTCUSDT" })).not.toBeInTheDocument();
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
  });

  it("allows Trade tab changes after a successful close", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockResolvedValue({
      id: "close-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "1.5",
      limitPrice: null,
      reduceOnly: true,
      status: "FILLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });
    renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const ordersTab = screen.getByRole("tab", { name: "Open orders" });
    expect(ordersTab).toBeEnabled();
    await user.click(ordersTab);
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
  });

  it("still allows tab changes while an idle Close confirmation is open", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(await screen.findByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Open orders" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("unmounts Positions when leaving the Positions tab", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    renderTrade();
    expect(await screen.findByRole("button", { name: "Close BTCUSDT" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Open orders" }));
    expect(screen.queryByRole("button", { name: "Close BTCUSDT" })).not.toBeInTheDocument();
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
  });
});
