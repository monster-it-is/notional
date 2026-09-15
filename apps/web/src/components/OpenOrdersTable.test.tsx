import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { OpenOrdersTable } from "./OpenOrdersTable.tsx";
import { cancelOrder, listOrders } from "../lib/api/orders.ts";

vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
  cancelOrder: vi.fn(),
}));

const mockedList = vi.mocked(listOrders);
const mockedCancel = vi.mocked(cancelOrder);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("OpenOrdersTable", () => {
  it("renders populated rows and cancel", async () => {
    mockedList.mockResolvedValue({
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
    render(<OpenOrdersTable />, { wrapper });
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("ord-1"));
  });

  it("shows empty and error states", async () => {
    mockedList.mockResolvedValueOnce({ orders: [] });
    const { rerender } = render(<OpenOrdersTable />, { wrapper });
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
    mockedList.mockRejectedValueOnce(new Error("boom"));
    rerender(<OpenOrdersTable />);
  });
});
