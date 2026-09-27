import type { OrderResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenOrdersTable } from "./OpenOrdersTable.tsx";
import { cancelOrder, listOrders } from "../lib/api/orders.ts";
import { queryKeys } from "../lib/query-keys.ts";

vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));

const mockedList = vi.mocked(listOrders);
const mockedCancel = vi.mocked(cancelOrder);

const openBuy: OrderResponse = {
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
};

function makeOrders(count: number, symbol: string): OrderResponse[] {
  return Array.from({ length: count }, (_, index) => ({
    ...openBuy,
    id: `${symbol}-${index}`,
    symbol,
  }));
}

function listParams(offset: number, symbol?: string) {
  return { status: "OPEN" as const, symbol, limit: 50, offset };
}

function renderTable(symbol?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<OpenOrdersTable symbol={symbol} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }),
  };
}

describe("OpenOrdersTable", () => {
  beforeEach(() => {
    mockedList.mockReset();
    mockedCancel.mockReset();
  });

  it("requests the first open-orders page with existing symbol behavior", async () => {
    mockedList.mockResolvedValue({ orders: [] });
    const { unmount } = renderTable();
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith({
        status: "OPEN",
        symbol: undefined,
        limit: 50,
        offset: 0,
      }),
    );
    unmount();

    mockedList.mockClear();
    renderTable("ETHUSDT");
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith({
        status: "OPEN",
        symbol: "ETHUSDT",
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("disables both pager buttons on a short first page and shows the range", async () => {
    mockedList.mockResolvedValue({ orders: makeOrders(3, "BTCUSDT") });
    renderTable();
    expect(await screen.findByText("Showing 1–3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("enables Next only when the first page is full", async () => {
    mockedList.mockResolvedValue({ orders: makeOrders(50, "BTCUSDT") });
    renderTable();
    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("loads page 2 at offset 50 and keeps Previous enabled", async () => {
    const page1 = makeOrders(50, "BTCUSDT");
    const page2 = makeOrders(12, "ETHUSDT");
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: page1 };
      }

      return { orders: page2 };
    });
    const user = userEvent.setup();
    const { client } = renderTable();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getAllByText("BTCUSDT")).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Showing 51–62")).toBeInTheDocument();
    expect(screen.getAllByText("ETHUSDT")).toHaveLength(12);
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(mockedList).toHaveBeenCalledWith(listParams(50));
    expect(client.getQueryData(queryKeys.orders.list(listParams(0)))).toEqual({ orders: page1 });
    expect(client.getQueryData(queryKeys.orders.list(listParams(50)))).toEqual({ orders: page2 });
  });

  it("disables Next while a later page is unresolved", async () => {
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: makeOrders(50, "BTCUSDT") };
      }

      return new Promise(() => undefined);
    });
    const user = userEvent.setup();
    renderTable();
    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Loading open orders…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(mockedList).toHaveBeenCalledWith(listParams(50));
  });

  it("returns to offset 0 from cache when Previous is clicked", async () => {
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: makeOrders(50, "BTCUSDT") };
      }

      return { orders: makeOrders(12, "ETHUSDT") };
    });
    const user = userEvent.setup();
    const { client } = renderTable();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 51–62")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getAllByText("BTCUSDT")).toHaveLength(50);
    expect(screen.queryByText("ETHUSDT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(mockedList).toHaveBeenCalledWith(listParams(0));
    expect(client.getQueryData(queryKeys.orders.list(listParams(0)))).toBeDefined();
    expect(client.getQueryData(queryKeys.orders.list(listParams(50)))).toBeDefined();
  });

  it("shows the empty first-page state with both pager buttons disabled", async () => {
    mockedList.mockResolvedValue({ orders: [] });
    renderTable();
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
    expect(screen.queryByText("No more open orders.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("keeps Previous on an empty trailing page and does not rewind", async () => {
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: makeOrders(50, "BTCUSDT") };
      }

      return { orders: [] };
    });
    const user = userEvent.setup();
    renderTable();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("No more open orders.")).toBeInTheDocument();
    expect(screen.queryByText("No open orders.")).not.toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith(listParams(50));
  });

  it("cancels an order on page 2 without resetting offset", async () => {
    const page2 = makeOrders(2, "ETHUSDT");
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: makeOrders(50, "BTCUSDT") };
      }

      return { orders: page2 };
    });
    mockedCancel.mockResolvedValue({ ...page2[0]!, status: "CANCELLED" });
    const user = userEvent.setup();
    renderTable();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 51–52")).toBeInTheDocument();
    const callsBeforeCancel = mockedList.mock.calls.length;
    await user.click(screen.getAllByRole("button", { name: "Cancel ETHUSDT" })[0]!);

    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("ETHUSDT-0"));
    await waitFor(() => expect(mockedList.mock.calls.length).toBeGreaterThan(callsBeforeCancel));
    expect(
      mockedList.mock.calls.slice(callsBeforeCancel).some(([params]) => params.offset === 50),
    ).toBe(true);
    expect(screen.getAllByText("ETHUSDT")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
  });

  it("stays on an empty trailing page after cancelling the last row", async () => {
    let page2 = makeOrders(1, "ETHUSDT");
    mockedList.mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) {
        return { orders: makeOrders(50, "BTCUSDT") };
      }

      return { orders: page2 };
    });
    mockedCancel.mockImplementation(async () => {
      const order = page2[0]!;
      page2 = [];
      return { ...order, status: "CANCELLED" };
    });
    const user = userEvent.setup();
    renderTable();

    expect(await screen.findByText("Showing 1–50")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel ETHUSDT" }));

    expect(await screen.findByText("No more open orders.")).toBeInTheDocument();
    expect(screen.queryByText("No open orders.")).not.toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("renders populated rows and cancel", async () => {
    mockedList.mockResolvedValue({ orders: [openBuy] });
    mockedCancel.mockResolvedValue({ ...openBuy, status: "CANCELLED" });

    const user = userEvent.setup();
    renderTable();
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("BUY")).toBeInTheDocument();
    const cancel = await screen.findByRole("button", { name: "Cancel BTCUSDT" });
    expect(cancel).toHaveTextContent("Cancel");
    await user.click(cancel);
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("ord-1"));
  });

  it("disables cancel buttons while a cancellation is pending", async () => {
    mockedList.mockResolvedValue({ orders: [openBuy] });
    mockedCancel.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderTable();
    await user.click(await screen.findByRole("button", { name: "Cancel BTCUSDT" }));
    expect(screen.getByRole("button", { name: "Cancel BTCUSDT" })).toBeDisabled();
  });

  it("shows a list ErrorBanner instead of an empty page", async () => {
    mockedList.mockRejectedValue(new Error("boom"));
    renderTable();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByText("No open orders.")).not.toBeInTheDocument();
    expect(screen.queryByText("No more open orders.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
