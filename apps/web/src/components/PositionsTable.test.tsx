import type { OrderResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PositionsTable } from "./PositionsTable.tsx";
import { ApiError } from "../lib/api/errors.ts";
import { listOrders, placeOrder } from "../lib/api/orders.ts";
import { listPositions } from "../lib/api/positions.ts";
import { queryKeys } from "../lib/query-keys.ts";

vi.mock("../lib/api/positions.ts", () => ({
  listPositions: vi.fn(),
}));

vi.mock("../lib/api/orders.ts", () => ({
  listOrders: vi.fn(),
  placeOrder: vi.fn(),
}));

const mocked = vi.mocked(listPositions);
const mockedOrders = vi.mocked(listOrders);
const mockedPlace = vi.mocked(placeOrder);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("PositionsTable", () => {
  it("shows a loading state", () => {
    mocked.mockReturnValue(new Promise(() => undefined));
    render(<PositionsTable />, { wrapper });
    expect(screen.getByText(/Loading positions/)).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mocked.mockResolvedValue({ positions: [] });
    render(<PositionsTable />, { wrapper });
    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
  });

  it("renders signed quantity as LONG/SHORT without float conversion", async () => {
    mocked.mockResolvedValue({
      positions: [
        {
          symbol: "BTCUSDT",
          quantity: "-0.5",
          entryPrice: "100",
          cumulativeRealizedPnl: "1.25",
          updatedAt: "t",
        },
      ],
    });
    render(<PositionsTable />, { wrapper });
    expect(await screen.findByText("SHORT")).toBeInTheDocument();
    expect(screen.getByText("-0.5")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("1.25").className).toContain("text-positive");
    expect(screen.getByText("SHORT").className).toContain("text-negative");
  });

  it("classifies realized PnL sign and keeps the original decimal string", async () => {
    mocked.mockResolvedValue({
      positions: [
        {
          symbol: "ETHUSDT",
          quantity: "1",
          entryPrice: "10",
          cumulativeRealizedPnl: "-1.25",
          updatedAt: "t",
        },
        {
          symbol: "SOLUSDT",
          quantity: "2",
          entryPrice: "10",
          cumulativeRealizedPnl: "0",
          updatedAt: "t",
        },
        {
          symbol: "BNBUSDT",
          quantity: "3",
          entryPrice: "10",
          cumulativeRealizedPnl: "-0",
          updatedAt: "t",
        },
      ],
    });
    render(<PositionsTable />, { wrapper });
    const loss = await screen.findByText("-1.25");
    expect(loss.className).toContain("text-negative");
    const zero = screen.getByText("0");
    expect(zero.className).not.toContain("text-positive");
    expect(zero.className).not.toContain("text-negative");
    const negativeZero = screen.getByText("-0");
    expect(negativeZero.className).not.toContain("text-negative");
    expect(negativeZero.className).not.toContain("text-positive");
  });
});

function position(symbol: string, quantity: string) {
  return {
    symbol,
    quantity,
    entryPrice: "100",
    cumulativeRealizedPnl: "0",
    updatedAt: "t",
  };
}

function filledClose(side: "BUY" | "SELL", quantity: string): OrderResponse {
  return {
    id: "close-1",
    symbol: "BTCUSDT",
    side,
    type: "MARKET",
    quantity,
    limitPrice: null,
    reduceOnly: true,
    status: "FILLED",
    origin: "USER",
    createdAt: "t",
    updatedAt: "t",
  };
}

function renderPositions(ui: ReactElement = <PositionsTable />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: string[] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters, options) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return original(filters, options);
  }) as typeof client.invalidateQueries;

  const view = render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });

  return { client, invalidated, ...view };
}

describe("PositionsTable close", () => {
  beforeEach(() => {
    mockedOrders.mockReset();
    mockedPlace.mockReset();
    mockedOrders.mockResolvedValue({ orders: [] });
  });

  it("does not offer Close for a flat quantity", async () => {
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "0")] });
    renderPositions();
    expect(await screen.findByText("FLAT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close BTCUSDT" })).not.toBeInTheDocument();
  });

  it("disables Close while the account is suspended", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    const { rerender } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    rerender(<PositionsTable disabled />);
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("opens a reduce-only market close confirmation without submitting", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    renderPositions();
    const opener = await screen.findByRole("button", { name: "Close BTCUSDT" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    expect(dialog).toHaveTextContent("This is a reduce-only market close.");
    expect(within(dialog).getByText("BTCUSDT")).toBeInTheDocument();
    expect(within(dialog).getByText("SELL")).toBeInTheDocument();
    expect(within(dialog).getByText("1.25")).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("closes a long with SELL, the exact quantity, and reduceOnly market", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    const { invalidated } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toEqual({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "1.25",
      reduceOnly: true,
    });
    expect(mockedPlace.mock.calls[0]?.[0]).not.toHaveProperty("limitPrice");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("FILLED")).not.toBeInTheDocument();
    expect(invalidated).toEqual(
      [
        queryKeys.orders.all,
        queryKeys.account,
        queryKeys.positions.all,
        queryKeys.perpFunding.all,
        queryKeys.executions.all,
      ].map((key) => JSON.stringify(key)),
    );
  });

  it("closes a short with BUY and strips only the leading minus", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "-0.50000000")] });
    mockedPlace.mockResolvedValue(filledClose("BUY", "0.50000000"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    expect(within(dialog).getByText("BUY")).toBeInTheDocument();
    expect(within(dialog).getByText("0.50000000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(mockedPlace.mock.calls[0]?.[0]).toEqual({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: "0.50000000",
      reduceOnly: true,
    });
    expect(mockedPlace.mock.calls[0]?.[0]).not.toHaveProperty("limitPrice");
  });

  it("disables confirm while the close is pending", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const confirm = await screen.findByRole("button", { name: "Confirm close" });
    await user.click(confirm);
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeDisabled();
    await user.click(confirm);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("does not replace an in-flight close with another position", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({
      positions: [position("BTCUSDT", "1.25"), position("ETHUSDT", "2")],
    });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Close ETHUSDT" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close ETHUSDT" }));
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Close ETHUSDT" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("1.25")).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("reuses the close idempotency key until the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockRejectedValue(new Error("network"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(2));
    expect(mockedPlace.mock.calls[1]?.[1]).toBe(mockedPlace.mock.calls[0]?.[1]);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close BTCUSDT" }));
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(3));
    expect(mockedPlace.mock.calls[2]?.[1]).not.toBe(mockedPlace.mock.calls[0]?.[1]);
  });

  it("warns when a reduce-only open order exists and does not cancel it", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedOrders.mockResolvedValue({
      orders: [
        {
          id: "ord-1",
          symbol: "BTCUSDT",
          side: "SELL",
          type: "LIMIT",
          quantity: "0.1",
          limitPrice: "100",
          reduceOnly: true,
          status: "OPEN",
          origin: "USER",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(
      await screen.findByText(
        "This symbol has reduce-only open orders. A market close does not cancel them. They may stay OPEN but become unfillable. Cancel them from Open orders if you want them gone.",
      ),
    ).toBeInTheDocument();
    expect(mockedOrders).toHaveBeenCalledWith({
      status: "OPEN",
      symbol: "BTCUSDT",
      limit: 100,
      offset: 0,
    });
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("does not warn for ordinary open orders", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedOrders.mockResolvedValue({
      orders: [
        {
          id: "ord-1",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          quantity: "0.1",
          limitPrice: "100",
          reduceOnly: false,
          status: "OPEN",
          origin: "USER",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mockedOrders).toHaveBeenCalled());
    expect(screen.queryByText(/This symbol has reduce-only open orders/)).not.toBeInTheDocument();
  });

  it("still allows close when the open-order check fails", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedOrders.mockRejectedValue(new Error("orders down"));
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(await screen.findByText("Unable to check open reduce-only orders")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm close" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
  });

  it("still allows close while the open-order check is loading", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedOrders.mockReturnValue(new Promise(() => undefined));
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const confirm = await screen.findByRole("button", { name: "Confirm close" });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText(/Unable to check open reduce-only orders/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This symbol has reduce-only open orders/)).not.toBeInTheDocument();
    await user.click(confirm);
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
  });

  it("does not submit a close after the cached position quantity changes", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "-0.50000000")] });
    const { client } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    client.setQueryData(queryKeys.positions.all, {
      positions: [position("BTCUSDT", "-0.40000000")],
    });
    expect(await screen.findByText("-0.40000000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText("0.50000000")).toBeInTheDocument();
    expect(
      screen.getByText("Position changed. Cancel and reopen Close to review the current size."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const reopened = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    expect(within(reopened).getByText("0.40000000")).toBeInTheDocument();
    expect(within(reopened).queryByText("0.50000000")).not.toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("does not submit a close after the cached position disappears", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    const { client } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    client.setQueryData(queryKeys.positions.all, { positions: [] });
    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText("1.25")).toBeInTheDocument();
    expect(
      screen.getByText("Position changed. Cancel and reopen Close to review the current size."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    client.setQueryData(queryKeys.positions.all, {
      positions: [position("BTCUSDT", "9.5")],
    });
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(within(await screen.findByRole("dialog")).getByText("9.5")).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("keeps REDUCE_ONLY_VIOLATION visible in the confirmation", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockRejectedValue(
      new ApiError({ status: 409, code: "REDUCE_ONLY_VIOLATION" }),
    );
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("REDUCE_ONLY_VIOLATION");
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });
});
