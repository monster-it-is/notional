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

const openBuy = {
  id: "ord-1",
  symbol: "BTCUSDT",
  side: "BUY" as const,
  type: "LIMIT" as const,
  quantity: "0.001",
  limitPrice: "100",
  reduceOnly: false,
  status: "OPEN" as const,
  origin: "USER" as const,
  createdAt: "t",
  updatedAt: "t",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("OpenOrdersTable", () => {
  it("renders populated rows and cancel", async () => {
    mockedList.mockResolvedValue({ orders: [openBuy] });
    mockedCancel.mockResolvedValue({ ...openBuy, status: "CANCELLED" });

    const user = userEvent.setup();
    render(<OpenOrdersTable />, { wrapper });
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("BUY")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockedCancel).toHaveBeenCalledWith("ord-1"));
  });

  it("disables cancel buttons while a cancellation is pending", async () => {
    mockedList.mockResolvedValue({ orders: [openBuy] });
    mockedCancel.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<OpenOrdersTable />, { wrapper });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("shows empty and error states", async () => {
    mockedList.mockResolvedValueOnce({ orders: [] });
    const { rerender } = render(<OpenOrdersTable />, { wrapper });
    expect(await screen.findByText("No open orders.")).toBeInTheDocument();
    mockedList.mockRejectedValueOnce(new Error("boom"));
    rerender(<OpenOrdersTable />);
  });
});
