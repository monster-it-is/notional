import type { OrderResponse, OrderSide, OrderStatus, OrderType } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderForm, type ReducePrefillCommand } from "./OrderForm.tsx";
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

  it("exposes Reduce only on a full-width label with a taller target below lg", () => {
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    const checkbox = screen.getByRole("checkbox", { name: "Reduce only" });
    const label = checkbox.closest("label");
    expect(label).not.toBeNull();
    expect(label?.className).toContain("min-h-11");
    expect(label?.className).toContain("w-full");
    expect(label?.className).toContain("lg:min-h-0");
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

  it("reports pending to the parent on Place and Retry before controls stay locked", async () => {
    const user = userEvent.setup();
    const onPendingChange = vi.fn();
    let rejectPlace: (reason: unknown) => void = () => undefined;
    mockedPlace.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPlace = reject;
        }),
    );
    mockedPlace.mockReturnValue(new Promise(() => undefined));

    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <OrderForm symbol="BTCUSDT" disabled={false} onPendingChange={onPendingChange} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("Quantity"), "0.001");
    onPendingChange.mockClear();
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(onPendingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Placing…" })).toBeDisabled();

    rejectPlace(new Error("network"));
    expect(await screen.findByRole("button", { name: "Retry same order" })).toBeInTheDocument();
    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(false));
    onPendingChange.mockClear();
    await user.click(screen.getByRole("button", { name: "Retry same order" }));
    expect(onPendingChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Placing…" })).toBeDisabled();
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

  it("renders a filled market acknowledgement from the response", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
      }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);
    expect(status).toHaveClass("text-sm", "text-secondary");
    expect(status.className).not.toContain("text-positive");
    expect(status.className).not.toContain("text-negative");
    expect(mockedPlace.mock.calls[0]?.[0]).toMatchObject({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.001",
    });
  });

  it("renders a resting limit acknowledgement from the response", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        symbol: "ETHUSDT",
        type: "LIMIT",
        side: "BUY",
        status: "OPEN",
      }),
    );
    render(<OrderForm symbol="ETHUSDT" disabled={false} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    await user.type(screen.getByLabelText("Limit price"), "2500");
    await user.click(screen.getByRole("button", { name: /Place LIMIT BUY/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^ETHUSDT · LIMIT BUY · OPEN$/);
    expect(mockedPlace.mock.calls[0]?.[0]).toMatchObject({
      type: "LIMIT",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: "0.5",
      limitPrice: "2500",
    });
  });

  it("renders response status instead of inferring it from the request type", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        symbol: "ETHUSDT",
        type: "LIMIT",
        side: "SELL",
        status: "OPEN",
      }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));

    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toMatchObject({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/^ETHUSDT · LIMIT SELL · OPEN$/);
    expect(screen.queryByText("BTCUSDT · MARKET BUY · FILLED")).not.toBeInTheDocument();
  });

  it("clears the previous acknowledgement while a new submission is pending", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
      }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);

    mockedPlace.mockReturnValueOnce(new Promise(() => undefined));
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "0.002");
    expect(screen.getByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Placing…" })).toBeDisabled();
    expect(mockedPlace).toHaveBeenCalledTimes(2);
  });

  it("replaces the acknowledgement when the next submission succeeds", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        id: "first",
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
      }),
    );
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        id: "second",
        symbol: "ETHUSDT",
        type: "LIMIT",
        side: "SELL",
        status: "OPEN",
      }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);

    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.click(screen.getByRole("button", { name: "SELL" }));
    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "0.002");
    await user.type(screen.getByLabelText("Limit price"), "2500");
    await user.click(screen.getByRole("button", { name: /Place LIMIT SELL/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^ETHUSDT · LIMIT SELL · OPEN$/);
    expect(screen.queryByText("BTCUSDT · MARKET BUY · FILLED")).not.toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(2);
  });

  it("does not present the previous acknowledgement as the result of a failed submission", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
      }),
    );
    mockedPlace.mockRejectedValueOnce(new Error("network"));
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "0.002");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("network");
    expect(screen.getByRole("button", { name: "Retry same order" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT · MARKET BUY · FILLED")).not.toBeInTheDocument();
  });

  it("renders the acknowledgement returned by a successful retry of the same order", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        id: "first",
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "FILLED",
      }),
    );
    mockedPlace.mockRejectedValueOnce(new Error("network"));
    mockedPlace.mockResolvedValueOnce(
      orderResponse({
        id: "retry",
        symbol: "BTCUSDT",
        type: "MARKET",
        side: "BUY",
        status: "OPEN",
      }),
    );
    render(<OrderForm symbol="BTCUSDT" disabled={false} />, { wrapper });
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · FILLED$/);

    await user.clear(screen.getByLabelText("Quantity"));
    await user.type(screen.getByLabelText("Quantity"), "0.002");
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const failedKey = mockedPlace.mock.calls[1]?.[1];

    await user.click(screen.getByRole("button", { name: "Retry same order" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET BUY · OPEN$/);
    expect(screen.queryByText("BTCUSDT · MARKET BUY · FILLED")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(3);
    expect(mockedPlace.mock.calls[2]?.[1]).toBe(failedKey);
    expect(mockedPlace.mock.calls[2]?.[0]).toMatchObject({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.002",
    });
  });
});

function orderResponse(overrides: {
  id?: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  status: OrderStatus;
  quantity?: string;
}): OrderResponse {
  return {
    id: overrides.id ?? "1",
    symbol: overrides.symbol,
    side: overrides.side,
    type: overrides.type,
    quantity: overrides.quantity ?? "0.001",
    limitPrice: overrides.type === "LIMIT" ? "2500" : null,
    reduceOnly: false,
    status: overrides.status,
    origin: "USER",
    createdAt: "t",
    updatedAt: "t",
  };
}

function filledMarket(overrides: {
  side?: "BUY" | "SELL";
  quantity?: string;
  reduceOnly?: boolean;
  type?: "MARKET" | "LIMIT";
} = {}) {
  return {
    id: "1",
    symbol: "BTCUSDT",
    side: overrides.side ?? "SELL",
    type: overrides.type ?? "MARKET",
    quantity: overrides.quantity ?? "0.001",
    limitPrice: null,
    reduceOnly: overrides.reduceOnly ?? true,
    status: "FILLED" as const,
    origin: "USER" as const,
    createdAt: "t",
    updatedAt: "t",
  };
}

function renderTicket(props: {
  symbol?: string | null;
  disabled?: boolean;
  reducePrefill?: ReducePrefillCommand | null;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <OrderForm
        symbol={props.symbol === undefined ? "BTCUSDT" : props.symbol}
        disabled={props.disabled ?? false}
        reducePrefill={props.reducePrefill}
      />
    </QueryClientProvider>,
  );

  function rerenderTicket(next: {
    symbol?: string | null;
    disabled?: boolean;
    reducePrefill?: ReducePrefillCommand | null;
  }) {
    view.rerender(
      <QueryClientProvider client={client}>
        <OrderForm
          symbol={next.symbol === undefined ? (props.symbol === undefined ? "BTCUSDT" : props.symbol) : next.symbol}
          disabled={next.disabled ?? props.disabled ?? false}
          reducePrefill={next.reducePrefill === undefined ? props.reducePrefill : next.reducePrefill}
        />
      </QueryClientProvider>,
    );
  }

  return { ...view, rerenderTicket };
}

describe("OrderForm reduce prefill", () => {
  beforeEach(() => {
    mockedPlace.mockReset();
  });

  it("prefills a LONG reduce as MARKET SELL reduce-only with empty quantity", async () => {
    const { rerenderTicket } = renderTicket();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.type(screen.getByLabelText("Quantity"), "9.5");
    await user.type(screen.getByLabelText("Limit price"), "101.25");
    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "MARKET" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(screen.queryByLabelText("Limit price")).not.toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    expect(screen.getByLabelText("Limit price")).toHaveValue("");
  });

  it("prefills a SHORT reduce as MARKET BUY reduce-only", async () => {
    const { rerenderTicket } = renderTicket();
    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "BUY" },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "MARKET" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("lets the user type a quantity and submit through the existing ticket path", async () => {
    const user = userEvent.setup();
    mockedPlace.mockResolvedValue(filledMarket());
    const { rerenderTicket } = renderTicket();
    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true"));
    expect(mockedPlace).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Quantity"), "0.25");
    await user.click(screen.getByRole("button", { name: /Place MARKET SELL/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toEqual({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.25",
      reduceOnly: true,
    });
  });

  it("waits for the matching symbol before applying a one-shot command", async () => {
    const user = userEvent.setup();
    const { rerenderTicket } = renderTicket({ symbol: "BTCUSDT" });
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    rerenderTicket({
      symbol: "BTCUSDT",
      reducePrefill: { id: 1, symbol: "ETHUSDT", side: "SELL" },
    });
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.5");
    expect(screen.getByRole("button", { name: "BUY" })).toHaveAttribute("aria-pressed", "true");

    rerenderTicket({
      symbol: "ETHUSDT",
      reducePrefill: { id: 1, symbol: "ETHUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByLabelText("Quantity")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("does not reapply an old Reduce command after the user leaves and returns to the symbol", async () => {
    const user = userEvent.setup();
    const { rerenderTicket } = renderTicket({ symbol: "BTCUSDT" });
    rerenderTicket({
      symbol: "BTCUSDT",
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    await user.click(screen.getByRole("checkbox", { name: "Reduce only" }));
    await user.click(screen.getByRole("button", { name: "LIMIT" }));
    await user.type(screen.getByLabelText("Limit price"), "99");

    rerenderTicket({
      symbol: "ETHUSDT",
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.5");

    rerenderTicket({
      symbol: "BTCUSDT",
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    expect(screen.getByLabelText("Quantity")).toHaveValue("0.5");
    expect(screen.getByRole("button", { name: "LIMIT" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).not.toBeChecked();
    expect(screen.getByLabelText("Limit price")).toHaveValue("99");
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("re-applies Reduce defaults when the same row is clicked again after edits", async () => {
    const user = userEvent.setup();
    const { rerenderTicket } = renderTicket();
    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    await user.type(screen.getByLabelText("Quantity"), "0.5");
    await user.click(screen.getByRole("button", { name: "LIMIT" }));

    rerenderTicket({
      reducePrefill: { id: 2, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.getByLabelText("Quantity")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "MARKET" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Reduce only" })).toBeChecked();
    expect(screen.queryByLabelText("Limit price")).not.toBeInTheDocument();
  });

  it("clears a local validation error when Reduce is applied", async () => {
    const user = userEvent.setup();
    const { rerenderTicket } = renderTicket();
    await user.click(screen.getByRole("button", { name: /Place MARKET BUY/i }));
    expect(await screen.findByText("Quantity must be a positive decimal string.")).toBeInTheDocument();

    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Quantity must be a positive decimal string.")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Quantity")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("clears a failed placement banner and starts a fresh ticket intent", async () => {
    const user = userEvent.setup();
    mockedPlace.mockRejectedValue(new Error("network"));
    const { rerenderTicket } = renderTicket();
    await user.click(screen.getByRole("button", { name: "SELL" }));
    await user.click(screen.getByRole("checkbox", { name: "Reduce only" }));
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET SELL/i }));
    expect(await screen.findByText("network")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry same order" })).toBeInTheDocument();
    const firstKey = mockedPlace.mock.calls[0]?.[1];

    rerenderTicket({
      reducePrefill: { id: 1, symbol: "BTCUSDT", side: "SELL" },
    });
    await waitFor(() => expect(screen.queryByText("network")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Retry same order" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("");

    mockedPlace.mockRejectedValue(new Error("network"));
    await user.type(screen.getByLabelText("Quantity"), "0.001");
    await user.click(screen.getByRole("button", { name: /Place MARKET SELL/i }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).not.toBe(firstKey);
    expect(mockedPlace.mock.calls[1]?.[0]).toEqual({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.001",
      reduceOnly: true,
    });
  });
});
