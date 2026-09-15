import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm } from "./OrderForm.tsx";
import { PLACE_ORDER_MUTATION_OPTIONS } from "../hooks/use-place-order.ts";
import { placeOrder } from "../lib/api/orders.ts";

vi.mock("../lib/api/orders.ts", () => ({
  placeOrder: vi.fn(),
}));

const mockedPlace = vi.mocked(placeOrder);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("OrderForm", () => {
  beforeEach(() => {
    mockedPlace.mockReset();
  });

  it("hides limit price for MARKET and requires it for LIMIT", async () => {
    const user = userEvent.setup();
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    expect(screen.queryByLabelText("Limit price")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    expect(screen.getByLabelText("Limit price")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place LIMIT BUY/i }));
    expect(await screen.findByText(/Limit price is required/)).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("keeps quantity and price as strings and reuses the idempotency key on retry", async () => {
    const user = userEvent.setup();
    mockedPlace.mockRejectedValueOnce(new Error("network"));
    mockedPlace.mockResolvedValueOnce({
      id: "1",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "MARKET",
      quantity: "0.001",
      limitPrice: null,
      reduceOnly: false,
      status: "FILLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });

    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    const firstKey = mockedPlace.mock.calls[0]?.[1];
    await user.click(screen.getByRole("button", { name: "Retry same order" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).toBe(firstKey);
    expect(mockedPlace.mock.calls[0]?.[0].quantity).toBe("0.001");
    expect(typeof mockedPlace.mock.calls[0]?.[0].quantity).toBe("string");
  });

  it("mints a new key when the intent changes", async () => {
    const user = userEvent.setup();
    mockedPlace.mockRejectedValue(new Error("network"));
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    const firstKey = mockedPlace.mock.calls[0]?.[1];
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "0.002");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).not.toBe(firstKey);
  });

  it("does not auto-retry POST /api/orders", () => {
    expect(PLACE_ORDER_MUTATION_OPTIONS.retry).toBe(false);
  });
});
