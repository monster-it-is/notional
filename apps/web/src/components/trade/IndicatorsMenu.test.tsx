import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { IndicatorsMenu } from "./IndicatorsMenu.tsx";
import {
  DEFAULT_INDICATOR_SETTINGS,
  type IndicatorSettings,
} from "../../lib/chart/indicators/settings.ts";

function Harness({
  initial = DEFAULT_INDICATOR_SETTINGS,
  onChange,
}: {
  initial?: IndicatorSettings;
  onChange?: (settings: IndicatorSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <IndicatorsMenu
      settings={settings}
      onSettingsChange={(next) => {
        setSettings(next);
        onChange?.(next);
      }}
    />
  );
}

describe("IndicatorsMenu", () => {
  it("exposes an accessible disclosure with overlay and oscillator controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Indicators" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("SMA")).toBeInTheDocument();
    expect(screen.getByLabelText("EMA")).toBeInTheDocument();
    expect(screen.getByLabelText("Bollinger Bands")).toBeInTheDocument();
    expect(screen.getByLabelText("RSI")).toBeInTheDocument();
    expect(screen.getByLabelText("MACD")).toBeInTheDocument();
    expect(screen.getByLabelText("RSI period")).toBeInTheDocument();
    expect(screen.getByLabelText("MACD fast")).toBeInTheDocument();
    expect(screen.getByLabelText("MACD slow")).toBeInTheDocument();
    expect(screen.getByLabelText("MACD signal")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("toggles SMA immediately and commits a valid period on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    await user.click(screen.getByLabelText("SMA"));
    expect(screen.getByLabelText("SMA")).toBeChecked();
    expect(screen.getByRole("button", { name: "Indicators, 1 enabled" })).toBeInTheDocument();

    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "30");
    await user.keyboard("{Enter}");
    expect(period).toHaveValue("30");
    expect(screen.queryByText(/integer from 1 to 500/i)).not.toBeInTheDocument();
  });

  it("keeps the last valid period when a draft is invalid", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    const period = screen.getByLabelText("SMA period");
    await user.clear(period);
    await user.type(period, "9999");
    await user.tab();
    expect(screen.getByText("Enter an integer from 1 to 500.")).toBeInTheDocument();
    expect(period).toHaveAttribute("aria-invalid", "true");
    expect(period).toHaveValue("9999");
  });

  it("rejects an RSI period below 2 without committing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    const period = screen.getByLabelText("RSI period");
    await user.clear(period);
    await user.type(period, "1");
    await user.tab();
    expect(screen.getByText("Enter an integer from 2 to 500.")).toBeInTheDocument();
    expect(period).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not commit an invalid intermediate MACD triple", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    const fast = screen.getByLabelText("MACD fast");
    await user.clear(fast);
    await user.type(fast, "30");
    await user.tab();
    expect(screen.getByText(/fast less than slow/i)).toBeInTheDocument();
    expect(fast).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("MACD slow")).toHaveAttribute("aria-invalid", "true");
    expect(fast).toHaveValue("30");
    expect(screen.getByLabelText("MACD slow")).toHaveValue("26");
    expect(screen.getByLabelText("MACD signal")).toHaveValue("9");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits a valid MACD triple atomically", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Indicators" }));
    const fast = screen.getByLabelText("MACD fast");
    const slow = screen.getByLabelText("MACD slow");
    await user.clear(fast);
    await user.type(fast, "8");
    await user.clear(slow);
    await user.type(slow, "21");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ macd: expect.objectContaining({ fast: 8, slow: 21, signal: 9 }) }),
    );
    expect(screen.queryByText(/fast less than slow/i)).not.toBeInTheDocument();
  });

  it("closes on Escape and outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Harness />
        <button type="button">Outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Indicators" });
    await user.click(trigger);
    expect(screen.getByLabelText("SMA")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("SMA")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByLabelText("SMA")).not.toBeInTheDocument();
  });
});
