import type { InstrumentResponse, PositionResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router";

import { TradePage } from "./TradePage.tsx";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { getCandles } from "../lib/api/candles.ts";
import { listExecutions } from "../lib/api/executions.ts";
import { listInstruments } from "../lib/api/instruments.ts";
import { getMarginSettings } from "../lib/api/margin.ts";
import { cancelOrder, listOrders, placeOrder } from "../lib/api/orders.ts";
import { listPositions } from "../lib/api/positions.ts";
import { queryKeys } from "../lib/query-keys.ts";

const { setDesiredSymbol, setDesiredCandle, subscribeMarketCandles, subscribeReconnectReady } =
  vi.hoisted(() => ({
    setDesiredSymbol: vi.fn(),
    setDesiredCandle: vi.fn(),
    subscribeMarketCandles: vi.fn(() => () => undefined),
    subscribeReconnectReady: vi.fn(() => () => undefined),
  }));

vi.mock("../lib/api/instruments.ts", () => ({
  listInstruments: vi.fn(),
}));
vi.mock("../lib/api/candles.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/candles.ts")>();
  return {
    ...actual,
    getCandles: vi.fn(),
  };
});
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
    setDesiredCandle,
    subscribeMarketCandles,
    subscribeReconnectReady,
  }),
}));

const mockedInstruments = vi.mocked(listInstruments);
const mockedCandles = vi.mocked(getCandles);
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

function SearchProbe() {
  const location = useLocation();

  return (
    <>
      <span data-testid="trade-pathname">{location.pathname}</span>
      <span data-testid="trade-search">{location.search}</span>
    </>
  );
}

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
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Outlet context={{ suspended }} />}>
              <Route
                path="/trade"
                element={
                  <>
                    <TradePage />
                    <SearchProbe />
                  </>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
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
    setDesiredCandle.mockReset();
    subscribeMarketCandles.mockReset();
    subscribeMarketCandles.mockReturnValue(() => undefined);
    subscribeReconnectReady.mockReset();
    subscribeReconnectReady.mockReturnValue(() => undefined);
    mockedInstruments.mockReset();
    mockedCandles.mockReset();
    mockedPositions.mockReset();
    mockedOrders.mockReset();
    mockedCancel.mockReset();
    mockedPlace.mockReset();
    mockedExecutions.mockReset();
    mockedMargin.mockReset();
    mockedInstruments.mockResolvedValue({ instruments: [btc, eth] });
    mockedCandles.mockImplementation(async ({ symbol, interval }) => ({
      symbol,
      interval,
      candles: [],
    }));
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

  it("renders a historical chart beside the order ticket and tables", async () => {
    mockedCandles.mockImplementation(async ({ symbol }) => ({
      symbol,
      interval: "15m",
      candles: [],
    }));
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    expect(screen.getByText("15m")).toBeInTheDocument();
    expect(await screen.findByText("No candle data available")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order ticket" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeInTheDocument();
    expect(mockedCandles).toHaveBeenCalledWith({
      symbol: "ETHUSDT",
      interval: "15m",
      limit: 500,
    });
  });

  it("defaults the chart interval to 15m when the query param is missing", async () => {
    renderTrade();
    expect(await screen.findByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(mockedCandles).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        interval: "15m",
        limit: 500,
      }),
    );
    expect(setDesiredCandle).toHaveBeenCalledWith({ symbol: "BTCUSDT", interval: "15m" });
  });

  it("honors ?interval=1h for historical candles and the live pair", async () => {
    renderTrade({ path: "/trade?interval=1h" });
    expect(await screen.findByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(mockedCandles).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        interval: "1h",
        limit: 500,
      }),
    );
    expect(setDesiredCandle).toHaveBeenCalledWith({ symbol: "BTCUSDT", interval: "1h" });
  });

  it("falls back to 15m when the interval query param is invalid", async () => {
    renderTrade({ path: "/trade?interval=9h" });
    expect(await screen.findByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(mockedCandles).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        interval: "15m",
        limit: 500,
      }),
    );
  });

  it("updates the URL interval while preserving symbol and unrelated search params", async () => {
    const user = userEvent.setup();
    renderTrade({ path: "/trade?symbol=ETHUSDT&foo=bar" });
    expect(await screen.findByRole("combobox", { name: "Instrument" })).toHaveValue("ETHUSDT");
    await user.click(screen.getByRole("button", { name: "5m" }));
    await waitFor(() => expect(screen.getByTestId("trade-search").textContent).toContain("interval=5m"));
    expect(screen.getByTestId("trade-pathname")).toHaveTextContent("/trade");
    expect(screen.getByTestId("trade-search").textContent).toContain("symbol=ETHUSDT");
    expect(screen.getByTestId("trade-search").textContent).toContain("foo=bar");
    expect(screen.getByRole("button", { name: "5m" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(mockedCandles).toHaveBeenCalledWith({
        symbol: "ETHUSDT",
        interval: "5m",
        limit: 500,
      }),
    );
  });

  it("keeps chart mode out of the URL", async () => {
    const user = userEvent.setup();
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.click(await screen.findByRole("button", { name: "Line" }));
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("trade-search").textContent).not.toMatch(/mode=/);
    expect(screen.getByTestId("trade-search").textContent).not.toMatch(/line/i);
    expect(screen.getByTestId("trade-pathname")).toHaveTextContent("/trade");
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
    await user.click(await screen.findByRole("button", { name: "Cancel BTCUSDT" }));
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

describe("TradePage reduce prefill", () => {
  beforeEach(() => {
    setDesiredSymbol.mockReset();
    setDesiredCandle.mockReset();
    subscribeMarketCandles.mockReset();
    subscribeMarketCandles.mockReturnValue(() => undefined);
    subscribeReconnectReady.mockReset();
    subscribeReconnectReady.mockReturnValue(() => undefined);
    mockedInstruments.mockReset();
    mockedCandles.mockReset();
    mockedPositions.mockReset();
    mockedOrders.mockReset();
    mockedCancel.mockReset();
    mockedPlace.mockReset();
    mockedExecutions.mockReset();
    mockedMargin.mockReset();
    mockedInstruments.mockResolvedValue({ instruments: [btc, eth] });
    mockedCandles.mockImplementation(async ({ symbol, interval }) => ({
      symbol,
      interval,
      candles: [],
    }));
    mockedPositions.mockResolvedValue({ positions: [] });
    mockedOrders.mockResolvedValue({ orders: [] });
    mockedExecutions.mockResolvedValue({ executions: [] });
    mockedMargin.mockResolvedValue({
      symbol: "BTCUSDT",
      marginMode: "CROSS",
      leverage: 20,
    });
  });

  it("prefills a LONG reduce on the existing ticket without placing", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition({ quantity: "1.5" })],
    });
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.type(await screen.findByLabelText("Quantity"), "9.5");
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.type(screen.getByLabelText("Limit price"), "101.25");

    await user.click(await screen.findByRole("button", { name: "Reduce BTCUSDT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "MARKET" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(screen.queryByLabelText("Limit price")).not.toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveFocus());
  });

  it("prefills a SHORT reduce as BUY and submits the user-chosen quantity later", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition({ symbol: "ETHUSDT", quantity: "-0.50000000" })],
    });
    mockedPlace.mockResolvedValue({
      id: "1",
      symbol: "ETHUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.2",
      limitPrice: null,
      reduceOnly: true,
      status: "FILLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });
    renderTrade({ path: "/trade?symbol=ETHUSDT" });
    await user.click(await screen.findByRole("button", { name: "Reduce ETHUSDT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(mockedPlace).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Quantity"), "0.2");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toEqual({
      type: "MARKET",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: "0.2",
      reduceOnly: true,
    });
  });

  it("switches ?symbol= first when reducing a different-symbol position", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [
        tradePosition({ symbol: "BTCUSDT", quantity: "1" }),
        tradePosition({ symbol: "ETHUSDT", quantity: "2" }),
      ],
    });
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    const selector = await screen.findByRole("combobox", { name: "Instrument" });
    expect(selector).toHaveValue("BTCUSDT");
    await user.click(await screen.findByRole("button", { name: "Reduce ETHUSDT" }));
    await waitFor(() => expect(selector).toHaveValue("ETHUSDT"));
    await waitFor(() => expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("does not reapply an old Reduce command after the user changes symbol and comes back", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition({ quantity: "1.5" })],
    });
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.click(await screen.findByRole("button", { name: "Reduce BTCUSDT" }));
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    await user.click(screen.getByRole("checkbox", { name: "Reduce only" }));
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.type(screen.getByLabelText("Limit price"), "99");

    const selector = screen.getByRole("combobox", { name: "Instrument" });
    await user.click(selector);
    await user.click(await screen.findByRole("option", { name: /ETHUSDT/ }));
    await waitFor(() => expect(selector).toHaveValue("ETHUSDT"));
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.5");

    await user.click(selector);
    await user.click(await screen.findByRole("option", { name: /BTCUSDT/ }));
    await waitFor(() => expect(selector).toHaveValue("BTCUSDT"));
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.5");
    expect(screen.getByRole("button", { name: "LIMIT" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).not.toBeChecked();
    expect(screen.getByLabelText("Limit price")).toHaveValue("99");
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("re-applies Reduce defaults when the same row is clicked again after edits", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition({ quantity: "1.5" })],
    });
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.click(await screen.findByRole("button", { name: "Reduce BTCUSDT" }));
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    await user.click(screen.getByRole("button", { name: "LIMIT" }));

    await user.click(screen.getByRole("button", { name: "Reduce BTCUSDT" }));
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "MARKET" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
  });

  it("disables Reduce while the account is suspended", async () => {
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    renderTrade({ suspended: true });
    expect(await screen.findByRole("button", { name: "Reduce BTCUSDT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeDisabled();
  });

  it("disables Reduce while a close request is pending and keeps the close dialog", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [tradePosition()],
    });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderTrade();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    const reduce = screen.getByRole("button", { name: "Reduce BTCUSDT" });
    expect(reduce).toBeDisabled();
    fireEvent.click(reduce);
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).not.toBeChecked();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the ticket when Reduce is clicked while placement is pending", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [
        tradePosition({ symbol: "BTCUSDT", quantity: "1" }),
        tradePosition({ symbol: "ETHUSDT", quantity: "2" }),
      ],
    });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.type(await screen.findByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(screen.getByRole("button", { name: "Placing…" })).toBeDisabled();
    const reduce = screen.getByRole("button", { name: "Reduce ETHUSDT" });
    expect(reduce).toBeDisabled();
    fireEvent.click(reduce);
    expect(screen.getByRole("combobox", { name: "Instrument" })).toHaveValue("BTCUSDT");
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.001");
    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Placing…" })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the ticket when Reduce is clicked while Retry same order is pending", async () => {
    const user = userEvent.setup();
    mockedPositions.mockResolvedValue({
      positions: [
        tradePosition({ symbol: "BTCUSDT", quantity: "1" }),
        tradePosition({ symbol: "ETHUSDT", quantity: "2" }),
      ],
    });
    mockedPlace.mockRejectedValueOnce(new Error("network"));
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderTrade({ path: "/trade?symbol=BTCUSDT" });
    await user.type(await screen.findByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    await user.click(await screen.findByRole("button", { name: "Retry same order" }));
    expect(screen.getByRole("button", { name: "Placing…" })).toBeDisabled();
    const reduce = screen.getByRole("button", { name: "Reduce ETHUSDT" });
    expect(reduce).toBeDisabled();
    fireEvent.click(reduce);
    expect(screen.getByRole("combobox", { name: "Instrument" })).toHaveValue("BTCUSDT");
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.001");
    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).not.toBeChecked();
    expect(mockedPlace).toHaveBeenCalledTimes(2);
  });
});
