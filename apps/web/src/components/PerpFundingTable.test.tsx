import type { PerpFundingHistoryItem } from "@notional/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PerpFundingTable } from "./PerpFundingTable.tsx";
import { listPerpFunding } from "../lib/api/funding.ts";

vi.mock("../lib/api/funding.ts", () => ({
  listPerpFunding: vi.fn(),
}));

const mocked = vi.mocked(listPerpFunding);

const base: PerpFundingHistoryItem = {
  id: "f-1",
  symbol: "BTCUSDT",
  fundingTime: "2024-01-02T03:04:05.123Z",
  marginMode: "CROSS",
  quantity: "0.1",
  fundingRate: "0.0001",
  markPrice: "100",
  fundingPayment: "1.25",
  createdAt: "2024-01-02T03:04:05.123Z",
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("PerpFundingTable", () => {
  it("colors payment by exact decimal sign and keeps -0 / malformed neutral", async () => {
    mocked.mockResolvedValue({
      funding: [
        base,
        { ...base, id: "f-2", fundingPayment: "-1.25" },
        { ...base, id: "f-3", fundingPayment: "0" },
        { ...base, id: "f-4", fundingPayment: "-0" },
        { ...base, id: "f-5", fundingPayment: "not-a-decimal" },
      ],
    });

    render(<PerpFundingTable limit={50} offset={0} />, { wrapper });

    const gain = await screen.findByText("1.25");
    expect(gain.className).toContain("text-positive");
    expect(screen.getByText("-1.25").className).toContain("text-negative");
    expect(screen.getByText("0").className).not.toContain("text-positive");
    expect(screen.getByText("0").className).not.toContain("text-negative");
    expect(screen.getByText("-0").className).not.toContain("text-positive");
    expect(screen.getByText("-0").className).not.toContain("text-negative");
    expect(screen.getByText("not-a-decimal").className).not.toContain("text-positive");
    expect(screen.getByText("not-a-decimal").className).not.toContain("text-negative");
    expect(screen.getAllByText("2024-01-02 03:04:05 UTC").length).toBeGreaterThan(0);
  });

  it("shows the trailing-page empty copy", async () => {
    mocked.mockResolvedValue({ funding: [] });
    render(<PerpFundingTable limit={50} offset={50} />, { wrapper });
    expect(await screen.findByText("No more perpetual funding settlements.")).toBeInTheDocument();
  });
});
