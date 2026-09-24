import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Input } from "./Input.tsx";
import { Tabs } from "./Tabs.tsx";
import { Th } from "./table.tsx";

const TRADE_COLOR = /positive|negative|green|red|buy|sell|danger|success/;

describe("Button", () => {
  it("renders a primary CTA with accent foreground, not white-on-amber", () => {
    render(
      <Button variant="primary" type="button">
        Create paper account
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Create paper account" });
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button.className).toContain("bg-accent");
    expect(button.className).toContain("text-accent-foreground");
    expect(button.className).not.toContain("text-white");
    expect(button.className).not.toMatch(TRADE_COLOR);
  });

  it("exposes disabled state", () => {
    render(
      <Button type="button" disabled>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps buy/sell as amber selected controls instead of green/red fills", () => {
    const { rerender } = render(
      <Button type="button" variant="buy">
        BUY / LONG
      </Button>,
    );
    let button = screen.getByRole("button", { name: "BUY / LONG" });
    expect(button.className).toContain("border-accent");
    expect(button.className).toContain("bg-accent-soft");
    expect(button.className).not.toMatch(/positive|negative|green|red/);
    expect(button.className).not.toContain("text-white");

    rerender(
      <Button type="button" variant="sell">
        SELL / SHORT
      </Button>,
    );
    button = screen.getByRole("button", { name: "SELL / SHORT" });
    expect(button.className).toContain("border-accent");
    expect(button.className).toContain("bg-accent-soft");
    expect(button.className).not.toMatch(/positive|negative|green|red/);
  });
});

describe("Input", () => {
  it("uses body font by default and mono only when numeric", () => {
    const { rerender } = render(<Input aria-label="Email" />);
    expect(screen.getByLabelText("Email").className).not.toContain("font-numeric");
    rerender(<Input aria-label="Quantity" numeric />);
    expect(screen.getByLabelText("Quantity").className).toContain("font-numeric");
  });
});

describe("Tabs", () => {
  it("keeps tab roles and selected state", () => {
    render(
      <Tabs
        tabs={[
          { id: "positions", label: "Positions" },
          { id: "orders", label: "Open orders" },
        ]}
        value="positions"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Positions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Open orders" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("ErrorBanner", () => {
  it("uses warning treatment instead of trading red", () => {
    render(<ErrorBanner error={new Error("INVALID_ORDER: MIN_NOTIONAL")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("INVALID_ORDER: MIN_NOTIONAL");
    expect(alert.className).toContain("border-warning-border");
    expect(alert.className).toContain("bg-warning-background");
    expect(alert.className).not.toMatch(/negative|danger|red/);
  });
});

describe("Th", () => {
  it("defaults to column scope and accepts a row override", () => {
    const { rerender } = render(
      <table>
        <thead>
          <tr>
            <Th>Symbol</Th>
          </tr>
        </thead>
      </table>,
    );

    expect(screen.getByRole("columnheader", { name: "Symbol" })).toHaveAttribute("scope", "col");

    rerender(
      <table>
        <tbody>
          <tr>
            <Th scope="row">BTCUSDT</Th>
            <td>1</td>
          </tr>
        </tbody>
      </table>,
    );

    expect(screen.getByRole("rowheader", { name: "BTCUSDT" })).toHaveAttribute("scope", "row");
  });
});
