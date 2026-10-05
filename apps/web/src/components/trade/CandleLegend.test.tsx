import type { Candle } from "@notional/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CandleLegend } from "./CandleLegend.tsx";

const candle: Candle = {
  openTime: 1_499_040_000_000,
  closeTime: 1_499_040_899_999,
  open: "100.00",
  high: "110.00",
  low: "90.00",
  close: "105.00",
  volume: "12.5",
};

describe("CandleLegend", () => {
  it("renders canonical formatted OHLCV, UTC time, and positive direction", () => {
    const { container } = render(<CandleLegend symbol="BTCUSDT" interval="15m" candle={candle} />);
    const legend = container.querySelector("dl");

    expect(legend).not.toBeNull();
    expect(legend).not.toHaveAttribute("aria-live");
    expect(legend?.className).toContain("pointer-events-none");
    expect(legend?.className).toContain("flex-wrap");
    expect(legend?.className).toContain("max-w-full");
    expect(legend?.className).toContain("min-w-0");
    expect(legend?.className).not.toMatch(/min-w-(?!0\b)\S+/);

    expect(screen.getByText("BTCUSDT · 15m · 2017-07-03 00:00:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("110.00")).toBeInTheDocument();
    expect(screen.getByText("90.00")).toBeInTheDocument();
    expect(screen.getByText("105.00")).toHaveClass("text-positive");
    expect(screen.getByText("+5.00")).toHaveClass("text-positive");
    expect(screen.getByText("+5.00%")).toHaveClass("text-positive");
    expect(screen.getByText("12.50")).toBeInTheDocument();
  });

  it("uses negative classes for a down candle and leaves zero change neutral", () => {
    const { rerender } = render(
      <CandleLegend
        symbol="BTCUSDT"
        interval="15m"
        candle={{ ...candle, close: "95.00" }}
      />,
    );

    expect(screen.getByText("-5.00")).toHaveClass("text-negative");
    expect(screen.getByText("-5.00%")).toHaveClass("text-negative");
    expect(screen.getByText("95.00")).toHaveClass("text-negative");

    rerender(<CandleLegend symbol="BTCUSDT" interval="15m" candle={{ ...candle, close: "100.00" }} />);
    expect(screen.getByText("0.00")).toHaveClass("text-foreground");
    expect(screen.getByText("0.00%")).toHaveClass("text-foreground");
    expect(screen.getByText("0.00")).not.toHaveClass("text-positive");
    expect(screen.getByText("0.00")).not.toHaveClass("text-negative");
  });

  it("shows an unavailable percent when open is zero", () => {
    render(
      <CandleLegend
        symbol="BTCUSDT"
        interval="15m"
        candle={{ ...candle, open: "0", close: "5.00" }}
      />,
    );

    expect(screen.getByText("Change %")).toBeInTheDocument();
    expect(screen.getByText("—")).toHaveClass("text-foreground");
    expect(screen.getByText("—")).not.toHaveClass("text-positive");
    expect(screen.getByText("+5.00")).toHaveClass("text-positive");
  });
});
