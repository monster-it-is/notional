import type { OrderResponse, PositionResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PositionsTable } from "./PositionsTable.tsx";
import { ApiError } from "../lib/api/errors.ts";
import { listOrders, placeOrder } from "../lib/api/orders.ts";
import { listPositions } from "../lib/api/positions.ts";
import { formatAdaptiveMarketPriceDisplay } from "../lib/format-adaptive-market-price.ts";
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

  it("shows ErrorBanner when the initial positions request fails with no cached data", async () => {
    mocked.mockRejectedValue(new Error("positions down"));
    render(<PositionsTable />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("positions down");
    expect(screen.queryByText("No open positions.")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders signed quantity as LONG/SHORT without float conversion", async () => {
    mocked.mockResolvedValue({
      positions: [
        position("BTCUSDT", "-0.5", {
          cumulativeRealizedPnl: "1.25",
        }),
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
        position("ETHUSDT", "1", { entryPrice: "10", cumulativeRealizedPnl: "-1.25" }),
        position("SOLUSDT", "2", { entryPrice: "10", cumulativeRealizedPnl: "0" }),
        position("BNBUSDT", "3", { entryPrice: "10", cumulativeRealizedPnl: "-0" }),
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

  it("renders mark, unrealized pnl, mode, leverage, and cumulative realized copy", async () => {
    mocked.mockResolvedValue({
      positions: [
        position("BTCUSDT", "1", {
          markPrice: "110",
          unrealizedPnl: "10",
          cumulativeRealizedPnl: "4",
          marginMode: "CROSS",
          leverage: 5,
        }),
      ],
    });
    render(<PositionsTable />, { wrapper });
    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("110.000")).toBeInTheDocument();
    const unrealized = screen.getByText("10");
    expect(unrealized.className).toContain("text-positive");
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("CROSS")).toBeInTheDocument();
    expect(screen.getByText("5x")).toBeInTheDocument();
    expect(screen.getByText("Cumulative realized")).toBeInTheDocument();
    expect(screen.getByText("Cumulative realized")).toHaveAttribute(
      "title",
      "Lifetime realized PnL for this symbol, including earlier reductions. Not this leg only.",
    );
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeEnabled();
  });

  it("renders the exact cumulative realized API string with existing sign styling", async () => {
    mocked.mockResolvedValue({
      positions: [
        position("BTCUSDT", "1", {
          cumulativeRealizedPnl: "12.340000000000000000",
        }),
        position("ETHUSDT", "-1", {
          cumulativeRealizedPnl: "-8.760000000000000000",
        }),
      ],
    });
    render(<PositionsTable />, { wrapper });

    const header = await screen.findByRole("columnheader", {
      name: "Cumulative realized",
    });
    expect(header).toHaveTextContent(/^Cumulative realized$/);
    expect(header).toHaveAttribute(
      "title",
      "Lifetime realized PnL for this symbol, including earlier reductions. Not this leg only.",
    );

    const gain = screen.getByText("12.340000000000000000");
    expect(gain.textContent).toBe("12.340000000000000000");
    expect(gain.className).toContain("text-positive");

    const loss = screen.getByText("-8.760000000000000000");
    expect(loss.textContent).toBe("-8.760000000000000000");
    expect(loss.className).toContain("text-negative");
  });

  it("renders em dashes for null mark and unrealized pnl", async () => {
    mocked.mockResolvedValue({
      positions: [position("ETHUSDT", "2", { marginMode: "ISOLATED", leverage: 20 })],
    });
    render(<PositionsTable />, { wrapper });
    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(2);
    expect(dashes[0]?.className).not.toContain("text-positive");
    expect(dashes[0]?.className).not.toContain("text-negative");
    expect(dashes[1]?.className).not.toContain("text-positive");
    expect(dashes[1]?.className).not.toContain("text-negative");
    expect(screen.getByText("ISOLATED")).toBeInTheDocument();
    expect(screen.getByText("20x")).toBeInTheDocument();
  });

  it("classifies unrealized pnl sign without changing the returned string", async () => {
    mocked.mockResolvedValue({
      positions: [
        position("BTCUSDT", "1", { markPrice: "110", unrealizedPnl: "12.5" }),
        position("ETHUSDT", "-1", { markPrice: "110", unrealizedPnl: "-9.25" }),
        position("SOLUSDT", "1", {
          markPrice: "100",
          unrealizedPnl: "0",
          cumulativeRealizedPnl: "3",
        }),
      ],
    });
    render(<PositionsTable />, { wrapper });
    const gain = await screen.findByText("12.5");
    expect(gain.className).toContain("text-positive");
    const loss = screen.getByText("-9.25");
    expect(loss.className).toContain("text-negative");
    const solRow = screen.getByText("SOLUSDT").closest("tr");
    expect(solRow).not.toBeNull();
    const zero = within(solRow as HTMLElement).getByText("0");
    expect(zero.className).not.toContain("text-positive");
    expect(zero.className).not.toContain("text-negative");
  });

  it("polls positions every second while mounted and stops after unmount", async () => {
    mocked.mockResolvedValue({ positions: [] });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <PositionsTable />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
    const query = client.getQueryCache().find({ queryKey: queryKeys.positions.all });
    expect(query).toBeDefined();
    const observerOptions = (
      query as unknown as {
        observers: Array<{
          options: { staleTime?: number; refetchInterval?: number | false };
        }>;
      }
    ).observers[0]?.options;
    expect(observerOptions?.staleTime).toBe(0);
    expect(observerOptions?.refetchInterval).toBe(1000);
    expect(query?.getObserversCount()).toBeGreaterThan(0);
    unmount();
    expect(query?.getObserversCount()).toBe(0);
  });

  it("uses a local fixed table layout with explicit column widths", async () => {
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1")] });
    render(<PositionsTable />, { wrapper });

    const table = await screen.findByRole("table");
    expect(table.className).toContain("table-fixed");
    expect(table.className).toContain("min-w-[");

    const cols = [...table.querySelectorAll("col")];
    expect(table.querySelector("colgroup")).not.toBeNull();
    expect(cols).toHaveLength(11);
    const widths = cols.map((col) => col.style.width);
    expect(widths.every((width) => width.endsWith("rem"))).toBe(true);
    expect(new Set(widths).size).toBeGreaterThan(1);
  });

  it("keeps long exact mark and unrealized pnl strings inside contained columns", async () => {
    const mark = "99999.123456789012345678";
    const unrealizedPnl = "-1234.000000000000123";
    mocked.mockResolvedValue({
      positions: [
        position("BTCUSDT", "1", {
          markPrice: mark,
          unrealizedPnl,
          cumulativeRealizedPnl: "12.340000000000000000",
        }),
      ],
    });
    render(<PositionsTable />, { wrapper });

    const formattedMark = formatAdaptiveMarketPriceDisplay(mark);
    const markCell = await screen.findByText(formattedMark);
    expect(markCell.textContent).toBe(formattedMark);
    expect(markCell).toHaveAttribute("title", mark);
    expect(markCell.className).toContain("whitespace-nowrap");
    expect(markCell.className).toContain("overflow-hidden");
    expect(markCell.className).toContain("text-ellipsis");

    const unrealizedCell = screen.getByText(unrealizedPnl);
    expect(unrealizedCell.textContent).toBe(unrealizedPnl);
    expect(unrealizedCell).toHaveAttribute("title", unrealizedPnl);
    expect(unrealizedCell.className).toContain("text-negative");
    expect(unrealizedCell.className).toContain("whitespace-nowrap");
    expect(unrealizedCell.className).toContain("overflow-hidden");

    const realized = screen.getByText("12.340000000000000000");
    expect(realized.textContent).toBe("12.340000000000000000");
    expect(realized).toHaveAttribute("title", "12.340000000000000000");
    expect(realized.className).toContain("text-positive");
    expect(screen.getByRole("columnheader", { name: "Cumulative realized" })).toHaveAttribute(
      "title",
      "Lifetime realized PnL for this symbol, including earlier reductions. Not this leg only.",
    );
  });

  it("keeps a long exact positive unrealized pnl string and class", async () => {
    mocked.mockResolvedValue({
      positions: [
        position("ETHUSDT", "1", {
          markPrice: "110",
          unrealizedPnl: "1234.000000000000123",
        }),
      ],
    });
    render(<PositionsTable />, { wrapper });

    const gain = await screen.findByText("1234.000000000000123");
    expect(gain.textContent).toBe("1234.000000000000123");
    expect(gain).toHaveAttribute("title", "1234.000000000000123");
    expect(gain.className).toContain("text-positive");
  });

  it("still renders em dashes for null mark and unrealized pnl after layout containment", async () => {
    mocked.mockResolvedValue({ positions: [position("ETHUSDT", "2")] });
    render(<PositionsTable />, { wrapper });

    expect(await screen.findByText("ETHUSDT")).toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(2);
    expect(dashes[0]).not.toHaveAttribute("title");
    expect(dashes[1]).not.toHaveAttribute("title");
    expect(dashes[0]?.className).not.toContain("text-positive");
    expect(dashes[0]?.className).not.toContain("text-negative");
    expect(dashes[1]?.className).not.toContain("text-positive");
    expect(dashes[1]?.className).not.toContain("text-negative");
  });
});

function position(
  symbol: string,
  quantity: string,
  overrides: Partial<PositionResponse> = {},
): PositionResponse {
  return {
    symbol,
    quantity,
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

function appearsBefore(first: HTMLElement, second: HTMLElement): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
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

  it("keeps an idle close confirmation when a background positions refetch fails", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    const { client } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });

    mocked.mockRejectedValue(new Error("positions refresh failed"));
    await client.refetchQueries({ queryKey: queryKeys.positions.all });

    expect(await screen.findByRole("alert")).toHaveTextContent("positions refresh failed");
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close BTCUSDT" })).toBeEnabled();
    expect(screen.getByRole("cell", { name: "1.25" })).toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();

    mocked.mockResolvedValue({
      positions: [position("BTCUSDT", "1.25", { markPrice: "110", unrealizedPnl: "12.5" })],
    });
    await client.refetchQueries({ queryKey: queryKeys.positions.all });

    expect(await screen.findByText("110.000")).toBeInTheDocument();
    expect(screen.queryByText("positions refresh failed")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(mockedPlace).not.toHaveBeenCalled();
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
    expect(dialog.className).toContain("focus:outline-2");
    expect(dialog.className).toContain("focus:outline-offset-2");
    expect(dialog.className).toContain("focus:outline-ring");
    expect(dialog.className).not.toContain("outline-none");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("dismisses the idle close confirmation on Escape from a descendant and restores opener focus", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    renderPositions();
    const opener = await screen.findByRole("button", { name: "Close BTCUSDT" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(cancel).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("does not dismiss a pending close confirmation on Escape", async () => {
    const user = userEvent.setup();
    let resolveClose: (order: OrderResponse) => void = () => undefined;
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClose = resolve;
        }),
    );
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();

    dialog.focus();
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBe(dialog);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeDisabled();
    expect(mockedPlace).toHaveBeenCalledTimes(1);

    resolveClose(filledClose("SELL", "1.25"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps a long exact close quantity visible and contained", async () => {
    const user = userEvent.setup();
    const signedQuantity = "123456789.123456789012345678";
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", signedQuantity)] });
    renderPositions();

    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    const dialog = await screen.findByRole("dialog", { name: "Close BTCUSDT" });
    const quantity = within(dialog).getByText(signedQuantity);

    expect(quantity.textContent).toBe(signedQuantity);
    expect(quantity.className).toContain("whitespace-nowrap");
    expect(quantity.closest("dd")?.className).toContain("min-w-0");
    expect(quantity.closest("dd")?.className).toContain("flex-1");
    expect(quantity.closest("dd")?.className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "Confirm close" })).toBeEnabled();
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

  it("does not treat mark or unrealized pnl refresh as a stale close", async () => {
    const user = userEvent.setup();
    const open = position("BTCUSDT", "1.25");
    mocked.mockResolvedValue({ positions: [open] });
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    const { client } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    client.setQueryData(queryKeys.positions.all, {
      positions: [{ ...open, markPrice: "110", unrealizedPnl: "12.5" }],
    });
    expect(await screen.findByText("110.000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm close" }));
    await waitFor(() => expect(mockedPlace).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText("Position changed. Cancel and reopen Close to review the current size."),
    ).not.toBeInTheDocument();
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

  it("shows the returned close acknowledgement after the dialog dismisses", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockedPlace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^BTCUSDT · MARKET SELL · FILLED$/);
    expect(status).toHaveClass("text-sm", "text-secondary");
    expect(appearsBefore(status, screen.getByRole("table"))).toBe(true);
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    expect(mockedPlace.mock.calls[0]?.[0]).toEqual({
      type: "MARKET",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "1.25",
      reduceOnly: true,
    });
  });

  it("keeps the close acknowledgement when the position list becomes empty", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    const { client } = renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET SELL · FILLED$/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mocked.mockResolvedValue({ positions: [] });
    await client.refetchQueries({ queryKey: queryKeys.positions.all });

    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^BTCUSDT · MARKET SELL · FILLED$/);
    expect(appearsBefore(status, screen.getByText("No open positions."))).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("clears the previous close acknowledgement when another confirmation opens", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({
      positions: [position("BTCUSDT", "1.25"), position("ETHUSDT", "-2")],
    });
    mockedPlace.mockResolvedValue(filledClose("SELL", "1.25"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET SELL · FILLED$/);

    await user.click(screen.getByRole("button", { name: "Close ETHUSDT" }));
    expect(await screen.findByRole("dialog", { name: "Close ETHUSDT" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge a failed close", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockRejectedValue(new Error("close failed"));
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("close failed");
    expect(screen.getByRole("dialog", { name: "Close BTCUSDT" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });

  it("replaces the previous close acknowledgement after the next success", async () => {
    const user = userEvent.setup();
    mocked.mockResolvedValue({
      positions: [position("BTCUSDT", "1.25"), position("ETHUSDT", "-2")],
    });
    mockedPlace.mockResolvedValueOnce(filledClose("SELL", "1.25"));
    mockedPlace.mockResolvedValueOnce({
      ...filledClose("BUY", "2"),
      id: "close-2",
      symbol: "ETHUSDT",
      status: "OPEN",
    });
    renderPositions();
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^BTCUSDT · MARKET SELL · FILLED$/);

    await user.click(screen.getByRole("button", { name: "Close ETHUSDT" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^ETHUSDT · MARKET BUY · OPEN$/);
    expect(screen.queryByText("BTCUSDT · MARKET SELL · FILLED")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPlace).toHaveBeenCalledTimes(2);
    expect(mockedPlace.mock.calls[1]?.[0]).toEqual({
      type: "MARKET",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: "2",
      reduceOnly: true,
    });
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

describe("PositionsTable reduce", () => {
  beforeEach(() => {
    mockedOrders.mockReset();
    mockedPlace.mockReset();
    mockedOrders.mockResolvedValue({ orders: [] });
  });

  it("does not offer Reduce for a flat quantity", async () => {
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "0")] });
    renderPositions();
    expect(await screen.findByText("FLAT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reduce BTCUSDT" })).not.toBeInTheDocument();
  });

  it("asks to prefill a LONG position as SELL without placing", async () => {
    const user = userEvent.setup();
    const onReduce = vi.fn();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    renderPositions(<PositionsTable onReduce={onReduce} />);
    await user.click(await screen.findByRole("button", { name: "Reduce BTCUSDT" }));
    expect(onReduce).toHaveBeenCalledTimes(1);
    expect(onReduce).toHaveBeenCalledWith({ symbol: "BTCUSDT", side: "SELL" });
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("asks to prefill a SHORT position as BUY without placing", async () => {
    const user = userEvent.setup();
    const onReduce = vi.fn();
    mocked.mockResolvedValue({ positions: [position("ETHUSDT", "-0.50000000")] });
    renderPositions(<PositionsTable onReduce={onReduce} />);
    await user.click(await screen.findByRole("button", { name: "Reduce ETHUSDT" }));
    expect(onReduce).toHaveBeenCalledTimes(1);
    expect(onReduce).toHaveBeenCalledWith({ symbol: "ETHUSDT", side: "BUY" });
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("disables Reduce while the account is suspended", async () => {
    const onReduce = vi.fn();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    renderPositions(<PositionsTable disabled onReduce={onReduce} />);
    const reduce = await screen.findByRole("button", { name: "Reduce BTCUSDT" });
    expect(reduce).toBeDisabled();
    reduce.click();
    expect(onReduce).not.toHaveBeenCalled();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("disables Reduce while the order ticket is pending", async () => {
    const onReduce = vi.fn();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    renderPositions(<PositionsTable reduceDisabled onReduce={onReduce} />);
    const reduce = await screen.findByRole("button", { name: "Reduce BTCUSDT" });
    expect(reduce).toBeDisabled();
    reduce.click();
    expect(onReduce).not.toHaveBeenCalled();
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("disables Reduce while a close request is pending", async () => {
    const user = userEvent.setup();
    const onReduce = vi.fn();
    mocked.mockResolvedValue({ positions: [position("BTCUSDT", "1.25")] });
    mockedPlace.mockReturnValue(new Promise(() => undefined));
    renderPositions(<PositionsTable onReduce={onReduce} />);
    await user.click(await screen.findByRole("button", { name: "Close BTCUSDT" }));
    await user.click(await screen.findByRole("button", { name: "Confirm close" }));
    expect(mockedPlace).toHaveBeenCalledTimes(1);
    const reduce = screen.getByRole("button", { name: "Reduce BTCUSDT" });
    expect(reduce).toBeDisabled();
    reduce.click();
    expect(onReduce).not.toHaveBeenCalled();
    expect(mockedPlace).toHaveBeenCalledTimes(1);
  });
});
