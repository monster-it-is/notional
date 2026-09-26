import type { ExecutionResponse, OrderResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { HistoryPage } from "./HistoryPage.tsx";
import { listExecutions } from "../lib/api/executions.ts";
import { listPerpFunding } from "../lib/api/funding.ts";
import { listLiquidations } from "../lib/api/liquidations.ts";
import { listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";

vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
}));
vi.mock("../lib/api/executions.ts", () => ({
  listExecutions: vi.fn(),
}));
vi.mock("../lib/api/funding.ts", () => ({
  listPerpFunding: vi.fn(),
}));
vi.mock("../lib/api/liquidations.ts", () => ({
  listLiquidations: vi.fn(),
}));

const mockedOrders = vi.mocked(listOrders);
const mockedExecutions = vi.mocked(listExecutions);
const mockedFunding = vi.mocked(listPerpFunding);
const mockedLiquidations = vi.mocked(listLiquidations);

const order: OrderResponse = {
  id: "ord-1",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  quantity: "0.001",
  limitPrice: "100",
  reduceOnly: false,
  status: "OPEN",
  origin: "USER",
  createdAt: "2024-01-02T03:04:05.123Z",
  updatedAt: "2024-01-02T03:04:05.123Z",
};

const execution: ExecutionResponse = {
  id: "ex-1",
  orderId: "ord-uuid-1",
  symbol: "BTCUSDT",
  side: "BUY",
  orderType: "MARKET",
  quantity: "0.001",
  price: "100.5",
  executedAt: "2024-01-02T03:04:05.123Z",
};

function fiftyOrders(): OrderResponse[] {
  return Array.from({ length: 50 }, (_, index) => ({
    ...order,
    id: `ord-${index}`,
  }));
}

function renderHistory(path = "/history") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HistoryPage", () => {
  beforeEach(() => {
    mockedOrders.mockReset();
    mockedExecutions.mockReset();
    mockedFunding.mockReset();
    mockedLiquidations.mockReset();
    mockedOrders.mockResolvedValue({ orders: [] });
    mockedExecutions.mockResolvedValue({ executions: [] });
    mockedFunding.mockResolvedValue({ funding: [] });
    mockedLiquidations.mockResolvedValue({ liquidations: [] });
  });

  it("defaults to Orders and keeps list query keys prefixed for realtime invalidation", async () => {
    renderHistory();
    expect(await screen.findByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Orders" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Positions" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Order status")).toBeInTheDocument();
    expect(screen.getByLabelText("Symbol filter")).toBeInTheDocument();
    expect(await screen.findByText("No orders.")).toBeInTheDocument();
    expect(queryKeys.orders.list({ limit: 50, offset: 0 })[0]).toBe("orders");
    expect(queryKeys.executions.list({ limit: 50, offset: 0 })[0]).toBe("executions");
  });

  it("hides status off Orders and symbol off funding/liquidations", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText("No orders.");

    await user.click(screen.getByRole("tab", { name: "Executions" }));
    expect(screen.queryByLabelText("Order status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Symbol filter")).toBeInTheDocument();
    expect(await screen.findByText("No executions.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Perpetual funding" }));
    expect(screen.queryByLabelText("Symbol filter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Order status")).not.toBeInTheDocument();
    expect(await screen.findByText("No perpetual funding settlements.")).toBeInTheDocument();
  });

  it("does not query orders or executions when the symbol is invalid", async () => {
    renderHistory("/history?symbol=BTC-USDT");

    expect((await screen.findAllByText("Use a symbol like BTCUSDT")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Symbol filter")).toHaveAttribute("aria-invalid", "true");
    expect(mockedOrders).not.toHaveBeenCalled();
    expect(mockedExecutions).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("queries with a canonical symbol and History execution order ids", async () => {
    mockedOrders.mockResolvedValue({ orders: [order] });
    mockedExecutions.mockResolvedValue({ executions: [execution] });
    const user = userEvent.setup();
    renderHistory("/history?symbol=BTCUSDT");

    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(mockedOrders).toHaveBeenCalledWith({
      status: undefined,
      symbol: "BTCUSDT",
      limit: 50,
      offset: 0,
    });

    await user.click(screen.getByRole("tab", { name: "Executions" }));
    expect(await screen.findByRole("columnheader", { name: "Order" })).toBeInTheDocument();
    expect(screen.getByText("ord-uuid-1")).toBeInTheDocument();
    expect(mockedExecutions).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      limit: 50,
      offset: 0,
    });
  });

  it("disables Next while the page count is unresolved and after a short page", async () => {
    mockedOrders.mockReturnValue(new Promise(() => undefined));
    renderHistory();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Loading orders…")).toBeInTheDocument();
  });

  it("enables Next only when the current page has 50 rows", async () => {
    mockedOrders.mockResolvedValue({ orders: fiftyOrders() });
    renderHistory();
    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("resets row count before a new filter result can re-enable Next", async () => {
    mockedOrders.mockResolvedValue({ orders: fiftyOrders() });
    const user = userEvent.setup();
    renderHistory();
    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    mockedOrders.mockReturnValue(new Promise(() => undefined));
    await user.selectOptions(screen.getByLabelText("Order status"), "FILLED");

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Loading orders…")).toBeInTheDocument();
    expect(mockedOrders).toHaveBeenLastCalledWith({
      status: "FILLED",
      symbol: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("keeps Previous on an empty trailing page and omits offset 0 after going back", async () => {
    mockedOrders.mockResolvedValue({ orders: [] });
    const user = userEvent.setup();
    renderHistory("/history?offset=50");

    expect(await screen.findByText("No more orders.")).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: "Previous" });
    expect(previous).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(previous);
    expect(await screen.findByText("No orders.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("does not expose cancel actions on the history ledger", async () => {
    mockedOrders.mockResolvedValue({ orders: [order] });
    renderHistory();
    expect(await screen.findByText("OPEN")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});
