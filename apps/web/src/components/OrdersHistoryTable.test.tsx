import type { OrderResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { OrdersHistoryTable } from "./OrdersHistoryTable.tsx";
import { listOrders } from "../lib/api/orders.ts";

vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
}));

const mocked = vi.mocked(listOrders);

const filledBuy: OrderResponse = {
  id: "ord-1",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  quantity: "0.001",
  limitPrice: null,
  reduceOnly: false,
  status: "FILLED",
  origin: "USER",
  createdAt: "2024-01-02T03:04:05.123Z",
  updatedAt: "2024-01-02T03:04:05.123Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("OrdersHistoryTable", () => {
  it("renders ledger columns with BUY/SELL color and non-trading status colors", async () => {
    mocked.mockResolvedValue({
      orders: [
        filledBuy,
        {
          ...filledBuy,
          id: "ord-2",
          side: "SELL",
          type: "LIMIT",
          limitPrice: "100",
          reduceOnly: true,
          status: "OPEN",
        },
        {
          ...filledBuy,
          id: "ord-3",
          status: "CANCELLED",
          origin: "LIQUIDATION",
        },
      ],
    });

    render(<OrdersHistoryTable limit={50} offset={0} />, { wrapper });

    expect(await screen.findByRole("columnheader", { name: "Reduce" })).toBeInTheDocument();
    expect(screen.queryByText("ord-1")).not.toBeInTheDocument();

    const buy = screen.getAllByText("BUY")[0];
    expect(buy.className).toContain("text-positive");
    expect(screen.getByText("SELL").className).toContain("text-negative");

    const filled = screen.getByText("FILLED");
    expect(filled.className).not.toContain("text-positive");
    expect(filled.className).not.toContain("text-negative");

    expect(screen.getByText("OPEN").className).toContain("text-accent");
    expect(screen.getByText("OPEN").className).not.toContain("text-positive");
    expect(screen.getByText("CANCELLED").className).toContain("text-secondary");
    expect(screen.getByText("CANCELLED").className).not.toContain("text-negative");
    expect(screen.getByText("LIQUIDATION").className).toContain("text-warning");
    expect(screen.getAllByText("USER")[0].className).not.toContain("text-warning");
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getAllByText("2024-01-02 03:04:05 UTC").length).toBeGreaterThan(0);
  });

  it("passes status, symbol, limit, and offset to the orders API", async () => {
    mocked.mockResolvedValue({ orders: [] });
    render(
      <OrdersHistoryTable status="FILLED" symbol="ETHUSDT" limit={50} offset={50} />,
      { wrapper },
    );
    expect(await screen.findByText("No more orders.")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith({
      status: "FILLED",
      symbol: "ETHUSDT",
      limit: 50,
      offset: 50,
    });
  });

  it("shows an empty state at offset 0", async () => {
    mocked.mockResolvedValue({ orders: [] });
    render(<OrdersHistoryTable limit={50} offset={0} />, { wrapper });
    expect(await screen.findByText("No orders.")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mocked.mockRejectedValue(new Error("orders down"));
    render(<OrdersHistoryTable limit={50} offset={0} />, { wrapper });
    expect(await screen.findByText("orders down")).toBeInTheDocument();
  });

  it("reports row count after a successful fetch", async () => {
    const onRowCountChange = vi.fn();
    mocked.mockResolvedValue({ orders: [filledBuy] });
    render(<OrdersHistoryTable limit={50} offset={0} onRowCountChange={onRowCountChange} />, {
      wrapper,
    });
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(onRowCountChange).toHaveBeenCalledWith(1);
  });
});
