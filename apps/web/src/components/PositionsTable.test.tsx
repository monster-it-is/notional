import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PositionsTable } from "./PositionsTable.tsx";
import { listPositions } from "../lib/api/positions.ts";

vi.mock("../lib/api/positions.ts", () => ({
  listPositions: vi.fn(),
}));

const mocked = vi.mocked(listPositions);

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
  });
});
