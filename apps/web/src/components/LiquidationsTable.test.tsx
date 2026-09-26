import type { LiquidationResponse } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { LiquidationsTable } from "./LiquidationsTable.tsx";
import { listLiquidations } from "../lib/api/liquidations.ts";

vi.mock("../lib/api/liquidations.ts", () => ({
  listLiquidations: vi.fn(),
}));

const mocked = vi.mocked(listLiquidations);

const row: LiquidationResponse = {
  id: "liq-1",
  marginMode: "CROSS",
  symbol: null,
  equity: "100.5",
  maintenanceMargin: "20.25",
  createdAt: "2024-01-02T03:04:05.123Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("LiquidationsTable", () => {
  it("renders snapshot fields without PnL coloring and keeps the CROSS fallback", async () => {
    mocked.mockResolvedValue({
      liquidations: [row, { ...row, id: "liq-2", symbol: "BTCUSDT", marginMode: "ISOLATED" }],
    });

    render(<LiquidationsTable limit={50} offset={0} />, { wrapper });

    expect(await screen.findByText("ISOLATED")).toBeInTheDocument();
    expect(screen.getAllByText("CROSS")[0]).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Equity" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.getAllByText("100.5")[0].className).not.toContain("text-positive");
    expect(screen.getAllByText("100.5")[0].className).not.toContain("text-negative");
    expect(screen.getAllByText("20.25")[0].className).not.toContain("text-positive");
    expect(screen.getAllByText("20.25")[0].className).not.toContain("text-negative");
    expect(screen.getAllByText("2024-01-02 03:04:05 UTC").length).toBeGreaterThan(0);
  });

  it("shows the trailing-page empty copy", async () => {
    mocked.mockResolvedValue({ liquidations: [] });
    render(<LiquidationsTable limit={50} offset={50} />, { wrapper });
    expect(await screen.findByText("No more liquidations.")).toBeInTheDocument();
  });
});
