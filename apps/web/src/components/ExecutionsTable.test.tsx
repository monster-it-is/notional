import type { ExecutionResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionsTable } from "./ExecutionsTable.tsx";
import { listExecutions } from "../lib/api/executions.ts";

vi.mock("../lib/api/executions.ts", () => ({
  listExecutions: vi.fn(),
}));

const mocked = vi.mocked(listExecutions);

const fill: ExecutionResponse = {
  id: "ex-1",
  orderId: "ord-uuid-1",
  symbol: "BTCUSDT",
  side: "BUY",
  orderType: "MARKET",
  quantity: "0.001",
  price: "100.5",
  executedAt: "2024-01-02T03:04:05.123Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("ExecutionsTable", () => {
  it("keeps Trade compact defaults: limit 20, six columns, no Order id", async () => {
    mocked.mockResolvedValue({
      executions: [{ ...fill, side: "SELL" }],
    });

    render(<ExecutionsTable />, { wrapper });

    expect(await screen.findByText("BTCUSDT")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith({ symbol: undefined, limit: 20, offset: 0 });
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Order" })).not.toBeInTheDocument();
    expect(screen.queryByText("ord-uuid-1")).not.toBeInTheDocument();
    expect(screen.getByText("SELL").className).toContain("text-negative");
  });

  it("shows the order id column when History opts in", async () => {
    mocked.mockResolvedValue({ executions: [fill] });
    render(<ExecutionsTable showOrderId limit={50} offset={0} />, { wrapper });

    expect(await screen.findByRole("columnheader", { name: "Order" })).toBeInTheDocument();
    expect(screen.getByText("ord-uuid-1")).toBeInTheDocument();
    expect(screen.getByText("BUY").className).toContain("text-positive");
    expect(mocked).toHaveBeenCalledWith({ symbol: undefined, limit: 50, offset: 0 });
  });

  it("shows empty and trailing-page empty copy", async () => {
    mocked.mockResolvedValue({ executions: [] });
    const { rerender } = render(<ExecutionsTable />, { wrapper });
    expect(await screen.findByText("No executions.")).toBeInTheDocument();

    rerender(<ExecutionsTable limit={50} offset={50} />);
    expect(await screen.findByText("No more executions.")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mocked.mockRejectedValue(new Error("fills down"));
    render(<ExecutionsTable />, { wrapper });
    expect(await screen.findByText("fills down")).toBeInTheDocument();
  });
});
