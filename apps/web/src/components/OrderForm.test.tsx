import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm } from "./OrderForm.tsx";
import { PLACE_ORDER_MUTATION_OPTIONS } from "../hooks/use-place-order.ts";
import { ApiError } from "../lib/api/errors.ts";
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

  it("exposes BUY and SELL without Long/Short ticket labels", () => {
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    expect(screen.getByRole("button", { name: "BUY" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SELL" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "BUY / LONG" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SELL / SHORT" })).not.toBeInTheDocument();
    expect(screen.queryByText("LONG")).not.toBeInTheDocument();
    expect(screen.queryByText("SHORT")).not.toBeInTheDocument();
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
    expect(screen.getByLabelText("Limit price")).toHaveAttribute("aria-invalid", "true");
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
    expect(mockedPlace.mock.calls[0]?.[0].reduceOnly).toBe(false);
  });

  it("sends reduceOnly and SELL in the payload as provided", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValue({
      id: "1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "MARKET",
      quantity: "0.001",
      limitPrice: null,
      reduceOnly: true,
      status: "FILLED",
      origin: "USER",
      createdAt: "t",
      updatedAt: "t",
    });

    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "SELL" }));
    await user.click(screen.getByRole("checkbox", { name: "Reduce only" }));
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET SELL/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toMatchObject({
      type: "MARKET",
      side: "SELL",
      quantity: "0.001",
      reduceOnly: true,
    });
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

  it("disables placement when suspended", () => {
    render(<OrderForm symbol="BTCUSDT" disabled />, { wrapper });
    expect(screen.getByRole("button", { name: /Place MARKET BUY/i })).toBeDisabled();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
    expect(screen.getByRole("button", { name: "BUY" })).toBeDisabled();
  });

  it("disables controls while a place request is pending", async () => {
    const user = userEvent.setup();
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("button", { name: "Placing…" })).toBeDisabled();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
  });

  it("keeps fail-closed copy when market data is unavailable", async () => {
    const user = userEvent.setup();
    mockedPlace.mockRejectedValue(
      new ApiError({ status: 503, code: "MARKET_DATA_UNAVAILABLE" }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByText("The order did not succeed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry same order" })).toBeInTheDocument();
  });

  it("does not auto-retry POST /api/orders", () => {
    expect(PLACE_ORDER_MUTATION_OPTIONS.retry).toBe(false);
  });
});
