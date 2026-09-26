import type { InstrumentResponse } from "@notional/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SymbolSelector } from "./SymbolSelector.tsx";

const btc = sample("BTCUSDT", "BTC");
const eth = sample("ETHUSDT", "ETH");
const sol = sample("SOLUSDT", "SOL");

describe("SymbolSelector", () => {
  it("shows the committed symbol while closed", () => {
    renderSelector({ value: "ETHUSDT" });
    expect(combobox()).toHaveValue("ETHUSDT");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens a listbox of catalog instruments", async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(combobox());
    const list = screen.getByRole("listbox");
    expect(list).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /BTCUSDT/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /ETHUSDT/ })).toBeInTheDocument();
    expect(screen.getByText("USDT perpetual")).toBeInTheDocument();
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    expect(combobox()).toHaveAttribute("aria-autocomplete", "list");
    expect(combobox().getAttribute("aria-controls")).toBe(list.id);
  });

  it("filters by typed text without calling onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelector({ onChange });
    await user.click(combobox());
    await user.type(combobox(), "eth");
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox()).toHaveValue("eth");
    expect(screen.getByRole("option", { name: /ETHUSDT/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /BTCUSDT/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /SOLUSDT/ })).not.toBeInTheDocument();
  });

  it("starts a fresh search from a closed focused field instead of appending to the committed symbol", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelector({ onChange, value: "ETHUSDT" });
    await user.click(combobox());
    await user.keyboard("{Escape}");
    expect(combobox()).toHaveValue("ETHUSDT");
    await user.keyboard("B");
    expect(onChange).not.toHaveBeenCalled();
    expect(combobox()).toHaveValue("B");
    expect(screen.getByRole("option", { name: /BTCUSDT/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ETHUSDT/ })).not.toBeInTheDocument();
  });

  it("does not commit partial BTC keystrokes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelector({ onChange, value: "ETHUSDT" });
    await user.click(combobox());
    await user.type(combobox(), "BTC");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith("B");
    expect(onChange).not.toHaveBeenCalledWith("BT");
    expect(onChange).not.toHaveBeenCalledWith("BTC");
    expect(onChange).not.toHaveBeenCalledWith("BTCUSDT");
  });

  it("commits exactly once on pointer selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderHarness({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    await user.click(screen.getByRole("option", { name: /ETHUSDT/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("ETHUSDT");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("ETHUSDT");
  });

  it("does not commit on touch pointerdown alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderHarness({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    fireEvent.pointerDown(screen.getByRole("option", { name: /ETHUSDT/ }), {
      button: 0,
      pointerType: "touch",
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not commit a touch scroll-like gesture without a click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderHarness({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    const option = screen.getByRole("option", { name: /ETHUSDT/ });

    fireEvent.pointerDown(option, { button: 0, pointerType: "touch" });
    fireEvent.pointerMove(option, { pointerType: "touch" });
    fireEvent.pointerUp(option, { pointerType: "touch" });
    fireEvent.pointerCancel(option, { pointerType: "touch" });
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("commits a blur-sensitive tap exactly once after click, not pointerdown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderHarness({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    const option = screen.getByRole("option", { name: /ETHUSDT/ });

    fireEvent.pointerDown(option, { button: 0, pointerType: "touch" });
    fireEvent.blur(combobox(), { relatedTarget: null });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.pointerUp(option, { pointerType: "touch" });
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("ETHUSDT");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("ETHUSDT");
  });

  it("moves the active descendant with ArrowDown and ArrowUp", async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(combobox());
    const first = screen.getByRole("option", { name: /BTCUSDT/ });
    expect(combobox()).toHaveAttribute("aria-activedescendant", first.id);

    await user.keyboard("{ArrowDown}");
    const second = screen.getByRole("option", { name: /ETHUSDT/ });
    expect(combobox()).toHaveAttribute("aria-activedescendant", second.id);

    await user.keyboard("{ArrowDown}");
    const third = screen.getByRole("option", { name: /SOLUSDT/ });
    expect(combobox()).toHaveAttribute("aria-activedescendant", third.id);

    await user.keyboard("{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", third.id);

    await user.keyboard("{ArrowUp}");
    expect(combobox()).toHaveAttribute("aria-activedescendant", second.id);
  });

  it("commits the active option exactly once on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderHarness({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("ETHUSDT");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("ETHUSDT");
  });

  it("closes on Escape without committing and restores the committed symbol", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelector({ onChange, value: "ETHUSDT" });
    await user.click(combobox());
    await user.type(combobox(), "BTC");
    expect(combobox()).toHaveValue("BTC");
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("ETHUSDT");
  });

  it("closes on outside pointer without committing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelector({ onChange, value: "BTCUSDT" });
    await user.click(combobox());
    await user.type(combobox(), "ETH");
    fireEvent.pointerDown(document.body);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(combobox()).toHaveValue("BTCUSDT");
  });

  it("does not trap Tab", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SymbolSelector instruments={[btc, eth]} value="BTCUSDT" onChange={() => undefined} />
        <button type="button">Next control</button>
      </div>,
    );
    await user.click(combobox());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Next control" })).toHaveFocus();
  });

  it("shows a search miss state", async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(combobox());
    await user.type(combobox(), "DOGE");
    expect(screen.getByText("No matching instruments")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("is disabled when the catalog is empty", () => {
    render(
      <SymbolSelector instruments={[]} value={null} onChange={() => undefined} disabled />,
    );
    expect(combobox()).toBeDisabled();
    expect(screen.getByText("No instruments")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("displays an unknown committed value without selecting a fake option", async () => {
    const user = userEvent.setup();
    renderSelector({ value: "DOGEUSDT" });
    expect(combobox()).toHaveValue("DOGEUSDT");
    await user.click(combobox());
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("aria-selected", "false");
    }
    expect(screen.getByRole("option", { name: /BTCUSDT/ })).toBeInTheDocument();
  });

  it("marks the committed catalog instrument as aria-selected", async () => {
    const user = userEvent.setup();
    renderSelector({ value: "ETHUSDT" });
    await user.click(combobox());
    expect(screen.getByRole("option", { name: /ETHUSDT/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /BTCUSDT/ })).toHaveAttribute("aria-selected", "false");
  });

  it("does not render live market metrics in the list", async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(combobox());
    const list = screen.getByRole("listbox").parentElement as HTMLElement;
    expect(within(list).queryByText(/^Mark$/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/^Bid$/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/^Ask$/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/24h/i)).not.toBeInTheDocument();
    expect(within(list).queryByText(/funding/i)).not.toBeInTheDocument();
    expect(within(list).queryByText(/open interest/i)).not.toBeInTheDocument();
    expect(within(list).queryByText(/order book/i)).not.toBeInTheDocument();
  });
});

function combobox(): HTMLElement {
  return screen.getByRole("combobox", { name: "Instrument" });
}

function renderSelector({
  value = "BTCUSDT",
  onChange = () => undefined,
  instruments = [btc, eth, sol],
}: {
  value?: string | null;
  onChange?: (symbol: string) => void;
  instruments?: InstrumentResponse[];
} = {}) {
  return render(
    <SymbolSelector instruments={instruments} value={value} onChange={onChange} />,
  );
}

function renderHarness({
  value = "BTCUSDT",
  onChange,
  instruments = [btc, eth, sol],
}: {
  value?: string | null;
  onChange: (symbol: string) => void;
  instruments?: InstrumentResponse[];
}) {
  function Harness() {
    const [symbol, setSymbol] = useState(value);
    return (
      <SymbolSelector
        instruments={instruments}
        value={symbol}
        onChange={(next) => {
          onChange(next);
          setSymbol(next);
        }}
      />
    );
  }

  return render(<Harness />);
}

function sample(symbol: string, baseAsset: string): InstrumentResponse {
  return {
    id: symbol,
    symbol,
    baseAsset,
    quoteAsset: "USDT",
    contractType: "PERPETUAL",
    status: "ACTIVE",
    tickSize: "0.1",
    minPrice: "0.1",
    maxPrice: "1000000",
    stepSize: "0.001",
    minQty: "0.001",
    maxQty: "1000",
    marketStepSize: "0.001",
    marketMinQty: "0.001",
    marketMaxQty: "120",
    minNotional: "5",
  };
}
